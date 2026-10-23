import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { businessDate, workspaceSubject, validateDriverActivity, employeeWorkspaceAction } from '../src/server/domain/employee-workspace.js';
import { canOpenFieldPath, normalizeRole, getEffectiveRole } from '../src/lib/permissions.js';
import { commercialSnapshot, latestDeliveryReports } from '../src/lib/employee-dashboard.js';
import { dashboardPreview } from '../src/lib/dashboard-preview.js';

const driver = { id: 'driver-a', full_name: 'Driver A', role: 'driver', status: 'active' };
const dispatch = { id: 'run-a', driver_id: driver.id, status: 'in_transit' };
const order = { id: 'order-a', dispatch_id: dispatch.id, driver_id: driver.id, status: 'ready' };
const body = { requestKey: '11111111-1111-4111-8111-111111111111', type: 'delivery_completed', receiver: 'Recipient', fileUris: [] };

test('drivers have a distinct role and field routes deny direct ERP access', () => {
  assert.equal(normalizeRole('Driver'), 'driver'); assert.equal(normalizeRole('chauffeur'), 'driver');
  assert.equal(getEffectiveRole({ role: 'user' }, driver), 'driver');
  assert.equal(getEffectiveRole({ role: 'admin' }, driver), 'admin');
  for (const role of ['commercial', 'driver']) {
    assert.equal(canOpenFieldPath(role, '/'), true);
    for (const path of ['/accounting', '/sales/new', '/employees', '/distribution/dispatches/new', '/team-workspaces']) assert.equal(canOpenFieldPath(role, path), false);
    assert.equal(canOpenFieldPath(role, '/customers/new'), role === 'commercial');
  }
  assert.equal(canOpenFieldPath('commercial', '/field-sales/new'), true);
  assert.equal(canOpenFieldPath('commercial', '/cash-handovers'), true);
  assert.equal(canOpenFieldPath('commercial', '/field-sales-forged'), false);
  assert.equal(canOpenFieldPath('driver', '/driver'), true);
  assert.equal(canOpenFieldPath('driver', '/distribution'), true);
  assert.equal(canOpenFieldPath('driver', '/distribution/dispatches/new'), false);
  assert.equal(canOpenFieldPath('driver', '/distribution/requests/another-run'), false);
  assert.equal(canOpenFieldPath('driver', '/field-sales/new'), false);
});

test('workspace access derives the employee from the session and rejects inactive or impersonated staff', () => {
  assert.equal(workspaceSubject('driver', driver, ''), driver.id);
  assert.throws(() => workspaceSubject('driver', driver, 'another-driver'));
  assert.throws(() => workspaceSubject('driver', { ...driver, status: 'suspended' }, ''));
  assert.throws(() => workspaceSubject('driver', null, ''));
  assert.throws(() => workspaceSubject('warehouse_manager', driver, ''));
  assert.equal(workspaceSubject('admin', null, 'driver-a'), 'driver-a');
});

test('Supply Chain Manager has a scoped dashboard without GM or finance reads', async () => {
  const employee = { id:'supply-a',full_name:'Supply Manager',role:'supply_chain_manager',access_template:'warehouse_manager',allowed_modules:['purchases','inventory','distribution'],status:'active' };
  assert.equal(workspaceSubject('warehouse_manager',employee,''),employee.id);
  assert.throws(() => workspaceSubject('warehouse_manager',employee,'another-person'),/own workspace/);
  const reads = [];
  const records = { PurchaseOrder:[{ id:'po',po_number:'PO-1',status:'pending_approval' }], StockBalance:[{ id:'lot',quantity:4,qc_status:'quarantined' }], Dispatch:[{ id:'run',dispatch_number:'RUN-1',status:'in_transit' }] };
  const client = { auth:{ staff:async () => employee }, asServiceRole:{ entities:new Proxy({}, { get:(_,name) => ({ filter:async () => { reads.push(name); return records[name] || []; } }) }) } };
  const result = await employeeWorkspaceAction(client,{ id:'login',role:'user' },{ action:'employeeDashboard',mode:'admin' });
  assert.equal(result.mode,'supply_chain_manager');
  assert.equal(result.purchaseOrders[0].po_number,'PO-1');
  assert.equal(result.dispatches[0].dispatch_number,'RUN-1');
  assert.deepEqual(reads,['PurchaseOrder','StockBalance','Dispatch']);
  assert.equal(result.payments,undefined);
  employee.allowed_modules = ['inventory']; reads.length = 0;
  const narrowed = await employeeWorkspaceAction(client,{ id:'login',role:'user' },{ action:'employeeDashboard' });
  assert.deepEqual(reads,['StockBalance']);
  assert.deepEqual(narrowed.purchaseOrders,[]);
  assert.deepEqual(narrowed.dispatches,[]);
  assert.equal(dashboardPreview('supply_chain_manager').isExample,true);
});

