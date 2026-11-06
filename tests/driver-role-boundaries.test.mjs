import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, fieldHandler, request, staff, run } from './helpers/commercial-supply.mjs';
import { driverDeliveryAction, driverDeliveryPoints } from '../src/server/domain/driver-deliveries.js';
import { driverLoadSnapshot } from '../src/lib/driver-deliveries.js';
import { featureContext, entityFeatureContext } from '../src/server/feature-access.js';
import { catalogueFromStored, decorateEmployee, validateRoleProfile } from '../src/server/domain/role-catalogue.js';
import { assertEntityAccess } from '../src/server/access.js';
import { normalizeRole } from '../src/server/domain/roles.js';
import { canOpenFieldPath } from '../src/lib/permissions.js';
import { modulesForRole } from '../src/lib/appModules.js';

function setup() {
  const f = fixture(), user = { id: 'driver-login', role: 'user' }, driver = f.tables.Employee[1];
  driver.user_id = user.id;
  f.client.entities.Employee.filter = async () => [driver];
  f.client.auth.me = async () => user;
  f.client.auth.assertModule = module => assert.equal(module, 'distribution');
  f.tables.Customer[0].salesperson_id = staff.id;
  const current = f.tables.Dispatch[0];
  const receipt = () => ({ action: 'driverReceiveLoad', dispatchId: current.id, requestKey: crypto.randomUUID(), loadSnapshot: driverLoadSnapshot(current, f.tables.DispatchLine) });
  return { ...f, user, driver, current, receipt, call: body => driverDeliveryAction(f.client, user, body) };
}

test('receiving the assigned load records its actor once without moving inventory or money', async () => {
  const f = setup(), before = structuredClone(f.tables), body = f.receipt();
  const result = await f.call(body);
  assert.equal(result.activity.driver_id, f.driver.id); assert.equal(result.activity.recorded_by, f.user.id);
  assert.equal(result.activity.type, 'stock_received');
  assert.equal((await f.call(body)).reused, true);
  assert.equal((await f.call(f.receipt())).reused, true);
  assert.equal(f.tables.DriverActivity.length, 1);
  for (const name of ['StockBalance', 'StockMovement', 'JournalEntry', 'SalesOrder', 'FieldSale', 'CashCollection', 'Dispatch']) assert.deepEqual(f.tables[name], before[name], name);
  f.tables.DispatchLine[0].loaded_quantity += 2;
  await assert.rejects(f.call({ ...body, requestKey: crypto.randomUUID() }), /load changed/);
  await f.call(f.receipt()); assert.equal(f.tables.DriverActivity.length, 2);
});

test('receipt and planning reject foreign/inactive runs, impersonation and non-driver accounts', async () => {
  for (const change of [{ driverId: 'other' }, { employeeId: 'other' }, { commercialId: staff.id }, { dispatchId: 'other' }, { requestKey: 'invalid' }]) {
    const f = setup(), before = structuredClone(f.tables);
    await assert.rejects(f.call({ ...f.receipt(), ...change })); assert.deepEqual(f.tables, before);
  }
  for (const role of ['admin', 'warehouse_manager', 'commercial', 'production_manager']) {
    const f = setup(); f.driver.role = role;
    await assert.rejects(f.call(f.receipt())); assert.equal(f.tables.DriverActivity.length, 0);
  }
  for (const state of ['approved', 'returned', 'completed', 'cancelled']) {
    const f = setup(); f.current.status = state;
    await assert.rejects(f.call(f.receipt())); assert.equal(f.tables.DriverActivity.length, 0);
  }
  const f = setup(); f.tables.DriverActivity.push({ dispatch_id: run.id, type: 'trip_returned' });
  await assert.rejects(f.call(f.receipt()), /no longer active/);
});

