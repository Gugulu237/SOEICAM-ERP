import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { hookRuntime } from './helpers/commercial-ui.mjs';
const require = createRequire(import.meta.url);
let compiled;
async function renderer() {
  if (compiled) return compiled;
  const mocks = {
    '@/lib/localization': 'export const useLocaleRender=()=>{};',
    '@/lib/posting': 'export const round2=value=>Math.round(Number(value||0)*100)/100;',
    '@/lib/router': "import React from 'react';export const Link=({to,children,...props})=>React.createElement('a',{...props,href:to},children);export const useNavigate=()=>()=>{};export const useSearchParams=()=>[new URLSearchParams(),()=>{}];",
    '@/hooks/useCurrentUser': 'export const useCurrentUser=()=>globalThis.__incomeSourcesUI.user;',
    '@/api/erpClient': 'export const erp={entities:{Account:"Account",JournalEntry:"JournalEntry",JournalLine:"JournalLine"}};export const invalidateERPReads=()=>{};',
    '@/lib/field-pos': 'export const readAll=async(entity,query)=>{globalThis.__incomeSourcesUI.reads.push({entity,query});return structuredClone(globalThis.__incomeSourcesUI.tables[entity]);};',
    '@/lib/asset-depreciation-client': 'export const syncAssetDepreciation=async()=>({through:"2026-11",pending_total:0,issues:[]});',
    '@/lib/recurring-expense-client': 'export const recurringExpenseRequest=async(_body,query)=>{globalThis.__incomeSourcesUI.charges.push(query);return {pending_total:0};};',
    '@/components/assets/DepreciationStatus': 'export default ()=>null;',
    '@/components/shared/PageHeader': 'export default ()=>null;',
    '@/components/accounting/CashFlowStatement': 'export default ()=>null;',
    '@/components/accounting/BalanceSheet': 'export default ()=>null;',
    '@/components/shared/ReportExport': "import React from 'react';export default props=>{globalThis.__incomeSourcesUI.export=props;return React.createElement('div',null,'Export');};",
    '@/components/ui/button': "import React from 'react';export const Button=({children,variant,...props})=>React.createElement('button',props,children);",
    '@/components/ui/input': "import React from 'react';export const Input=props=>{globalThis.__incomeSourcesUI.inputs.push(props);return React.createElement('input',props);};",
    '@/components/ui/label': "import React from 'react';export const Label=({children,...props})=>React.createElement('label',props,children);",
    '@/components/ui/tabs': "import React from 'react';const Wrapper=({children})=>React.createElement('div',null,children);export const Tabs=Wrapper,TabsContent=Wrapper,TabsList=Wrapper,TabsTrigger=Wrapper;",
  };
  const result = await build({ stdin: { contents: "import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Income from './src/components/accounting/IncomeStatement.jsx';import Statements from './src/views/FinancialStatements.jsx';export const income=props=>renderToStaticMarkup(React.createElement(Income,props));export const page=()=>renderToStaticMarkup(React.createElement(Statements));export {computeActivity} from './src/lib/statements.js';", resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, jsx: 'transform', platform: 'node', format: 'cjs', write: false, plugins: [{ name: 'income-source-ui', setup(builder) {
    builder.onResolve({ filter: /^react$/ }, args => args.importer.endsWith('FinancialStatements.jsx') ? { path: 'page', namespace: 'hooks' } : undefined);
    builder.onLoad({ filter: /.*/, namespace: 'hooks' }, () => ({ contents: `import React from ${JSON.stringify(require.resolve('react'))};export default React;export const useState=value=>globalThis.__incomeSourcesUI.state('page',value),useEffect=(callback,deps)=>globalThis.__incomeSourcesUI.effect('page',callback,deps),useMemo=callback=>callback();`, resolveDir: process.cwd() }));
    builder.onResolve({ filter: /useRecurringExpenseReview$/ }, () => ({ path: 'recurring', namespace: 'hooks-review' }));
    builder.onLoad({ filter: /.*/, namespace: 'hooks-review' }, () => ({ contents: 'export const useRecurringExpenseReview=()=>({loading:false,error:"",count:0,total:0,canReview:false});' }));
    builder.onResolve({ filter: /^@\// }, args => Object.hasOwn(mocks, args.path) ? { path: args.path, namespace: 'leaf' } : undefined);
    builder.onLoad({ filter: /.*/, namespace: 'leaf' }, args => ({ contents: mocks[args.path], resolveDir: process.cwd() }));
  } }] });
  const module = { exports: {} }; new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports); compiled = module.exports; return compiled;
}
function fixture() {
  const accounts = [{ id: 'sales', account_number: '4010', name: 'YOLA sales', account_type: 'revenue' }, { id: 'cost', account_number: '5100', name: 'COGS', account_type: 'cogs' }, { id: 'stock', account_number: '1200', name: 'Inventory', account_type: 'asset' }, { id: 'customer', account_number: '1100', name: 'Customer', account_type: 'asset' }, { id: 'gain', account_number: '6050', name: 'Setup income', account_type: 'other_income' }];
  const journalsById = {
    sale: { id: 'sale', journal_number: 'JV-SALE', entry_date: '2026-11-04', status: 'posted', source_module: 'sales', source_document_type: 'Invoice', source_document_id: 'invoice-a', description: 'Delivered sale' },
    setup: { id: 'setup', journal_number: 'JV-SETUP', entry_date: '2026-11-04', status: 'posted', source_module: 'inventory_adjustment', source_document_type: 'WarehouseAdjustment', source_document_id: 'warehouse-count', description: 'Opening count' },
  };
  const lines = [['sale', 'customer', 1000, 0], ['sale', 'sales', 0, 1000], ['sale', 'cost', 400, 0], ['sale', 'stock', 0, 400], ['setup', 'stock', 1200, 0], ['setup', 'gain', 0, 1200]].map(([journal_id, account_id, debit, credit], index) => ({ id: 'line-' + index, journal_id, account_id, debit, credit }));
  return { accounts, journalsById, lines, fromDate: '2026-11-04', toDate: '2026-11-08', canCorrectSetup: true };
}
function environment() {
  const runtime = hookRuntime(), reset = runtime.beforeRender.bind(runtime), oldWindow = globalThis.window;
  runtime.reads = []; runtime.charges = []; runtime.inputs = []; runtime.user = { isAdmin: true, principalRole: 'admin' };
  runtime.beforeRender = () => { reset(); runtime.inputs = []; };
  globalThis.__incomeSourcesUI = runtime; globalThis.window = { addEventListener() {}, removeEventListener() {} };
  runtime.dispose = () => { runtime.cleanup(); globalThis.window = oldWindow; delete globalThis.__incomeSourcesUI; };
  return runtime;
}
const amount = (report, title) => report.sections.find(section => section.title === title).totals[0][2];

test('P&L offers account/source/journal inspection with source references and correction access without changing export totals', async () => {
  const render = await renderer(), runtime = environment(), input = fixture(); input.activity = render.computeActivity(input);
  try {
    render.income({ ...input, journalsById: undefined, lines: undefined }); const baseline = structuredClone(runtime.export.report);
    const before = structuredClone(input), html = render.income(input);
    assert.match(html, /Review income statement entries/); assert.match(html, /Inventory adjustments \/ WarehouseAdjustment/); assert.match(html, /Sales \/ Invoice/); assert.match(html, /warehouse-count/); assert.match(html, /invoice-a/);
    assert.match(html, /href="\/accounting\/journals\/sale"/); assert.match(html, /href="\/accounting\/journals\/setup"/);
    assert.match(html, /href="\/accounting\?tab=journals#setup-stock-corrections"/); assert.match(html, /Correct setup inventory entries/);
    assert.match(html, /do not verify their accounting treatment/); assert.match(html, /print:hidden/);
    assert.deepEqual(runtime.export.report, baseline); assert.equal(amount(runtime.export.report, 'Cost of goods sold'), 400); assert.equal(amount(runtime.export.report, 'Other income'), 1200); assert.deepEqual(input, before);
    assert.equal(runtime.reads.length, 0); assert.equal(runtime.charges.length, 0, 'opening source details performs no API reads or writes');
    assert.doesNotMatch(render.income({ ...input, canCorrectSetup: false }), /Correct setup inventory entries/);
  } finally { runtime.dispose(); }
});

test('drilldown fails visibly on mismatched account totals while the original report and export remain unchanged', async () => {
  const render = await renderer(), runtime = environment(), input = fixture(); input.activity = render.computeActivity(input); input.activity.cost.period = 401;
  try {
    const html = render.income(input); assert.match(html, /role="alert"/); assert.match(html, /entry details do not match/); assert.doesNotMatch(html, /href="\/accounting\/journals\//);
    assert.equal(amount(runtime.export.report, 'Cost of goods sold'), 401);
  } finally { runtime.dispose(); }
});

test('the loaded statement page passes the same dated ledger to the drilldown and keeps corrections restricted to principal admins', async () => {
  const render = await renderer(), runtime = environment(), input = fixture();
  input.journalsById.sale.status = 'reversed'; input.journalsById.sale.reversed_by_journal = 'correction';
  input.journalsById.correction = { id: 'correction', journal_number: 'JV-REVERSAL', status: 'posted', entry_date: '2026-11-06', source_module: 'sales', source_document_type: 'SaleReversal', source_document_id: 'sale', reversal_of: 'sale', description: 'Dated sale correction' };
  input.lines.push(...input.lines.filter(line => line.journal_id === 'sale').map(line => ({ ...line, id: 'reverse-' + line.id, journal_id: 'correction', debit: line.credit, credit: line.debit })));
  runtime.tables = { Account: input.accounts, JournalEntry: Object.values(input.journalsById), JournalLine: input.lines };
  const paint = () => { runtime.beforeRender(); return render.page(); };
  try {
    paint(); runtime.inputs[0].onChange({ target: { value: input.fromDate } }); runtime.inputs[1].onChange({ target: { value: input.toDate } }); await runtime.flush();
    let html = paint(); assert.match(html, /JV-REVERSAL/); assert.match(html, /Reversal journal/); assert.match(html, /Original journal with reversal/); assert.equal(amount(runtime.export.report, 'Cost of goods sold'), 0);
    assert.match(html, /Correct setup inventory entries/); assert.equal(runtime.reads.length, 3);
    runtime.inputs[0].onChange({ target: { value: '2026-11-06' } }); html = paint(); assert.match(html, /JV-REVERSAL/); assert.doesNotMatch(html, /href="\/accounting\/journals\/sale"/); assert.doesNotMatch(html, /JV-SETUP/); assert.equal(amount(runtime.export.report, 'Cost of goods sold'), -400); assert.equal(runtime.reads.length, 3);
    runtime.user = { isAdmin: true, principalRole: 'commercial' }; html = paint(); assert.doesNotMatch(html, /Correct setup inventory entries/); assert.match(html, /href="\/accounting\/journals\/correction"/);
    const exported = await runtime.export.getReport(); assert.equal(amount(exported, 'Cost of goods sold'), -400); assert.deepEqual(exported.metadata.slice(0, 2), [['From', '2026-11-06'], ['To', input.toDate]]); assert.equal(exported.sections.some(section => section.title.includes('journal inspection')), false);
  } finally { runtime.dispose(); }
});