test('driver reporting enforces assignment, run status, order membership and recipient details', () => {
  assert.equal(validateDriverActivity(dispatch, driver, body, order), 'delivery_completed');
  assert.throws(() => validateDriverActivity({ ...dispatch, driver_id: 'other' }, driver, body, order));
  assert.throws(() => validateDriverActivity(dispatch, driver, body, { ...order, dispatch_id: 'other-run' }));
  assert.throws(() => validateDriverActivity(dispatch, driver, body, { ...order, driver_id: 'other' }));
  assert.throws(() => validateDriverActivity(dispatch, driver, body, { ...order, status: 'cancelled' }));
  assert.throws(() => validateDriverActivity(dispatch, driver, { ...body, receiver: '' }, order));
  assert.throws(() => validateDriverActivity({ ...dispatch, status: 'approved' }, driver, body, order));
  assert.throws(() => validateDriverActivity(dispatch, driver, body, order, true));
  assert.throws(() => validateDriverActivity(dispatch, driver, { ...body, type: 'delivery_partial' }, order));
  assert.throws(() => validateDriverActivity(dispatch, driver, { ...body, fileUris: ['https://example.com/public-file'] }, order));
  assert.equal(validateDriverActivity(dispatch, driver, { ...body, type: 'delivery_failed', receiver: '', notes: 'Shop was closed' }, order), 'delivery_failed');
});

test('starting a run requires warehouse loading and returning does not imply stock reconciliation', () => {
  assert.equal(validateDriverActivity({ ...dispatch, status: 'loaded' }, driver, { ...body, type: 'trip_started' }, null), 'trip_started');
  assert.throws(() => validateDriverActivity({ ...dispatch, status: 'approved' }, driver, { ...body, type: 'trip_started' }, null));
  assert.equal(validateDriverActivity(dispatch, driver, { ...body, type: 'trip_returned' }, null), 'trip_returned');
  assert.throws(() => validateDriverActivity({ ...dispatch, status: 'completed' }, driver, { ...body, type: 'trip_returned' }, null));
});

test('dashboard day follows Cameroon midnight and commercial metrics exclude unapproved and stale sales', () => {
  assert.equal(businessDate(new Date('2026-10-17T23:30:00Z')), '2026-10-18');
  const summary = commercialSnapshot({ date: '2026-10-18', monthStart: '2026-10-01',
    sales: [{ status: 'approved_posted', transaction_date: '2026-10-18', total: 500 },
      { status: 'submitted', transaction_date: '2026-10-18', total: 9000 }, { status: 'draft', total: 100 },
      { status: 'approved_posted', transaction_date: '2026-09-30', total: 10000 }, { status: 'approved_posted', transaction_date: '2026-10-17', total: 250 }],
    cash: [{ outstanding_amount: 400 }, { outstanding_amount: -20 }], customers: [{ acquisition_date: '2026-10-01', acquisition_verified: 'verified_unique' }, { acquisition_date: '2026-10-02', acquisition_verified: 'pending' }, { acquisition_date: '2026-09-01', acquisition_verified: 'verified_unique' }],
    products: [{ id: 'p', inventory_type: 'assembly' }, { id: 'r', inventory_type: 'raw_material' }],
    balances: [{ product_id: 'p', quantity: 4, qc_status: 'approved' }, { product_id: 'p', quantity: 3, expiry_date: '2026-10-17' }, { product_id: 'r', quantity: 100 }],
  });
  assert.equal(summary.today, 500); assert.equal(summary.month, 750); assert.equal(summary.cash, 400);
  assert.equal(summary.registered, 2); assert.equal(summary.verified, 1); assert.equal(summary.drafts.length, 1);
  assert.equal(summary.stock.length, 1); assert.equal(summary.stock[0].quantity, 4);
});

