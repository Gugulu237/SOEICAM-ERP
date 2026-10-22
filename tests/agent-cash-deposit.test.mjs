import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { fixture, functionRoute, request, date, user as cashierUser } from './helpers/cashier.mjs';
import { commercialAction } from '../src/server/domain/commercial-workspace.js';
import { cashierAction } from '../src/server/domain/cashier-workspace.js';
import { employeeWorkspaceAction } from '../src/server/domain/employee-workspace.js';

async function setup(db) {
  const f = await fixture(db), s = f.entities;
  const agent = await s.Employee.create({ role: 'commercial', status: 'active', full_name: 'Deposit Agent', user_id: 'agent-login' });
  const collection = await s.CashCollection.create({ commercial_id: agent.id, commercial_name: agent.full_name, collection_date: date,
    method: 'cash', status: 'held_by_commercial', amount_collected: 3000, received_amount: 0, outstanding_amount: 3000 });
  const user = { id: 'agent-login', role: 'user', full_name: agent.full_name };
  const client = { ...f.client, auth: { me: async () => user }, entities: { Employee: { filter: async () => [agent] } } };
  const body = { action: 'commercialDepositCash', commercialId: agent.id, date, depositedDate: date, cashierId: 'cashier', amount: 3000, requestKey: 'deposit-report-key' };
  return { ...f, cashierClient: f.client, client, agent, collection, user, body };
}

test('agent report creates a pending handover and reaches Settled only through cashier confirmation', async () => {
  const { client, cashierClient, entities: s, user, body, agent, collection } = await setup();
  const first = await commercialAction(client, user, body), retry = await commercialAction(client, user, body);
  assert.equal(first.status, 'awaiting_cashier_confirmation'); assert.equal(retry.reused, true);
  let cash = await s.CashCollection.get(collection.id), h = await s.CashHandover.get(cash.handover_id);
  assert.equal(cash.received_amount, 0); assert.equal(cash.outstanding_amount, 3000); assert.ok(cash.agent_deposit_reported_at);
  assert.equal(h.status, 'submitted'); assert.equal(h.requested_by_cashier, false); assert.equal(h.agent_deposit_reports.length, 1);
  assert.equal(h.agent_deposit_reports[0].reported_by, user.id);
  assert.equal((await s.TreasuryAccount.get('till')).balance, 100000); assert.equal((await s.JournalEntry.list()).length, 0);
  const dashboard = () => employeeWorkspaceAction(client, user, { action: 'employeeDashboard' });
  const pending = (await dashboard()).cashDays[0]; assert.equal(pending.status, 'deposit_reported'); assert.equal(pending.depositable, 0);
  const desk = await cashierAction(cashierClient, cashierUser, { action: 'cashierWorkspace', date });
  assert.equal(desk.handovers.find(row => row.id === h.id).agent_deposit_cashier_name, 'Cashier');
  await cashierAction(cashierClient, cashierUser, { action: 'confirmHandover', handoverId: h.id, treasuryAccountId: 'till', receivedAmount: 3000, date, requestKey: 'cashier-receipt-key' });
  assert.equal((await dashboard()).cashDays[0].status, 'settled'); assert.equal((await s.TreasuryAccount.get('till')).balance, 103000);
  assert.equal((await s.FieldSale.list()).length, 0); assert.equal((await s.Invoice.list()).length, 0);
  await assert.rejects(commercialAction(client, user, { ...body, commercialId: 'another-agent', requestKey: 'other-agent-key' }), /own commercial/);
  assert.equal(agent.id, h.commercial_id);
});

test('agent can report an existing cashier-requested handover without reserving or posting it twice', async () => {
  const { client, cashierClient, entities: s, user, body, collection } = await setup();
  const before = await cashierAction(cashierClient, cashierUser, { action: 'cashierRequestHandover', commercialId: body.commercialId, date, collectionIds: [collection.id], expectedAmount: 3000, requestKey: 'cashier-request-key' });
  await commercialAction(client, user, body);
  const h = await s.CashHandover.get(before.handover.id);
  assert.equal(h.agent_deposit_reports.length, 1); assert.equal(h.status, 'submitted');
  assert.equal((await s.CashHandover.list()).length, 2); assert.equal((await s.CashHandoverAllocation.list()).length, 2);
  assert.equal((await s.JournalEntry.list()).length, 0);
  await assert.rejects(commercialAction(client, user, { ...body, amount: 2900 }), /different details/);
});

