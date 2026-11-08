import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundled = await build({ stdin: { contents: "export {incomeStatementSources} from './src/lib/income-statement-sources.js';export {computeActivity,sectionRows} from './src/lib/statements.js';", resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', write: false, plugins: [{ name: 'statement-source-fixture', setup(builder) {
  builder.onResolve({ filter: /^@\/lib\/posting$/ }, () => ({ path: 'round', namespace: 'fixture' }));
  builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const round2=value=>Math.round(Number(value||0)*100)/100;' }));
} }] });
const { incomeStatementSources, computeActivity, sectionRows } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const accounts = [
  { id: 'sales', account_number: '4010', name: 'YOLA sales', account_type: 'revenue', normal_balance: 'credit' },
  { id: 'cost', account_number: '5100', name: 'Cost of goods sold', account_type: 'cogs', normal_balance: 'debit' },
  { id: 'stock', account_number: '1200', name: 'Finished goods', account_type: 'asset', normal_balance: 'debit' },
  { id: 'customer', account_number: '1100', name: 'Customers', account_type: 'asset', normal_balance: 'debit' },
  { id: 'gain', account_number: '6050', name: 'Other operating income', account_type: 'other_income', normal_balance: 'credit' },
  { id: 'unused', account_number: '6000', name: 'Unused expense', account_type: 'expense', normal_balance: 'debit' },
];
function fixture() {
  const journalsById = {
    sale: { id: 'sale', journal_number: 'JV-2', entry_date: '2026-11-04', status: 'posted', source_module: 'sales', source_document_type: 'Invoice', source_document_id: 'invoice', description: 'Invoice supply', internal_approval_secret: 'Do not project extra fields' },
    setup: { id: 'setup', journal_number: 'JV-3', entry_date: '2026-11-04', status: 'posted', source_module: 'inventory_adjustment', source_document_type: 'WarehouseAdjustment', source_document_id: 'count', description: 'Setup count' },
    materials: { id: 'materials', journal_number: 'JV-4', entry_date: '2026-11-05', status: 'posted', source_module: 'manufacturing', source_document_type: 'ProductionMaterialIssue', source_document_id: 'order:stage', description: 'Historical material posting' },
    older: { id: 'older', journal_number: 'JV-1', entry_date: '2026-11-03', status: 'posted', source_module: 'manual', source_document_type: 'manual_journal', source_document_id: 'older' },
    future: { id: 'future', journal_number: 'JV-5', entry_date: '2026-11-09', status: 'posted' },
    draft: { id: 'draft', entry_date: '2026-11-04', status: 'draft' },
  };
  const lines = [
    ['sale', 'customer', 1000, 0], ['sale', 'sales', 0, 1000], ['sale', 'cost', 100, 0], ['sale', 'cost', 300, 0], ['sale', 'stock', 0, 400],
    ['setup', 'stock', 1200, 0], ['setup', 'gain', 0, 1200],
    ['materials', 'cost', 200, 0], ['materials', 'stock', 0, 200],
    ['older', 'cost', 900, 0], ['older', 'stock', 0, 900], ['future', 'cost', 800, 0], ['future', 'stock', 0, 800],
    ['draft', 'cost', 700, 0], ['draft', 'stock', 0, 700], ['missing', 'cost', 9999, 0],
  ].map(([journal_id, account_id, debit, credit], index) => ({ id: 'line-' + index, journal_id, account_id, debit, credit }));
  return { accounts: structuredClone(accounts), journalsById, lines, fromDate: '2026-11-04', toDate: '2026-11-08' };
}
const withActivity = input => ({ ...input, activity: computeActivity(input) });

test('source drilldown reconciles each account to its exact P&L amount and separates manufactured costs from invoice costs', () => {
  const input = withActivity(fixture()), before = structuredClone(input), rows = incomeStatementSources(input);
  assert.equal(rows.length, 3); assert.deepEqual(rows.map(row => row.account_number), ['4010', '5100', '6050']);
  const cost = rows.find(row => row.account_id === 'cost'); assert.equal(cost.amount, 600); assert.equal(cost.debit, 600); assert.equal(cost.credit, 0);
  assert.deepEqual(cost.sources.map(source => [source.source_module, source.source_document_type, source.amount]), [['manufacturing', 'ProductionMaterialIssue', 200], ['sales', 'Invoice', 400]]);
  assert.equal(cost.sources.find(source => source.source_module === 'sales').journals.length, 1, 'several lines for the same account stay in one journal row');
  assert.equal(cost.sources.find(source => source.source_module === 'sales').journals[0].source_document_id, 'invoice');
  for (const row of rows) {
    const sign = ['revenue', 'other_income'].includes(row.account_type) ? -1 : 1;
    assert.equal(row.amount, sectionRows(input.accounts, input.activity, [row.account_type], sign).find(account => account.id === row.account_id).amount);
    assert.equal(row.sources.reduce((sum, source) => sum + source.amount, 0), row.amount);
    for (const source of row.sources) assert.equal(source.journals.reduce((sum, journal) => sum + journal.amount, 0), source.amount);
  }
  assert.equal(rows.find(row => row.account_id === 'sales').amount, 1000); assert.equal(rows.find(row => row.account_id === 'gain').amount, 1200);
  assert.equal(JSON.stringify(rows).includes('internal_approval_secret'), false); assert.deepEqual(input, before);
});

