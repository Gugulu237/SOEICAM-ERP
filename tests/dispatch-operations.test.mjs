import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchAction } from '../src/server/domain/dispatch-operations.js';

const matches = (row, query) => Object.entries(query).every(([key, value]) => value && typeof value === 'object' && '$in' in value ? value.$in.includes(row[key]) : row[key] === value);
function fixture(role = 'admin') {
  const user = { id: 'manager', role: role === 'admin' ? 'admin' : 'user' };
  const rows = {
    Employee: [{ id: 'manager-employee', user_id: 'manager', role, status: 'active' }, { id: 'driver', role: 'driver', status: 'active' }, { id: 'commercial', role: 'commercial', status: 'active' }],
    Vehicle: [{ id: 'van', name: 'Van', warehouse_id: 'van-stock', is_active: true }],
    Warehouse: [{ id: 'store', name: 'Factory', warehouse_type: 'finished_goods', is_active: true }, { id: 'van-stock', name: 'Van stock', warehouse_type: 'vehicle', is_active: true }],
    Product: [{ id: 'yogurt', name: 'Yogurt', inventory_type: 'assembly', is_active: true }, { id: 'drink', name: 'Drink', inventory_type: 'finished_product', is_active: true }],
    Dispatch: [{ id: 'run', dispatch_number: 'DSP-001', status: 'approved', dispatch_date: new Date().toISOString().slice(0, 10), driver_id: 'driver', salesperson_id: 'commercial', vehicle_id: 'van', warehouse_id: 'store' }],
    DispatchLine: [{ id: 'line', dispatch_id: 'run', product_id: 'yogurt', product_name: 'Yogurt', requested_quantity: 9, loaded_quantity: 5 }],
    StockBalance: [{ id: 'available', product_id: 'yogurt', warehouse_id: 'store', product_name: 'Yogurt', quantity: 12, unit_cost: 40, total_value: 480, qc_status: 'approved', lot_number: 'lot', expiry_date: '2099-01-01' }],
    SpoilageRecord: [], StockMovement: [], AuditLog: [], FieldSale: [], FieldSaleLine: [], SalesOrder: [], SalesOrderLine: [], DriverActivity: [], DispatchRequest: [], Route: [],
  };
  const writes = [], entities = {};
  for (const [name, records] of Object.entries(rows)) entities[name] = {
    get: async id => records.find(row => row.id === id) || null,
    filter: async (query = {}, sort, limit = 200, offset = 0) => records.filter(row => matches(row, query)).slice(offset, offset + limit),
    update: async (id, changes) => { const record = records.find(row => row.id === id); if (!record) throw Error('Missing test record'); writes.push({ entity: name, id, changes }); Object.assign(record, changes); return record; },
    create: async data => { const record = { id: `${name}-${records.length + 1}`, ...data }; records.push(record); writes.push({ entity: name, id: record.id, created: true }); return record; },
  };
  const client = { entities, asServiceRole: { entities } };
  const action = (action, extra = {}) => dispatchAction(client, user, { action, dispatchId: 'run', ...extra });
  return { action, rows, writes, user, client, run: rows.Dispatch[0], line: rows.DispatchLine[0], balance: rows.StockBalance[0] };
}

