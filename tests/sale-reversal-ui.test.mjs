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

test('reversal requires a reviewed stock outcome, keeps credit visible and retries the identical request after an interrupted response',async()=>{
 const s=hookRuntime();globalThis.__reversalUI=s;const calls=[],done=[];let fail=true;
 s.request=async body=>{calls.push(body);if(body.action==='previewSaleReversal')return {number:'INV-1',customer_name:'Customer A',date:'2026-11-05',total:1000,unpaid_cancelled:600,customer_credit:400,reviewToken:'verified-preview',can_restore_stock:true,warehouses:[{id:'factory',name:'Cold room'}],items:[{product_name:'1000g Brasse non sucre',quantity:2,unit:'ea'}]};if(fail)throw Error('Connection interrupted');return {reversal:{journal_id:'reversal'}};};
 const draw=()=>{s.beforeRender();return mod.exports.render({invoiceId:'invoice',onClose:()=>{},onDone:r=>done.push(r)});};
 try{draw();await s.flush();const html=draw();assert.match(html,/Customer credit created/);assert.match(html,/does not issue a cash refund/);assert.equal(s.buttons.find(b=>b.label==='Confirm sale reversal').disabled,true);
 s.controls.find(c=>c['aria-label']==='Reason for reversal').onChange({target:{value:'Mistake found during audit'}});s.controls.find(c=>c['aria-label']==='What happened to the goods?').onChange({target:{value:'return_stock'}});draw();assert.match(draw(),/quarantine/i);
 s.controls.find(c=>c['aria-label']==='Actual return warehouse').onChange({target:{value:'factory'}});draw();s.controls.find(c=>c.type==='checkbox').onChange({target:{checked:true}});draw();assert.equal(s.buttons.find(b=>b.label==='Confirm sale reversal').disabled,false);
 await s.buttons.find(b=>b.label==='Confirm sale reversal').onClick();assert.match(draw(),/Connection interrupted/);assert.equal(s.controls.find(c=>c['aria-label']==='Reason for reversal').value,'Mistake found during audit');
 fail=false;const save=s.buttons.find(b=>b.label==='Confirm sale reversal');await Promise.all([save.onClick(),save.onClick()]);const writes=calls.filter(c=>c.action==='reverseSale');assert.equal(writes.length,2);assert.deepEqual(writes[0],writes[1]);assert.equal(writes[1].warehouseId,'factory');assert.equal(writes[1].reviewToken,'verified-preview');assert.equal(done.length,1);
 }finally{s.cleanup();delete globalThis.__reversalUI;}
});
