import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCashFlow, cashFlowDates, cashFlowCsv, cashPool, classifyCashAccount } from '../src/lib/cash-flow.js';
import { functionRoute, request, fixture } from './helpers/cashier.mjs';
import { isReadOnlyFunction } from '../src/lib/function-actions.js';

function ledger() {
  const accounts = [
    ['cash', 'Cash on hand', 'asset'], ['bank', 'Bank', 'asset'], ['transit', 'Commercial cash held', 'asset'], ['reserve', 'Replacement savings', 'asset'],
    ['sales', 'Product sales', 'revenue'], ['ar', 'Customer receivables', 'asset'], ['stock', 'Raw material inventory', 'asset'], ['cogs', 'Cost of goods', 'cogs'],
    ['payable', 'Trade payables', 'liability'], ['capital', 'Share capital', 'equity'], ['machine', 'Production machinery', 'asset'], ['accum', 'Accumulated depreciation', 'asset'],
    ['depreciation', 'Depreciation', 'expense'], ['loan', 'Bank loan', 'liability'], ['interest', 'Loan interest expense', 'expense'], ['salary', 'Salaries', 'expense'],
    ['fuel', 'Distribution fuel', 'expense'], ['tax', 'VAT payable', 'liability'], ['fees', 'Bank fees', 'expense'], ['gain', 'Asset disposal gain', 'other_income'], ['unknown', 'Suspense', 'liability'],
  ].map(([id, name, account_type]) => ({ id, name, account_number: id === 'transit' ? '1050' : id, account_type, normal_balance: ['liability', 'equity', 'revenue'].includes(account_type) || id === 'accum' ? 'credit' : 'debit', is_treasury: ['cash', 'bank', 'reserve'].includes(id), balance: 0 }));
  const journals = [], lines = [];
  const add = (id, date, rows, extra = {}) => {
    const j = { id, journal_number: 'JV-' + id, entry_date: date, status: 'posted', ...extra }; journals.push(j);
    for (const [account_id, debit, credit] of rows) {
      lines.push({ id: 'line-' + lines.length, journal_id: id, account_id, debit, credit, status: j.status === 'draft' ? 'draft' : 'posted' });
      if (j.status !== 'draft') accounts.find(a => a.id === account_id).balance += (debit - credit) * (accounts.find(a => a.id === account_id).normal_balance === 'credit' ? -1 : 1);
    }
    return j;
  };
  const run = (from = '2026-10-01', to = '2026-10-31') => buildCashFlow({ accounts, journals, cashLines: lines.filter(l => ['cash', 'bank', 'reserve', 'transit'].includes(l.account_id)), periodLines: lines, from, to });
  return { accounts, journals, lines, add, run };
}

test('commercial cash sale, partial handover and replacement transfer count cash exactly once', () => {
  const l = ledger(); l.add('open', '2026-09-30', [['cash', 1000, 0], ['capital', 0, 1000]]);
  l.add('sale', '2026-10-01', [['transit', 600, 0], ['ar', 400, 0], ['sales', 0, 900], ['tax', 0, 100], ['cogs', 300, 0], ['stock', 0, 300]], { source_module: 'field_sales', source_document_type: 'FieldSale' });
  l.add('handover', '2026-10-02', [['cash', 400, 0], ['transit', 0, 400]]);
  l.add('reserve', '2026-10-03', [['reserve', 100, 0], ['cash', 0, 100]], { source_module: 'assets', source_document_type: 'AssetReplacementFunding' });
  l.add('depreciation', '2026-10-31', [['depreciation', 100, 0], ['accum', 0, 100]]);
  l.add('draft', '2026-10-01', [['cash', 777, 0], ['sales', 0, 777]], { status: 'draft' });
  const r = l.run(); assert.equal(r.opening, 1000); assert.equal(r.inflow, 600); assert.equal(r.outflow, 0); assert.equal(r.closing, 1600); assert.equal(r.internal_transfers, 500);
  assert.equal(r.history.length, 3); assert.equal(r.components.find(a => a.account_id === 'transit').closing, 200); assert.equal(r.activities[0].net, 600); assert.deepEqual(r.issues, []);
});

