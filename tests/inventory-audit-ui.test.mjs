import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { hookRuntime } from './helpers/commercial-ui.mjs';
const require = createRequire(import.meta.url);
let compiled;
async function renderer() {
  if (compiled) return compiled;
  const output = await build({ stdin: { contents: `import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {CountDetail} from './src/views/AccountingInventory.jsx';export const render=props=>renderToStaticMarkup(React.createElement(CountDetail,props));`, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, platform: 'node', format: 'cjs', write: false, plugins: [{ name: 'inventory-ui', setup(b) {
    b.onResolve({ filter: /^react$/ }, args => args.importer.endsWith('AccountingInventory.jsx') ? { path: 'hooks', namespace: 'fixture' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `import React from ${JSON.stringify(require.resolve('react'))};
      export default {...React,createElement:(tag,props,...children)=>{globalThis.__inventoryUI.capture(tag,props,children);return React.createElement(tag,props,...children);}};
      export const useState=v=>globalThis.__inventoryUI.state('inventory',v),useRef=v=>globalThis.__inventoryUI.ref('inventory',v),useEffect=(fn,deps)=>globalThis.__inventoryUI.effect('inventory',fn,deps);
      export const useMemo=(fn,deps)=>{const r=useRef();if(!r.current||deps.some((v,i)=>!Object.is(v,r.current.deps[i])))r.current={value:fn(),deps};return r.current.value;};export const useCallback=(fn,deps)=>useMemo(()=>fn,deps);`, resolveDir: process.cwd() }));
    const mocks = {
      '@/api/erpClient': 'export const erp={};',
      '@/lib/router': `import React from 'react';export const Link=({to,children,...props})=>React.createElement('a',{...props,href:to},children);export const useSearchParams=()=>{};`,
      '@/components/shared/PageHeader': 'export default ()=>null;',
      '@/components/inventory/StockAdjustmentDialog': 'export default ()=>null;',
      '@/hooks/useCurrentUser': "export const useCurrentUser=()=>({role:'cashier'});",
      '@/components/ui/button': `import React from 'react';export const Button=({children,variant,size,asChild,...props})=>React.createElement('button',props,children);`,
      '@/components/ui/input': `import React from 'react';export const Input=props=>React.createElement('input',props);`,
      '@/components/ui/label': `import React from 'react';export const Label=props=>React.createElement('label',props);`,
      '@/components/ui/dialog': 'export const Dialog=()=>null,DialogContent=()=>null,DialogHeader=()=>null,DialogTitle=()=>null;',
    };
    b.onResolve({ filter: /^@\// }, a => Object.hasOwn(mocks, a.path) ? { path: a.path, namespace: 'leaf' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'leaf' }, a => ({ contents: mocks[a.path], resolveDir: process.cwd() }));
  } }] });
  const module = { exports: {} }; new Function('require', 'module', 'exports', output.outputFiles[0].text)(require, module, module.exports); compiled = module.exports.render; return compiled;
}
const row = { balance_id: 'lot', product_name: 'Flour', lot_number: 'L1', warehouse_name: 'Main', unit: 'kg', book_quantity: 10, book_value: 100, unit_cost: 10, counted_quantity: 8, difference: -2, value_difference: -20, reason: 'Damaged bags', qc_status: 'approved' };
const audit = { id: 'IA-test', revision: 2, title: 'Weekly count', status: 'draft', warehouse_name: 'Main', created_by: 'accountant', makers: ['accountant'], counter_name: 'Accountant', rows: [row], evidence_reference: 'SHEET-1', loss_account_id: 'loss' };
async function screen(overrides = {}, workspace = {}) {
  const r = hookRuntime(); r.elements = []; r.capture = (tag, props, children) => r.elements.push({ tag, props: props || {}, children }); globalThis.__inventoryUI = r;
  const render = await renderer(), calls = [];
  const props = { detail: { audit: structuredClone({ ...audit, ...overrides }), stale: [], history: [] }, workspace: { role: 'cashier', user_id: 'accountant', accounts: [], ...workspace }, busy: false, perform: (...args) => calls.push(args), back: () => {}, reload: () => {} };
  const paint = () => { r.beforeRender(); r.elements = []; return render(props); };
  const input = name => r.elements.find(e => e.props.id === name || e.props['aria-label'] === name)?.props;
  const button = text => r.elements.find(e => e.props.onClick && e.children.flat().includes(text))?.props;
  return { r, props, calls, paint, input, button, close: () => { r.cleanup(); delete globalThis.__inventoryUI; } };
}

test('physical count edits distinguish cleared values from zero and require save before submit', async () => {
  const s = await screen(); try {
    assert.match(s.paint(), /1 \/ 1/); assert.equal(s.button('Submit count').disabled, false);
    s.input('Physical count Flour L1').onChange({ target: { value: '' } }); let html = s.paint();
    assert.match(html, /0 \/ 1/); assert.match(html, /Not counted/); assert.equal(s.button('Submit count').disabled, true);
    s.button('Save counts').onClick(); assert.equal(s.calls[0][1].rows[0].counted_quantity, ''); assert.equal(s.calls[0][1].revision, 2);
    s.input('Physical count Flour L1').onChange({ target: { value: '0' } }); html = s.paint(); assert.match(html, /1 \/ 1/); assert.match(html, /100 XAF/);
    s.button('Save counts').onClick(); assert.equal(s.calls[1][1].rows[0].counted_quantity, '0');
  } finally { s.close(); }
});

test('independent review requires a note, and stale counts cannot be approved', async () => {
  const s = await screen({ status: 'submitted' }, { role: 'admin', user_id: 'gm' }); try {
    s.paint(); assert.equal(s.button('Save counts'), undefined); assert.equal(s.button('Approve variance').disabled, true); assert.equal(s.r.elements.find(e => e.tag === 'fieldset').props.disabled, true);
    s.input('audit-review-note').onChange({ target: { value: 'Witnessed the count' } }); s.paint(); assert.equal(s.button('Approve variance').disabled, false);
    s.button('Approve variance').onClick(); assert.deepEqual(s.calls[0], ['inventoryAuditApprove', { auditId: 'IA-test', revision: 2, note: 'Witnessed the count' }]);
    s.props.detail.stale = ['Stock changed']; s.paint(); assert.equal(s.button('Approve variance').disabled, true); assert.equal(s.button('Return to accountant').disabled, false);
    s.props.workspace.user_id = 'accountant'; s.paint(); assert.equal(s.button('Approve variance'), undefined);
  } finally { s.close(); }
});

test('posted counts are read-only; approved counts require adjustment permission and owner or GM', async () => {
  const s = await screen({ status: 'posted', journal_id: 'journal', journal_number: 'JV-1' }, { can_post_adjustments: true }); try {
    const html = s.paint(); assert.match(html, /read-only/); assert.match(html, /\/accounting\/journals\/journal/); assert.equal(s.button('Save counts'), undefined); assert.equal(s.button('Cancel count'), undefined);
    s.props.detail.audit.status = 'approved'; s.paint(); assert.equal(s.button('Post approved stock & journal adjustment').disabled, false);
    s.props.workspace.can_post_adjustments = false; assert.match(s.paint(), /requires Inventory quantity adjustments access/); assert.equal(s.button('Post approved stock & journal adjustment'), undefined);
    s.props.workspace.can_post_adjustments = true;
    s.props.detail.stale = ['Changed']; s.paint(); assert.equal(s.button('Post approved stock & journal adjustment').disabled, true);
    s.props.workspace.user_id = 'other-accountant'; s.paint(); assert.equal(s.button('Post approved stock & journal adjustment'), undefined);
  } finally { s.close(); }
});
