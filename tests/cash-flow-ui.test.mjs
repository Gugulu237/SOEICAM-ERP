import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { hookRuntime } from './helpers/commercial-ui.mjs';
import { buildCashFlowReport } from '../src/lib/cash-flow-report.js';
import { packCashFlowReport } from '../src/lib/cash-flow-wire.js';
const require = createRequire(import.meta.url);

async function renderer() {
  const output = await build({ stdin: { contents: `import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import Report from './src/components/accounting/CashFlowStatement.jsx'; export const render=()=>renderToStaticMarkup(React.createElement(Report));`, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, platform: 'node', format: 'cjs', write: false, plugins: [{ name: 'cash-flow-ui', setup(b) {
    b.onResolve({ filter: /^react$/ }, args => /CashFlow(Statement|TraceDialog)\.jsx$/.test(args.importer) ? { path: args.importer, namespace: 'fixture' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({path:key}) => ({ contents: `import React from ${JSON.stringify(require.resolve('react'))};const key=${JSON.stringify(key)};
      export default {...React,createElement:(tag,props,...children)=>{globalThis.__flowUI.capture(tag,props,children);return React.createElement(tag,props,...children);}};
      export const useState=v=>globalThis.__flowUI.state(key,v), useRef=v=>globalThis.__flowUI.ref(key,v), useEffect=(fn,deps)=>globalThis.__flowUI.effect(key,fn,deps);
      export const useMemo=(fn,deps)=>{const r=useRef();if(!r.current||deps.some((v,i)=>!Object.is(v,r.current.deps[i])))r.current={value:fn(),deps};return r.current.value;};
      export const useCallback=(fn,deps)=>useMemo(()=>fn,deps);`, resolveDir: process.cwd() }));
    const mocks = {
      '@/lib/business-date': "export const businessDate=()=> '2026-10-19';",
      '@/lib/localization': "export const useLocaleRender=()=>globalThis.__flowUI.language||'en';",
      '@/components/shared/ReportExport': `import React from 'react';export default props=>{globalThis.__flowUI.reportExport=props;return React.createElement('button',{disabled:props.disabled},'Print / save PDF');};`,
      '@/api/erpClient': 'export const erp={functions:{invoke:(...args)=>globalThis.__flowUI.invoke(...args)}};',
      '@/lib/router': `import React from 'react';export const Link=({to,replaceOverlay,children,...props})=>React.createElement('a',{...props,href:to},children);`,
      '@/components/ui/dialog': "import React from 'react';export const Dialog=({children,onOpenChange})=>{globalThis.__flowUI.close=()=>onOpenChange(false);return React.createElement('div',null,children)},DialogContent=Dialog,DialogHeader=({children})=>React.createElement('div',null,children),DialogTitle=DialogHeader,DialogDescription=DialogHeader;",
      '@/components/ui/button': `import React from 'react';export const Button=({children,variant,size,...props})=>React.createElement('button',props,children);`,
      '@/components/ui/input': `import React from 'react';export const Input=props=>React.createElement('input',props);`,
      '@/components/ui/label': `import React from 'react';export const Label=props=>React.createElement('label',props);`,
    };
    b.onResolve({ filter: /^@\// }, a => Object.hasOwn(mocks, a.path) ? { path: a.path, namespace: 'leaf' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'leaf' }, a => ({ contents: mocks[a.path], resolveDir: process.cwd() }));
  } }] });
  const module = { exports: {} }; new Function('require', 'module', 'exports', output.outputFiles[0].text)(require, module, module.exports); return module.exports.render;
}

test('report shows management and indirect views, paginates exact journal evidence and exports only the selected period', async () => {
  const r = hookRuntime(), originalCapture = r.capture.bind(r); r.elements = [];
  r.capture = (tag, props, children) => { originalCapture(tag, props, children); r.elements.push({ tag, props: props || {}, children }); };
  const accounts = [{ id: 'cash', account_number: '1000', name: 'Cash', account_type: 'asset', normal_balance: 'debit', is_treasury: true, balance: 51 }, { id: 'sales', account_number: '7000', name: 'Sales', account_type: 'revenue', cash_flow_role:'sales' }];
  const journals = Array.from({ length: 51 }, (_, i) => ({ id: 'j' + i, journal_number: 'JV-' + String(i).padStart(3, '0'), entry_date: '2026-10-01', status: 'posted', description: 'Receipt ' + i }));
  const lines = journals.flatMap(j => [{ journal_id: j.id, account_id: 'cash', debit: 1, credit: 0 }, { journal_id: j.id, account_id: 'sales', debit: 0, credit: 1 }]);
  let calls = 0, fail = false;
  const requests=[];
  r.invoke = async (name, body) => { calls++; requests.push(body); assert.equal(name, 'fieldOps'); assert.equal(body.action, 'cashFlowReport'); if (fail) throw Error('Connection unavailable'); const snapshot=buildCashFlowReport({ accounts, journals, cashLines: lines.filter(l => l.account_id === 'cash'), periodLines: lines, ...body }); return {data:body.compactTraces ? packCashFlowReport(snapshot) : snapshot}; };
  globalThis.__flowUI = r;
  const render = await renderer();
  const paint = () => { r.beforeRender(); r.elements = []; return render(); };
  const prop = name => r.elements.find(e => e.props.id === name || e.props['aria-label'] === name)?.props;
  const button = text => r.elements.find(e => e.props.onClick && e.children.flat().includes(text))?.props;
  try {
    paint(); await r.flush(); let html = paint();
    assert.deepEqual(requests[0],{action:'cashFlowReport',from:'2026-10-01',to:'2026-10-31',compare:false,compactTraces:true});
    assert.match(html,/Operating Cash Flow/);assert.match(html,/Cash account reconciliation/);assert.match(html,/Treasury reconciled/);
    assert.equal((html.match(/data-cashflow-section=/g)||[]).length,3);
    prop('View journal entries for Cash sales received').onClick();html=paint();
    assert.match(html,/Page 1 \/ 2/);assert.doesNotMatch(html,/href="\/accounting\/journals\/j50"/);
    button('Next').onClick();html=paint();assert.match(html,/Page 2 \/ 2/);assert.match(html,/href="\/accounting\/journals\/j50"/);
    prop('Search journal entries').onChange({target:{value:'Receipt 50'}});html=paint();
    assert.match(html,/1 entries/);assert.match(html,/51 FCFA/);assert.equal(calls,1);
    prop('cashflow-compare').onChange({target:{checked:true}});await r.flush();html=paint();
    assert.equal(calls,2);assert.equal(requests[1].compare,true);assert.match(html,/2025-10-01/);
    button('SYSCOHADA').onClick();html=paint();assert.match(html,/Global self-financing capacity/);
    assert.match(html,/data-cashflow-line="ZH"/);assert.match(html,/N−1/);
    const official=r.reportExport.getReport();
    assert.deepEqual(official.sections[0].rows.find(row=>row[0]==='ZH').slice(2),['H',51,0]);assert.equal(calls,2);
    assert.match(html,/data-cashflow-line="workingCapital"/);
    r.language='fr';html=paint();assert.match(html,/Trésorerie nette à la clôture/);assert.equal(r.reportExport.getReport().language,'fr');
    r.language='en';paint();
    prop('cashflow-preset').onChange({target:{value:'custom'}});paint();
    prop('cashflow-from').onChange({target:{value:'2026-10-02'}});html=paint();assert.match(html,/Dates changed/);assert.equal(r.reportExport.disabled,true);
    const submit = r.elements.find(e => e.tag === 'form').props.onSubmit; submit({ preventDefault() {} }); await r.flush(); html = paint(); assert.match(html,/2026-10-02/);assert.equal(calls,3);assert.equal(r.reportExport.disabled,false);
    assert.equal(r.reportExport.getReport().sections[0].rows.find(row=>row[0]==='ZG')[3],0);
    fail = true; r.elements.find(e => e.tag === 'form').props.onSubmit({ preventDefault() {} }); await r.flush(); html = paint(); assert.match(html, /Connection unavailable/); assert.ok(!html.includes('Cash account reconciliation')); assert.equal(r.reportExport.disabled, true);
  } finally { r.cleanup(); delete globalThis.__flowUI; }
});
