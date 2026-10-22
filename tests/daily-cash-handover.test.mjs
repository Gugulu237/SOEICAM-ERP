import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { cashierAction } from '../src/server/domain/cashier-workspace.js';
import { employeeWorkspaceAction } from '../src/server/domain/employee-workspace.js';
import { dailyCashSettlements, reconcileDailyCash } from '../src/lib/cash-settlement.js';
import { fixture, functionRoute, request, date, user } from './helpers/cashier.mjs';

async function dailyFixture(db) {
  const f = await fixture(db), s = f.entities;
  const agent = await s.Employee.create({ user_id: 'agent-login', role: 'commercial', status: 'active', full_name: 'Daily agent' });
  const collection = await s.CashCollection.create({ commercial_id: agent.id, commercial_name: agent.full_name, collection_number: 'DAILY-01',
    customer_name: 'Daily customer', collection_date: date, amount_collected: 2500, received_amount: 0, outstanding_amount: 2500, method: 'cash', status: 'held_by_commercial' });
  return { ...f, agent, collection, body: { action: 'cashierRequestHandover', commercialId: agent.id, date, collectionIds: [collection.id], expectedAmount: 2500, requestKey: 'daily-cash-request' } };
}

test('daily request reserves only that agent and date, without posting money; retries reuse it', async () => {
  const { client, entities: s, collection, body } = await dailyFixture();
  const otherDay = await s.CashCollection.create({ ...collection, collection_date: '2020-01-01' });
  const otherAgent = await s.CashCollection.create({ ...collection, commercial_id: 'someone-else' });
  const before = await s.TreasuryAccount.list();
  const first = await cashierAction(client, user, body), retry = await cashierAction(client, user, body);
  assert.equal(retry.handover.id, first.handover.id); assert.equal(retry.reused, true);
  assert.equal(first.handover.expected_amount, 2500); assert.equal(first.handover.offered_amount, 0);
  assert.equal(first.handover.requested_by_cashier, true);
  assert.equal((await s.CashCollection.get(collection.id)).status, 'handover_submitted');
  assert.equal((await s.CashCollection.get(otherDay.id)).status, 'held_by_commercial');
  assert.equal((await s.CashCollection.get(otherAgent.id)).status, 'held_by_commercial');
  assert.deepEqual(await s.TreasuryAccount.list(), before);
  assert.equal((await s.JournalEntry.list()).length, 0); assert.equal((await s.TreasuryTransaction.list()).length, 0);
  await assert.rejects(cashierAction(client, user, { ...body, requestKey: 'second-request' }), /changed/);
  await assert.rejects(cashierAction(client, user, { ...body, date: '2020-01-01' }), /another agent or date/);
  assert.equal((await s.CashHandoverAllocation.list()).filter(a => a.collection_id === collection.id).length, 1);
});

test('agent dashboard changes requested -> partly settled -> settled only after cashier receipts', async () => {
  const { client, entities: s, agent, body } = await dailyFixture();
  const agentClient = { ...client, entities: { Employee: { filter: async () => [agent] } } };
  const agentUser = { id: 'agent-login', role: 'user' };
  const dashboard = () => employeeWorkspaceAction(agentClient, agentUser, { action: 'employeeDashboard', date });
  assert.equal((await dashboard()).cashDays[0].status, 'outstanding');
  const { handover } = await cashierAction(client, user, body);
  assert.equal((await dashboard()).cashDays[0].status, 'requested');
  const receipt = { action: 'confirmHandover', handoverId: handover.id, treasuryAccountId: 'till', date, requestKey: 'partial-daily-receipt', receivedAmount: 1000, varianceReason: '1500 remains with agent' };
  await cashierAction(client, user, receipt);
  assert.equal((await dashboard()).cashDays[0].status, 'partial');
  await cashierAction(client, user, { ...receipt, requestKey: 'final-daily-receipt', receivedAmount: 1500 });
  const settled = (await dashboard()).cashDays[0];
  assert.equal(settled.status, 'settled'); assert.equal(settled.outstanding, 0); assert.equal(settled.received, 2500);
  await cashierAction(client, user, { ...receipt, requestKey: 'final-daily-receipt', receivedAmount: 1500 });
  assert.equal((await s.TreasuryAccount.get('till')).balance, 102500);
  assert.equal((await s.JournalEntry.list()).length, 2);
  assert.equal((await s.FieldSale.list()).length, 0); assert.equal((await s.Invoice.list()).length, 0);
  assert.ok((await s.JournalLine.list()).every(line => ['till-gl', 'clearing'].includes(line.account_id)));
  await assert.rejects(employeeWorkspaceAction(agentClient, agentUser, { action: 'employeeDashboard', employeeId: 'someone-else' }), /own workspace/);
});

