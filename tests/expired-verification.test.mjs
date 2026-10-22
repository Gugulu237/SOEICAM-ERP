import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, fieldHandler, request, staff, run, date } from './helpers/commercial-supply.mjs';
import { receiveVehicleExpiredReturns } from '../src/server/domain/commercial-returns.js';
import { supplyRun } from '../src/server/domain/commercial-runs.js';
import { isReadOnlyFunction } from '../src/lib/function-actions.js';

const collection = extra => ({ action: 'recordExpiredReturn', customerId: 'customer-a', productId: 'product-a', dispatchId: run.id,
  quantity: 2, expiryDate: '2000-01-01', date, replaceNow: true, receiptReference: 'EXP-1', receiptFileUris: ['private/fixture.jpg'], requestKey: crypto.randomUUID(), ...extra });
async function setup() {
  const f = fixture(), handler = await fieldHandler();
  globalThis.__dailySupplyClient = f.client;
  return { ...f, call: async body => { const response = await handler(request(body)); return { httpStatus: response.status, ...await response.json() }; },
    manager() { f.client.auth.me = async () => ({ id: 'gm-reviewer', role: 'admin' }); f.client.entities.Employee.filter = async () => []; },
    close() { delete globalThis.__dailySupplyClient; } };
}
test('field requests preserve evidence without stock, location, journal or cash writes; retries require identical evidence', async () => {
  const f = await setup(); try {
    const before = structuredClone(f.tables), body = collection(), result = await f.call(body);
    assert.equal(result.httpStatus, 200, result.error); assert.equal(result.record.status, 'pending_verification');
    for (const entity of ['Warehouse', 'CustomerLocation', 'StockBalance', 'StockMovement', 'JournalEntry', 'JournalLine', 'FieldSale', 'CashCollection', 'Customer']) assert.deepEqual(f.tables[entity], before[entity], entity);
    assert.equal((await f.call(body)).reused, true); assert.equal(f.tables.SpoilageRecord.length, 1);
    assert.match((await f.call({ ...body, quantity: 3 })).error, /different details/);
    const own = await f.call({ action: 'commercialReturns' }); assert.equal(own.requests.length, 1); assert.equal(own.returns.length, 0);
    const unchanged = structuredClone(f.tables);
    assert.match((await f.call({ action: 'verifyExpiredReturn', requestId: result.record.id })).error, /not permitted|not allowed|verifying|permission/i);
    assert.deepEqual(f.tables, unchanged);
    f.client.auth.me = async () => ({ id: staff.user_id, role: 'admin' }); f.client.entities.Employee.filter = async () => [];
    assert.match((await f.call({ action: 'verifyExpiredReturn', requestId: result.record.id })).error, /different manager/);
    assert.deepEqual(f.tables, unchanged);
  } finally { f.close(); }
});
test('approval rechecks live manifest stock, retains original reporter and records the actual reviewer exactly once', async () => {
  const f = await setup(); try {
    const pending = await f.call(collection()); f.manager();
    assert.equal((await f.call({ action: 'expiredReturnReviewQueue' })).requests.length, 1);
    f.tables.StockBalance[0].quantity = 1;
    let before = structuredClone(f.tables);
    assert.match((await f.call({ action: 'verifyExpiredReturn', requestId: pending.record.id })).error, /Only 1 available/);
    assert.deepEqual(f.tables, before);
    f.tables.StockBalance[0].quantity = 10;
    const approved = await f.call({ action: 'verifyExpiredReturn', requestId: pending.record.id });
    assert.equal(approved.httpStatus, 200, approved.error); assert.equal(approved.request.status, 'verified'); assert.equal(approved.record.status, 'replaced');
    const actual = f.tables.SpoilageRecord.find(row => row.record_type === 'field_expired_return');
    assert.equal(actual.recorded_by, staff.user_id); assert.equal(actual.verified_by, 'gm-reviewer');
    assert.equal(f.tables.JournalEntry[0].posted_by || f.tables.JournalEntry[0].created_by, 'gm-reviewer');
    assert.equal(f.tables.StockBalance[0].quantity, 8); before = structuredClone(f.tables);
    assert.equal((await f.call({ action: 'verifyExpiredReturn', requestId: pending.record.id })).reused, true); assert.deepEqual(f.tables, before);
    assert.equal((await f.call({ action: 'expiredReturnReviewQueue' })).requests.length, 0);
  } finally { f.close(); }
});
test('rejections need a reason and remain visible to the reporting employee without financial effects', async () => {
  const f = await setup(); try {
    const pending = await f.call(collection()), me = f.client.auth.me, filter = f.client.entities.Employee.filter; f.manager();
    assert.match((await f.call({ action: 'rejectExpiredReturn', requestId: pending.record.id })).error, /reason/);
    const result = await f.call({ action: 'rejectExpiredReturn', requestId: pending.record.id, reviewNote: 'Receipt quantity does not match the returned goods.' });
    assert.equal(result.request.status, 'rejected'); assert.equal(f.tables.StockMovement.length, 0); assert.equal(f.tables.JournalEntry.length, 0);
    assert.match((await f.call({ action: 'verifyExpiredReturn', requestId: pending.record.id })).error, /already been reviewed/);
    f.client.auth.me = me; f.client.entities.Employee.filter = filter;
    assert.match((await f.call({ action: 'commercialReturns' })).requests[0].review_note, /does not match/);
  } finally { f.close(); }
});
test('Warehouse can review after a driver returns to base, while sales stay blocked and unverified returns prevent receiving the run', async () => {
  const f = await setup(); try {
    const pending = await f.call(collection());
    f.tables.DriverActivity.push({ dispatch_id: run.id, type: 'trip_returned' });
    await assert.rejects(() => supplyRun(f.client.asServiceRole, staff.id, run.id, date, true), /returned to base/);
    const before = structuredClone(f.tables);
    await assert.rejects(() => receiveVehicleExpiredReturns(f.client.asServiceRole, f.tables.Dispatch[0], f.tables.Warehouse[0], { id: 'gm-reviewer' }), /Verify or reject/);
    assert.deepEqual(f.tables, before);
    const warehouse = { id: 'warehouse-reviewer', role: 'warehouse_manager', status: 'active' };
    f.client.auth.me = async () => ({ id: 'warehouse-login', role: 'user' }); f.client.entities.Employee.filter = async () => [warehouse];
    f.client.auth.assertModule = module => assert.equal(module, 'distribution');
    const approved = await f.call({ action: 'verifyExpiredReturn', requestId: pending.record.id });
    assert.equal(approved.httpStatus, 200, approved.error); assert.equal(approved.record.verified_by, 'warehouse-login');
    warehouse.status = 'inactive'; assert.match((await f.call({ action: 'expiredReturnReviewQueue' })).error, /active/);
    assert.equal(isReadOnlyFunction('fieldOps', 'expiredReturnReviewQueue'), true);
    assert.equal(isReadOnlyFunction('fieldOps', 'verifyExpiredReturn'), false);
  } finally { f.close(); }
});