test('management loading transfers lot stock atomically in the caller transaction, with no revenue or journal', async () => {
  const f = fixture();
  f.run.departure_date = '2099-01-01';
  const result = await f.action('loadDispatch');
  assert.deepEqual(result, { totalValue: 200, vehicleWarehouseId: 'van-stock' });
  assert.equal(f.balance.quantity, 7);
  const vehicle = f.rows.StockBalance.find(row => row.warehouse_id === 'van-stock');
  assert.equal(vehicle.quantity, 5); assert.equal(vehicle.lot_number, 'lot'); assert.equal(vehicle.unit_cost, 40); assert.equal(vehicle.expiry_date, '2099-01-01');
  assert.equal(f.run.status, 'loaded'); assert.equal(f.run.loaded_by, 'manager'); assert.equal(f.line.loaded_quantity, 5);
  assert.equal(f.run.departure_date, null, 'loading must not assert an actual departure or retain a planned date');
  assert.match(f.run.loaded_at, /^\d{4}-\d\d-\d\dT/);
  assert.equal(f.rows.DriverActivity.length, 0, 'warehouse loading cannot record the driver report');
  assert.equal(f.line.unit, 'ea', 'loaded quantities use the registered stock unit');
  assert.equal(f.rows.StockMovement.length, 2); assert.ok(f.rows.StockMovement.every(row => row.document_id === 'run' && row.movement_type === 'vehicle_load'));
  assert.ok(f.writes.every(write => ['StockBalance', 'StockMovement', 'DispatchLine', 'Dispatch', 'AuditLog'].includes(write.entity)));
  const count = f.writes.length;
  assert.deepEqual(await f.action('loadDispatch'), { ...result, reused: true }); assert.equal(f.writes.length, count);
  f.run.status = 'in_transit'; assert.equal((await f.action('loadDispatch')).reused, true); assert.equal(f.writes.length, count);
});

test('an explicit zero loaded quantity is skipped instead of falling back to the requested quantity', async () => {
  const f = fixture(); f.line.loaded_quantity = 0;
  await assert.rejects(f.action('loadDispatch'), /positive quantity/); assert.equal(f.writes.length, 0);
  delete f.line.loaded_quantity;
  await f.action('loadDispatch'); assert.equal(f.line.loaded_quantity, 9); assert.equal(f.balance.quantity, 3);
});

test('load preflight rejects invalid lines, unavailable stock and unconfigured products before any stock write', async () => {
  const cases = [
    f => { f.line.loaded_quantity = -1; }, f => { f.line.loaded_quantity = Infinity; }, f => { f.line.loaded_quantity = true; },
    f => { f.rows.DispatchLine.push({ ...f.line, id: 'duplicate' }); }, f => { f.rows.DispatchLine.length = 0; },
    f => { f.line.product_id = 'missing'; }, f => { f.rows.Product[0].inventory_type = 'raw_material'; },
    f => { f.rows.Product[0].is_active = false; }, f => { f.rows.Product[0].configuration_status = 'draft'; },
    f => { f.line.unit = 'kg'; }, f => { f.rows.Product[0].unit_of_measure = 'g'; f.line.unit = 'kg'; },
    f => { f.balance.quantity = 4; }, f => { f.balance.qc_status = 'pending'; }, f => { f.balance.expiry_date = '2000-01-01'; },
    f => { f.rows.DispatchLine.push({ id: 'bad-second', dispatch_id: 'run', product_id: 'drink', loaded_quantity: 4 }); },
  ];
  for (const mutate of cases) { const f = fixture(); mutate(f); await assert.rejects(f.action('loadDispatch')); assert.equal(f.writes.length, 0); }
});

test('load requires an active paired team and vehicle mapped to a distinct valid storage location', async () => {
  const cases = [
    f => { f.run.driver_id = ''; }, f => { f.run.salesperson_id = ''; }, f => { f.run.salesperson_id = 'driver'; },
    f => { f.rows.Employee[1].status = 'inactive'; }, f => { f.rows.Employee[2].role = 'cashier'; }, f => { f.rows.Employee[2].status = 'inactive'; },
    f => { f.rows.Vehicle[0].is_active = false; },
    f => { f.run.vehicle_warehouse_id = 'other'; }, f => { f.rows.Warehouse[1].warehouse_type = 'commercial_custody'; },
    f => { f.rows.Warehouse[0].warehouse_type = 'vehicle'; }, f => { f.rows.Warehouse[0].is_active = false; },
    f => { f.run.status = 'draft'; }, f => { f.run.status = 'returned'; },
  ];
  for (const mutate of cases) { const f = fixture(); mutate(f); await assert.rejects(f.action('loadDispatch')); assert.equal(f.writes.length, 0); }
});

