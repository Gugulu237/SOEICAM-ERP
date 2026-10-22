import test from 'node:test';
import assert from 'node:assert/strict';
import { commercialWorkspaceSubject, commercialWorkspacePath, validateCommercialWorkspace } from '../src/lib/commercial-workspace.js';
import { canOpenFieldPath } from '../src/lib/permissions.js';
import { employeeWorkspaceAction } from '../src/server/domain/employee-workspace.js';
import { fixture, staff, user } from './helpers/commercial-supply.mjs';
import { driverRunStock } from '../src/lib/driver-stock.js';

test('live Commercial identity is fixed to the signed-in employee for agents', () => {
  const employee = { id: 'own-agent', status: 'active' };
  assert.equal(commercialWorkspaceSubject('commercial', employee, 'someone-else'), 'own-agent');
  assert.equal(commercialWorkspaceSubject('commercial', { ...employee, status: 'suspended' }), '');
  assert.equal(commercialWorkspaceSubject('cashier', employee, 'someone-else'), '');
  assert.equal(commercialWorkspaceSubject('admin', null, 'selected-agent'), 'selected-agent');
  assert.equal(canOpenFieldPath('commercial', '/commercial'), true);
  assert.equal(canOpenFieldPath('production_manager', '/commercial'), true, 'Operations may open the performance-only dashboard');
  assert.equal(canOpenFieldPath('production_manager', '/field-sales/new'), false, 'Operations cannot enter Field POS sales');
  for (const role of ['cashier', 'driver', 'hotesse', 'employee']) assert.equal(canOpenFieldPath(role, '/commercial'), false);
});

test('management links preserve the report subject without opening employee transaction entry', () => {
  for (const path of ['/field-sales/new', '/field-customers?new=1', '/cash-handovers', '/commercial-performance']) assert.equal(commercialWorkspacePath(path, false, 'agent-a'), path);
  const report='/commercial?section=workspace&employee=agent-a';
  assert.equal(commercialWorkspacePath('/field-sales/new', true, 'agent-a'), report);
  assert.equal(commercialWorkspacePath('/field-sales/new?customer=shop', true, 'agent-a'), report);
  assert.equal(commercialWorkspacePath('/field-sales/sale-a', true, 'agent-a'), report);
  assert.equal(commercialWorkspacePath('/field-customers?new=1', true, 'agent-a'), report+'&view=customers');
  assert.equal(commercialWorkspacePath('/custody', true, 'agent-a'), report+'&view=stock');
  assert.equal(commercialWorkspacePath('/cash-handovers', true, 'a&b'), '/commercial?section=workspace&employee=a%26b');
  assert.equal(commercialWorkspacePath('/field-sales/new', true, ''), '/commercial?section=performance');
  assert.equal(commercialWorkspacePath('/commercial-performance', true, 'agent-a'), '/commercial?section=performance&employee=agent-a');
  assert.equal(commercialWorkspacePath('/commercial?section=performance', true, 'agent-a'), '/commercial?section=performance&employee=agent-a');
  assert.equal(commercialWorkspacePath('/field-sales', false, 'agent-a'), '/commercial?section=pos');
});

test('live data refuses examples, mismatched agents and mismatched dashboard modes', () => {
  const data = { mode: 'commercial', employee: { id: 'agent-a' } };
  assert.equal(validateCommercialWorkspace(data, 'agent-a'), data);
  for (const result of [null, { ...data, isExample: true }, { ...data, mode: 'admin' }, { ...data, employee: null }]) assert.throws(() => validateCommercialWorkspace(result, 'agent-a'));
  assert.throws(() => validateCommercialWorkspace(data, 'agent-b'));
});

test('live agent data uses assigned loaded vehicle goods, includes only finished products and omits costs', async () => {
  const { client, tables } = fixture();
  tables.Product.push({ id: 'raw', inventory_type: 'raw_material', is_active: true },
    { id: 'draft', inventory_type: 'assembly', configuration_status: 'draft', is_active: false });
  for (const product_id of ['raw', 'draft']) {
    tables.DispatchLine.push({ id: 'load-' + product_id, dispatch_id: 'run-a', product_id, loaded_quantity: 3 });
    tables.StockBalance.push({ id: 'stock-' + product_id, warehouse_id: 'van-stock', product_id, quantity: 3, unit_cost: 999 });
  }
  const result = await employeeWorkspaceAction(client, user, { action: 'employeeDashboard', mode: 'commercial', employeeId: staff.id });
  assert.equal(validateCommercialWorkspace(result, staff.id), result);
  assert.equal(result.products.length, 1); assert.equal(result.products[0].id, 'product-a');
  assert.equal(result.balances.length, 1); assert.equal(result.balances[0].quantity, 10);
  assert.equal(result.balances[0].warehouse_id, 'van-stock'); assert.equal(result.balances[0].usable_quantity, 10);
  assert.equal(result.balances[0].unit_cost, undefined); assert.equal(result.balances[0].total_value, undefined);
  assert.equal(result.products[0].current_cost, undefined); assert.equal(result.isExample, undefined);
  assert.equal(result.runs[0].can_supply, true);
});