test('dated reversals retain the original until reversal date and show signed correction sources, including net-zero account activity', () => {
  const input = fixture(); input.journalsById.sale.status = 'reversed'; input.journalsById.sale.reversed_by_journal = 'reverse';
  input.journalsById.reverse = { id: 'reverse', journal_number: 'JV-6', entry_date: '2026-11-06', status: 'posted', reversal_of: 'sale', source_module: 'sales', source_document_type: 'SaleReversal', source_document_id: 'sale' };
  input.lines.push(...input.lines.filter(line => line.journal_id === 'sale').map(line => ({ ...line, id: 'reverse-' + line.id, journal_id: 'reverse', debit: line.credit, credit: line.debit })));
  const early = incomeStatementSources(withActivity({ ...input, toDate: '2026-11-05' }));
  assert.equal(early.find(row => row.account_id === 'cost').amount, 600); assert.equal(early.find(row => row.account_id === 'sales').amount, 1000);
  const complete = incomeStatementSources(withActivity(input)), revenue = complete.find(row => row.account_id === 'sales');
  assert.equal(revenue.amount, 0); assert.deepEqual(revenue.sources.map(source => source.amount), [1000, -1000]);
  const cost = complete.find(row => row.account_id === 'cost'); assert.equal(cost.amount, 200);
  assert.equal(cost.sources.find(source => source.source_document_type === 'SaleReversal').journals[0].reversal_of, 'sale');
  const onlyReversal = incomeStatementSources(withActivity({ ...input, fromDate: '2026-11-06' }));
  assert.equal(onlyReversal.find(row => row.account_id === 'cost').amount, -400); assert.equal(onlyReversal.find(row => row.account_id === 'sales').amount, -1000);
});

test('duplicate source journals stay distinct and counted instead of being hidden by the audit breakdown', () => {
  const input = fixture(); input.journalsById.copy = { ...input.journalsById.sale, id: 'copy', journal_number: 'JV-7' };
  input.lines.push(...input.lines.filter(line => line.journal_id === 'sale').map(line => ({ ...line, id: 'copy-' + line.id, journal_id: 'copy' })));
  const cost = incomeStatementSources(withActivity(input)).find(row => row.account_id === 'cost');
  assert.equal(cost.amount, 1000); const invoice = cost.sources.find(source => source.source_module === 'sales'); assert.equal(invoice.amount, 800);
  assert.deepEqual(invoice.journals.map(journal => journal.journal_number), ['JV-2', 'JV-7']); assert.equal(new Set(invoice.journals.map(journal => journal.source_document_id)).size, 1);
});

test('incomplete ledger chains and mismatched displayed account totals cannot produce a misleading drilldown', () => {
  const input = withActivity(fixture());
  assert.throws(() => incomeStatementSources({ ...input, activity: { ...input.activity, cost: { period: 601 } } }), /do not match/);
  assert.throws(() => incomeStatementSources({ ...input, activity: { ...input.activity, unused: { period: 50 } } }), /do not match/);
  assert.throws(() => incomeStatementSources({ ...input, lines: input.lines.filter(line => line.account_id === 'cost') }), /incomplete|balance/);
  assert.throws(() => incomeStatementSources({ ...input, fromDate: '2026-02-30' }), /date range/);
  assert.throws(() => incomeStatementSources({ ...input, journalsById: { ...input.journalsById, sale: { ...input.journalsById.sale, total_debit: 999 } } }), /incomplete|balance/);
});

test('fractional lines keep cent precision across account, source and journal totals', () => {
  const input = { accounts, fromDate: '2026-11-04', toDate: '2026-11-08', journalsById: { fraction: { entry_date: '2026-11-04', status: 'posted', source_module: 'manual', source_document_type: 'manual_journal' } }, lines: [...Array.from({ length: 1001 }, () => ({ journal_id: 'fraction', account_id: 'cost', debit: 0.1 })), { journal_id: 'fraction', account_id: 'stock', credit: 100.1 }] };
  const [row] = incomeStatementSources(withActivity(input)); assert.equal(row.amount, 100.1); assert.equal(row.sources[0].amount, 100.1); assert.equal(row.sources[0].journals[0].amount, 100.1);
});