test('loading repairs a legacy missing vehicle mapping by reusing its unique exact-name stock location', async () => {
  const f = fixture(); f.rows.Vehicle[0].warehouse_id = ''; f.rows.Warehouse[1].name = 'Van';
  const result = await f.action('loadDispatch');
  assert.equal(result.vehicleWarehouseId, 'van-stock'); assert.equal(f.rows.Vehicle[0].warehouse_id, 'van-stock');
  assert.equal(f.rows.Warehouse.length, 2); assert.equal(f.rows.Warehouse[1].vehicle_id, 'van');
  assert.equal(f.balance.quantity, 7); assert.equal(f.rows.StockBalance.find(row => row.warehouse_id === 'van-stock').quantity, 5);
});

test('vehicles and paired teams cannot mix residual stock or concurrent open runs', async () => {
  for (const other of [{ vehicle_id: 'van' }, { vehicle_id: 'other', vehicle_warehouse_id: 'van-stock' }, { vehicle_id: 'other', driver_id: 'driver' }, { vehicle_id: 'other', salesperson_id: 'commercial' }]) {
    const f = fixture(); f.rows.Dispatch.push({ id: 'previous', status: 'loaded', ...other });
    await assert.rejects(f.action('loadDispatch'), /open delivery run/); assert.equal(f.writes.length, 0);
  }
  for (const quantity of [1, -1]) {
    const f = fixture(); f.rows.StockBalance.push({ id: 'residual', product_id: 'drink', warehouse_id: 'van-stock', quantity });
    await assert.rejects(f.action('loadDispatch'), /empty/); assert.equal(f.writes.length, 0);
  }
});

test('stock operations and cost reconciliation preserve admin and warehouse management permissions', async () => {
  for (const role of ['driver', 'commercial', 'hotesse', 'cashier', 'employee']) for (const action of ['approveDispatchRequest', 'approveDispatch', 'loadDispatch', 'returnDispatchStock', 'dispatchReconciliation']) {
    const f = fixture(role); await assert.rejects(f.action(action), /Not permitted/); assert.equal(f.writes.length, 0);
  }
  for (const role of ['warehouse_manager', 'production_manager']) {
    const f = fixture(role); await f.action('loadDispatch'); assert.equal(f.run.status, 'loaded');
    const blocked = fixture(role); blocked.rows.Employee[0].status = 'inactive'; await assert.rejects(blocked.action('loadDispatch'), /active management/); assert.equal(blocked.writes.length, 0);
  }
});

test('approval validates the authoritative paired team, vehicle and finished manifest without moving stock', async () => {
  const f = fixture(); f.run.status = 'pending_approval';
  const result = await f.action('approveDispatch');
  assert.equal(result.dispatch.status, 'approved'); assert.equal(f.run.approved_by, 'manager'); assert.equal(f.run.vehicle_warehouse_id, 'van-stock'); assert.equal(f.rows.StockMovement.length, 0); assert.equal(f.balance.quantity, 12);
  assert.ok(f.writes.every(write => ['Dispatch', 'AuditLog'].includes(write.entity)));
  const count = f.writes.length; assert.equal((await f.action('approveDispatch')).reused, true); assert.equal(f.writes.length, count);
  for (const mutate of [
    f => { f.run.status = 'draft'; }, f => { f.run.status = 'loaded'; }, f => { f.run.driver_id = ''; },
    f => { f.rows.Product[0].is_active = false; }, f => { f.rows.DispatchLine.length = 0; },
    f => { f.line.loaded_quantity = 0; }, f => { f.rows.Warehouse[0].warehouse_type = 'quarantine'; },
  ]) {
    const bad = fixture(); bad.run.status = 'pending_approval'; mutate(bad);
    await assert.rejects(bad.action('approveDispatch')); assert.equal(bad.writes.length, 0);
  }
});

