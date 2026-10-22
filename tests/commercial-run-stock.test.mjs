import test from 'node:test';
import assert from 'node:assert/strict';
import { assertRunSupplyStock, commercialRunInventory, supplyRun } from '../src/server/domain/commercial-runs.js';
import { businessDate } from '../src/lib/business-date.js';

const date = businessDate();
const matches = (row, query) => Object.entries(query).every(([key, value]) => key === '$or' ? value.some(part => matches(row, part))
  : value && typeof value === 'object' ? Object.entries(value).every(([operator, values]) => operator === '$in' && values.includes(row[key])) : row[key] === value);
function fixture() {
  const rows = {
    Employee: [{ id: 'agent', full_name: 'Agent', role: 'commercial', status: 'active' }, { id: 'driver', full_name: 'Driver', role: 'driver', status: 'active' }],
    Dispatch: [{ id: 'run', salesperson_id: 'agent', driver_id: 'driver', vehicle_id: 'van', vehicle_warehouse_id: 'vehicle-stock', warehouse_id: 'factory', dispatch_date: date, status: 'loaded' }],
    Vehicle: [{ id: 'van', name: 'Van', warehouse_id: 'vehicle-stock', is_active: true }],
    Warehouse: [{ id: 'vehicle-stock', name: 'Out for delivery', warehouse_type: 'vehicle', is_active: true }, { id: 'custody', warehouse_type: 'commercial_custody' }],
    DriverActivity: [], FieldSale: [], SalesOrder: [], StockMovement: [],
    DispatchLine: [{ id: 'manifest', dispatch_id: 'run', product_id: 'finished', loaded_quantity: 10, returned_quantity: 0 }],
    StockBalance: [
      { id: 'good', warehouse_id: 'vehicle-stock', product_id: 'finished', quantity: 4, qc_status: 'approved', unit_cost: 999, total_value: 3996 },
      { id: 'hold', warehouse_id: 'vehicle-stock', product_id: 'finished', quantity: 3, qc_status: 'quarantine' },
      { id: 'expired', warehouse_id: 'vehicle-stock', product_id: 'finished', quantity: 2, qc_status: 'approved', expiry_date: '2000-01-01' },
      { id: 'legacy', warehouse_id: 'custody', product_id: 'finished', quantity: 200, qc_status: 'approved' },
      { id: 'raw', warehouse_id: 'vehicle-stock', product_id: 'raw', quantity: 100, qc_status: 'approved' },
    ],
    Product: [{ id: 'finished', name: 'YOLA', inventory_type: 'assembly', is_active: true, selling_price: 500, current_cost: 999 }, { id: 'raw', name: 'Sugar', inventory_type: 'ingredient', is_active: true }],
  };
  const entities = Object.fromEntries(Object.entries(rows).map(([name, table]) => [name, {
    get: async id => structuredClone(table.find(row => row.id === id)),
    filter: async (query = {}, sort, limit, skip = 0) => structuredClone(table.filter(row => matches(row, query)).slice(skip, limit ? skip + limit : undefined)),
  }]));
  return { rows, svc: { entities } };
}

test('a supply uses its assigned loaded vehicle and never creates or moves custody stock', async () => {
  const { rows, svc } = fixture(), before = structuredClone(rows);
  const context = await supplyRun(svc, 'agent', 'run', date, true);
  assert.equal(context.driver_id, 'driver');
  assert.equal(context.stock_warehouse_id, 'vehicle-stock');
  await assertRunSupplyStock(svc, context, [{ product_id: 'finished', quantity: 4 }], date);
  await assert.rejects(assertRunSupplyStock(svc, context, [{ product_id: 'finished', quantity: 5 }], date), /Only 4 available/);
  assert.deepEqual(rows, before);
});

test('approved and closed runs cannot supply, and each staff member must match the actual pairing', async () => {
  const { rows, svc } = fixture();
  for (const status of ['approved', 'returned', 'completed']) {
    rows.Dispatch[0].status = status;
    await assert.rejects(supplyRun(svc, 'agent', 'run', date, true), /warehouse must load/);
  }
  rows.Dispatch[0].status = 'loaded';
  await assert.rejects(supplyRun(svc, 'other-agent', 'run', date, true), /assigned to you/);
  await assert.rejects(supplyRun(svc, 'agent', 'run', '2000-01-01', true), /assigned to you/);
  rows.Employee[0].status = 'suspended';
  await assert.rejects(supplyRun(svc, 'agent', 'run', date, true), /active assigned Commercial/);
  rows.Employee[0].status = 'active'; rows.Employee[1].status = 'suspended';
  await assert.rejects(supplyRun(svc, 'agent', 'run', date, true), /active assigned driver/);
});