test('deposit report rejects short amounts, invalid receiver/date and unauthorized staff, and picker exposes no pay data', async () => {
  const { client, entities: s, user, body } = await setup();
  for (const changed of [{ amount: 2900 }, { cashierId: body.commercialId }, { cashierId: 'missing' }, { date: '2026-02-30' }, { depositedDate: '2000-01-01' }]) {
    await assert.rejects(commercialAction(client, user, { ...body, ...changed }), /full unreported|active Cashier|valid date|cannot precede/);
  }
  await s.Employee.update('cashier', { salary: 123456 });
  assert.deepEqual((await commercialAction(client, user, { action: 'commercialCashiers' })).cashiers, [{ id: 'cashier', full_name: 'Cashier' }]);
  const wrong = { ...client, entities: { Employee: { filter: async () => [{ role: 'driver', status: 'active' }] } } };
  await assert.rejects(commercialAction(wrong, user, body), /Not permitted/);
  assert.equal((await s.CashHandover.list()).length, 1);
});

test('GM cannot report cash deposited by another employee or create that employees handover', async () => {
  const { client, entities: s, body } = await setup();
  const admin = { id: 'gm-login', role: 'admin', full_name: 'General Manager' };
  const before={collections:await s.CashCollection.list(),handovers:await s.CashHandover.list(),audit:await s.AuditLog.list(),journals:await s.JournalEntry.list()};
  await assert.rejects(commercialAction(client, admin, body), error=>error.status===403 && /read-only/.test(error.message));
  assert.deepEqual({collections:await s.CashCollection.list(),handovers:await s.CashHandover.list(),audit:await s.AuditLog.list(),journals:await s.JournalEntry.list()},before);
});

test('new cash and a counted shortfall remain reportable rather than being hidden by a prior deposit report', async () => {
  const { client, cashierClient, entities: s, body, user, collection } = await setup();
  await commercialAction(client, user, body);
  const handoverId = (await s.CashCollection.get(collection.id)).handover_id;
  await cashierAction(cashierClient, cashierUser, { action: 'confirmHandover', handoverId, treasuryAccountId: 'till', receivedAmount: 2000, varianceReason: '1000 not received', date, requestKey: 'partial-deposit-receipt' });
  let day = (await employeeWorkspaceAction(client, user, { action: 'employeeDashboard' })).cashDays[0];
  assert.equal(day.depositable, 1000); assert.equal(day.status, 'partial');
  await commercialAction(client, user, { ...body, amount: 1000, requestKey: 'shortfall-deposit-key' });
  day = (await employeeWorkspaceAction(client, user, { action: 'employeeDashboard' })).cashDays[0];
  assert.equal(day.status, 'deposit_reported'); assert.equal(day.outstanding, 1000);
});

test('a later cash collection can be reported without reporting the earlier pending deposit twice', async () => {
  const { client, entities: s, body, user, agent } = await setup();
  await commercialAction(client, user, body);
  await s.CashCollection.create({ commercial_id: agent.id, commercial_name: agent.full_name, collection_date: date, method: 'cash', status: 'held_by_commercial', amount_collected: 500, received_amount: 0, outstanding_amount: 500 });
  let day = (await employeeWorkspaceAction(client, user, { action: 'employeeDashboard' })).cashDays[0];
  assert.equal(day.depositable, 500); assert.equal(day.deposit_reported, 3000);
  await commercialAction(client, user, { ...body, amount: 500, requestKey: 'later-cash-deposit' });
  day = (await employeeWorkspaceAction(client, user, { action: 'employeeDashboard' })).cashDays[0];
  assert.equal(day.depositable, 0); assert.equal(day.deposit_reported, 3500); assert.equal(day.outstanding, 3500);
});

test('HTTP reporting rolls back an interrupted deposit and retries the same reference once', async () => {
  const db = new PGlite();
  try {
    const { client, entities: s, body } = await setup(db), POST = await functionRoute();
    globalThis.__cashierClient = client;
    globalThis.__cashierTransaction = async callback => { await db.exec('BEGIN'); try { const r = await callback(); await db.exec('COMMIT'); return r; } catch (e) { await db.exec('ROLLBACK'); throw e; } };
    const call = () => POST(request(body), { params: Promise.resolve({ name: 'fieldOps' }) });
    const write = s.CashCollection.update;
    s.CashCollection.update = async (id, patch) => { if (patch.agent_deposit_reported_at) throw Error('Interrupted report'); return write(id, patch); };
    assert.equal((await call()).status, 400); assert.equal((await s.CashHandover.list()).length, 1);
    s.CashCollection.update = write;
    assert.equal((await call()).status, 200); assert.equal((await call()).status, 200);
    assert.equal((await s.CashHandover.list()).length, 2); assert.equal((await s.JournalEntry.list()).length, 0);
  } finally { delete globalThis.__cashierClient; delete globalThis.__cashierTransaction; await db.close(); }
});
