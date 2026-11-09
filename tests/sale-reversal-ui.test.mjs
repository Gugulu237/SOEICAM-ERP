import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url);
const out=await build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Reversal from './src/components/sales/SaleReversalDialog.jsx';export const render=(props)=>renderToStaticMarkup(React.createElement(Reversal,props));",loader:'jsx',resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'customer-activity-ui',setup(b){
  b.onResolve({filter:/^react$/},a=>/(SaleReversalDialog)\.jsx$/.test(a.importer)?{path:a.importer.split(/[\\/]/).at(-1),namespace:'hooks'}:undefined);
  b.onLoad({filter:/.*/,namespace:'hooks'},({path:key})=>({resolveDir:process.cwd(),contents:"import React from "+JSON.stringify(require.resolve('react'))+";export default {...React,createElement:(tag,props,...children)=>{globalThis.__reversalUI.capture(tag,props,children);if(tag==='textarea')globalThis.__reversalUI.controls.push(props);return React.createElement(tag,props,...children);}};export const useState=v=>globalThis.__reversalUI.state("+JSON.stringify(key)+",v),useRef=v=>globalThis.__reversalUI.ref("+JSON.stringify(key)+",v),useEffect=(fn,deps)=>globalThis.__reversalUI.effect("+JSON.stringify(key)+",fn,deps);"}));
  const mocks={
    '@/lib/localization':"export const useLocaleRender=()=>{};",
    '@/lib/field-ops':"export const invokeFieldOps=async body=>({data:await globalThis.__reversalUI.request(body)}),errorMessage=e=>e.message;",
    '@/components/ui/textarea':"import React from 'react';export const Textarea=props=>{globalThis.__reversalUI.controls.push(props);return React.createElement('textarea',props);};",
    '@/components/ui/input':"import React from 'react';export const Input=props=>{globalThis.__reversalUI.capture('input',props,[]);return React.createElement('input',props);};",
    '@/components/ui/button':"import React from 'react';export const Button=({children,...props})=>{globalThis.__reversalUI.capture('button',props,children);return React.createElement('button',props,children);};",
    '@/components/ui/dialog':"import React from 'react';export const Dialog=({children,onOpenChange})=>{globalThis.__reversalUI.dismiss=onOpenChange;return React.createElement('div',null,children);};export const DialogContent=({children})=>React.createElement('div',null,children),DialogHeader=DialogContent,DialogTitle=DialogContent,DialogDescription=DialogContent;",
    '@/components/sales/SaleProductPicker':"export default props=>{globalThis.__reversalUI.picker=props;return null;};"
  };
  b.onResolve({filter:/.*/},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'leaf'}:undefined);
  b.onLoad({filter:/.*/,namespace:'leaf'},a=>({resolveDir:process.cwd(),contents:mocks[a.path]}));
}}]});
const mod={exports:{}};new Function('require','module','exports',out.outputFiles[0].text)(require,mod,mod.exports);
const retainedCostReview={policy:'unreturned-goods-operating-expense-v1',amount:400.13,available:true,requires_expense:true,costs_visible:true,expense_account:{id:'',account_number:'UNRETURNED-GOODS',name:'Unreturned goods from cancelled sales'},will_create_account:true,error:''};

test('reversal requires a reviewed stock outcome, keeps credit visible and retries the identical request after an interrupted response',async()=>{
 const s=hookRuntime();globalThis.__reversalUI=s;const calls=[],done=[];let fail=true;
 s.request=async body=>{calls.push(body);if(body.action==='previewSaleReversal')return {number:'INV-1',customer_name:'Customer A',date:'2026-11-05',total:1000,unpaid_cancelled:600,customer_credit:400,reviewToken:'verified-preview',can_restore_stock:true,retained_cost_review:retainedCostReview,warehouses:[{id:'factory',name:'Cold room'}],items:[{product_name:'1000g Brasse non sucre',quantity:2,unit:'ea'}]};if(fail)throw Error('Connection interrupted');return {reversal:{journal_id:'reversal'}};};
 const draw=()=>{s.beforeRender();return mod.exports.render({invoiceId:'invoice',onClose:()=>{},onDone:r=>done.push(r)});};
 try{draw();await s.flush();const html=draw();assert.match(html,/Customer credit created/);assert.match(html,/does not issue a cash refund/);assert.equal(s.buttons.find(b=>b.label==='Confirm sale reversal').disabled,true);
 s.controls.find(c=>c['aria-label']==='Reason for reversal').onChange({target:{value:'Mistake found during audit'}});s.controls.find(c=>c['aria-label']==='What happened to the goods?').onChange({target:{value:'return_stock'}});draw();assert.match(draw(),/quarantine/i);
 s.controls.find(c=>c['aria-label']==='Actual return warehouse').onChange({target:{value:'factory'}});draw();s.controls.find(c=>c.type==='checkbox').onChange({target:{checked:true}});draw();assert.equal(s.buttons.find(b=>b.label==='Confirm sale reversal').disabled,false);
 await s.buttons.find(b=>b.label==='Confirm sale reversal').onClick();assert.match(draw(),/Connection interrupted/);assert.equal(s.controls.find(c=>c['aria-label']==='Reason for reversal').value,'Mistake found during audit');
 fail=false;const save=s.buttons.find(b=>b.label==='Confirm sale reversal');await Promise.all([save.onClick(),save.onClick()]);const writes=calls.filter(c=>c.action==='reverseSale');assert.equal(writes.length,2);assert.deepEqual(writes[0],writes[1]);assert.equal(writes[1].warehouseId,'factory');assert.equal(writes[1].reviewToken,'verified-preview');assert.equal(Object.hasOwn(writes[1],'costTreatmentPolicy'),false);assert.equal(done.length,1);
 }finally{s.cleanup();delete globalThis.__reversalUI;}
});

