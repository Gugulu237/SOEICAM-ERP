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
    b.onResolve({ filter: /^react$/ }, args => /(?:AccountingInventory|InventoryAdjustmentTreatment)\.jsx$/.test(args.importer) ? { path: 'hooks', namespace: 'fixture' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `import React from ${JSON.stringify(require.resolve('react'))};
      export default {...React,createElement:(tag,props,...children)=>{globalThis.__inventoryUI.capture(tag,props,children);return React.createElement(tag,props,...children);}};
      export const lazy=React.lazy,Suspense=React.Suspense;export const useState=v=>globalThis.__inventoryUI.state('inventory',v),useRef=v=>globalThis.__inventoryUI.ref('inventory',v),useEffect=(fn,deps)=>globalThis.__inventoryUI.effect('inventory',fn,deps);
      export const useMemo=(fn,deps)=>{const r=useRef();if(!r.current||deps.some((v,i)=>!Object.is(v,r.current.deps[i])))r.current={value:fn(),deps};return r.current.value;};export const useCallback=(fn,deps)=>useMemo(()=>fn,deps);`, resolveDir: process.cwd() }));
    const mocks = {
      '@/api/erpClient': 'export const erp={};',
      '@/lib/router': `import React from 'react';export const Link=({to,children,...props})=>React.createElement('a',{...props,href:to},children);export const useSearchParams=()=>{};`,
      '@/components/shared/PageHeader': 'export default ()=>null;',
      '@/components/inventory/StockAdjustmentDialog': 'export default ()=>null;',
      '@/components/inventory/AdjustmentHistory':'export default ()=>null;',
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
const audit = { id: 'IA-test', revision: 2, title: 'Weekly count', status: 'draft', purpose:'operating', warehouse_name: 'Main', created_by: 'accountant', makers: ['accountant'], counter_name: 'Accountant', rows: [row], evidence_reference: 'SHEET-1', loss_account_id: 'loss' };
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

test('count account choices keep non-sale shortages out of COGS and preserve surplus income',async()=>{
 const account=(id,account_type,normal_balance)=>({id,name:id,account_number:id,account_type,normal_balance});
 const s=await screen({}, {accounts:[account('expense','expense','debit'),account('other-loss','other_expense','debit'),account('cogs','cogs','debit'),account('surplus','other_income','credit')]});
 try{
  const html=s.paint();
  assert.match(html,/<option value="expense">/);assert.match(html,/<option value="other-loss">/);assert.match(html,/<option value="surplus">/);
  assert.doesNotMatch(html,/<option value="cogs">/);
 }finally{s.close();}
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
    s.props.workspace.can_post_adjustments = false; assert.match(s.paint(), /Only top administrators with inventory adjustment access/); assert.equal(s.button('Post approved stock & journal adjustment'), undefined);
    s.props.workspace.can_post_adjustments = true;
    s.props.detail.stale = ['Changed']; s.paint(); assert.equal(s.button('Post approved stock & journal adjustment').disabled, true);
    s.props.workspace.user_id = 'other-accountant'; s.paint(); assert.equal(s.button('Post approved stock & journal adjustment'), undefined);
  } finally { s.close(); }
});

test('editable counts require an explicit accounting purpose before saving or submitting',async()=>{
 for(const purpose of ['',undefined]){
  const s=await screen({purpose});try{
   s.paint();assert.equal(s.input('Accounting purpose').value,'');assert.equal(s.button('Save counts').disabled,true);assert.equal(s.button('Submit count').disabled,true);assert.equal(s.input('gainAccountId'),undefined);
   s.input('Accounting purpose').onChange({target:{value:'operating'}});s.paint();assert.equal(s.button('Save counts').disabled,false);assert.equal(s.button('Submit count').disabled,true);
   s.button('Save counts').onClick();assert.equal(s.calls[0][1].purpose,'operating');assert.equal(s.calls[0][1].correctionAccountId,'');assert.equal(s.calls[0][1].correctionConfirmed,false);assert.equal(s.calls[0][1].lossAccountId,'loss');
  }finally{s.close();}
 }
});

