import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { canOpenFieldPath, NAV_ROLE_ACCESS, hasRoleAccess, canApprovePO, canApproveProduction, canApproveFieldSale, canDisburse } from '../src/lib/permissions.js';
import { assertEntityAccess, recordScope, visibleRecord } from '../src/server/access.js';
import { guardDispatchMutation } from '../src/server/domain/dispatch-mutations.js';
import { commercialAction } from '../src/server/domain/commercial-workspace.js';
import { companySalesAction } from '../src/server/domain/company-sales.js';
import { employeeWorkspaceAction } from '../src/server/domain/employee-workspace.js';
import { fixture, date, user } from './helpers/cashier.mjs';
const role = 'production_manager';
const context = { user, employee: { id: 'operations', role, status: 'active' } };

test('Operations opens all seven requested modules while financial and staff administration stay restricted', () => {
  for (const path of ['/accounting', '/sales', '/inventory', '/manufacturing', '/quality', '/expiry', '/commercial', '/distribution']) {
    assert.equal(canOpenFieldPath(role, path), true, path);
    assert.equal(hasRoleAccess(role, NAV_ROLE_ACCESS[path]), true, path);
  }
  for (const path of ['/inventory/products/new', '/items/new', '/manufacturing/new', '/distribution/dispatches/new', '/distribution/requests/run']) assert.equal(canOpenFieldPath(role, path), true, path);
  for (const path of ['/sales/new', '/sales/order', '/field-review', '/field-sales/new', '/commercial/new', '/employees', '/admin', '/team-workspaces', '/payroll', '/accounting/journals/new', '/cash-handovers']) assert.equal(canOpenFieldPath(role, path), false, path);
  for (const permission of [canApprovePO, canApproveProduction, canApproveFieldSale, canDisburse]) assert.equal(permission(role), false);
  for (const entity of ['Product', 'StockBalance', 'StockMovement', 'ProductionOrder', 'QualityCheck', 'Dispatch', 'DispatchLine', 'DispatchRequest', 'Route', 'Vehicle']) assert.doesNotThrow(() => assertEntityAccess(context, entity, 'update'), entity);
  for (const entity of ['Employee', 'User', 'Invoice', 'SalesOrder', 'FieldSale', 'CashHandover', 'TreasuryAccount', 'JournalEntry', 'PayrollRun']) assert.throws(() => assertEntityAccess(context, entity, 'update'), entity);
  for (const entity of ['Dispatch', 'DispatchLine', 'DispatchRequest', 'SalesOrder', 'SalesOrderLine', 'Vehicle', 'Route', 'Customer', 'CustomerLocation']) assert.doesNotThrow(() => assertEntityAccess(context, entity, 'filter'), entity);
});

test('Operations can select active delivery staff without gaining their login, salary or personal records', async () => {
  const scope = await recordScope(context, 'Employee', 'filter', {});
  assert.deepEqual(scope, { $or: [{ id: 'operations' }, { role: { $in: ['commercial', 'driver', 'employee'] }, status: 'active' }] });
  assert.deepEqual(visibleRecord(context, 'Employee', { id: 'driver', full_name: 'Driver', role: 'driver', status: 'active', user_id: 'private-login', salary: 100000 }), { id: 'driver', full_name: 'Driver', role: 'driver', status: 'active' });
  await assert.rejects(guardDispatchMutation(context, 'Dispatch', 'update', { status: 'loaded' }, { id: 'run', status: 'approved' }, {}), /checked dispatch/);
  await assert.rejects(guardDispatchMutation(context, 'Dispatch', 'update', { status: 'cancelled' }, { id: 'run', status: 'loaded' }, {}), /Return loaded stock/);
  await assert.doesNotReject(guardDispatchMutation(context, 'Dispatch', 'update', { status: 'cancelled' }, { id: 'run', status: 'approved' }, {}));
});

test('Operations can filter reports across agents but cannot verify customers or record sales for them', async () => {
  const { client, entities } = await fixture();
  await entities.Employee.update('cashier', { role });
  const agent = await entities.Employee.create({ role: 'commercial', status: 'active', full_name: 'Agent A' });
  const other = await entities.Employee.create({ role: 'commercial', status: 'active', full_name: 'Agent B' });
  const sale = await entities.FieldSale.create({ commercial_id: agent.id, status: 'approved_posted', transaction_date: date, total: 1000, subtotal: 1000, customer_id: 'customer-a', journal_id: 'posted-journal', sale_number: 'FS-01' });
  await entities.FieldSaleLine.create({ field_sale_id: sale.id, product_id: 'product-a', product_name: 'YOLA', quantity: 2, unit: 'ea' });
  const body = { action: 'commercialPerformance', from: date, to: date };
  const all = await commercialAction(client, user, body);
  assert.equal(all.agents.length, 2); assert.equal(all.agents.find(a => a.id === agent.id).deliveries, 1);
  const selected = await commercialAction(client, user, { ...body, commercialId: other.id });
  assert.equal(selected.agents.length, 1); assert.equal(selected.agents[0].deliveries, 0);
  for (const action of ['verifyFieldCustomer', 'registerCustomer', 'updateCustomerGps', 'commercialDailySupplies']) await assert.rejects(commercialAction(client, user, { action }), /Not permitted/);
  const journal=await entities.JournalEntry.create({status:'posted',source_document_type:'FieldSale',source_document_id:sale.id});
  await entities.FieldSale.update(sale.id,{journal_id:journal.id});
  const sales = await companySalesAction(client, user, body); assert.equal(sales.totals.count, 1);
  await entities.Employee.update('cashier', { status: 'inactive' });
  await assert.rejects(commercialAction(client, user, body), /not active/);
});

test('Operations reviews driver reports but cannot impersonate a driver or preview another staff workspace', async () => {
  const { client, entities } = await fixture(); await entities.Employee.update('cashier', { role });
  const result = await employeeWorkspaceAction(client, user, { action: 'dispatchActivity', dispatchId: 'run-a' });
  assert.deepEqual(result.activities, []);
  await assert.rejects(employeeWorkspaceAction(client, user, { action: 'driverActivity', dispatchId: 'run-a' }), /Only the assigned/);
  await assert.rejects(employeeWorkspaceAction(client, user, { action: 'employeeDashboard', employeeId: 'driver-a' }), /own workspace/);
});

test('Operations approval inbox never requests payroll, cash releases or customer receipts', async () => {
  const output = await build({ entryPoints: ['src/lib/approvals.js'], bundle: true, platform: 'node', format: 'esm', write: false, plugins: [{ name: 'approval-fixture', setup(b) {
    b.onResolve({ filter: /^@\/api\/erpClient$/ }, () => ({ path: 'erp', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const erp=globalThis.__operationsClient;' }));
  } }] });
  const reads = [];
  globalThis.__operationsClient = { entities: new Proxy({}, { get: (_, name) => ({ filter: async () => { reads.push(name); return []; } }) }) };
  try {
    const { loadPendingApprovals, canDecide } = await import('data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].text).toString('base64'));
    assert.deepEqual(await loadPendingApprovals(role), []);
    assert.deepEqual(reads.sort(), ['PurchaseOrder', 'ProductionOrder', 'DispatchRequest', 'ExpenseRequest', 'Recipe'].sort());
    assert.equal(canDecide('dispatch', role), true);
    for (const type of ['cash', 'customer_receipt', 'payroll', 'po', 'production']) assert.equal(canDecide(type, role), false);
  } finally { delete globalThis.__operationsClient; }
});