test('unreturned goods show the exact operating expense and account before confirming its current cost policy',async()=>{
 const s=hookRuntime();globalThis.__reversalUI=s;const calls=[],done=[];
 s.request=async body=>{calls.push(body);return body.action==='previewSaleReversal'?{number:'INV-1',customer_name:'Customer A',date:'2026-11-05',total:1000,unpaid_cancelled:1000,customer_credit:0,reviewToken:'verified-preview',can_restore_stock:true,retained_cost_review:retainedCostReview,warehouses:[],items:[]}:{reversal:{journal_id:'reversal'}};};
 const draw=()=>{s.beforeRender();return mod.exports.render({invoiceId:'invoice',onClose:()=>{},onDone:r=>done.push(r)});};
 try{draw();await s.flush();draw();s.controls.find(c=>c['aria-label']==='Reason for reversal').onChange({target:{value:'Cancel invoice without received goods'}});s.controls.find(c=>c['aria-label']==='What happened to the goods?').onChange({target:{value:'retain_stock'}});const html=draw();assert.match(html,/record their cost as an operating expense/);assert.doesNotMatch(html,/leave stock and costs unchanged/);assert.match(html,/Cost moved from COGS to operating expense/);assert.match(html,/400.13 XAF/);assert.match(html,/UNRETURNED-GOODS/);assert.match(html,/Unreturned goods from cancelled sales/);assert.match(html,/not restored to inventory/);assert.match(html,/will be created when this correction is confirmed/);assert.equal(s.buttons.find(b=>b.label==='Confirm sale reversal').disabled,true);
 s.controls.find(c=>c.type==='checkbox').onChange({target:{checked:true}});draw();assert.equal(s.buttons.find(b=>b.label==='Confirm sale reversal').disabled,false);await s.buttons.find(b=>b.label==='Confirm sale reversal').onClick();assert.equal(calls.filter(c=>c.action==='reverseSale').length,1);assert.equal(calls.at(-1).costTreatmentPolicy,retainedCostReview.policy);assert.equal(calls.at(-1).reviewToken,'verified-preview');assert.equal(done.length,1);
 }finally{s.cleanup();delete globalThis.__reversalUI;}
});

test('missing or invalid retained-cost previews cannot enable or submit an undisplayed expense outcome',async()=>{
 for(const retained of [undefined,{...retainedCostReview,available:false,error:'Review the configured <COGS> account.'}]){
  const s=hookRuntime();globalThis.__reversalUI=s;const calls=[];
  s.request=async body=>{calls.push(body);return {number:'INV-1',customer_name:'Customer A',date:'2026-11-05',total:1000,unpaid_cancelled:1000,customer_credit:0,reviewToken:'verified-preview',can_restore_stock:true,...(retained?{retained_cost_review:retained}:{}),warehouses:[],items:[]};};
  const draw=()=>{s.beforeRender();return mod.exports.render({invoiceId:'invoice',onClose:()=>{},onDone:()=>{throw Error('No reversal should be posted');}});};
  try{draw();await s.flush();let html=draw();assert.match(html,/<option value="retain_stock" disabled=""/);if(retained)assert.match(html,/configured &lt;COGS&gt; account/);else assert.match(html,/Reload the preview to review the operating expense/);
   s.controls.find(c=>c['aria-label']==='Reason for reversal').onChange({target:{value:'Cancel unsafe old preview'}});s.controls.find(c=>c['aria-label']==='What happened to the goods?').onChange({target:{value:'retain_stock'}});draw();s.controls.find(c=>c.type==='checkbox').onChange({target:{checked:true}});html=draw();assert.doesNotMatch(html,/Cost moved from COGS to operating expense/);assert.equal(s.buttons.find(b=>b.label==='Confirm sale reversal').disabled,true);await s.buttons.find(b=>b.label==='Confirm sale reversal').onClick();assert.equal(calls.filter(c=>c.action==='reverseSale').length,0);
  }finally{s.cleanup();delete globalThis.__reversalUI;}
 }
});

test('an authorized sale author can acknowledge the generic operating expense without seeing carrying costs or account details',async()=>{
 const s=hookRuntime();globalThis.__reversalUI=s;const calls=[];
 s.request=async body=>{calls.push(body);return body.action==='previewSaleReversal'?{number:'INV-1',customer_name:'Customer A',date:'2026-11-05',total:1000,unpaid_cancelled:1000,customer_credit:0,reviewToken:'verified-preview',can_restore_stock:true,retained_cost_review:{policy:retainedCostReview.policy,available:true,requires_expense:true,costs_visible:false},warehouses:[],items:[]}:{reversal:{journal_id:'reversal'}};};
 const draw=()=>{s.beforeRender();return mod.exports.render({invoiceId:'invoice',onClose:()=>{},onDone:()=>{}});};
 try{draw();await s.flush();draw();s.controls.find(c=>c['aria-label']==='Reason for reversal').onChange({target:{value:'Cancel my wrong invoice'}});s.controls.find(c=>c['aria-label']==='What happened to the goods?').onChange({target:{value:'retain_stock'}});const html=draw();assert.match(html,/not restored to inventory/);assert.doesNotMatch(html,/Cost moved from COGS to operating expense|Operating expense account|UNRETURNED-GOODS|Invalid amount|400.13/);
 s.controls.find(c=>c.type==='checkbox').onChange({target:{checked:true}});draw();assert.equal(s.buttons.find(b=>b.label==='Confirm sale reversal').disabled,false);await s.buttons.find(b=>b.label==='Confirm sale reversal').onClick();assert.equal(calls.at(-1).costTreatmentPolicy,retainedCostReview.policy);
 }finally{s.cleanup();delete globalThis.__reversalUI;}
});