test('delivery follow-up uses the latest attempt for each order', () => {
  const reports = latestDeliveryReports([{ order_id: 'a', type: 'delivery_completed', recorded_at: '2026-10-17T13:00:00Z' },
    { order_id: 'a', type: 'delivery_failed', recorded_at: '2026-10-17T10:00:00Z' }, { type: 'incident', recorded_at: '2026-10-17T14:00:00Z' }]);
  assert.equal(reports.size, 1); assert.equal(reports.get('a').type, 'delivery_completed');
});

test('sample layouts are explicitly labelled and contain no live identifiers', () => {
  for (const mode of ['commercial', 'driver']) {
    const data = dashboardPreview(mode);
    assert.equal(data.isExample, true); assert.equal(data.employee.id, 'example-employee');
    data.products.forEach((p) => assert.ok(p.id.startsWith('example-')));
  }
  const schema = JSON.parse(readFileSync(new URL('../migration/entities/DriverActivity.jsonc', import.meta.url), 'utf8'));
  assert.deepEqual(schema.rls, { create: false, read: false, update: false, delete: false });
});

test('driver reports never mutate stock, invoices or sales orders, and retries reuse the saved activity', async () => {
  const activities = [], mutations = [];
  const svc = { Dispatch: { get: async () => dispatch, updateMany: async () => { mutations.push('dispatch'); } },
    SalesOrder: { get: async () => order, update: async () => { mutations.push('order'); } },
    StockBalance: { update: async () => { mutations.push('stock'); } },
    DriverActivity: { filter: async () => activities, upsert: async ([value]) => { const saved = { ...value, id: 'activity-a' }; activities.push(saved); return { records: [saved] }; } } };
  const client = { entities: { Employee: { filter: async () => [driver] } }, asServiceRole: { entities: svc } };
  const args = { ...body, action: 'driverActivity', dispatchId: dispatch.id, orderId: order.id, driver_id: 'forged' };
  const first = await employeeWorkspaceAction(client, { id: 'user-a', role: 'user' }, args);
  assert.equal(first.activity.driver_id, driver.id); assert.equal(first.activity.recorded_by, 'user-a');
  const retry = await employeeWorkspaceAction(client, { id: 'user-a', role: 'user' }, args);
  assert.equal(retry.reused, true); assert.equal(activities.length, 1); assert.deepEqual(mutations, []);
  await assert.rejects(employeeWorkspaceAction(client, { id: 'user-a', role: 'user' }, { action: 'dispatchActivity', dispatchId: dispatch.id }), /management/);
});

test('scoped dashboard rejects another employee before reading any service records', async () => {
  let reads = 0;
  const client = { entities: { Employee: { filter: async () => [driver] } }, asServiceRole: { entities: new Proxy({}, { get: () => { reads++; throw new Error('Unexpected service read'); } }) } };
  await assert.rejects(employeeWorkspaceAction(client, { id: 'user-a', role: 'user' }, { action: 'employeeDashboard', employeeId: 'driver-b', mode: 'driver' }), /own workspace/);
  assert.equal(reads, 0);
});

test('a dispatch status change during reporting is checked again before saving', async () => {
  let reads = 0, writes = 0;
  const client = { entities: { Employee: { filter: async () => [driver] } }, asServiceRole: { entities: {
    Dispatch: { get: async () => (++reads === 1 ? dispatch : { ...dispatch, status: 'approved' }) },
    SalesOrder: { get: async () => order },
    DriverActivity: { filter: async () => [], upsert: async () => { writes++; } },
  } } };
  await assert.rejects(employeeWorkspaceAction(client, { id: 'user-a', role: 'user' }, {
    ...body, action: 'driverActivity', dispatchId: dispatch.id, orderId: order.id,
  }), /Start the run/);
  assert.equal(writes, 0);
});