test('shared active vehicle stock, changed vehicle locations and a returned driver block new supplies', async () => {
  const { rows, svc } = fixture();
  rows.Dispatch.push({ ...rows.Dispatch[0], id: 'other-run', salesperson_id: 'other' });
  await assert.rejects(supplyRun(svc, 'agent', 'run', date, true), /More than one active run/);
  rows.Dispatch.pop(); rows.Vehicle[0].warehouse_id = 'different';
  await assert.rejects(supplyRun(svc, 'agent', 'run', date, true), /stock location changed/);
  rows.Vehicle[0].warehouse_id = 'vehicle-stock';
  rows.DriverActivity.push({ id: 'return', dispatch_id: 'run', type: 'trip_returned' });
  await assert.rejects(supplyRun(svc, 'agent', 'run', date, true), /returned to base/);
});

test('the real load manifest and active finished-product definition limit every supplied quantity', async () => {
  const { rows, svc } = fixture(), context = await supplyRun(svc, 'agent', 'run', date, true);
  for (const lines of [[{ product_id: 'finished', quantity: true }], [{ product_id: 'finished', quantity: 0 }], [{ product_id: 'finished', quantity: Infinity }], [{ product_id: 'finished', quantity: 1 }, { product_id: 'finished', quantity: 1 }]]) {
    await assert.rejects(assertRunSupplyStock(svc, context, lines), /positive quantities/);
  }
  await assert.rejects(assertRunSupplyStock(svc, context, [{ product_id: 'raw', quantity: 1 }]), /active finished products/);
  rows.DispatchLine[0].loaded_quantity = 1;
  await assert.rejects(assertRunSupplyStock(svc, context, [{ product_id: 'finished', quantity: 2 }]), /quantities loaded/);
  rows.DispatchLine[0].loaded_quantity = 10; rows.Product[0].configuration_status = 'draft';
  await assert.rejects(assertRunSupplyStock(svc, context, [{ product_id: 'finished', quantity: 1 }]), /active finished products/);
});

test('commercial inventory is actual assigned-run finished stock and strips costs and legacy custody', async () => {
  const { rows, svc } = fixture();
  rows.Dispatch.push({ ...rows.Dispatch[0], id: 'planned', status: 'approved' });
  rows.DispatchLine.push({ id: 'raw-manifest', dispatch_id: 'run', product_id: 'raw', loaded_quantity: 100 });
  const inventory = await commercialRunInventory(svc, 'agent', date);
  assert.equal(inventory.runs.find(run => run.id === 'run').can_supply, true);
  assert.equal(inventory.runs.find(run => run.id === 'planned').can_supply, false);
  assert.equal(inventory.products.length, 1);
  assert.equal(inventory.products[0].current_cost, undefined);
  assert.equal(inventory.balances.length, 3);
  assert.ok(inventory.balances.every(balance => balance.dispatch_id === 'run' && balance.warehouse_id === 'vehicle-stock' && balance.product_id === 'finished'));
  assert.ok(inventory.balances.every(balance => balance.unit_cost === undefined && balance.total_value === undefined));
});

test('an adjustment cannot resell quantities already issued on the same run, and source lot legs count once', async () => {
  const { rows, svc } = fixture(), context = await supplyRun(svc, 'agent', 'run', date, true);
  rows.FieldSale.push({ id: 'sale', dispatch_id: 'run', status: 'approved_posted', stock_moved_at: new Date().toISOString() });
  rows.SalesOrder.push({ id: 'order', dispatch_id: 'run', status: 'partially_delivered' });
  rows.StockMovement.push(
    { id: 'sale-lot1', document_type: 'FieldSale', document_id: 'sale', product_id: 'finished', source_warehouse_id: 'vehicle-stock', movement_type: 'field_delivery', quantity: 3, status: 'approved' },
    { id: 'sale-lot2', document_type: 'FieldSale', document_id: 'sale', product_id: 'finished', source_warehouse_id: 'vehicle-stock', movement_type: 'field_delivery', quantity: 2, status: 'approved' },
    { id: 'sale-receive', document_type: 'FieldSale', document_id: 'sale', product_id: 'finished', destination_warehouse_id: 'pending', movement_type: 'field_delivery', quantity: 5, status: 'approved' },
    { id: 'partial-order', document_type: 'SalesOrder', document_id: 'order', product_id: 'finished', source_warehouse_id: 'vehicle-stock', movement_type: 'customer_delivery', quantity: 2, status: 'approved' },
    { id: 'other-run', document_type: 'FieldSale', document_id: 'unrelated', product_id: 'finished', source_warehouse_id: 'vehicle-stock', movement_type: 'field_delivery', quantity: 100, status: 'approved' },
  );
  rows.StockBalance[0].quantity = 20;
  await assert.rejects(assertRunSupplyStock(svc, context, [{ product_id: 'finished', quantity: 4 }]), /quantities loaded/);
  await assertRunSupplyStock(svc, context, [{ product_id: 'finished', quantity: 3 }]);
  const inventory = await commercialRunInventory(svc, 'agent', date);
  assert.equal(inventory.balances.filter(row => row.product_id === 'finished').reduce((sum, row) => sum + row.usable_quantity, 0), 3);
  assert.ok(inventory.balances.every(row => row.run_remaining_quantity === 3));
});