test('a Commercial with legacy custody but no assigned loaded run has zero available delivery goods', async () => {
  const { client, tables } = fixture(); tables.Dispatch[0].salesperson_id = 'other-agent';
  const result = await employeeWorkspaceAction(client, user, { action: 'employeeDashboard', mode: 'commercial', employeeId: staff.id });
  assert.equal(tables.StockBalance.find(row => row.id === 'legacy-custody').quantity, 50);
  assert.deepEqual(result.runs, []); assert.deepEqual(result.balances, []); assert.deepEqual(result.products, []);
});

test('depleted run stock stays zero in the live dashboard despite positive legacy custody', async () => {
  const { client, tables } = fixture(); tables.StockBalance[0].quantity = 0;
  const result = await employeeWorkspaceAction(client, user, { action: 'employeeDashboard', mode: 'commercial', employeeId: staff.id });
  assert.equal(result.runs[0].can_supply, true);
  assert.deepEqual(result.balances, []); assert.deepEqual(result.products, []);
  assert.equal(tables.StockBalance.find(row => row.id === 'legacy-custody').quantity, 50);
});

test('driver payload counts approved vehicle delivery issues rather than sale quantities, legacy custody or driver reports', async () => {
  const { client, tables } = fixture(), assignedDriver = tables.Employee[1];
  client.entities.Employee.filter = async () => [assignedDriver];
  tables.StockBalance[0].quantity = 6;
  tables.FieldSale.push({ id: 'posted', dispatch_id: 'run-a', status: 'approved_posted' },
    { id: 'legacy', dispatch_id: 'run-a', status: 'approved_posted' },
    { id: 'unposted', dispatch_id: 'run-a', status: 'submitted' });
  tables.FieldSaleLine.push({ id: 'posted-line', field_sale_id: 'posted', product_id: 'product-a', quantity: 20 },
    { id: 'legacy-line', field_sale_id: 'legacy', product_id: 'product-a', quantity: 7 });
  tables.SalesOrder.push({ id: 'order-a', dispatch_id: 'run-a', driver_id: assignedDriver.id, customer_id: 'customer-a', status: 'partially_delivered' },
    { id: 'other-driver-order', dispatch_id: 'run-a', driver_id: 'another-driver', status: 'dispatched' });
  tables.SalesOrderLine.push({ id: 'order-line', order_id: 'order-a', product_id: 'product-a', quantity: 5 });
  const issue = { product_id: 'product-a', quantity: 2, source_warehouse_id: 'van-stock', status: 'approved' };
  tables.StockMovement.push(
    { ...issue, id: 'field-issue', document_type: 'FieldSale', document_id: 'posted', movement_type: 'field_delivery' },
    { ...issue, id: 'pending-receipt', document_type: 'FieldSale', document_id: 'posted', movement_type: 'field_delivery', source_warehouse_id: '', destination_warehouse_id: 'pending' },
    { ...issue, id: 'legacy-custody-issue', document_type: 'FieldSale', document_id: 'legacy', movement_type: 'field_delivery', source_warehouse_id: 'custody', quantity: 7 },
    { ...issue, id: 'unposted-issue', document_type: 'FieldSale', document_id: 'unposted', movement_type: 'field_delivery', quantity: 99 },
    { ...issue, id: 'rejected-issue', document_type: 'FieldSale', document_id: 'posted', movement_type: 'field_delivery', status: 'rejected', quantity: 99 },
    { ...issue, id: 'order-issue', document_type: 'SalesOrder', document_id: 'order-a', movement_type: 'customer_delivery' },
    { ...issue, id: 'wrong-kind', document_type: 'SalesOrder', document_id: 'order-a', movement_type: 'commercial_issue', quantity: 99 },
    { ...issue, id: 'another-driver', document_type: 'SalesOrder', document_id: 'other-driver-order', movement_type: 'customer_delivery', quantity: 99 },
  );
  tables.DriverActivity.push({ id: 'report', dispatch_id: 'run-a', driver_id: assignedDriver.id, type: 'delivery_completed', quantity: 999 });
  const before = structuredClone({ sales: tables.FieldSale, movements: tables.StockMovement, balances: tables.StockBalance });
  const result = await employeeWorkspaceAction(client, { id: 'driver-login', role: 'user' }, { action: 'employeeDashboard', mode: 'driver' });
  assert.equal(result.dispatches.length, 1); assert.equal(result.stops.length, 1); assert.equal(result.activities.length, 1);
  assert.deepEqual(result.supplyLines, [
    { product_id: 'product-a', quantity: 2, dispatch_id: 'run-a' },
    { product_id: 'product-a', quantity: 2, dispatch_id: 'run-a' },
  ]);
  assert.equal(result.vehicleBalances.length, 1); assert.equal(result.vehicleBalances[0].warehouse_id, 'van-stock');
  assert.equal(result.vehicleBalances[0].unit_cost, undefined); assert.equal(result.products[0].selling_price, undefined);
  const stock = driverRunStock(result, result.dispatches[0]);
  assert.equal(stock.rows[0].loaded, 10); assert.equal(stock.rows[0].supplied, 4); assert.equal(stock.rows[0].onVehicle, 6);
  assert.deepEqual({ sales: tables.FieldSale, movements: tables.StockMovement, balances: tables.StockBalance }, before,
    'viewing a driver report never creates a second sale or stock issue');
});