test('reconciliation counts posted field supplies, actual cash collected and credit due, excluding pending sales and reserved orders', async () => {
  const f = fixture(); await f.action('loadDispatch');
  f.rows.StockBalance.find(row => row.warehouse_id === 'van-stock').quantity = 2;
  f.rows.FieldSale.push(
    { id: 'sale', dispatch_id: 'run', status: 'approved_posted', total: 300, amount_collected: 100, amount_due: 200 },
    { id: 'draft', dispatch_id: 'run', status: 'draft', total: 1000, amount_collected: 1000, amount_due: 0 },
  );
  f.rows.FieldSaleLine.push({ id: 'sold-line', field_sale_id: 'sale', product_id: 'yogurt', quantity: 3, line_total: 300 }, { id: 'draft-line', field_sale_id: 'draft', product_id: 'yogurt', quantity: 10, line_total: 1000 });
  f.rows.StockMovement.push({ id: 'sale-issued', document_type: 'FieldSale', document_id: 'sale', product_id: 'yogurt', source_warehouse_id: 'van-stock', movement_type: 'field_delivery', status: 'approved', quantity: 3 });
  f.rows.SalesOrder.push({ id: 'reserved', dispatch_id: 'run', status: 'confirmed', total: 800, payment_type: 'cash' });
  f.rows.SalesOrderLine.push({ id: 'reserved-line', order_id: 'reserved', product_id: 'yogurt', quantity: 8, total: 800 });
  const recon = await f.action('dispatchReconciliation');
  assert.equal(recon.rows[0].loaded, 5); assert.equal(recon.rows[0].sold, 3); assert.equal(recon.rows[0].expected, 2); assert.equal(recon.rows[0].actual, 2); assert.equal(recon.rows[0].variance, 0);
  assert.equal(recon.rows[0].sales_value, 300); assert.equal(recon.cashSales, 100); assert.equal(recon.creditSales, 200); assert.equal(recon.totalSales, 300); assert.equal(recon.hasVariance, false); assert.equal(recon.orders.length, 0);
});

test('legacy delivered sales require complete outbound stock-issue evidence and never infer cash from payment type', async () => {
  const f = fixture(); await f.action('loadDispatch');
  f.rows.SalesOrder.push({ id: 'delivered', dispatch_id: 'run', status: 'delivered', total: 200, payment_type: 'cash' }, { id: 'unissued', dispatch_id: 'run', status: 'invoiced', total: 500 });
  f.rows.SalesOrderLine.push({ id: 'delivery-line', order_id: 'delivered', product_id: 'yogurt', quantity: 2, total: 200 }, { id: 'unissued-line', order_id: 'unissued', product_id: 'yogurt', quantity: 5, total: 500 });
  let recon = await f.action('dispatchReconciliation'); assert.equal(recon.totalSales, 0);
  f.rows.StockMovement.push({ id: 'issued', document_type: 'SalesOrder', document_id: 'delivered', product_id: 'yogurt', source_warehouse_id: 'van-stock', movement_type: 'customer_delivery', status: 'approved', quantity: 2 });
  f.rows.StockBalance.find(row => row.warehouse_id === 'van-stock').quantity = 3;
  recon = await f.action('dispatchReconciliation');
  assert.equal(recon.rows[0].sold, 2); assert.equal(recon.orders.length, 1); assert.equal(recon.cashSales, 0); assert.equal(recon.creditSales, 200); assert.equal(recon.totalSales, 200); assert.equal(recon.hasVariance, false);
});