test('gross operating, investing and financing flows reconcile with exact split of debt and interest', () => {
  const l = ledger(); l.add('open', '2026-09-30', [['bank', 10000, 0], ['capital', 0, 10000]]);
  for (const [id, account, value] of [['supplier', 'payable', 500], ['wages', 'salary', 250], ['fuel', 'fuel', 100], ['tax', 'tax', 50]]) l.add(id, '2026-10-02', [[account, value, 0], ['bank', 0, value]]);
  l.add('machine', '2026-10-03', [['machine', 1200, 0], ['bank', 0, 1200]], { source_module: 'assets', source_document_type: 'FixedAsset' });
  l.add('loan', '2026-10-04', [['bank', 2000, 0], ['loan', 0, 2000]]);
  l.add('repayment', '2026-10-05', [['loan', 300, 0], ['interest', 30, 0], ['bank', 0, 330]]);
  l.add('disposal', '2026-10-06', [['bank', 400, 0], ['accum', 700, 0], ['machine', 0, 1000], ['gain', 0, 100]], { source_module: 'assets', source_document_type: 'AssetDisposal' });
  const r = l.run(); assert.deepEqual(r.activities.slice(0, 3).map(a => [a.inflow, a.outflow, a.net]), [[0, 930, -930], [400, 1200, -800], [2000, 300, 1700]]);
  assert.equal(r.closing, 9970); assert.equal(r.reconciliation_difference, 0); assert.deepEqual(r.issues, []);
});

test('transfer with a fee reports only the fee as an external payment', () => {
  const l = ledger(); l.add('open', '2026-09-30', [['cash', 100, 0], ['capital', 0, 100]]);
  l.add('deposit', '2026-10-01', [['bank', 98, 0], ['fees', 2, 0], ['cash', 0, 100]]);
  const r = l.run(); assert.equal(r.internal_transfers, 98); assert.equal(r.outflow, 2); assert.equal(r.inflow, 0); assert.equal(r.closing, 98);
});

test('dated reversals retain the original movement and reverse the same source classification', () => {
  const l = ledger(); const original = l.add('sale', '2026-09-30', [['cash', 100, 0], ['sales', 0, 100], ['cogs', 50, 0], ['stock', 0, 50]], { source_module: 'sales', source_document_type: 'Invoice' });
  original.status = 'reversed'; original.reversed_by_journal = 'reverse';
  l.add('reverse', '2026-10-01', [['cash', 0, 100], ['sales', 100, 0], ['cogs', 0, 50], ['stock', 50, 0]], { source_module: 'sales', source_document_type: 'reversal', reversal_of: 'sale' });
  const before = l.run('2026-09-01', '2026-09-30'); assert.equal(before.inflow, 100); assert.equal(before.closing, 100);
  const after = l.run(); assert.equal(after.opening, 100); assert.equal(after.outflow, 100); assert.equal(after.closing, 0); assert.equal(after.activities[0].outflow, 100);
});

test('ambiguous compound journals retain gross cash and request review even when net is zero', () => {
  const l = ledger(); l.add('mixed', '2026-10-01', [['cash', 100, 0], ['bank', 0, 100], ['loan', 100, 0], ['sales', 0, 100]]);
  const r = l.run(); assert.equal(r.inflow, 100); assert.equal(r.outflow, 100); assert.equal(r.internal_transfers, 0); assert.equal(r.activities[3].inflow, 100); assert.match(r.history[0].review, /Compound/);
});

test('configured account activity wins and unposted opening balances remain visible discrepancies', () => {
  const l = ledger(); l.accounts.find(a => a.id === 'unknown').cash_flow_category = 'investing';
  l.add('settlement', '2026-10-01', [['unknown', 20, 0], ['cash', 0, 20]]);
  l.accounts.find(a => a.id === 'cash').balance += 50;
  const r = l.run(); assert.equal(r.activities[1].outflow, 20); assert.equal(r.opening, 0); assert.equal(r.closing, -20); assert.match(r.issues.join(' '), /stored GL balance/);
  assert.equal(classifyCashAccount({ account_type: 'expense', name: 'Interest', cash_flow_category: 'financing' }).activity, 'financing');
});

