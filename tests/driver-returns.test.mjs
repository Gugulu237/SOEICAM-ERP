import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, fieldHandler, request, staff, run, date } from './helpers/commercial-supply.mjs';
const collection = extra => ({ action: 'recordExpiredReturn', driverId: 'driver-a', dispatchId: run.id, customerId: 'customer-a', productId: 'product-a', quantity: 2, expiryDate: '2000-01-01', date, replaceNow: false, receiptReference: 'DR-1', receiptFileUris: ['private/fixture.jpg'], requestKey: crypto.randomUUID(), ...extra });
async function setup() {
  const f = fixture(), handler = await fieldHandler();
  f.client.entities.Employee.filter = async () => [f.tables.Employee[1]];
  f.client.auth.me = async () => ({ id: 'driver-login', role: 'user' });
  f.tables.Customer[0].salesperson_id = staff.id;
  f.client.auth.assertModule = module => assert.equal(module, 'distribution');
  globalThis.__dailySupplyClient = f.client;
  return { ...f, call: async body => { const response = await handler(request(body)); return { status: response.status, ...await response.json() }; }, close: () => { delete globalThis.__dailySupplyClient; } };
}
async function verify(f, requestId) {
  const me = f.client.auth.me, filter = f.client.entities.Employee.filter, module = f.client.auth.assertModule;
  f.client.auth.assertModule = value => assert.equal(value, 'distribution');
  f.client.auth.me = async () => ({ id: 'gm-reviewer', role: 'admin' }); f.client.entities.Employee.filter = async () => [];
  try { const result = await f.call({ action: 'verifyExpiredReturn', requestId }); assert.equal(result.status, 200, result.error); return result; }
  finally { f.client.auth.me = me; f.client.entities.Employee.filter = filter; f.client.auth.assertModule = module; }
}
test('driver collections quarantine expired goods and retain actor attribution without issuing fresh goods', async () => {
  const f = await setup(); try {
    const body = collection(), pending = await f.call(body); assert.equal(pending.status, 200, pending.error); assert.equal(pending.record.status, 'pending_verification');
    assert.equal(f.tables.StockBalance[0].quantity, 10); assert.equal(f.tables.JournalEntry.length, 0);
    const result = await verify(f, pending.record.id);
    const record = f.tables.SpoilageRecord.find(row => row.record_type === 'field_expired_return'); assert.equal(record.recorded_by, 'driver-login'); assert.equal(record.commercial_id, staff.id); assert.equal(record.driver_id, 'driver-a');
    assert.equal(f.tables.StockBalance[0].quantity, 10); assert.equal(f.tables.StockBalance.find(b => b.qc_status === 'quarantine').quantity, 2);
    assert.equal(f.tables.FieldSale.length, 0); assert.equal(f.tables.CashCollection.length, 0); assert.equal(f.tables.JournalEntry.length, 0);
    assert.equal((await f.call(body)).reused, true); assert.equal(f.tables.SpoilageRecord.length, 2); assert.equal(f.tables.StockBalance[0].quantity, 10);
    assert.equal(result.record.replacement_cost, undefined);
  } finally { f.close(); }
});
test('driver return workspace exposes assigned customers and inventory without company prices, costs or debts', async () => {
  const f = await setup(); try {
    f.tables.Customer.push({ id: 'foreign', business_name: 'Foreign', is_active: true, salesperson_id: 'other' });
    f.tables.CustomerLocation.push({ id: 'outlet', customer_id: 'customer-a', name: 'Shop', is_active: true }, { id: 'foreign-outlet', customer_id: 'foreign', name: 'Hidden', is_active: true });
    f.tables.SpoilageRecord.push({ id: 'foreign-return', record_type: 'field_expired_return', driver_id: 'other-driver', commercial_id: staff.id });
    let result = await f.call({ action: 'driverReturnsWorkspace', driverId: 'driver-a' }); assert.equal(result.status, 200, result.error);
    assert.deepEqual(result.customers.map(c => c.id), ['customer-a']); assert.deepEqual(result.locations.map(l => l.id), ['outlet']); assert.equal(result.returns.length, 0); assert.equal(result.runBalances[0].quantity, 10);
    assert.equal(result.products[0].selling_price, undefined); assert.equal(result.runBalances[0].unit_cost, undefined); assert.equal(result.customers[0].balance, undefined);
    f.tables.DriverActivity.push({ dispatch_id: run.id, type: 'trip_returned' }); result = await f.call({ action: 'driverReturnsWorkspace' }); assert.equal(result.runs[0].can_supply, false); assert.equal(result.customers.length, 0); assert.equal(result.runBalances.length, 0);
  } finally { f.close(); }
});
test('drivers cannot impersonate others, use foreign runs or unrelated customers, bypass evidence or write after returning to base', async () => {
  for (const change of [{ driverId: 'other' }, { commercialId: staff.id }, { dispatchId: 'other' }, { customerId: 'foreign' }, { receiptFileUris: [] }, { quantity: -1 }, { replaceNow: true }]) {
    const f = await setup(); try {
      f.tables.Customer.push({ id: 'foreign', business_name: 'Foreign', is_active: true, salesperson_id: 'other' });
      const before = structuredClone(f.tables), result = await f.call(collection(change)); assert.equal(result.status, 400, JSON.stringify(change)); assert.deepEqual(f.tables, before);
    } finally { f.close(); }
  }
  const f = await setup(); try {
    f.tables.Employee[1].status = 'inactive'; assert.equal((await f.call({ action: 'driverReturnsWorkspace' })).status, 400);
    f.tables.Employee[1].status = 'active'; f.client.auth.assertModule = () => { throw Error('Module disabled'); }; assert.match((await f.call(collection())).error, /Module disabled/);
    f.client.auth.assertModule = () => {}; f.tables.DriverActivity.push({ dispatch_id: run.id, type: 'trip_returned' }); assert.match((await f.call(collection())).error, /returned to base/);
  } finally { f.close(); }
});
test('only the Commercial can request a pending fresh replacement; the driver remains unable to issue goods', async () => {
  const f = await setup(); try {
    const pending = await f.call(collection({ replaceNow: false })); assert.equal(pending.status, 200, pending.error);
    const collected = await verify(f, pending.record.id); assert.equal(f.tables.StockBalance[0].quantity, 10);
    f.client.entities.Employee.filter = async () => [f.tables.Employee[0]]; f.client.auth.me = async () => ({ id: 'login-a', role: 'user' }); f.client.auth.assertModule = module => assert.equal(module, 'commercial');
    const replace = { action: 'replaceExpiredReturn', returnId: collected.record.id, dispatchId: run.id, date, receiptReference: 'REPL-1', receiptFileUris: ['private/fixture.jpg'], requestKey: crypto.randomUUID() };
    const replacement = await f.call(replace); assert.equal(replacement.status, 200, replacement.error); assert.equal(f.tables.StockBalance[0].quantity, 10);
    await verify(f, replacement.record.id); assert.equal(f.tables.StockBalance[0].quantity, 8);
    f.client.entities.Employee.filter = async () => [f.tables.Employee[1]]; f.client.auth.me = async () => ({ id: 'driver-login', role: 'user' }); f.client.auth.assertModule = module => assert.equal(module, 'distribution');
    replace.requestKey = crypto.randomUUID();
    assert.match((await f.call(replace)).error, /Drivers report collections only/); assert.equal(f.tables.StockBalance[0].quantity, 8); assert.equal(f.tables.JournalEntry.length, 1);
  } finally { f.close(); }
});
test('new request endpoints are removed, while field inventory stays personal and read-only', async () => {
  const f = await setup(); try {
    for (const action of ['fieldStockSubmit', 'fieldStockApprove', 'fieldStockLoad', 'fieldStockWorkspace']) assert.match((await f.call({ action })).error, /Unknown function action/);
    assert.match((await f.call({ action: 'fieldStockInventory', employeeId: 'other-driver' })).error, /own inventory/);
    const result = await f.call({ action: 'fieldStockInventory' }); assert.equal(result.status, 200, result.error); assert.equal(result.runs[0].rows[0].on_hand, 10); assert.equal(result.runs[0].rows[0].product.selling_price, undefined);
    assert.equal(f.tables.StockMovement.length, 0); assert.equal(f.tables.JournalEntry.length, 0);
  } finally { f.close(); }
});
