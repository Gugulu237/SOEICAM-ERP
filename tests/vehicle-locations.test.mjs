import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { ensureVehicleStockLocation, prepareVehicleDefinition, vehicleLocationCode } from '../src/server/domain/vehicle-locations.js';

const matches = (row, query) => query.$and ? query.$and.every(part => matches(row, part)) : Object.entries(query).every(([key, value]) => value?.$in ? value.$in.includes(row[key]) : row[key] === value);
function fixture() {
  const rows = { Vehicle: [{ id: 'van-1', name: 'YDE-01', registration: 'ABC', is_active: true }], Warehouse: [], StockBalance: [], Dispatch: [] };
  const writes = [], stores = {};
  for (const [name, records] of Object.entries(rows)) stores[name] = {
    get: async id => records.find(row => row.id === id) || null,
    filter: async (query = {}, sort, limit = 200, offset = 0) => records.filter(row => matches(row, query)).slice(offset, offset + limit),
    create: async input => { const row = { id: `${name}-${records.length + 1}`, ...input }; records.push(row); writes.push({ name, action: 'create', row }); return row; },
    update: async (id, changes) => { const row = records.find(item => item.id === id); assert.ok(row); Object.assign(row, changes); writes.push({ name, action: 'update', id, changes }); return row; },
  };
  return { rows, stores, writes, vehicle: rows.Vehicle[0] };
}
const location = (id = 'location', changes = {}) => ({ id, name: 'YDE-01', warehouse_type: 'vehicle', is_active: true, ...changes });

test('legacy missing links reuse the exact dedicated vehicle location without touching any stock', async () => {
  const f = fixture(); f.rows.Warehouse.push(location('existing', { name: '  yde-01 ' }));
  const result = await ensureVehicleStockLocation(f.stores, f.vehicle);
  assert.equal(result.vehicle.warehouse_id, 'existing'); assert.equal(f.vehicle.warehouse_id, 'existing'); assert.equal(result.created, false);
  assert.equal(f.rows.Warehouse.length, 1); assert.equal(f.rows.Warehouse[0].vehicle_id, 'van-1');
  assert.deepEqual(f.writes.map(row => row.name), ['Warehouse', 'Vehicle']);
  const writes = f.writes.length; await ensureVehicleStockLocation(f.stores, f.vehicle); assert.equal(f.writes.length, writes, 'repeated setup is idempotent');
});

test('stable owned locations survive vehicle renaming, and new vehicles receive exactly one empty dedicated location', async () => {
  const f = fixture(); f.rows.Warehouse.push(location('owned', { name: 'Old name', vehicle_id: 'van-1' }), location('same-name'));
  assert.equal((await ensureVehicleStockLocation(f.stores, f.vehicle)).warehouse.id, 'owned'); assert.equal(f.rows.Warehouse.length, 2);
  const fresh = fixture(); const result = await ensureVehicleStockLocation(fresh.stores, fresh.vehicle);
  assert.equal(result.created, true); assert.equal(result.warehouse.code, vehicleLocationCode('van-1')); assert.equal(result.warehouse.vehicle_id, 'van-1');
  assert.equal(result.warehouse.warehouse_type, 'vehicle'); assert.equal(fresh.rows.StockBalance.length, 0); assert.equal(fresh.rows.Dispatch.length, 0);
  await ensureVehicleStockLocation(fresh.stores, fresh.vehicle); assert.equal(fresh.rows.Warehouse.length, 1);
});

test('ambiguous, inactive, shared and foreign-owned legacy matches are rejected without writes', async () => {
  const cases = [
    f => f.rows.Warehouse.push(location('a'), location('b')),
    f => f.rows.Warehouse.push(location('a', { vehicle_id: 'van-1' }), location('b', { vehicle_id: 'van-1' })),
    f => f.rows.Warehouse.push(location('a', { is_active: false })),
    f => { f.rows.Warehouse.push(location('a')); f.rows.Vehicle.push({ id: 'other', warehouse_id: 'a' }); },
    f => f.rows.Warehouse.push(location('a', { vehicle_id: 'other' })),
    f => f.rows.Warehouse.push(location('a', { code: vehicleLocationCode('van-1'), name: 'Unrelated', warehouse_type: 'general' })),
  ];
  for (const mutate of cases) { const f = fixture(); mutate(f); await assert.rejects(ensureVehicleStockLocation(f.stores, f.vehicle)); assert.equal(f.writes.length, 0); }
});

