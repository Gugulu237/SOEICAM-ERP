import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { cashierAction } from '../src/server/domain/cashier-workspace.js';
import { fixture, functionRoute, request, date, user } from './helpers/cashier.mjs';
const args = action => ({ action, date, requestKey: crypto.randomUUID(), accountId: 'till', amount: 10000, reference: 'REF-1', description: 'Daily operations' });

test('cash desk refuses other roles and inactive staff before reading company money', async () => {
  for (const employee of [{ role: 'driver', status: 'active' }, { role: 'commercial', status: 'active' }, { role: 'production_manager', status: 'active' }, { role: 'cashier', status: 'inactive' }]) {
    const client = { entities: { Employee: { filter: async () => [employee] } }, asServiceRole: { get entities() { throw Error('Private financial data read'); } } };
    for(const action of ['cashierWorkspace','cashierHandoverHistory'])await assert.rejects(cashierAction(client, user, args(action)), /Not permitted|active Cashier/);
  }
});

test('Cashier received history is paginated, preserves acknowledgement details and filters by Commercial and handover date',async()=>{
  const {client,entities:s}=await fixture();
  for(let i=0;i<52;i++)await s.CashHandover.create({handover_number:'HIST-'+i,status:'received',commercial_id:'agent-a',commercial_name:'Agent A',handover_date:date,received_date:date,received_amount:100,acknowledgement_reference:'ACK-'+i,cashier_name:'Cash desk',treasury_account_name:'Till',private_notes:'not returned'});
  await s.CashHandover.create({handover_number:'OTHER',status:'received',commercial_id:'agent-b',handover_date:'2020-01-01',received_amount:200});
  const body={action:'cashierHandoverHistory',commercialId:'agent-a',from:date,to:date},first=await cashierAction(client,user,body);
  assert.equal(first.records.length,50);assert.equal(first.has_more,true);assert.equal(first.next_cursor,'50');assert.equal(first.records[0].acknowledgement_reference,'ACK-0');assert.equal(first.records[0].private_notes,undefined);
  const next=await cashierAction(client,user,{...body,cursor:first.next_cursor});assert.equal(next.records.length,2);assert.equal(next.has_more,false);assert.equal(next.next_cursor,null);assert.equal(new Set([...first.records,...next.records].map(h=>h.id)).size,52);
  const old=await cashierAction(client,user,{action:'cashierHandoverHistory',commercialId:'agent-b',from:'2020-01-01',to:'2020-01-01'});assert.equal(old.records[0].handover_number,'OTHER');
  await assert.rejects(cashierAction(client,user,{...body,from:'2026-99-99'}),/valid date/);await assert.rejects(cashierAction(client,user,{...body,from:'2026-01-02',to:'2026-01-01'}),/on or after/);await assert.rejects(cashierAction(client,user,{...body,cursor:'1.5'}),/valid handover history page/);
  assert.equal((await s.JournalEntry.list()).length,0);assert.equal((await s.TreasuryAccount.get('till')).balance,100000);
});

test('transfer preserves total cash and never posts revenue or expenses; retries move cash once', async () => {
  const { client, entities } = await fixture(), body = { ...args('cashierTransfer'), toAccountId: 'float' };
  await cashierAction(client, user, body); await cashierAction(client, user, body);
  assert.equal((await entities.TreasuryAccount.get('till')).balance, 90000);
  assert.equal((await entities.TreasuryAccount.get('float')).balance, 110000);
  const movements = await entities.TreasuryTransaction.list(); assert.equal(movements.length, 2);
  assert.deepEqual(movements.map(m => m.transaction_type), ['transfer_out', 'transfer_in']);
  assert.equal(movements[0].journal_id, movements[1].journal_id);
  assert.equal((await entities.JournalEntry.list()).length, 1);
  assert.deepEqual((await entities.JournalLine.list()).map(l => l.account_id), ['float-gl', 'till-gl']);
  await assert.rejects(cashierAction(client, user, { ...args('cashierTransfer'), toAccountId: 'float', amount: 200000 }), /Insufficient/);
});

test('petty cash applies the existing limit, valid cost centre and ledger, and consumes its budget once', async () => {
  const { client, entities } = await fixture(), body = { ...args('cashierPettyExpense'), accountId: 'float', expenseAccountId: 'expense', departmentId: 'sales', category: 'fuel' };
  await assert.rejects(cashierAction(client, user, { ...body, amount: 50001 }), /50,000/);
  await assert.rejects(cashierAction(client, user, { ...body, accountId: 'till' }), /petty cash/);
  await assert.rejects(cashierAction(client, user, { ...body, expenseAccountId: 'till-gl' }), /expense account/);
  await cashierAction(client, user, body); await cashierAction(client, user, body);
  assert.equal((await entities.TreasuryAccount.get('float')).balance, 90000);
  assert.equal((await entities.Budget.get('budget')).actual_spent, 10000);
  assert.equal((await entities.ExpenseRequest.list()).filter(r => r.petty_cash).length, 1);
  assert.equal((await entities.JournalEntry.list()).length, 1);
});