test('partial legacy deliveries consume physical run stock without prematurely recognizing their order revenue', async () => {
  const f = fixture(); await f.action('loadDispatch');
  f.rows.SalesOrder.push({ id: 'partial', dispatch_id: 'run', status: 'partially_delivered', total: 500, amount_collected: 0, amount_due: 500 });
  f.rows.SalesOrderLine.push({ id: 'partial-line', order_id: 'partial', product_id: 'yogurt', quantity: 5, total: 500 });
  f.rows.StockMovement.push({ id: 'partial-issued', document_type: 'SalesOrder', document_id: 'partial', product_id: 'yogurt', source_warehouse_id: 'van-stock', movement_type: 'customer_delivery', status: 'approved', quantity: 2 });
  f.rows.StockBalance.find(row => row.warehouse_id === 'van-stock').quantity = 3;
  const recon = await f.action('dispatchReconciliation');
  assert.equal(recon.rows[0].consumed, 2); assert.equal(recon.rows[0].sold, 0); assert.equal(recon.rows[0].expected, 3); assert.equal(recon.rows[0].actual, 3);
  assert.equal(recon.hasVariance, false); assert.equal(recon.totalSales, 0); assert.equal(recon.cashSales, 0); assert.equal(recon.creditSales, 0); assert.equal(recon.orders.length, 0);
});

test('return transfers remaining goods including expired/inactive goods, updates reconciliation and is idempotent', async () => {
  const f = fixture(); await f.action('loadDispatch');
  const vehicle = f.rows.StockBalance.find(row => row.warehouse_id === 'van-stock');
  vehicle.quantity = 2; vehicle.expiry_date = '2000-01-01'; f.rows.Product[0].is_active = false;
  f.rows.FieldSale.push({ id: 'sale', dispatch_id: 'run', status: 'approved_posted', total: 300, amount_collected: 50, amount_due: 250 });
  f.rows.FieldSaleLine.push({ id: 'sale-line', field_sale_id: 'sale', product_id: 'yogurt', quantity: 3, line_total: 300 });
  f.rows.StockMovement.push({ id: 'sale-issued', document_type: 'FieldSale', document_id: 'sale', product_id: 'yogurt', source_warehouse_id: 'van-stock', movement_type: 'field_delivery', status: 'approved', quantity: 3 });
  assert.deepEqual(await f.action('returnDispatchStock'), { totalValue: 80, expiredReturned: 0 });
  assert.equal(f.line.returned_quantity, 2); assert.equal(vehicle.quantity, 0); assert.equal(f.balance.quantity, 7); assert.equal(f.run.status, 'returned');
  assert.equal(f.balance.expiry_date, '2099-01-01', 'returning an expired lot must not overwrite the expiry on fresh stock');
  const expired = f.rows.StockBalance.find(row => row.warehouse_id === 'store' && row.expiry_date === '2000-01-01');
  assert.equal(expired.quantity, 2); assert.equal(expired.lot_number, 'lot');
  assert.equal(f.run.total_cash_collected, 50); assert.equal(f.run.total_credit_sales, 250); assert.equal(f.run.total_delivered_value, 300);
  const recon = await f.action('dispatchReconciliation'); assert.equal(recon.rows[0].expected, 0); assert.equal(recon.rows[0].returned, 2); assert.equal(recon.hasVariance, false);
  const writes = f.writes.length; assert.deepEqual(await f.action('returnDispatchStock'), { totalValue: 80, reused: true }); assert.equal(f.writes.length, writes);
});

test('empty vehicle can close its return, and unexplained finished stock remains a reconciliation variance', async () => {
  const empty = fixture(); await empty.action('loadDispatch'); empty.rows.StockBalance.find(row => row.warehouse_id === 'van-stock').quantity = 0;
  await empty.action('returnDispatchStock'); assert.equal(empty.run.status, 'returned'); assert.equal((await empty.action('dispatchReconciliation')).hasVariance, true);
  const extra = fixture(); await extra.action('loadDispatch');
  extra.rows.StockBalance.push({ id: 'unexpected', product_id: 'drink', product_name: 'Drink', warehouse_id: 'van-stock', quantity: 2, unit_cost: 30, total_value: 60, qc_status: 'approved', lot_number: 'extra' });
  await extra.action('returnDispatchStock');
  const row = (await extra.action('dispatchReconciliation')).rows.find(row => row.product_id === 'drink');
  assert.equal(row.loaded, 0); assert.equal(row.returned, 2); assert.equal(row.actual, 0); assert.equal(row.variance, 2);
});