test('explicit location choices require an active vehicle location, unique ownership and no shared mapping', async () => {
  for (const changes of [{ is_active: false }, { warehouse_type: 'finished_goods' }, { vehicle_id: 'other' }]) {
    const f = fixture(); f.rows.Warehouse.push(location('target', changes));
    await assert.rejects(prepareVehicleDefinition(f.stores, { warehouse_id: 'target' }, f.vehicle)); assert.equal(f.writes.length, 0);
  }
  const missing = fixture(); await assert.rejects(prepareVehicleDefinition(missing.stores, { warehouse_id: 'missing' }, missing.vehicle)); assert.equal(missing.writes.length, 0);
  const shared = fixture(); shared.rows.Warehouse.push(location('target')); shared.rows.Vehicle.push({ id: 'other', warehouse_id: 'target', is_active: false });
  await assert.rejects(prepareVehicleDefinition(shared.stores, { warehouse_id: 'target' }, shared.vehicle), /shared/); assert.equal(shared.writes.length, 0);
});

test('automatic choice preserves existing valid locations and does not silently replace a broken mapping', async () => {
  const f = fixture(); f.vehicle.warehouse_id = 'existing'; f.rows.Warehouse.push(location('existing', { name: 'Different label' }));
  assert.equal((await prepareVehicleDefinition(f.stores, { name: 'Renamed', warehouse_id: '' }, f.vehicle)).warehouse_id, 'existing'); assert.equal(f.writes.length, 0);
  f.rows.Warehouse[0].is_active = false;
  await assert.rejects(prepareVehicleDefinition(f.stores, { warehouse_id: '' }, f.vehicle), /active vehicle/); assert.equal(f.writes.length, 0);
});

test('changing custody cannot strand nonzero stock or an open delivery run, including bulk-save helpers', async () => {
  const cases = [
    f => f.rows.StockBalance.push({ id: 'stock', warehouse_id: 'old', quantity: 1 }),
    f => f.rows.StockBalance.push({ id: 'stock', warehouse_id: 'old', quantity: -1 }),
    f => f.rows.StockBalance.push({ id: 'stock', warehouse_id: 'old', quantity: 'invalid' }),
    f => f.rows.Dispatch.push({ id: 'run', status: 'loaded', vehicle_id: 'van-1' }),
    f => f.rows.Dispatch.push({ id: 'run', status: 'in_transit', vehicle_warehouse_id: 'old' }),
  ];
  for (const mutate of cases) {
    const f = fixture(); f.vehicle.warehouse_id = 'old'; f.rows.Warehouse.push(location('old', { vehicle_id: 'van-1' }), location('new')); mutate(f);
    await assert.rejects(prepareVehicleDefinition(f.stores, { warehouse_id: 'new' }, f.vehicle)); assert.equal(f.writes.length, 0);
  }
  const f = fixture(); f.vehicle.warehouse_id = 'old'; f.rows.Warehouse.push(location('old', { vehicle_id: 'van-1' }), location('new'));
  const result = await prepareVehicleDefinition(f.stores, { warehouse_id: 'new' }, f.vehicle);
  assert.equal(result.warehouse_id, 'new'); assert.equal(f.rows.Warehouse[0].vehicle_id, null); assert.equal(f.rows.Warehouse[1].vehicle_id, 'van-1');
});

test('missing links on an open run are not resolved by creating unrelated empty stock', async () => {
  const f = fixture(); f.rows.Dispatch.push({ id: 'run', status: 'loaded', vehicle_id: 'van-1' });
  await assert.rejects(ensureVehicleStockLocation(f.stores, f.vehicle), /open delivery run/); assert.equal(f.writes.length, 0); assert.equal(f.rows.Warehouse.length, 0);
});