test('cash pool includes inactive historic accounts, deduplicates shared GL links and rejects invalid currency', () => {
  const l = ledger(); const bank = l.accounts.find(a => a.id === 'bank'); bank.is_active = false;
  const treasury = [{ gl_account_id: 'bank' }, { gl_account_id: 'bank' }]; assert.equal(cashPool(l.accounts, treasury).filter(a => a.id === 'bank').length, 1);
  bank.currency = 'USD'; assert.throws(() => cashPool(l.accounts, treasury), /Convert foreign/);
  assert.throws(() => cashPool(l.accounts, [{ gl_account_id: 'missing' }]), /no matching/);
});

test('bad dates, invalid amounts, unbalanced or incomplete posted histories fail instead of reporting false totals', () => {
  for (const dates of [['2026-02-30', '2026-03-01'], ['2026-10-31', '2026-10-01'], ['', '2026-10-01']]) assert.throws(() => cashFlowDates(...dates));
  const l = ledger(); l.add('bad', '2026-10-01', [['cash', 100, 0], ['sales', 0, 90]]); assert.throws(l.run, /not balanced/);
  l.lines[1].credit = 100; l.lines[0].debit = NaN; assert.throws(l.run, /invalid/);
  l.lines[0].debit = 100;
  assert.throws(() => buildCashFlow({ accounts: l.accounts, journals: l.journals, cashLines: l.lines.slice(0, 1), periodLines: [], from: '2026-10-01', to: '2026-10-31' }), /incomplete/);
});

test('CSV exports all history and protects text formula cells without changing numeric outflows', () => {
  const l = ledger(); l.add('csv', '2026-10-01', [['cash', 100, 0], ['sales', 0, 100]], { description: '=HYPERLINK("bad")', reference: '\t+formula' });
  const csv = cashFlowCsv(l.run()); assert.ok(csv.startsWith('\uFEFF')); assert.match(csv, /'\=HYPERLINK/); assert.match(csv, /'\+formula/); assert.match(csv, /JV-csv/); assert.match(csv, /Opening cash/);
});

test('HTTP report authorizes management, rejects cashier bank access, reads every page and never mutates business records', async () => {
  const env = await fixture();
  env.client.auth.me=async()=>({id:'cashier-login',role:'admin'});
  const l = ledger();
  for (let i = 0; i < 405; i++) l.add('sale-' + i, '2026-10-01', [['cash', 1, 0], ['sales', 0, 1]]);
  env.rows.Account.splice(0, env.rows.Account.length, ...l.accounts); env.rows.JournalEntry.push(...l.journals); env.rows.JournalLine.push(...l.lines); env.rows.TreasuryAccount.length = 0;
  let snapshots = 0;
  globalThis.__cashierClient = env.client; globalThis.__cashierTransaction = async fn => { snapshots++; return fn(); };
  env.client.auth.assertModule = module => assert.equal(module, 'accounting');
  const route = await functionRoute();
  const call = async () => { const response = await route(request({ action: 'cashFlowReport', from: '2026-10-01', to: '2026-10-31' }), { params: Promise.resolve({ name: 'fieldOps' }) }); return { status: response.status, ...await response.json() }; };
  try {
    const before = JSON.stringify(env.rows), result = await call();
    assert.equal(result.status, 200, result.error); assert.equal(result.history.length, 405); assert.equal(result.inflow, 405); assert.equal(result.closing, 405); assert.equal(JSON.stringify(env.rows), before); assert.equal(snapshots, 1); assert.equal(isReadOnlyFunction('fieldOps', 'cashFlowReport'), true);
    env.client.auth.me=async()=>({id:'cashier-login',role:'user'}); env.rows.Employee[0].status = 'inactive'; assert.equal((await call()).status, 400);
    env.rows.Employee[0].status = 'active'; env.client.auth.me=async()=>({id:'cashier-login',role:'user'}); assert.equal((await call()).status,400);
    env.rows.Employee[0].role = 'commercial'; assert.equal((await call()).status, 400);
    env.rows.Employee[0].role = 'cashier'; env.client.auth.me=async()=>({id:'cashier-login',role:'admin'}); env.client.auth.assertModule = () => { throw Error('Accounting module denied'); }; assert.match((await call()).error, /module denied/);
    env.client.auth.me = async () => null; assert.equal((await call()).status, 401);
  } finally { delete globalThis.__cashierClient; delete globalThis.__cashierTransaction; }
});
