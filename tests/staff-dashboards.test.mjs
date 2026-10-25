import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cashierSnapshot, productionSnapshot, managerSnapshot, hotesseSnapshot, DASHBOARD_ROLES } from '../src/lib/staff-dashboard.js';
import { dashboardPreview } from '../src/lib/dashboard-preview.js';
import { canOpenFieldPath } from '../src/lib/permissions.js';
import { workspaceSubject, employeeWorkspaceAction } from '../src/server/domain/employee-workspace.js';
import { validateOutletVisit } from '../src/server/domain/outlet-rules.js';
import { outletAction } from '../src/server/domain/outlet-workspace.js';
import { managerData } from '../src/server/domain/staff-workspace.js';

const staff = { id: 'hotesse-a', full_name: 'Staff A', role: 'hotesse', status: 'active' };
const location = { id: 'outlet-a', name: 'Main outlet', customer_id: 'customer-a', customer_name: 'Customer A', assigned_hotesse_ids: [staff.id], is_active: true };
const product = { id: 'product-a', name: 'YOLA Nature', inventory_type: 'assembly', storage_unit: 'cups', is_active: true };
const body = { requestKey: '11111111-1111-4111-8111-111111111111', locationId: location.id, lines: [{ product_id: product.id, availability: 'low_stock', issue: 'none', quantity: 3, observed_price: '' }], notes: 'Please restock', fileUris: [] };
const user = { id: 'user-a', role: 'user' };
const clientFor = (employee, entities) => ({ entities: { Employee: { filter: async () => employee ? [employee] : [] } }, asServiceRole: { entities } });
const outletSupplies = () => ({
  Customer: { get: async () => ({ id: location.customer_id, business_name: 'Customer A' }), filter: async () => [{ id: location.customer_id, business_name: 'Customer A' }] },
  SalesOrder: { filter: async () => [{ id: 'supply-order', customer_id: location.customer_id, location_id: location.id, status: 'delivered', delivery_date: '2026-01-01' }] },
  SalesOrderLine: { filter: async () => [{ order_id: 'supply-order', product_id: product.id, delivered_quantity: 12, quantity: 99, unit: 'cups' }] },
  FieldSale: { filter: async () => [] }, FieldSaleLine: { filter: async () => [] }, StockMovement: { filter: async () => [] },
});

test('all supported dashboard roles have explicit sample layouts and no live identifiers', () => {
  assert.deepEqual(DASHBOARD_ROLES.map(role => role.value), ['commercial', 'driver', 'cashier', 'production_manager', 'supply_chain_manager', 'hotesse', 'admin']);
  for (const { value } of DASHBOARD_ROLES) {
    const data = dashboardPreview(value);
    assert.equal(data.mode, value); assert.equal(data.isExample, true);
    assert.equal(data.employee.id, 'example-employee');
    if (value === 'cashier') assert.ok(data.accounts.length);
    if (value === 'production_manager') assert.ok(data.orders.length);
    if (value === 'supply_chain_manager') assert.ok(data.purchaseOrders.length);
    if (value === 'hotesse') assert.ok(data.locations.length);
    if (value === 'admin') assert.ok(data.approvalQueues.length);
  }
});

test('new roles have their own routes and cannot open management or another staff workspace', () => {
  for (const role of ['cashier', 'production_manager', 'hotesse']) {
    assert.equal(canOpenFieldPath(role, '/'), true);
    assert.equal(canOpenFieldPath(role, '/payroll'), role === 'cashier');
    for (const path of ['/employees', '/team-workspaces', '/admin', '/field-sales/new']) assert.equal(canOpenFieldPath(role, path), false);
    assert.equal(workspaceSubject(role, { ...staff, role }, ''), staff.id);
    assert.throws(() => workspaceSubject(role, { ...staff, role }, 'someone-else'));
  }
  assert.equal(canOpenFieldPath('hotesse', '/outlet-reports'), true);
  assert.equal(canOpenFieldPath('hotesse', '/customers'), false);
  assert.equal(canOpenFieldPath('hotesse', '/hotesse-forged'), false);
  assert.equal(canOpenFieldPath('cashier', '/accounting/treasury'), false);
  assert.equal(canOpenFieldPath('cashier', '/accounting/payments/new'), true);
  assert.equal(canOpenFieldPath('production_manager', '/manufacturing/new'), true);
  assert.equal(canOpenFieldPath('production_manager', '/cashier'), true);
  assert.equal(canOpenFieldPath('cashier', '/outlet-reports'), false);
  assert.equal(canOpenFieldPath('admin', '/team-workspaces'), true);
});

