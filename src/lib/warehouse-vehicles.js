import { warehouseItemStock } from './warehouse-stock.js';
import { warehouseSnapshot } from './warehouse-workspace.js';

// A location appears once, including legacy locations without a Vehicle record.
// Unlinked vehicles must never inherit another warehouse's stock.
export function vehicleStockOverview(warehouses, vehicles, products, balances) {
  const locations = warehouses.filter(warehouse => warehouse.warehouse_type === 'vehicle');
  const locationIds = new Set(locations.map(warehouse => warehouse.id));
  const entries = locations.map(warehouse => {
    const linked = vehicles.filter(vehicle => vehicle.warehouse_id === warehouse.id);
    const items = warehouseItemStock(warehouse, products, balances)
      .filter(item => item.lots.some(lot => Number(lot.quantity || 0) !== 0 || Number(lot.total_value || 0) !== 0));
    return {
      id: `warehouse:${warehouse.id}`, warehouse, vehicles: linked,
      name: linked.map(vehicle => vehicle.name || vehicle.registration).join(' / ') || warehouse.name,
      registration: linked.map(vehicle => vehicle.registration).filter(Boolean).join(' / ') || warehouse.code,
      active: warehouse.is_active !== false && (!linked.length || linked.some(vehicle => vehicle.is_active !== false)),
      issue: linked.length > 1 ? 'Shared stock location. Review vehicle assignments in Distribution.' : '',
      snapshot: warehouseSnapshot(warehouse, balances), items,
    };
  });
  for (const vehicle of vehicles) {
    if (locationIds.has(vehicle.warehouse_id)) continue;
    entries.push({
      id: `vehicle:${vehicle.id}`, warehouse: null, vehicles: [vehicle],
      name: vehicle.name || vehicle.registration, registration: vehicle.registration,
      active: vehicle.is_active !== false, items: [], snapshot: null,
      issue: vehicle.warehouse_id ? 'Vehicle stock location unavailable. Review the assignment in Distribution.' : 'No stock location assigned. Set one in Distribution.',
    });
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

export function matchesVehicleEntry(entry, search = '', status = 'all') {
  return (status === 'all' || entry.active === (status === 'active')) &&
    [entry.name, entry.registration, entry.warehouse?.name, entry.warehouse?.code, entry.warehouse?.address]
      .join(' ').toLowerCase().includes(search.trim().toLowerCase());
}

export function vehicleFleetSummary(entries) {
  return {
    count: entries.reduce((count, entry) => count + (entry.vehicles.length || 1), 0),
    value: entries.reduce((value, entry) => value + (entry.snapshot?.value || 0), 0),
    withStock: entries.filter(entry => entry.items.some(item => item.quantity > 0)).length,
  };
}
