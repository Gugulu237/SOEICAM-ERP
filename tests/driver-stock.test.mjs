import test from 'node:test';
import assert from 'node:assert/strict';
import { driverRunStock } from '../src/lib/driver-stock.js';

const run = { id: 'run-a', vehicle_warehouse_id: 'vehicle-a', status: 'in_transit' };
const data = {
  date: '2026-10-18', dispatches: [run], products: [{ id: 'yogurt', inventory_type: 'assembly', storage_unit: 'ea' }, { id: 'milk', inventory_type: 'raw_material' }],
  manifest: [{ dispatch_id: 'run-a', product_id: 'yogurt', loaded_quantity: 20, requested_quantity: 20, returned_quantity: 2 }, { dispatch_id: 'run-a', product_id: 'milk', loaded_quantity: 50 }],
  supplyLines: [{ dispatch_id: 'run-a', product_id: 'yogurt', quantity: 7 }, { dispatch_id: 'other-run', product_id: 'yogurt', quantity: 99 }],
  vehicleBalances: [{ warehouse_id: 'vehicle-a', product_id: 'yogurt', quantity: 8, qc_status: 'approved' }, { warehouse_id: 'vehicle-a', product_id: 'yogurt', quantity: 3, qc_status: 'quarantine' }, { warehouse_id: 'other-vehicle', product_id: 'yogurt', quantity: 99 }, { warehouse_id: 'vehicle-a', product_id: 'milk', quantity: 40 }],
};

test('driver stock separates run loading and posted supplies from actual finished vehicle balances', () => {
  const result = driverRunStock(data, run);
  assert.equal(result.rows.length, 1);
  assert.deepEqual({ loaded: result.rows[0].loaded, supplied: result.rows[0].supplied, returned: result.rows[0].returned, physical: result.rows[0].onVehicle, usable: result.rows[0].usable }, { loaded: 20, supplied: 7, returned: 2, physical: 11, usable: 8 });
  assert.equal(result.live, true);
});

test('missing live data stays unknown while a confirmed empty vehicle shows zero', () => {
  const missing = driverRunStock({ ...data, vehicleBalances: undefined, supplyLines: undefined }, run);
  assert.equal(missing.live, false); assert.equal(missing.rows[0].onVehicle, null); assert.equal(missing.rows[0].supplied, null);
  assert.equal(driverRunStock({ ...data, vehicleBalances: [] }, run).rows[0].onVehicle, 0);
  assert.equal(driverRunStock(data, { ...run, vehicle_warehouse_id: '' }).live, false);
  const historical = driverRunStock(data, { ...run, status: 'completed' });
  assert.equal(historical.live, false); assert.equal(historical.rows[0].onVehicle, null);
  const scopedOut = driverRunStock({ ...data, liveVehicleWarehouseIds: [] }, run);
  assert.equal(scopedOut.live, false); assert.equal(scopedOut.rows[0].onVehicle, null);
});

test('driver stock flags a live balance shared by another open run and does not subtract reports', () => {
  const result = driverRunStock({ ...data, dispatches: [run, { id: 'run-b', vehicle_warehouse_id: 'vehicle-a', status: 'loaded' }], activities: [{ type: 'delivery_completed', quantity: 100 }] }, run);
  assert.equal(result.shared, true); assert.equal(result.rows[0].onVehicle, 11);
});