test('small operating expenses reject payroll, rent and monthly utilities even below the cash limit', async () => {
  const { client, entities } = await fixture();
  const body = { ...args('cashierPettyExpense'), accountId: 'float', expenseAccountId: 'expense', departmentId: 'sales', category: 'other' };
  await assert.rejects(cashierAction(client, user, { ...body, description: 'October salaries' }), /Payroll/);
  await assert.rejects(cashierAction(client, user, { ...body, description: 'Workshop rent' }), /Expense Request/);
  await assert.rejects(cashierAction(client, user, { ...body, category: 'utilities', description: 'Electricity' }), /Expense Request/);
  await entities.Account.update('expense', { name: 'Rent expense' });
  await assert.rejects(cashierAction(client, user, { ...body, description: 'Office costs' }), /Expense Request/);
  assert.equal((await entities.TreasuryAccount.get('float')).balance, 100000);
  assert.equal((await entities.TreasuryTransaction.list()).length, 0);
  assert.equal((await entities.JournalEntry.list()).length, 0);
});

test('an approved expense is paid at its saved amount once, never at the client supplied amount', async () => {
  const { client, entities } = await fixture(), body = { ...args('cashierPayExpense'), expenseId: 'expense-request', amount: 1 };
  await cashierAction(client, user, body); await cashierAction(client, user, { ...body, requestKey: 'another-browser' });
  assert.equal((await entities.TreasuryAccount.get('till')).balance, 80000);
  assert.equal((await entities.ExpenseRequest.get('expense-request')).status, 'paid');
  assert.equal((await entities.Budget.get('budget')).actual_spent, 20000);
  assert.equal((await entities.JournalEntry.list()).length, 1);
});

test('supplier requests leave money untouched and require GM approval before release', async () => {
  const { client, entities } = await fixture(), body = { ...args('cashierRequestPayment'), orderId: 'po', amount: 50000 };
  const { payment } = await cashierAction(client, user, body);
  assert.equal((await entities.TreasuryAccount.get('till')).balance, 100000);
  await assert.rejects(cashierAction(client, user, { ...args('cashierReleasePayment'), paymentId: payment.id }), /approved by the General Manager/);
  await entities.Payment.update(payment.id, { status: 'approved', approved_by: 'gm', approved_at: new Date().toISOString() });
  const release = { ...args('cashierReleasePayment'), paymentId: payment.id };
  await cashierAction(client, user, release); await cashierAction(client, user, release);
  assert.equal((await entities.TreasuryAccount.get('till')).balance, 50000);
  assert.equal((await entities.PurchaseOrder.get('po')).cash_disbursed, true);
  assert.equal((await entities.Payment.get(payment.id)).status, 'posted');
  assert.equal((await entities.JournalEntry.list()).length, 1);
});

test('legacy half-completed cash operations are held for reconciliation rather than charged again', async () => {
  const { client, entities } = await fixture();
  await entities.TreasuryTransaction.create({ source: 'request', source_document_id: 'expense-request', amount: 20000 });
  await assert.rejects(cashierAction(client, user, { ...args('cashierPayExpense'), expenseId: 'expense-request' }), /earlier cash movement/);
  const payment = await entities.Payment.create({ payment_type: 'supplier_payment', payment_method: 'cash', po_id: 'po', party_id: 'supplier', amount: 10000, status: 'approved', approved_by: 'gm', approved_at: new Date().toISOString(), treasury_account_id: 'till' });
  await entities.JournalEntry.create({ source_document_id: payment.id, status: 'posted' });
  await assert.rejects(cashierAction(client, user, { ...args('cashierReleasePayment'), paymentId: payment.id }), /earlier ledger entry/);
  assert.equal((await entities.TreasuryAccount.get('till')).balance, 100000);
});