test('invalid return stock or state rejects before writes', async () => {
  const untouched = fixture(); await assert.rejects(untouched.action('returnDispatchStock'), /loaded or in-transit/); assert.equal(untouched.writes.length, 0);
  const f = fixture(); await f.action('loadDispatch');
  f.rows.Product.push({ id: 'raw', inventory_type: 'raw_material', name: 'Raw milk' });
  f.rows.StockBalance.push({ id: 'invalid-return', product_id: 'raw', warehouse_id: 'van-stock', quantity: 1 });
  const writes = f.writes.length; await assert.rejects(f.action('returnDispatchStock'), /non-finished/); assert.equal(f.writes.length, writes); assert.equal(f.rows.StockBalance.find(row => row.warehouse_id === 'van-stock').quantity, 5);
});

test('returns reject shared open vehicle stock and closed run reconciliation excludes a later run load', async () => {
  const f = fixture(); await f.action('loadDispatch');
  f.rows.Dispatch.push({ id: 'conflicting', status: 'loaded', vehicle_id: 'van', vehicle_warehouse_id: 'van-stock' });
  const count = f.writes.length; await assert.rejects(f.action('returnDispatchStock'), /Multiple open/); assert.equal(f.writes.length, count);
  await assert.rejects(f.action('dispatchReconciliation'), /Multiple open/);
  f.rows.Dispatch.pop(); await f.action('returnDispatchStock');
  f.rows.Dispatch.push({ id: 'later', status: 'loaded', vehicle_id: 'van', vehicle_warehouse_id: 'van-stock' });
  f.rows.StockBalance.find(row => row.warehouse_id === 'van-stock').quantity = 15;
  const recon = await f.action('dispatchReconciliation'); assert.equal(recon.rows[0].actual, 0); assert.equal(recon.remainingQty, 0); assert.equal(recon.hasVariance, false);
});

test('old posted field sales from commercial custody do not consume a vehicle run merely because they carry its dispatch id', async () => {
  const f = fixture(); await f.action('loadDispatch');
  f.rows.FieldSale.push({ id: 'legacy', dispatch_id: 'run', status: 'approved_posted', total: 300, amount_collected: 300, amount_due: 0 });
  f.rows.FieldSaleLine.push({ id: 'legacy-line', field_sale_id: 'legacy', product_id: 'yogurt', quantity: 3, line_total: 300 });
  f.rows.StockMovement.push({ id: 'custody-issued', document_type: 'FieldSale', document_id: 'legacy', product_id: 'yogurt', source_warehouse_id: 'commercial-custody', movement_type: 'field_delivery', status: 'approved', quantity: 3 });
  const recon = await f.action('dispatchReconciliation'); assert.equal(recon.rows[0].sold, 0); assert.equal(recon.rows[0].expected, 5); assert.equal(recon.totalSales, 0); assert.equal(recon.fieldSales.length, 0);
});

function requestedFixture() {
  const f = fixture();
  f.rows.Employee[1].full_name = 'The Driver'; f.rows.Employee[2].full_name = 'The Commercial';
  f.rows.Product[0].unit_of_measure = 'ea'; f.rows.Product[0].selling_price = 125;
  const request = { id: 'request', request_number: 'REQ-001', status: 'pending_approval', request_date: f.run.dispatch_date, driver_id: 'driver', vehicle_id: 'van', source_warehouse_id: 'store', vehicle_name: 'Untrusted vehicle', source_warehouse_name: 'Untrusted store', driver_name: 'Untrusted person', items: [{ product_id: 'yogurt', product_name: 'Untrusted name', unit: 'ea', quantity: 4, unit_price: 1 }] };
  f.rows.DispatchRequest.push(request);
  return { ...f, request, approveRequest: extra => f.action('approveDispatchRequest', { requestId: request.id, commercialId: 'commercial', ...extra }) };
}