test('inactive vehicles receive no automatic new locations and new active IDs are generated on the server', async () => {
  const f = fixture();
  const inactive = await prepareVehicleDefinition(f.stores, { name: 'Inactive', registration: 'XYZ', is_active: false });
  assert.ok(inactive.id); assert.equal(inactive.warehouse_id, ''); assert.equal(f.writes.length, 0);
  const fresh = await prepareVehicleDefinition(f.stores, { name: 'New van', registration: 'DEF', warehouse_id: '' });
  assert.match(fresh.id, /^[\da-f-]{36}$/); assert.equal(f.rows.Warehouse[0].vehicle_id, fresh.id); assert.equal(fresh.warehouse_id, f.rows.Warehouse[0].id);
  assert.ok(f.writes.every(row => row.name === 'Warehouse'), 'the caller creates the Vehicle after preparation within the same transaction');
});

test('generic Vehicle create, update and bulk changes run checked location setup after permissions', async () => {
  const output = await build({ entryPoints: ['src/server/entity-api.js'], bundle: true, format: 'esm', platform: 'node', write: false,
    plugins: [{ name: 'vehicle-api-fixture', setup(builder) {
      builder.onResolve({ filter: /^server-only$/ }, () => ({ path: 'empty', namespace: 'vehicle-api-fixture' }));
      builder.onResolve({ filter: /(?:^|\/)entities\.js$/ }, () => ({ path: 'entities', namespace: 'vehicle-api-fixture' }));
      builder.onResolve({ filter: /(?:^|\/)db\.js$/ }, () => ({ path: 'db', namespace: 'vehicle-api-fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'vehicle-api-fixture' }, args => ({ contents: args.path === 'entities' ? 'export const serviceEntities = globalThis.__vehicleStores; export const entityStore = name => serviceEntities[name];' : args.path === 'db' ? 'export const database=()=>{throw Error("Unexpected catalogue read in unrelated test");};export const transaction = callback => callback();' : '' }));
    } }] });
  const f = fixture(); globalThis.__vehicleStores = f.stores;
  try {
    const { entityOperation } = await import('data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].text).toString('base64'));
    const admin = { user: { id: 'admin', role: 'admin', email: 'admin@example.test' } };
    await assert.rejects(entityOperation(admin, 'Vehicle', 'create', [{ id: 'forged', name: 'Van', registration: 'ABC' }]), /System fields/); assert.equal(f.writes.length, 0);
    await assert.rejects(entityOperation({ user: { id: 'driver', role: 'user' }, employee: { id: 'driver-employee', role: 'driver', status: 'active' } }, 'Vehicle', 'create', [{ name: 'Van', registration: 'ABC' }])); assert.equal(f.writes.length, 0);
    const created = await entityOperation(admin, 'Vehicle', 'create', [{ name: 'New van', registration: 'DEF', warehouse_id: '' }]);
    assert.ok(created.warehouse_id); assert.equal(f.rows.Warehouse.find(row => row.id === created.warehouse_id).vehicle_id, created.id);
    const updated = await entityOperation(admin, 'Vehicle', 'update', ['van-1', { warehouse_id: '' }]); assert.ok(updated.warehouse_id);
    const result = await entityOperation(admin, 'Vehicle', 'updateMany', [{}, { name: 'Renamed' }]);
    assert.equal(result.updated, 2); assert.ok(result.records.every(row => row.warehouse_id)); assert.equal(f.rows.Warehouse.length, 2);
    const batch = await entityOperation(admin, 'Vehicle', 'bulkCreate', [[{ name: 'Van 3', registration: 'GHI' }, { name: 'Van 4', registration: 'JKL' }]]);
    assert.equal(batch.length, 2); assert.equal(new Set(batch.map(row => row.warehouse_id)).size, 2);
  } finally { delete globalThis.__vehicleStores; }
});
