import test from 'node:test';
import assert from 'node:assert/strict';
import { outletAction, hotesseData } from '../src/server/domain/outlet-workspace.js';

const manager = { id: 'manager-a', role: 'admin' };
const hotesse = { id: 'hotesse-a', role: 'hotesse', status: 'active', full_name: 'Staff A' };
const customer = { id: 'customer-a', business_name: 'Registered Customer A', is_active: true, phone: '123', credit_limit: 9000 };
const outlet = { id: 'outlet-a', customer_id: customer.id, name: 'Shop A', customer_name: 'Old customer name', is_active: true, assigned_hotesse_ids: [] };
const client = (entities, staff = null) => ({ entities: { Employee: { filter: async () => staff ? [staff] : [] } }, asServiceRole: { entities } });
const creation = { action: 'createAssignedOutlet', customerId: customer.id, employeeIds: [hotesse.id], requestKey: '11111111-1111-4111-8111-111111111111', name: 'Main shop', address: 'Customer premises', town: 'Yaounde' };

test('administrator roster starts with registered customers, including customers without outlets, and omits orphan outlets and financial details', async () => {
  const second = { ...customer, id: 'customer-b', business_name: 'Customer without outlet' };
  const entities = {
    Customer: { filter: async query => { assert.deepEqual(query, { is_active: { $ne: false } }); return [customer, second]; } },
    CustomerLocation: { filter: async () => [outlet, { ...outlet, id: 'orphan', customer_id: 'missing-customer' }] },
    Employee: { filter: async query => { assert.equal(query.role, 'hotesse'); return [hotesse]; } },
  };
  const result = await outletAction(client(entities), manager, { action: 'outletRoster' });
  assert.deepEqual(result.customers.map(row => row.id), [customer.id, second.id]);
  assert.equal(result.customers[0].credit_limit, undefined);
  assert.equal(result.locations.length, 1);
  assert.equal(result.locations[0].customer_name, customer.business_name);
});

test('assignment checks the registered parent and active Hotesse role, preserves the outlet, and permits administrators to remove access', async () => {
  let parent = customer;
  const writes = [];
  const entities = {
    Customer: { get: async () => parent },
    CustomerLocation: { get: async () => outlet, update: async (id, values) => { writes.push({ id, values }); return { ...outlet, ...values }; } },
    Employee: { filter: async query => {
      assert.equal(query.role, 'hotesse'); assert.equal(query.status, 'active');
      return query.id.$in.every(id => id === hotesse.id) ? [hotesse] : [];
    } },
  };
  const args = { action: 'assignHotesse', customerId: customer.id, locationId: outlet.id, employeeIds: [hotesse.id] };
  const api = client(entities);
  await assert.rejects(outletAction(api, manager, { ...args, customerId: 'other-customer' }), /another customer/);
  await assert.rejects(outletAction(api, manager, { ...args, employeeIds: ['driver-or-inactive'] }), /active Hotesse/);
  await assert.rejects(outletAction(api, manager, { ...args, employeeIds: [hotesse.id, hotesse.id] }), /valid staff/);
  parent = { ...customer, is_active: false };
  await assert.rejects(outletAction(api, manager, args), /active registered customer/);
  parent = null;
  await assert.rejects(outletAction(api, manager, args), /active registered customer/);
  assert.equal(writes.length, 0);
  parent = customer;
  const assigned = await outletAction(api, manager, args);
  assert.equal(assigned.location.customer_id, customer.id);
  assert.deepEqual(assigned.location.assigned_hotesse_ids, [hotesse.id]);
  assert.equal(writes[0].values.hotesse_assignment_by, manager.id);
  assert.equal(writes[0].values.customer_name, customer.business_name);
  await outletAction(api, manager, { ...args, employeeIds: [] });
  assert.deepEqual(writes[1].values.assigned_hotesse_ids, []);
  assert.equal(writes[1].values.customer_id, undefined, 'the registered parent cannot be replaced');
});

test('point-of-sale creation is tied to a registered customer, whitelists fields and reuses the same request without resetting later assignments', async () => {
  const locations = [];
  let inserts = 0;
  const entities = {
    Customer: { get: async id => id === customer.id ? customer : null },
    Employee: { filter: async () => [hotesse] },
    CustomerLocation: {
      get: async id => locations.find(row => row.id === id), filter: async () => locations,
      upsert: async ([row], options) => { assert.equal(options.updateExisting, false); inserts++; locations.push(row); return { records: [row] }; },
    },
  };
  const api = client(entities);
  const first = await outletAction(api, manager, { ...creation, customer_name: 'Forged', gps_lat: 70, is_active: false });
  assert.equal(first.location.customer_name, customer.business_name);
  assert.equal(first.location.customer_id, customer.id);
  assert.equal(first.location.is_active, true);
  assert.equal(first.location.gps_lat, undefined, 'a new shop address does not inherit unverified coordinates');
  assert.equal(locations[0].hotesse_assignment_by, manager.id);
  locations[0].assigned_hotesse_ids = [];
  locations[0].hotesse_assignment_by = 'another-admin';
  const retried = await outletAction(api, manager, creation);
  assert.equal(retried.reused, true);
  assert.deepEqual(retried.location.assigned_hotesse_ids, []);
  assert.equal(inserts, 1);
  await assert.rejects(outletAction(api, manager, { ...creation, requestKey: '22222222-2222-4222-8222-222222222222', name: '  MAIN SHOP ' }), /already has a point of sale/);
  await assert.rejects(outletAction(api, manager, { ...creation, customerId: 'unregistered' }), /active registered customer/);
  await assert.rejects(outletAction(api, manager, { ...creation, requestKey: 'invalid' }), /reference/);
  await assert.rejects(outletAction(api, manager, { ...creation, employeeIds: [] }), /valid staff/);
  await assert.rejects(outletAction(api, { ...manager, id: 'other-admin' }, creation), /reference is already in use/);
  assert.equal(inserts, 1);
});

test('Hotesse cannot choose customers or assign their own outlet, and an inactive or missing parent prevents reporting access', async () => {
  const api = client({}, hotesse), user = { id: 'login-a', role: 'user' };
  for (const action of ['outletRoster', 'assignHotesse', 'createAssignedOutlet']) {
    await assert.rejects(outletAction(api, user, { ...creation, action }), /General Manager/);
  }
  const entities = {
    CustomerLocation: { get: async () => ({ ...outlet, assigned_hotesse_ids: [hotesse.id] }), filter: async () => [{ ...outlet, assigned_hotesse_ids: [hotesse.id] }] },
    Customer: { get: async () => ({ ...customer, is_active: false }), filter: async () => [] },
    OutletVisit: { filter: async () => [] },
  };
  await assert.rejects(outletAction(client(entities, hotesse), user, { action: 'submitOutletVisit', requestKey: creation.requestKey, locationId: outlet.id }), /active registered customer/);
  const data = await hotesseData({ entities }, hotesse.id, '2026-10-18');
  assert.deepEqual(data.locations, []);
  assert.deepEqual(data.outletProducts, {});
});
