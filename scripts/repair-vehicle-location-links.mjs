// Repairs the two reviewed imported vehicle/location relationships only.
// It never creates locations, moves goods or approves a delivery request.
import fs from 'node:fs/promises';
import { database, transaction } from '../src/server/db.js';
import { serviceEntities } from '../src/server/entities.js';
import { readRecords } from '../src/server/domain/commercial-workspace.js';
import { createHash } from 'node:crypto';
const apply = process.argv.includes('--apply');
if (process.argv.slice(2).some(value => value !== '--apply')) throw new Error('Usage: node --env-file=.env.local --conditions=react-server scripts/repair-vehicle-location-links.mjs [--apply]');
const reviewed = [
  { vehicle_id: '6a5167331d12cb92ecfee064', warehouse_id: '6a5166f51d12cb92ecfedfe6', name: 'Vehicle YDE-01' },
  { vehicle_id: '6a5167331d12cb92ecfee065', warehouse_id: '6a5166f51d12cb92ecfedfe7', name: 'Vehicle YDE-02' },
];
const protectedTables = ['Warehouse', 'StockBalance', 'StockMovement', 'Dispatch', 'DispatchLine', 'DispatchRequest', 'FieldSale', 'FieldSaleLine', 'JournalEntry', 'JournalLine', 'CashCollection'];
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
async function controls() {
  return Object.fromEntries(await Promise.all(protectedTables.map(async table => {
    const rows = await readRecords(serviceEntities[table]);
    return [table, { records: rows.length, sha256: hash(rows) }];
  })));
}
try {
  const result = await transaction(async () => {
    await database().unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['vehicle-location-links:reviewed-repair']);
    const [vehicles, warehouses, runs, before] = await Promise.all([
      readRecords(serviceEntities.Vehicle), readRecords(serviceEntities.Warehouse),
      readRecords(serviceEntities.Dispatch, { status: { $in: ['loaded', 'in_transit'] } }), controls(),
    ]);
    const changes = [];
    for (const match of reviewed) {
      const vehicle = vehicles.find(row => row.id === match.vehicle_id), warehouse = warehouses.find(row => row.id === match.warehouse_id);
      if (!vehicle || vehicle.is_active === false || vehicle.name !== match.name || !warehouse || warehouse.is_active === false || warehouse.warehouse_type !== 'vehicle' || warehouse.name !== match.name) throw new Error('A reviewed vehicle or stock location has changed; no repair performed');
      if ((vehicle.warehouse_id && vehicle.warehouse_id !== warehouse.id) || (warehouse.vehicle_id && warehouse.vehicle_id !== vehicle.id)
        || vehicles.some(other => other.id !== vehicle.id && other.warehouse_id === warehouse.id)
        || runs.some(run => run.vehicle_id === vehicle.id && run.vehicle_warehouse_id !== warehouse.id)) throw new Error('An existing vehicle assignment conflicts with this reviewed link');
      if (vehicle.warehouse_id === warehouse.id) continue;
      changes.push({ vehicle_id: vehicle.id, vehicle_name: vehicle.name, warehouse_id: warehouse.id, warehouse_name: warehouse.name });
      if (apply) {
        await serviceEntities.Vehicle.update(vehicle.id, { warehouse_id: warehouse.id });
        await serviceEntities.AuditLog.create({ action: 'configure_vehicle_stock_location', module: 'distribution', entity_type: 'Vehicle', entity_id: vehicle.id,
          description: `Restored imported vehicle stock-location link: ${vehicle.name} -> ${warehouse.name}. Existing stock and delivery records preserved.`,
          repair_source: 'reviewed_vehicle_location_links' });
      }
    }
    const after = await controls();
    if (hash(before) !== hash(after)) throw new Error('A protected stock, delivery or accounting table changed; repair rolled back');
    const afterVehicles = await readRecords(serviceEntities.Vehicle);
    for (const original of vehicles) {
      const current = afterVehicles.find(row => row.id === original.id);
      const expected = changes.find(change => change.vehicle_id === original.id);
      const fields = value => Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'updated_date'));
      if (hash(fields(current)) !== hash(fields({ ...original, ...(apply && expected ? { warehouse_id: expected.warehouse_id } : {}) }))) throw new Error('Unexpected vehicle changes; repair rolled back');
    }
    return { mode: apply ? 'apply' : 'preview', changes, protected_tables_unchanged: true,
      controls: after, verified_at: new Date().toISOString() };
  });
  if (apply) {
    await fs.mkdir('logs', { recursive: true });
    await fs.writeFile('logs/vehicle-location-repair-result.json', JSON.stringify(result, null, 2));
  }
  console.log(JSON.stringify({ mode: result.mode, repaired: apply ? result.changes.length : 0, planned: result.changes,
    stock_delivery_accounting_unchanged: result.protected_tables_unchanged }));
} finally { await database().end({ timeout: 5 }); }