test('partial handovers can be completed without posting the company sale or collecting twice', async () => {
  const { client, entities } = await fixture(), body = { ...args('confirmHandover'), handoverId: 'handover', treasuryAccountId: 'till', receivedAmount: 600, varianceReason: '400 XAF still with agent' };
  const first = await cashierAction(client, user, body); const retry = await cashierAction(client, user, body);
  assert.equal(retry.reused, true); assert.equal(retry.acknowledgementReference, first.acknowledgementReference);
  assert.equal((await entities.TreasuryAccount.get('till')).balance, 100600);
  const rest = await cashierAction(client, user, { ...body, requestKey: 'balance-received', receivedAmount: 400 });
  assert.equal(rest.status, 'received');
  assert.equal((await entities.TreasuryAccount.get('till')).balance, 101000);
  assert.equal((await entities.CashCollection.get('collection')).outstanding_amount, 0);
  assert.equal((await entities.JournalEntry.list()).length, 2);
  assert.ok((await entities.JournalLine.list()).every(l => ['till-gl', 'clearing'].includes(l.account_id)));
  assert.equal((await entities.FieldSale.list()).length, 0); assert.equal((await entities.Invoice.list()).length, 0);
});

test('cash customer list avoids duplicate confirmations and invoice collection excludes pending receipts', async () => {
  const { client, entities } = await fixture();
  const invoice = await entities.Invoice.create({ invoice_number: 'INV-1', customer_id: 'customer-a', customer_name: 'Customer A', status: 'posted', balance: 1000 });
  await entities.Payment.create({ payment_type: 'customer_payment', payment_method: 'cash', status: 'pending_approval', amount: 400, payment_date: date, collection_id: 'collection', receipt_allocations: [{ invoice_id: invoice.id, amount: 400 }], party_name: 'Customer A' });
  const view = await cashierAction(client, user, args('cashierWorkspace'));
  assert.equal(view.cashCustomers.length, 1); assert.equal(view.cashCustomers[0].status, 'pending_approval');
  assert.equal(view.invoices[0].available_amount, 600); assert.equal(view.invoices[0].pending_amount, 400);
  assert.equal(view.collections.length, 0, 'a direct confirmed receipt is not treated as agent-held cash');
  assert.equal('receipt_allocations' in view.receipts[0], false);
});

test('filing a receipt and resolving a fully received disputed handover never change financial balances', async () => {
  const { client, entities } = await fixture();
  client.validateExpenseReceipt = async uri => { if (uri !== 'private/fixture') throw Error('Receipt unavailable'); return uri; };
  await entities.ExpenseRequest.update('expense-request', { status: 'paid' });
  const before = await entities.TreasuryAccount.list();
  await cashierAction(client, user, { action: 'cashierAttachReceipt', expenseId: 'expense-request', receiptFileUri: 'private/fixture' });
  assert.equal((await entities.ExpenseRequest.get('expense-request')).receipt_url, 'private/fixture');
  await assert.rejects(cashierAction(client, user, { action: 'cashierAttachReceipt', expenseId: 'expense-request', receiptFileUri: 'private/foreign' }), /Receipt unavailable/);
  await entities.CashHandover.update('handover', { status: 'disputed', received_amount: 1000 });
  await cashierAction(client, user, { action: 'cashierResolveHandover', handoverId: 'handover', varianceReason: 'The count has been reconciled.' });
  assert.equal((await entities.CashHandover.get('handover')).status, 'received');
  assert.deepEqual(await entities.TreasuryAccount.list(), before);
  assert.equal((await entities.JournalEntry.list()).length, 0);
});

test('real HTTP transactions roll back a late cash posting error, then retry the same transfer once', async () => {
  const db = new PGlite();
  try {
    const { client, entities } = await fixture(db), route = await functionRoute();
    globalThis.__cashierClient = client;
    globalThis.__cashierTransaction = async callback => {
      await db.exec('BEGIN');
      try { const response = await callback(); await db.exec('COMMIT'); return response; }
      catch (e) { await db.exec('ROLLBACK'); throw e; }
    };
    const before = (await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows;
    const original = entities.Account.update;
    let fail = true;
    entities.Account.update = async (id, patch) => { if (id === 'till-gl' && fail) throw Error('Ledger unavailable'); return original(id, patch); };
    const body = { ...args('cashierTransfer'), toAccountId: 'float' }, params = { params: Promise.resolve({ name: 'fieldOps' }) };
    const failed = await route(request(body), params); assert.equal(failed.status, 400);
    assert.deepEqual((await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows, before);
    fail = false;
    assert.equal((await route(request(body), params)).status, 200);
    assert.equal((await route(request(body), params)).status, 200);
    assert.equal((await entities.TreasuryAccount.get('till')).balance, 90000);
    assert.equal((await entities.TreasuryTransaction.list()).length, 2);
    assert.equal((await entities.JournalEntry.list()).length, 1);
  } finally { delete globalThis.__cashierClient; delete globalThis.__cashierTransaction; await db.close(); }
});