test('cash requests reject other roles, stale balances, allocated collections and direct customer receipts', async () => {
  const { client, entities: s, agent, collection, body } = await dailyFixture();
  const agentClient = { ...client, entities: { Employee: { filter: async () => [agent] } } };
  await assert.rejects(cashierAction(agentClient, { id: 'agent-login', role: 'user' }, body), /Not permitted/);
  await assert.rejects(cashierAction(client, user, { ...body, expectedAmount: 1 }), /balance changed/);
  await assert.rejects(cashierAction(client, user, { ...body, collectionIds: ['collection'] }), /collections changed/);
  await s.CashHandoverAllocation.create({ handover_id: 'handover', collection_id: collection.id, amount_allocated: 2500, received_amount: 0 });
  await assert.rejects(cashierAction(client, user, body), /unfinished handover/);
  await s.CashHandoverAllocation.deleteMany({ collection_id: collection.id });
  await s.Payment.create({ payment_type: 'customer_payment', collection_id: collection.id, status: 'posted' });
  await assert.rejects(cashierAction(client, user, body), /customer receipt workflow/);
  assert.equal((await s.CashHandover.list()).length, 1);
  assert.equal((await s.TreasuryTransaction.list()).length, 0);
});

test('older collection days retain complete daily totals and remain visible after receipt this month', async () => {
  const { client, entities: s, agent, collection, body } = await dailyFixture();
  await s.CashCollection.update(collection.id, { collection_date: '2020-01-01' });
  await s.CashCollection.create({ commercial_id: agent.id, commercial_name: agent.full_name, collection_date: '2020-01-01', method: 'cash',
    amount_collected: 500, received_amount: 500, outstanding_amount: 0, status: 'received', received_at: '2020-01-01T12:00:00Z' });
  const agentClient = { ...client, entities: { Employee: { filter: async () => [agent] } } };
  const dashboard = () => employeeWorkspaceAction(agentClient, { id: 'agent-login', role: 'user' }, { action: 'employeeDashboard' });
  const before = (await dashboard()).cashDays[0]; assert.equal(before.collected, 3000); assert.equal(before.received, 500);
  const { handover } = await cashierAction(client, user, { ...body, date: '2020-01-01' });
  await cashierAction(client, user, { action: 'confirmHandover', handoverId: handover.id, treasuryAccountId: 'till', receivedAmount: 2500, date, requestKey: 'late-cash-receipt' });
  const settled = (await dashboard()).cashDays[0];
  assert.equal(settled.collection_date, '2020-01-01'); assert.equal(settled.collected, 3000); assert.equal(settled.status, 'settled');
  assert.equal((await s.TreasuryTransaction.list())[0].transaction_date, date);
});

