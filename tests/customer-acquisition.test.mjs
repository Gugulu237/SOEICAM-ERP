import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, fieldHandler, request, staff, date } from './helpers/commercial-supply.mjs';
import { employeeWorkspaceAction } from '../src/server/domain/employee-workspace.js';
import { commercialSnapshot } from '../src/lib/employee-dashboard.js';
import { guardMutation } from '../src/server/access.js';
import { isReadOnlyFunction } from '../src/lib/function-actions.js';

const gm = { id: 'gm-login', role: 'admin', full_name: 'General Manager' };
const customer = { business_name: 'New acquired shop', phone: '699123456', category: 'shop', credit_limit: 0, payment_terms_days: 0 };
const registration = extra => ({ action: 'registerManagedCustomer', requestKey: crypto.randomUUID(), acquiredById: staff.id, customer: { ...customer }, ...extra });
async function setup() {
  const f = fixture(), handler = await fieldHandler();
  f.client.auth.me = async () => gm; f.client.entities.Employee.filter = async () => [];
  globalThis.__dailySupplyClient = f.client;
  return { ...f, call: async body => { const response = await handler(request(body)); return { httpStatus: response.status, ...await response.json() }; },
    close: () => { delete globalThis.__dailySupplyClient; } };
}
test('GM registration attributes the acquisition to the selected active employee and retains the actual registrar and audit actor', async () => {
  const f = await setup(); try {
    f.tables.Customer[0].customer_number = 'C-0142';
    const args = registration(), result = await f.call(args);
    assert.equal(result.httpStatus, 200, result.error);
    assert.equal(result.customer.customer_number, 'C-0143'); assert.equal(f.tables.CompanySettings[0].next_customer_number, 144);
    assert.equal(result.customer.acquired_by_id, staff.id); assert.equal(result.customer.acquired_by_name, staff.full_name); assert.equal(result.customer.salesperson_id, staff.id);
    assert.equal(result.customer.registered_by_id, gm.id); assert.equal(result.customer.registered_by_name, gm.full_name);
    assert.equal(result.customer.acquisition_source, 'management_entry'); assert.equal(result.customer.acquisition_verified, 'pending');
    assert.equal(result.customer.acquisition_date, date); assert.equal(result.customer.balance, 0);
    assert.equal(f.tables.AuditLog[0].user_id, gm.id); assert.match(f.tables.AuditLog[0].description, /Agent A/);
    assert.equal(f.tables.FieldSale.length, 0); assert.equal(f.tables.StockMovement.length, 0); assert.equal(f.tables.JournalEntry.length, 0);
    const before = structuredClone(f.tables); assert.equal((await f.call(args)).reused, true); assert.deepEqual(f.tables, before);
    for (const changed of [{ ...args, acquiredById: '' }, { ...args, customer: { ...customer, business_name: 'Different shop' } }]) {
      assert.match((await f.call(changed)).error, /different details/); assert.deepEqual(f.tables, before);
    }
  } finally { f.close(); }
});
test('acquisition credit and verified customer bonus appear only on the selected employee commission view', async () => {
  const f = await setup(); try {
    f.tables.Employee[0].new_customer_bonus = 1500;
    f.tables.Employee[0].commission_rate_percent = 5;
    const registered = await f.call(registration()); assert.equal(registered.httpStatus, 200, registered.error);
    const pending = await employeeWorkspaceAction(f.client, gm, { action: 'employeeDashboard', mode: 'commercial', employeeId: staff.id });
    assert.equal(commercialSnapshot(pending).registered, 1); assert.equal(commercialSnapshot(pending).commission.acquisitionEstimate, 0);
    const verified = await f.call({ action: 'verifyFieldCustomer', customerId: registered.customer.id, status: 'verified_unique' }); assert.equal(verified.httpStatus, 200, verified.error);
    const dashboard = await employeeWorkspaceAction(f.client, gm, { action: 'employeeDashboard', mode: 'commercial', employeeId: staff.id });
    assert.equal(commercialSnapshot(dashboard).verified, 1); assert.equal(commercialSnapshot(dashboard).commission.acquisitionEstimate, 1500);
    assert.equal(f.tables.Customer.find(row => row.id === registered.customer.id).registered_by_id, gm.id);
    assert.equal(f.tables.JournalEntry.length, 0, 'commission estimates do not create an unapproved employee payable');
    const fieldCustomers = await f.call({ action: 'fieldCustomers', commercialId: staff.id });
    assert.equal(fieldCustomers.customers[0].registered_by_name, gm.full_name); assert.equal(fieldCustomers.customers[0].acquired_by_name, staff.full_name);
    await f.call({ action: 'verifyFieldCustomer', customerId: registered.customer.id, status: 'duplicate', notes: 'Existing partner branch.' });
    const duplicate = await employeeWorkspaceAction(f.client, gm, { action: 'employeeDashboard', mode: 'commercial', employeeId: staff.id });
    assert.equal(commercialSnapshot(duplicate).commission.acquisitionEstimate, 0);
  } finally { f.close(); }
});
test('unattributed management customers remain uncredited and shared phone numbers carry a verification warning', async () => {
  const f = await setup(); try {
    let result = await f.call(registration({ acquiredById: '' })); assert.equal(result.httpStatus, 200, result.error);
    assert.equal(result.customer.acquired_by_id, undefined); assert.equal(result.customer.registered_by_id, gm.id);
    result = await f.call(registration({ customer: { ...customer, business_name: 'Second shop' } }));
    assert.equal(result.httpStatus, 200, result.error); assert.equal(result.customer.acquisition_verified, 'pending'); assert.match(result.customer.acquisition_notes, /Shared phone/);
    const before = structuredClone(f.tables); result = await f.call(registration());
    assert.match(result.error, /already registered/); assert.deepEqual(f.tables, before);
  } finally { f.close(); }
});
test('only active Commercial beneficiaries are listed and forged ownership, bonuses, balances or unauthorized callers cannot bypass the workflow', async () => {
  const f = await setup(); try {
    f.tables.Employee.push({ id: 'inactive', role: 'commercial', status: 'inactive' }, { id: 'cashier', role: 'cashier', status: 'active' });
    const options = await f.call({ action: 'customerAcquisitionOptions' }); assert.equal(options.httpStatus, 200, options.error); assert.deepEqual(options.employees.map(row => row.id), [staff.id]);
    assert.deepEqual(Object.keys(options.employees[0]).sort(), ['full_name', 'id']);
    for (const body of [registration({ acquiredById: 'inactive' }), registration({ acquiredById: 'cashier' }), registration({ acquiredById: 'missing' }), registration({ acquiredById: true }),
      registration({ customer: { ...customer, acquired_by_id: 'forged' } }), registration({ customer: { ...customer, balance: 100 } }),
      registration({ customer: { ...customer, acquisition_verified: 'verified_unique' } }), registration({ customer: { ...customer, registered_by_id: 'forged' } })]) {
      const before = structuredClone(f.tables), result = await f.call(body); assert.equal(result.httpStatus, 400, JSON.stringify(body)); assert.deepEqual(f.tables, before);
    }
    const context = { user: gm, employee: null };
    for (const key of ['acquired_by_id', 'registered_by_id', 'registered_by_name', 'registration_request_key', 'registration_request_hash']) assert.throws(() => guardMutation(context, 'Customer', 'create', { business_name: 'Forged', [key]: 'forged' }), { status: 403 });
    f.client.auth.me = async () => ({ id: staff.user_id, role: 'user' }); f.client.entities.Employee.filter = async () => [f.tables.Employee[0]];
    const before = structuredClone(f.tables); const denied = await f.call(registration()); assert.ok(denied.httpStatus >= 400); assert.deepEqual(f.tables, before);
    assert.equal(isReadOnlyFunction('fieldOps', 'customerAcquisitionOptions'), true); assert.equal(isReadOnlyFunction('fieldOps', 'registerManagedCustomer'), false);
  } finally { f.close(); }
});