test('delivery planning exposes only team customers and preserves selected visit order with retry protection', async () => {
  const f = setup();
  f.tables.Customer.push({ id: 'second', business_name: 'Second shop', is_active: true, acquired_by_id: staff.id, balance: 999 },
    { id: 'foreign', business_name: 'Foreign shop', is_active: true, salesperson_id: 'other' });
  f.tables.CustomerLocation.push({ id: 'outlet', customer_id: 'second', name: 'Damas', is_active: true, phone: '650000000', gps_lat: 3.8, gps_lng: 11.5 });
  const points = await driverDeliveryPoints(f.client.asServiceRole, [f.current]);
  assert.deepEqual(points.map(row => row.customer_id).sort(), ['customer-a', 'second']);
  assert.equal(points[1].balance, undefined); assert.equal(points[1].phone, '650000000');
  const body = { action: 'driverSaveDeliveryPlan', dispatchId: run.id, requestKey: crypto.randomUUID(),
    stops: [{ customer_id: 'second', location_id: 'outlet' }, { customer_id: 'customer-a', location_id: '' }] };
  const before = structuredClone(f.tables), result = await f.call(body);
  assert.deepEqual(result.activity.planned_stops, body.stops);
  assert.equal((await f.call(body)).reused, true);
  await assert.rejects(f.call({ ...body, stops: [] }), /different details/);
  for (const stops of [[body.stops[0], body.stops[0]], [{ customer_id: 'foreign', location_id: '' }], [{ customer_id: 'customer-a', location_id: 'outlet' }], Array(101).fill(body.stops[0]), [null]]) {
    await assert.rejects(f.call({ ...body, requestKey: crypto.randomUUID(), stops }));
  }
  for (const name of ['StockBalance', 'StockMovement', 'SalesOrder', 'FieldSale', 'JournalEntry']) assert.deepEqual(f.tables[name], before[name], name);
  await f.call({ ...body, requestKey: crypto.randomUUID(), stops: [] });
  assert.deepEqual(f.tables.DriverActivity.at(-1).planned_stops, []);
});

test('saved module grants cannot make drivers stock issuers, sellers or unrestricted customer viewers', () => {
  const modules = ['distribution', 'inventory', 'sales', 'commercial', 'customers', 'cashier', 'accounting'];
  const catalogue = catalogueFromStored({ roles: { driver: { template_role: 'driver', modules, module_permissions_version: 5 } } });
  const user = { id: 'login', role: 'user' }, employee = decorateEmployee(user, { id: 'driver', role: 'driver', status: 'active' }, catalogue);
  const context = { user, employee, role: 'driver', roleCatalogue: catalogue };
  for (const module of modules) for (const actor of ['admin', 'commercial', 'warehouse_manager']) assert.equal(featureContext(context, module, actor), context);
  for (const entity of ['Dispatch', 'DispatchLine', 'DispatchRequest', 'StockMovement', 'SalesOrder', 'Customer']) {
    const scoped = entityFeatureContext(context, entity, 'create');
    assert.throws(() => assertEntityAccess(scoped, entity, 'create'));
  }
  for (const path of ['/distribution/dispatches/new', '/distribution/requests/new', '/sales', '/field-sales/new', '/inventory', '/customers/new', '/customers']) assert.equal(canOpenFieldPath('driver', path, modules), false, path);
  assert.deepEqual(modulesForRole('driver', modules).map(row => row.path), ['/distribution?tab=deliveries']);
  assert.equal(normalizeRole('sales agent'), 'commercial'); assert.equal(normalizeRole('commercial agent'), 'commercial');
  assert.equal(catalogueFromStored({ roles: { driver: { template_role: 'warehouse_manager', modules } } }).roles.driver.template_role, 'driver');
  assert.throws(() => validateRoleProfile({ key: 'driver', template_role: 'warehouse_manager' }), /retain the driver/);
});

test('receipt rechecks the driver assignment before writing an acknowledgement', async () => {
  const f = setup(), store = f.client.asServiceRole.entities.Dispatch, get = store.get;
  let reads = 0;
  store.get = async id => { const value = await get(id); return ++reads > 1 ? { ...value, driver_id: 'another-driver' } : value; };
  await assert.rejects(f.call(f.receipt()), /run changed/); assert.equal(f.tables.DriverActivity.length, 0);
});

test('function routing accepts driver receipts and plans while refusing stock loading and sales', async () => {
  const f = setup(), handler = await fieldHandler(); globalThis.__dailySupplyClient = f.client;
  try {
    for (const body of [f.receipt(), { action: 'driverSaveDeliveryPlan', dispatchId: run.id, requestKey: crypto.randomUUID(), stops: [] }]) {
      const response = await handler(request(body)), result = await response.json(); assert.equal(response.status, 200, result.error);
    }
    const before = structuredClone(f.tables);
    for (const action of ['issueDistributionStock', 'loadDispatch', 'approveDispatchRequest', 'saveSale']) {
      const response = await handler(request({ action, dispatchId: run.id, commercialId: staff.id }));
      assert.equal(response.status, 400, action); assert.deepEqual(f.tables, before, action);
    }
  } finally { delete globalThis.__dailySupplyClient; }
});