test('cash summaries exclude transfers, other dates and unapproved payment requests', () => {
  const summary = cashierSnapshot({ date: '2026-10-17', accounts: [{ balance: 100 }, { balance: 900, is_active: false }],
    movements: [{ transaction_date: '2026-10-17', transaction_type: 'receipt', amount: 50 }, { transaction_date: '2026-10-17', transaction_type: 'transfer_in', amount: 1000 }, { transaction_date: '2026-10-16', transaction_type: 'receipt', amount: 800 }, { transaction_date: '2026-10-17', transaction_type: 'expense', amount: 20 }],
    payments: [{ status: 'approved', amount: 200 }, { status: 'pending_approval', amount: 5000 }],
    handovers: [{ offered_amount: 80, received_amount: 30 }, { offered_amount: 10, received_amount: 20 }],
  });
  assert.equal(summary.balance, 100); assert.equal(summary.receipts, 50); assert.equal(summary.expenses, 20);
  assert.equal(summary.readyAmount, 200); assert.equal(summary.handoverAmount, 50);
});

test('manager invoice sales exclude drafts, cancelled and future invoices and keep field supplies separate', () => {
  const summary = managerSnapshot({ date: '2026-10-17', monthStart: '2026-10-01', invoices: [
    { invoice_date: '2026-10-17', status: 'posted', total: 100 }, { invoice_date: '2026-10-16', status: 'paid', total: 50 },
    { invoice_date: '2026-10-17', status: 'draft', total: 1000 }, { invoice_date: '2026-10-17', status: 'cancelled', total: 1000 },
    { invoice_date: '2026-10-18', status: 'posted', total: 1000 }, { invoice_date: '2026-09-30', status: 'posted', total: 30 },
  ], sales: [{ total: 100 }], receivables: [{ status: 'posted', balance: 80, due_date: '2026-10-16' }, { status: 'draft', balance: 9000, due_date: '2026-10-10' }] });
  assert.equal(summary.today, 100); assert.equal(summary.month, 150); assert.equal(summary.receivables, 80); assert.equal(summary.overdueAmount, 80);
  assert.equal(summary.trend.length, 7); assert.equal(summary.trend[6].value, 100);
  assert.equal(summary.fieldSalesToday, 0); assert.equal(summary.fieldSalesMonth, 0);
});

test('manager field supply totals count only posted journal-backed supplies in the correct date period', () => {
  const recorded = (transaction_date, total, changes = {}) => ({ transaction_date, total, status: 'approved_posted', journal_id: 'journal-a', ...changes });
  const summary = managerSnapshot({ date: '2026-10-17', monthStart: '2026-10-01',
    invoices: [{ invoice_date: '2026-10-17', status: 'posted', total: 100 }],
    receivables: [{ status: 'posted', balance: 25 }],
    recordedFieldSales: [recorded('2026-10-17', 40), recorded('2026-10-01', 10), recorded('2026-09-30', 70),
      recorded('2026-10-18', 900), recorded('2026-10-17', 800, { status: 'submitted' }),
      recorded('2026-10-17', 700, { status: 'posting_failed' }), recorded('2026-10-17', 600, { status: 'future_status' }),
      recorded('2026-10-17', 500, { journal_id: '' }), recorded('2026-10-17', 400, { journal_id: '  ' }),
      recorded('2026-10-17', 300, { journal_id: undefined }), recorded('2026-10-00', 200), recorded('', 100),
      recorded('2026-13-01', 100), recorded('2026-02-30', 100)],
  });
  assert.equal(summary.fieldSalesToday, 40); assert.equal(summary.fieldSalesMonth, 50);
  assert.equal(summary.today, 100); assert.equal(summary.month, 100);
  assert.equal(summary.receivables, 25, 'original supply amount_due is not a current receivable balance');
});

