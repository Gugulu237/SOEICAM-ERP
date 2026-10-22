import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { hookRuntime } from './helpers/commercial-ui.mjs';
import { buildCashFlow } from '../src/lib/cash-flow.js';
const require = createRequire(import.meta.url);

async function renderer() {
  const output = await build({ stdin: { contents: `import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import Report from './src/components/accounting/CashFlowStatement.jsx'; export const render=()=>renderToStaticMarkup(React.createElement(Report));`, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, platform: 'node', format: 'cjs', write: false, plugins: [{ name: 'cash-flow-ui', setup(b) {
    b.onResolve({ filter: /^react$/ }, args => args.importer.endsWith('CashFlowStatement.jsx') ? { path: 'hooks', namespace: 'fixture' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `import React from ${JSON.stringify(require.resolve('react'))};
      export default {...React,createElement:(tag,props,...children)=>{globalThis.__flowUI.capture(tag,props,children);return React.createElement(tag,props,...children);}};
      export const useState=v=>globalThis.__flowUI.state('flow',v), useRef=v=>globalThis.__flowUI.ref('flow',v), useEffect=(fn,deps)=>globalThis.__flowUI.effect('flow',fn,deps);
      export const useMemo=(fn,deps)=>{const r=useRef();if(!r.current||deps.some((v,i)=>!Object.is(v,r.current.deps[i])))r.current={value:fn(),deps};return r.current.value;};
      export const useCallback=(fn,deps)=>useMemo(()=>fn,deps);`, resolveDir: process.cwd() }));
    const mocks = {
      '@/lib/business-date': "export const businessDate=()=> '2026-10-19';",
      '@/components/shared/ReportExport': `import React from 'react';export default props=>{globalThis.__flowUI.reportExport=props;return React.createElement('button',{disabled:props.disabled},'Print / save PDF');};`,
      '@/api/erpClient': 'export const erp={functions:{invoke:(...args)=>globalThis.__flowUI.invoke(...args)}};',
      '@/lib/router': `import React from 'react';export const Link=({to,children,...props})=>React.createElement('a',{...props,href:to},children);`,
      '@/components/ui/button': `import React from 'react';export const Button=({children,variant,size,...props})=>React.createElement('button',props,children);`,
      '@/components/ui/input': `import React from 'react';export const Input=props=>React.createElement('input',props);`,
      '@/components/ui/label': `import React from 'react';export const Label=props=>React.createElement('label',props);`,
    };
    b.onResolve({ filter: /^@\// }, a => Object.hasOwn(mocks, a.path) ? { path: a.path, namespace: 'leaf' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'leaf' }, a => ({ contents: mocks[a.path], resolveDir: process.cwd() }));
  } }] });
  const module = { exports: {} }; new Function('require', 'module', 'exports', output.outputFiles[0].text)(require, module, module.exports); return module.exports.render;
}

test('report screen runs dates, filters history without changing totals, paginates and clears failed results', async () => {
  const r = hookRuntime(), originalCapture = r.capture.bind(r); r.elements = [];
  r.capture = (tag, props, children) => { originalCapture(tag, props, children); r.elements.push({ tag, props: props || {}, children }); };
  const accounts = [{ id: 'cash', account_number: '1000', name: 'Cash', account_type: 'asset', normal_balance: 'debit', is_treasury: true, balance: 51 }, { id: 'sales', account_number: '7000', name: 'Sales', account_type: 'revenue' }];
  const journals = Array.from({ length: 51 }, (_, i) => ({ id: 'j' + i, journal_number: 'JV-' + String(i).padStart(3, '0'), entry_date: '2026-10-01', status: 'posted', description: 'Receipt ' + i }));
  const lines = journals.flatMap(j => [{ journal_id: j.id, account_id: 'cash', debit: 1, credit: 0 }, { journal_id: j.id, account_id: 'sales', debit: 0, credit: 1 }]);
  let calls = 0, fail = false;
  r.invoke = async (name, body) => { calls++; assert.equal(name, 'fieldOps'); assert.equal(body.action, 'cashFlowReport'); if (fail) throw Error('Connection unavailable'); return { data: buildCashFlow({ accounts, journals, cashLines: lines.filter(l => l.account_id === 'cash'), periodLines: lines, from: body.from, to: body.to }) }; };
  globalThis.__flowUI = r;
  const render = await renderer();
  const paint = () => { r.beforeRender(); r.elements = []; return render(); };
  const prop = name => r.elements.find(e => e.props.id === name || e.props['aria-label'] === name)?.props;
  const button = text => r.elements.find(e => e.props.onClick && e.children.flat().includes(text))?.props;
  try {
    paint(); await r.flush(); let html = paint(); assert.equal(calls, 1); assert.match(html, /Operating activities/); assert.match(html, /Cash account reconciliation/); assert.match(html, /Page 1 of 2/); assert.ok(!html.includes('/accounting/journals/j50'));
    button('Next').onClick(); html = paint(); assert.match(html, /Page 2 of 2/); assert.match(html, /\/accounting\/journals\/j50/); assert.equal(calls, 1);
    prop('Search cash history').onChange({ target: { value: 'Receipt 50' } }); html = paint(); assert.match(html, /1 movements/); assert.match(html, /51 XAF/); assert.equal(calls, 1);assert.equal(r.reportExport.getReport().sections.at(-1).rows.length,51);
    prop('cashflow-from').onChange({ target: { value: '2026-10-02' } }); html = paint(); assert.match(html, /Dates changed/); assert.equal(r.reportExport.disabled, true);
    const submit = r.elements.find(e => e.tag === 'form').props.onSubmit; submit({ preventDefault() {} }); await r.flush(); html = paint(); assert.match(html, /No cash movements match/); assert.equal(calls, 2); assert.equal(r.reportExport.disabled, false);
    fail = true; r.elements.find(e => e.tag === 'form').props.onSubmit({ preventDefault() {} }); await r.flush(); html = paint(); assert.match(html, /Connection unavailable/); assert.ok(!html.includes('Cash account reconciliation')); assert.equal(r.reportExport.disabled, true);
  } finally { r.cleanup(); delete globalThis.__flowUI; }
});
