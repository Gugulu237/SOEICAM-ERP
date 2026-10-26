import test from 'node:test';
import assert from 'node:assert/strict';
import { cashFlowReport } from '../src/server/domain/cash-flow.js';
import { buildCashFlow } from '../src/lib/cash-flow.js';
import { fixture } from './helpers/cashier.mjs';

const user={id:'gm',role:'admin'};
const from = '2026-10-01', to = '2026-10-31';
const comparable = ({ generated_at, ...report }) => report;
async function ledgerFixture() {
  const env = await fixture();
  env.rows.Account.splice(0, env.rows.Account.length,
    { id: 'cash', account_number: '1000', name: 'Cash', account_type: 'asset', normal_balance: 'debit', is_treasury: true, balance: 0 },
    { id: 'equity', account_number: '3000', name: 'Capital', account_type: 'equity', normal_balance: 'credit', balance: 0 },
    { id: 'stock', account_number: '1300', name: 'Inventory', account_type: 'asset', normal_balance: 'debit', balance: 0 },
    { id: 'cogs', account_number: '5000', name: 'Cost of goods', account_type: 'cogs', normal_balance: 'debit', balance: 0 });
  env.rows.JournalEntry.length = 0; env.rows.JournalLine.length = 0; env.rows.TreasuryAccount.length = 0;
  const add = (id, date, entries, changes = {}) => {
    const header = { id, journal_number: id, entry_date: date, status: 'posted', ...changes };
    env.rows.JournalEntry.push(header);
    for (const [account_id, debit, credit] of entries) {
      env.rows.JournalLine.push({ id: `${id}-${env.rows.JournalLine.length}`, journal_id: id, account_id, debit, credit });
      if (account_id === 'cash' && ['posted', 'reversed'].includes(header.status)) env.rows.Account[0].balance += debit - credit;
    }
  };
  const counts = { queries: 0, rows: 0, filters: [] }, filter = env.entities.JournalEntry.filter;
  env.entities.JournalEntry.filter = async (...args) => {
    counts.queries++; counts.filters.push(args[0]);
    const rows = await filter(...args); counts.rows += rows.length; return rows;
  };
  const baseline = () => buildCashFlow({ accounts: env.rows.Account, treasury: env.rows.TreasuryAccount, journals: env.rows.JournalEntry,
    cashLines: env.rows.JournalLine.filter(line => line.account_id === 'cash'), periodLines: env.rows.JournalLine, from, to });
  const run = () => cashFlowReport(env.client, user, { from, to });
  return { ...env, add, counts, baseline, run };
}

test('cash report hydrates only linked headers while preserving opening, future balance checks and reversal source classification', async () => {
  const env = await ledgerFixture();
  env.add('opening', '2026-09-30', [['cash', 100, 0], ['equity', 0, 100]]);
  env.add('period', '2026-10-02', [['cash', 20, 0], ['equity', 0, 20]], { status: 'reversed' });
  env.add('reverse', '2026-10-03', [['cash', 0, 20], ['equity', 20, 0]], { reversal_of: 'period' });
  env.add('future', '2026-11-01', [['cash', 40, 0], ['equity', 0, 40]]);
  env.add('draft', '2026-10-04', [['cash', 999, 0], ['equity', 0, 999]], { status: 'draft' });
  // Preserve the source-classification fallback even for an unusual legacy
  // reversal reference whose original journal has no cash line.
  env.add('source-without-cash', '2026-09-20', [['stock', 7, 0], ['cogs', 0, 7]], { source_module: 'assets', source_document_type: 'FixedAsset' });
  env.add('legacy-reversal', '2026-10-05', [['stock', 7, 0], ['cash', 0, 7]], { reversal_of: 'source-without-cash' });
  for (let index = 0; index < 1000; index++) env.add('noncash-' + index, '2026-10-01', [['stock', 1, 0], ['cogs', 0, 1]]);
  const expected = env.baseline(), actual = await env.run();
  assert.deepEqual(comparable(actual), comparable(expected));
  assert.equal(actual.opening, 100); assert.equal(actual.closing, 93);
  assert.equal(actual.components[0].all_posted, 133); assert.equal(actual.components[0].balance_difference, 0);
  assert.equal(actual.activities.find(activity => activity.key === 'investing').outflow, 7);
  assert.equal(env.counts.rows, 6, '1000 non-cash and the draft headers are not hydrated');
  assert.equal(env.counts.queries, 2);
  assert.ok(env.counts.filters.every(query => Array.isArray(query.id.$in) && query.id.$in.length <= 100));
});

test('cash header lookup remains complete across chunks without loading unrelated history', async () => {
  const env = await ledgerFixture();
  for (let index = 0; index < 210; index++) env.add('receipt-' + index, '2026-10-02', [['cash', 1, 0], ['equity', 0, 1]]);
  for (let index = 0; index < 1000; index++) env.add('noncash-' + index, '2026-10-02', [['stock', 1, 0], ['cogs', 0, 1]]);
  const report = await env.run();
  assert.deepEqual(comparable(report), comparable(env.baseline()));
  assert.equal(report.history.length, 210); assert.equal(report.closing, 210);
  assert.equal(env.counts.rows, 210); assert.equal(env.counts.queries, 3);
});

test('bad historical cash dates still fail and an empty cash register avoids header queries', async () => {
  const env = await ledgerFixture();
  env.add('bad-history', 'invalid-date', [['cash', 1, 0], ['equity', 0, 1]]);
  await assert.rejects(env.run(), /valid start and end dates/);
  const empty = await ledgerFixture(), report = await empty.run();
  assert.equal(report.history.length, 0); assert.equal(empty.counts.queries, 0);
});