test('manager service loads bounded posted field supplies and returns only sales metric metadata', async () => {
  const calls = [];
  const recorded = (id, transaction_date, changes = {}) => ({ id, transaction_date, status: 'approved_posted', total: 100, journal_id: 'journal-' + id,
    customer_name: 'Private customer', receipt_file_uris: ['private/receipt'], amount_due: 75, ...changes });
  const rows = [recorded('today', '2026-10-03'), recorded('week-boundary', '2026-09-27'), recorded('old', '2026-09-26'),
    recorded('future', '2026-10-04'), recorded('unposted', '2026-10-03', { status: 'submitted' }),
    recorded('legacy', '2026-10-03', { journal_id: '' })];
  const entities = new Proxy({}, { get: (_, name) => ({ filter: async query => {
    calls.push({ name, query });
    return name === 'FieldSale' && query.status === 'approved_posted' ? rows : [];
  } }) });
  const data = await managerData({ entities }, '2026-10-03');
  assert.deepEqual(calls.find(call => call.name === 'FieldSale' && call.query.status === 'approved_posted').query,
    { status: 'approved_posted', transaction_date: { $gte: '2026-09-27', $lte: '2026-10-03' } });
  assert.deepEqual(data.recordedFieldSales.map(sale => sale.id), ['today', 'week-boundary']);
  for (const sale of data.recordedFieldSales) assert.deepEqual(Object.keys(sale).sort(), ['id', 'journal_id', 'status', 'total', 'transaction_date']);
  const summary = managerSnapshot({ ...data, date: '2026-10-03' });
  assert.equal(summary.fieldSalesToday, 100); assert.equal(summary.fieldSalesMonth, 100);
});

test('production keeps batch counts separate from mixed product quantities and distinguishes expired stock', () => {
  const summary = productionSnapshot({ date: '2026-10-17', orders: [{ status: 'in_production', planned_output: 200 }, { status: 'awaiting_qc', planned_output: 3 }, { status: 'awaiting_approval' }],
    riskLots: [{ quantity: 5, expiry_date: '2026-10-16' }, { quantity: 2, expiry_date: '2026-10-17', qc_status: 'quarantined' }, { quantity: 0, expiry_date: '2026-10-20', qc_status: 'rejected' }] });
  assert.equal(summary.running.length, 1); assert.equal(summary.awaitingQC.length, 1); assert.equal(summary.awaitingGM.length, 1);
  assert.equal(summary.expired.length, 1); assert.equal(summary.expiring.length, 1); assert.equal(summary.held.length, 1);
});

test('outlet coverage counts distinct currently assigned locations, not repeated visits', () => {
  const summary = hotesseSnapshot({ date: '2026-10-17', locations: [{ id: 'a' }, { id: 'b' }], reports: [
    { location_id: 'a', visit_date: '2026-10-17', has_concerns: true, status: 'submitted' },
    { location_id: 'a', visit_date: '2026-10-17', has_concerns: true, status: 'reviewed' }, { location_id: 'former-outlet', visit_date: '2026-10-17' },
  ] });
  assert.equal(summary.today.length, 3); assert.equal(summary.visited, 1); assert.equal(summary.remaining.length, 1); assert.equal(summary.concerns.length, 1);
});

test('outlet reports reject unassigned outlets, raw materials, duplicates and inconsistent observations', () => {
  const value = validateOutletVisit(body, location, staff, [product]);
  assert.equal(value.lines[0].product_name, product.name); assert.equal(value.has_concerns, true);
  assert.equal(value.lines[0].observed_price, undefined);
  assert.throws(() => validateOutletVisit(body, { ...location, assigned_hotesse_ids: ['other'] }, staff, [product]));
  assert.throws(() => validateOutletVisit(body, { ...location, is_active: false }, staff, [product]));
  assert.throws(() => validateOutletVisit(body, location, staff, [{ ...product, inventory_type: 'raw_material' }]));
  assert.throws(() => validateOutletVisit({ ...body, lines: [...body.lines, ...body.lines] }, location, staff, [product]));
  for (const patch of [{ availability: 'out_of_stock', quantity: 3 }, { quantity: -1 }, { expiry_date: '2026-02-30' }, { availability: 'bogus' }]) {
    assert.throws(() => validateOutletVisit({ ...body, lines: [{ ...body.lines[0], ...patch }] }, location, staff, [product]));
  }
  assert.throws(() => validateOutletVisit({ ...body, notes: '', lines: [{ ...body.lines[0], issue: 'pricing' }] }, location, staff, [product]));
  assert.throws(() => validateOutletVisit({ ...body, fileUris: ['https://example.com/public-photo'] }, location, staff, [product]));
});