test('approving a driver stock request creates a real paired run and loads authoritative goods exactly once', async () => {
  const f = requestedFixture();
  const result = await f.approveRequest({ warehouseId: 'fake', vehicleId: 'fake', items: [{ product_id: 'drink', quantity: 9000 }] });
  assert.equal(result.dispatch.status, 'loaded'); assert.equal(result.dispatch.request_id, 'request'); assert.equal(result.dispatch.driver_id, 'driver'); assert.equal(result.dispatch.salesperson_id, 'commercial');
  assert.equal(result.dispatch.driver_name, 'The Driver'); assert.equal(result.dispatch.salesperson_name, 'The Commercial'); assert.equal(result.dispatch.vehicle_name, 'Van'); assert.equal(result.dispatch.warehouse_name, 'Factory');
  assert.equal(result.totalValue, 160); assert.equal(result.vehicleWarehouseId, 'van-stock'); assert.equal(f.balance.quantity, 8);
  const line = f.rows.DispatchLine.find(row => row.dispatch_id === result.dispatch.id);
  assert.equal(line.product_name, 'Yogurt'); assert.equal(line.unit, 'ea'); assert.equal(line.unit_price, 125); assert.equal(line.loaded_quantity, 4);
  assert.equal(f.request.status, 'processed'); assert.equal(f.request.dispatch_id, result.dispatch.id); assert.equal(f.request.salesperson_id, 'commercial'); assert.equal(f.request.approved_by, 'manager');
  const writes = f.writes.length, movements = f.rows.StockMovement.length;
  const retry = await f.approveRequest(); assert.equal(retry.reused, true); assert.equal(retry.dispatch.id, result.dispatch.id); assert.equal(f.writes.length, writes); assert.equal(f.rows.StockMovement.length, movements);
});

test('request approval validates pair, products, unit, availability and vehicle conflicts before creating any record', async () => {
  const cases = [
    f => { f.request.status = 'draft'; }, f => { f.request.request_date = '2026-02-30'; }, f => { f.request.items = []; },
    f => { f.request.items[0].quantity = 0; }, f => { f.request.items[0].quantity = Infinity; }, f => { f.request.items[0].quantity = 99; },
    f => { f.request.items[0].unit = 'box'; }, f => { f.rows.Product[0].unit_of_measure = 'g'; f.request.items[0].unit = 'kg'; },
    f => { f.request.items.push({ ...f.request.items[0] }); }, f => { f.rows.Product[0].inventory_type = 'raw_material'; },
    f => { f.rows.Employee[2].status = 'inactive'; }, f => { f.request.driver_id = 'commercial'; },
    f => { f.rows.Warehouse[0].warehouse_type = 'quarantine'; }, f => { f.rows.Vehicle[0].is_active = false; },
    f => { f.rows.Dispatch.push({ id: 'open', status: 'in_transit', vehicle_id: 'van' }); },
    f => { f.rows.StockBalance.push({ id: 'residual', warehouse_id: 'van-stock', product_id: 'yogurt', quantity: 1 }); },
    f => { f.request.route_id = 'unknown-route'; }, f => { f.request.dispatch_id = 'already-linked'; },
    f => { f.rows.Dispatch.push({ id: 'already-created', request_id: 'request', status: 'draft' }); },
  ];
  for (const mutate of cases) {
    const f = requestedFixture(); mutate(f); await assert.rejects(f.approveRequest()); assert.equal(f.writes.length, 0); assert.equal(f.balance.quantity, 12);
  }
  const missing = requestedFixture(); await assert.rejects(missing.approveRequest({ commercialId: '' }), /driver and a commercial/); assert.equal(missing.writes.length, 0);
});

test('request approval can use its stored reviewed commercial and rejects broken processed links', async () => {
  const f = requestedFixture(); f.request.salesperson_id = 'commercial';
  assert.equal((await f.approveRequest({ commercialId: undefined })).dispatch.salesperson_id, 'commercial');
  const broken = requestedFixture(); broken.request.status = 'processed'; broken.request.dispatch_id = 'run';
  await assert.rejects(broken.approveRequest(), /no matching dispatch/); assert.equal(broken.writes.length, 0);
});