test('settlement distinguishes empty days, unconfirmed zero balances, new cash and fully received disputes', () => {
  const c = { id: 'c', commercial_id: 'a', commercial_name: 'Agent', collection_date: date, method: 'cash', amount_collected: 100, received_amount: 100, outstanding_amount: 0, status: 'received', handover_id: 'h' };
  assert.deepEqual(dailyCashSettlements([]), []);
  assert.equal(dailyCashSettlements([c])[0].status, 'settled');
  assert.notEqual(dailyCashSettlements([{ ...c, status: 'held_by_commercial' }])[0].status, 'settled');
  assert.equal(dailyCashSettlements([c], [{ id: 'h', status: 'disputed' }])[0].status, 'disputed');
  const fresh = { ...c, id: 'fresh', received_amount: 0, outstanding_amount: 100, status: 'held_by_commercial', handover_id: '' };
  const day = dailyCashSettlements([c, fresh])[0];
  assert.equal(day.status, 'partial'); assert.equal(day.requestable, 100); assert.deepEqual(day.collection_ids, ['fresh']);
  assert.deepEqual(dailyCashSettlements([{ ...c, method: 'mobile_money' }]), []);
});

test('daily cash reconciles recorded sales without deducting expenses or counting customer credit as cash', () => {
  const sale = { id: 'sale', sale_number: 'FS-1', commercial_id: 'agent', commercial_name: 'Agent', transaction_date: date, payment_type: 'cash', status: 'approved_posted', total: 10000, amount_collected: 10000 };
  const cash = { id: 'cash', field_sale_id: sale.id, commercial_id: sale.commercial_id, collection_date: date, method: 'cash', status: 'held_by_commercial', amount_collected: 10000, received_amount: 0, outstanding_amount: 10000 };
  const day = reconcileDailyCash([cash], [], [sale, { ...sale, id: 'credit-sale', payment_type: 'credit', amount_collected: 0 }])[0];
  assert.equal(day.cash_sales_amount, 10000); assert.equal(day.cash_sales_variance, 0); assert.equal(day.requestable, 10000);
  const reduced = reconcileDailyCash([{ ...cash, amount_collected: 9000, outstanding_amount: 9000 }], [], [sale])[0];
  assert.equal(reduced.cash_sales_variance, 1000); assert.equal(reduced.status, 'disputed');
  const missing = reconcileDailyCash([], [], [sale])[0]; assert.equal(missing.cash_sales_variance, 10000); assert.equal(missing.status, 'disputed');
  assert.equal(reconcileDailyCash([cash], [], [])[0].cash_sales_reconciliation_required, true);
});

test('cashier can collect independently from multiple agents; receipts identify the receiver and cannot net expenses', async () => {
  const { client, entities: s, agent, collection, body } = await dailyFixture();
  const secondAgent = await s.Employee.create({ role: 'commercial', full_name: 'Second agent', status: 'active', salary: 99999 });
  const secondCash = await s.CashCollection.create({ commercial_id: secondAgent.id, commercial_name: secondAgent.full_name, collection_date: date, method: 'cash', status: 'held_by_commercial', amount_collected: 8000, received_amount: 0, outstanding_amount: 8000 });
  const sales = [];
  for (const [a, c, amount] of [[agent, collection, 2500], [secondAgent, secondCash, 8000]]) {
    const sale = await s.FieldSale.create({ commercial_id: a.id, commercial_name: a.full_name, transaction_date: date, payment_type: 'cash', status: 'approved_posted', total: amount, amount_collected: amount });
    sales.push(sale); await s.CashCollection.update(c.id, { field_sale_id: sale.id });
  }
  const view = await cashierAction(client, user, { action: 'cashierWorkspace', date });
  assert.ok(view.commercials.some(e => e.id === secondAgent.id)); assert.equal(view.commercials.find(e => e.id === secondAgent.id).salary, undefined);
  assert.equal(view.dailyCash.find(d => d.commercial_id === agent.id).cash_sales_amount, 2500);
  await assert.rejects(cashierAction(client, user, { ...body, expectedAmount: 2000, expenseAmount: 500 }), /balance changed/);
  for (const [a, c, amount] of [[agent, collection, 2500], [secondAgent, secondCash, 8000]]) {
    const { handover } = await cashierAction(client, user, { ...body, commercialId: a.id, collectionIds: [c.id], expectedAmount: amount, requestKey: `agent-request-${a.id}` });
    await cashierAction(client, user, { action: 'confirmHandover', handoverId: handover.id, treasuryAccountId: 'till', receivedAmount: amount, date, requestKey: `agent-receipt-${a.id}` });
  }
  assert.equal((await s.TreasuryAccount.get('till')).balance, 110500);
  const after = await cashierAction(client, user, { action: 'cashierWorkspace', date });
  for (const id of [agent.id, secondAgent.id]) {
    const day = after.dailyCash.find(d => d.commercial_id === id);
    assert.equal(day.status, 'settled'); assert.deepEqual(day.cashier_names, ['Cashier']); assert.equal(day.receipt_references.length, 1);
  }
  assert.equal((await s.FieldSale.list()).length, 2); assert.equal((await s.TreasuryTransaction.list()).length, 2);
});