test('submitting an outlet report derives attribution, changes no stock and reuses the retry key', async () => {
  const reports = [], writes = [];
  const entities = {
    ...outletSupplies(), SpoilageRecord: { filter: async () => [] },
    OutletVisit: { filter: async () => reports, upsert: async ([value]) => { writes.push('report'); const row = { id: 'report-a', ...value }; reports.push(row); return { records: [row] }; } },
    CustomerLocation: { get: async () => location }, Product: { filter: async () => [product] },
  };
  const client = clientFor(staff, new Proxy(entities, { get: (target, key) => { assert.ok(key in target, 'Unexpected entity access: ' + String(key)); return target[key]; } }));
  const args = { ...body, lines: [{ product_id: product.id, sold_quantity: 3, damaged_quantity: 0, quantity: 9, observed_price: 500 }], action: 'submitOutletVisit', employee_id: 'forged', employee_name: 'Forged', visit_date: '2000-01-01' };
  const first = await outletAction(client, user, args);
  assert.equal(first.report.employee_id, staff.id); assert.equal(first.report.recorded_by, user.id); assert.notEqual(first.report.visit_date, args.visit_date);
  const retry = await outletAction(client, user, args);
  assert.equal(retry.reused, true); assert.deepEqual(writes, ['report']);
});

test('Hotesse cannot assign outlets or review reports and cannot request another employee history', async () => {
  const queries = [];
  const client = clientFor(staff, { OutletVisit: { filter: async query => { queries.push(query); return []; } } });
  await assert.rejects(outletAction(client, user, { action: 'assignHotesse', locationId: location.id, employeeIds: ['other'] }), /General Manager/);
  await assert.rejects(outletAction(client, user, { action: 'reviewOutletVisit', reportId: 'some-report' }), /General Manager/);
  await outletAction(client, user, { action: 'outletReports', employeeId: 'other', from: '2026-10-01', to: '2026-10-17' });
  assert.equal(queries[0].employee_id, staff.id);
});

test('a cashier cannot choose the manager dashboard or read invoice/customer entities through the endpoint', async () => {
  const cashier = { ...staff, role: 'cashier' }, calls = [];
  const entities = new Proxy({}, { get: (_, name) => {
    assert.ok(['TreasuryAccount', 'TreasuryTransaction', 'CashHandover', 'Payment', 'ExpenseRequest'].includes(name));
    return { filter: async () => { calls.push(name); return []; } };
  } });
  const data = await employeeWorkspaceAction(clientFor(cashier, entities), user, { action: 'employeeDashboard', mode: 'admin' });
  assert.equal(data.mode, 'cashier'); assert.equal(calls.length, 5); assert.equal(data.approvalQueues, undefined);
});

test('Hotesse dashboard restricts supplies to assigned outlets and hides supply prices', async () => {
  const entities = { ...outletSupplies(), CustomerLocation: { filter: async query => { assert.deepEqual(query.assigned_hotesse_ids, { $in: [staff.id] }); return [location, { ...location, id: 'other', assigned_hotesse_ids: ['other'] }]; } },
    OutletVisit: { filter: async query => { if (query.employee_id) assert.equal(query.employee_id, staff.id); else assert.equal(query.location_id, location.id); return []; } }, Product: { filter: async () => [product] } };
  entities.SpoilageRecord = { filter: async () => [] };
  const data = await employeeWorkspaceAction(clientFor(staff, entities), user, { action: 'employeeDashboard', mode: 'admin' });
  assert.equal(data.mode, 'hotesse'); assert.equal(data.locations.length, 1); assert.equal(data.products[0].selling_price, undefined);
  assert.equal(data.outletProducts[location.id][0].opening_quantity, 12);
  assert.equal(data.outletProducts.other, undefined);
});

test('General Manager home works without a linked Employee and reports remain service-only', async () => {
  const entities = new Proxy({}, { get: () => ({ filter: async () => [] }) });
  const data = await employeeWorkspaceAction(clientFor(null, entities), { id: 'manager-user', role: 'admin', full_name: 'Manager' }, { action: 'employeeDashboard', mode: 'admin' });
  assert.equal(data.employee.id, 'manager-user'); assert.equal(data.mode, 'admin'); assert.ok(data.approvalQueues.length > 0);
  const schema = JSON.parse(readFileSync(new URL('../migration/entities/OutletVisit.jsonc', import.meta.url), 'utf8'));
  assert.deepEqual(schema.rls, { create: false, read: false, update: false, delete: false });
});