test('opening correction requires a selected valid equity counterpart and fresh confirmation, and saves no operating offsets',async()=>{
 const equity={id:'equity',account_number:'3990',name:'Opening equity',account_type:'equity',normal_balance:'credit',currency:'XAF',is_active:true,is_posting:true};
 const accounts=[equity,...[['inactive',{is_active:false}],['nonposting',{is_posting:false}],['foreign',{currency:'EUR'}],['wrong-normal',{normal_balance:'debit'}],['income',{account_type:'other_income'}],['cash',{is_treasury:true}],['1050',{account_number:'1050'}]].map(([id,extra])=>({...equity,id,name:id,...extra}))];
 const s=await screen({gain_account_id:'income'}, {accounts});try{
  s.paint();s.input('Accounting purpose').onChange({target:{value:'opening_correction'}});let html=s.paint();
  assert.equal(s.input('lossAccountId'),undefined);assert.equal(s.input('gainAccountId'),undefined);assert.equal(s.input('Opening stock equity counterpart').value,'');assert.equal(s.button('Save counts').disabled,true);
  assert.match(html,/<option value="equity">/);for(const id of ['inactive','nonposting','foreign','wrong-normal','income','cash','1050'])assert.doesNotMatch(html,new RegExp('<option value="'+id+'">'));
  s.input('Opening stock equity counterpart').onChange({target:{value:'equity'}});s.paint();assert.equal(s.button('Save counts').disabled,true);assert.equal(s.input('Confirm opening stock correction').checked,false);
  s.input('Confirm opening stock correction').onChange({target:{checked:true}});html=s.paint();assert.match(html,/opening stock error, not an operating gain or loss/);assert.equal(s.button('Save counts').disabled,false);
  s.button('Save counts').onClick();const saved=s.calls[0][1];assert.equal(saved.purpose,'opening_correction');assert.equal(saved.correctionAccountId,'equity');assert.equal(saved.correctionConfirmed,true);assert.equal(saved.lossAccountId,'');assert.equal(saved.gainAccountId,'');
  s.input('Opening stock equity counterpart').onChange({target:{value:'equity'}});s.paint();assert.equal(s.input('Confirm opening stock correction').checked,false);assert.equal(s.button('Save counts').disabled,true);
  s.input('Accounting purpose').onChange({target:{value:'operating'}});s.paint();s.button('Save counts').onClick();assert.equal(s.calls[1][1].correctionAccountId,'');assert.equal(s.calls[1][1].correctionConfirmed,false);
 }finally{s.close();}
});

test('saved legacy operating treatment remains readable and invalid saved correction accounts block posting without rewriting history',async()=>{
 const legacy=await screen({purpose:undefined,status:'posted'});try{
  const before=structuredClone(legacy.props.detail.audit);legacy.paint();assert.equal(legacy.input('Accounting purpose').value,'operating');assert.equal(legacy.input('Accounting purpose').disabled,true);assert.equal(legacy.button('Save counts'),undefined);assert.deepEqual(legacy.props.detail.audit,before);
 }finally{legacy.close();}
 const equity={id:'equity',account_number:'3990',name:'Opening equity',account_type:'equity',normal_balance:'credit'};
 const s=await screen({purpose:'opening_correction',correction_account_id:'equity',correction_confirmed:true,status:'approved',approved_plan:[{account_id:'equity',account_name:'Reviewed opening equity',debit:20,credit:0}]},{accounts:[equity],can_post_adjustments:true});try{
  s.paint();assert.equal(s.button('Post approved stock & journal adjustment').disabled,false);assert.equal(s.input('Opening stock equity counterpart').disabled,true);
  s.props.workspace.accounts=[];const html=s.paint();assert.equal(s.button('Post approved stock & journal adjustment').disabled,true);assert.match(html,/Saved equity counterpart: Reviewed opening equity/);assert.equal(s.props.detail.audit.correction_account_id,'equity');assert.equal(s.props.detail.audit.correction_confirmed,true);
 }finally{s.close();}
});


test('audited counts link to separate reviewed setup correction without changing saved history',async()=>{
 const s=await screen({status:'posted',purpose:undefined});try{
  const before=structuredClone(s.props.detail.audit),html=s.paint();assert.match(html,/href="\/accounting\?tab=journals#setup-stock-corrections"/);assert.match(html,/Review previously posted setup entries/);assert.deepEqual(s.calls,[]);assert.deepEqual(s.props.detail.audit,before);
 }finally{s.close();}
});
