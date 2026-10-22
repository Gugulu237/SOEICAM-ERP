import { randomUUID } from 'node:crypto';

const openStates = ['loaded', 'in_transit'];
const normalizeName = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').trim().toLowerCase().replace(/\s+/g, ' ');
const hasId = value => typeof value === 'string' && value.trim().length > 0;

async function records(store, query = {}) {
  const result = [], seen = new Set();
  for (let offset = 0; ; offset += 200) {
    const page = await store.filter(query, 'id', 200, offset);
    if (!Array.isArray(page)) throw new Error('Could not verify vehicle stock locations.');
    for (const row of page) {
      if (seen.has(row.id)) throw new Error('Vehicle stock locations changed. Refresh and try again.');
      seen.add(row.id); result.push(row);
    }
    if (page.length < 200) return result;
  }
}

export const vehicleLocationCode = id => `VEH-${String(id).replace(/[^a-zA-Z0-9]/g, '').toUpperCase()}`;

function validateLocation(warehouse, vehicle, vehicles) {
  if (!warehouse || warehouse.is_active === false || warehouse.warehouse_type !== 'vehicle') throw new Error('Choose an active vehicle stock location.');
  if (hasId(warehouse.vehicle_id) && warehouse.vehicle_id !== vehicle.id) throw new Error('This stock location belongs to another vehicle. Choose this vehicle\'s own location.');
  if (vehicles.some(row => row.id !== vehicle.id && row.warehouse_id === warehouse.id)) throw new Error('A vehicle stock location cannot be shared by different vehicles.');
}

async function checkLocationChange(stores, previous, nextId) {
  if (!previous || previous.warehouse_id === nextId) return;
  const [runs, balances] = await Promise.all([
    records(stores.Dispatch, { status: { $in: openStates } }),
    hasId(previous.warehouse_id) ? records(stores.StockBalance, { warehouse_id: previous.warehouse_id }) : [],
  ]);
  if (runs.some(run => run.vehicle_id === previous.id || (hasId(previous.warehouse_id) && run.vehicle_warehouse_id === previous.warehouse_id))) throw new Error('Return or close the vehicle\'s open delivery run before changing its stock location.');
  if (balances.some(row => !Number.isFinite(Number(row.quantity ?? 0)) || Number(row.quantity ?? 0) !== 0)) throw new Error('Return all stock from the current vehicle location before changing it.');
}

// Call only within a serializable write transaction. Provisioning creates an
// empty location; it never creates stock, movements, sales or accounting rows.
export async function ensureVehicleStockLocation(stores, vehicle, { persist = true, previous = vehicle } = {}) {
  if (!vehicle || !hasId(vehicle.id)) throw new Error('Choose an existing vehicle before assigning its stock location.');
  if (vehicle.is_active === false && !hasId(vehicle.warehouse_id)) return { vehicle, warehouse: null, created: false, linked: false };
  const [vehicles, warehouses] = await Promise.all([records(stores.Vehicle), records(stores.Warehouse)]);
  let warehouse = null, created = false;
  if (hasId(vehicle.warehouse_id)) {
    warehouse = warehouses.find(row => row.id === vehicle.warehouse_id);
    validateLocation(warehouse, vehicle, vehicles);
  } else {
    if (vehicle.is_active === false) return { vehicle, warehouse: null, created: false, linked: false };
    const owned = warehouses.filter(row => row.vehicle_id === vehicle.id);
    if (owned.length > 1) throw new Error('This vehicle has multiple stock locations. Ask dispatch management to choose its correct location.');
    if (owned.length) warehouse = owned[0];
    else {
      const name = normalizeName(vehicle.name);
      const matching = name ? warehouses.filter(row => row.warehouse_type === 'vehicle' && normalizeName(row.name) === name) : [];
      if (matching.length > 1) throw new Error('Several stock locations match this vehicle. Choose its correct location explicitly.');
      if (matching.length) warehouse = matching[0];
    }
    if (warehouse) validateLocation(warehouse, vehicle, vehicles);
    else {
      const code = vehicleLocationCode(vehicle.id);
      if (warehouses.some(row => row.code === code)) throw new Error('The vehicle stock location code is already in use. Ask dispatch management to review it.');
      // Check old custody before creating anything, including recovery of a
      // missing mapping on a vehicle that already has an open run.
      await checkLocationChange(stores, previous, null);
      warehouse = await stores.Warehouse.create({
        name: vehicle.name || vehicle.registration || 'Delivery vehicle', code,
        warehouse_type: 'vehicle', vehicle_id: vehicle.id, is_active: true,
        ...(vehicle.branch_id ? { branch_id: vehicle.branch_id } : {}),
      });
      created = true;
    }
  }
  const linked = vehicle.warehouse_id !== warehouse.id;
  await checkLocationChange(stores, previous, warehouse.id);
  // Ownership is attached only when adopting a location or changing a mapping.
  // A valid legacy mapping is otherwise left entirely unchanged.
  if (!created && previous?.warehouse_id !== warehouse.id && warehouse.vehicle_id !== vehicle.id) warehouse = await stores.Warehouse.update(warehouse.id, { vehicle_id: vehicle.id });
  if (previous?.warehouse_id && previous.warehouse_id !== warehouse.id) {
    const old = warehouses.find(row => row.id === previous.warehouse_id);
    if (old?.vehicle_id === vehicle.id) await stores.Warehouse.update(old.id, { vehicle_id: null });
  }
  const updated = { ...vehicle, warehouse_id: warehouse.id };
  if (persist && linked) await stores.Vehicle.update(vehicle.id, { warehouse_id: warehouse.id });
  return { vehicle: updated, warehouse, created, linked };
}

// The caller has already applied mutation permissions and rejected client IDs.
// Generate the ID first so a newly provisioned location has a stable owner.
export async function prepareVehicleDefinition(stores, input, existing = null) {
  const value = { ...input };
  const id = existing?.id || randomUUID();
  const requested = Object.hasOwn(value, 'warehouse_id') ? value.warehouse_id : existing?.warehouse_id;
  if (requested != null && typeof requested !== 'string') throw new Error('Choose a valid vehicle stock location.');
  // An empty selection means automatic setup and retains an existing mapping.
  const vehicle = { ...existing, ...value, id, warehouse_id: requested?.trim() || existing?.warehouse_id || '', is_active: value.is_active ?? existing?.is_active ?? true };
  const result = await ensureVehicleStockLocation(stores, vehicle, { persist: false, previous: existing });
  return { ...value, ...(!existing ? { id } : {}), warehouse_id: result.vehicle.warehouse_id };
}