test('commercial staff cannot spend, transfer, receive or settle their own sales cash', async () => {
  const { client, agent } = await dailyFixture();
  const agentClient = { ...client, entities: { Employee: { filter: async () => [agent] } } };
  for (const action of ['cashierPettyExpense', 'cashierPayExpense', 'cashierTransfer', 'cashierReleasePayment', 'confirmHandover', 'cashierResolveHandover']) {
    await assert.rejects(cashierAction(agentClient, { id: 'agent-login', role: 'user' }, { action, date }), /Not permitted/);
  }
});

test('a missing or reduced cash collection blocks a new request until recorded sales are reconciled', async () => {
  const { client, entities: s, agent, collection, body } = await dailyFixture();
  const sale = await s.FieldSale.create({ commercial_id: agent.id, commercial_name: agent.full_name, transaction_date: date, payment_type: 'cash', status: 'approved_posted', amount_collected: 3500, total: 3500 });
  await s.CashCollection.update(collection.id, { field_sale_id: sale.id });
  await assert.rejects(cashierAction(client, user, body), /do not match/);
  assert.equal((await s.CashHandover.list()).length, 1); assert.equal((await s.TreasuryTransaction.list()).length, 0);
});

test('HTTP transaction rolls back a failed daily request and a late receipt posting failure', async () => {
  const db = new PGlite(), { client, entities: s, collection, body } = await dailyFixture(db), POST = await functionRoute();
  globalThis.__cashierClient = client;
  globalThis.__cashierTransaction = async callback => {
    await db.exec('BEGIN');
    try { const result = await callback(); await db.exec('COMMIT'); return result; }
    catch (error) { await db.exec('ROLLBACK'); throw error; }
  };
  const call = value => POST(request(value), { params: Promise.resolve({ name: 'fieldOps' }) });
  try {
    const original = s.CashCollection.update;
    s.CashCollection.update = async () => { throw Error('Simulated collection write failure'); };
    assert.equal((await call(body)).status, 400);
    assert.equal((await s.CashHandover.list()).length, 1);
    assert.equal((await s.CashHandoverAllocation.list()).length, 1);
    s.CashCollection.update = original;
    const response = await call(body); assert.equal(response.status, 200);
    const { handover } = await response.json();
    const receive = { action: 'confirmHandover', handoverId: handover.id, treasuryAccountId: 'till', receivedAmount: 2500, date, requestKey: 'daily-posting-retry' };
    const post = s.JournalEntry.create;
    s.JournalEntry.create = async () => { throw Error('Simulated ledger failure'); };
    assert.equal((await call(receive)).status, 400);
    assert.equal((await s.CashCollection.get(collection.id)).received_amount, 0);
    assert.equal((await s.CashHandover.get(handover.id)).status, 'submitted');
    assert.equal((await s.TreasuryTransaction.list()).length, 0);
    s.JournalEntry.create = post;
    assert.equal((await call(receive)).status, 200); assert.equal((await call(receive)).status, 200);
    assert.equal((await s.TreasuryAccount.get('till')).balance, 102500);
    assert.equal((await s.TreasuryTransaction.list()).length, 1);
  } finally { delete globalThis.__cashierClient; delete globalThis.__cashierTransaction; await db.close(); }
});
