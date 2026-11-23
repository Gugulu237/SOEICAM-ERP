import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url);
const out=await build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Editor from './src/components/sales/PostedSaleEditDialog.jsx';export const render=props=>renderToStaticMarkup(React.createElement(Editor,props));",loader:'jsx',resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'posted-sale-edit-ui',setup(b){
 b.onResolve({filter:/^react$/},a=>a.importer.endsWith('PostedSaleEditDialog.jsx')?{path:'editor',namespace:'hooks'}:undefined);
 b.onLoad({filter:/.*/,namespace:'hooks'},()=>({resolveDir:process.cwd(),contents:"import React from "+JSON.stringify(require.resolve('react'))+";export default {...React,createElement:(tag,props,...children)=>{globalThis.__postedUI.capture(tag,props,children);return React.createElement(tag,props,...children);}};export const useState=v=>globalThis.__postedUI.state('editor',v),useRef=v=>globalThis.__postedUI.ref('editor',v),useEffect=(fn,deps)=>globalThis.__postedUI.effect('editor',fn,deps);"}));
 const mocks={
  '@/lib/localization':"export const useLocaleRender=()=>{};",
  '@/lib/field-ops':"export const invokeFieldOps=async body=>({data:await globalThis.__postedUI.request(body)}),errorMessage=e=>e.message;",
  '@/components/ui/button':"import React from 'react';export const Button=({children,...props})=>{globalThis.__postedUI.capture('button',props,children);return React.createElement('button',props,children);};",
  '@/components/ui/input':"import React from 'react';export const Input=props=>{globalThis.__postedUI.capture('input',props,[]);return React.createElement('input',props);};",
  '@/components/ui/textarea':"import React from 'react';export const Textarea=props=>{globalThis.__postedUI.controls.push(props);return React.createElement('textarea',props);};",
  '@/components/ui/dialog':"import React from 'react';export const Dialog=({children})=>React.createElement('div',null,children);export const DialogContent=Dialog,DialogHeader=Dialog,DialogTitle=Dialog,DialogDescription=Dialog;",
 };
 b.onResolve({filter:/.*/},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'leaf'}:a.path==='./CashSaleDepositSelect'?{path:'deposit',namespace:'leaf'}:undefined);
 b.onLoad({filter:/.*/,namespace:'leaf'},a=>({resolveDir:process.cwd(),contents:a.path==='deposit'?"export default ()=>null;":mocks[a.path]}));
}}]});
const mod={exports:{}};new Function('require','module','exports',out.outputFiles[0].text)(require,mod,mod.exports);
const workspace={number:'INV-TEST',customerId:'c1',locationId:'',paymentType:'cash',treasuryAccountId:'till',reference:'REC-1',total:2000,balance:0,customers:[{id:'c1',name:'Customer A'},{id:'branch',name:'Customer A Jouvence',parent_id:'c1'}],points:[],cashAccounts:[],history:[],lines:[{line_id:'line',product_name:'YOLA',quantity:4,unit:'ea',unit_price:500}]};
const review={fingerprint:'verified-preview',customer_name:'Customer A',payment_type:'credit',total:1500,amount_paid:0,balance:1500,cash_change:-2000,stock_changes:[{product_name:'YOLA',before:4,after:3}]};
const button=(s,label)=>s.buttons.find(b=>b.label===label);
const control=(s,label)=>s.controls.find(c=>c['aria-label']===label);
function fixture(responder){
 const s=hookRuntime(),calls=[],done=[];globalThis.__postedUI=s;
 s.request=async body=>{calls.push(body);return responder(body,calls);};
 const draw=()=>{s.beforeRender();return mod.exports.render({invoiceId:'invoice',onClose:()=>{},onDone:r=>done.push(r)});};
 return {s,calls,done,draw,close:()=>{s.cleanup();delete globalThis.__postedUI;}};
}
test('posted sale editor reviews payment and quantity changes, invalidates stale confirmation and prevents double saving',async()=>{
 const f=fixture(body=>body.action==='postedSaleEditWorkspace'?structuredClone(workspace):body.action==='previewPostedSaleEdit'?structuredClone(review):{id:'saved'}),{s,draw}=f;
 try{
  draw();await s.flush();draw();assert.equal(button(s,'Review correction').disabled,true);
  control(s,'Payment type').onChange({target:{value:'credit'}});control(s,'Reason for correction').onChange({target:{value:'Physical receipt verified'}});draw();
  control(s,'Correct quantity for YOLA').onChange({target:{value:'3'}});draw();await button(s,'Review correction').onClick();assert.match(draw(),/Review corrected sale/);
  assert.equal(button(s,'Save posted sale correction').disabled,true);s.controls.find(c=>c.type==='checkbox').onChange({target:{checked:true}});draw();assert.equal(button(s,'Save posted sale correction').disabled,false);
  control(s,'Correct quantity for YOLA').onChange({target:{value:'2'}});draw();assert.equal(button(s,'Save posted sale correction'),undefined);
  await button(s,'Review correction').onClick();draw();assert.equal(button(s,'Save posted sale correction').disabled,true);
  s.controls.find(c=>c.type==='checkbox').onChange({target:{checked:true}});draw();const save=button(s,'Save posted sale correction').onClick;await Promise.all([save(),save()]);
  const writes=f.calls.filter(c=>c.action==='savePostedSaleEdit');assert.equal(writes.length,1);assert.equal(writes[0].paymentType,'credit');assert.equal(writes[0].lines[0].quantity,'2');assert.equal(writes[0].fingerprint,'verified-preview');assert.equal(writes[0].confirmed,true);assert.equal(f.done.length,1);
 }finally{f.close();}
});
test('a failed posted sale save keeps entered values and reuses the same correction key after review',async()=>{
 let fail=true;const f=fixture(body=>{if(body.action==='postedSaleEditWorkspace')return structuredClone(workspace);if(body.action==='previewPostedSaleEdit')return structuredClone(review);if(fail)throw Error('Connection interrupted');return {id:'saved'};}),{s,draw}=f;
 try{
  draw();await s.flush();draw();control(s,'Payment type').onChange({target:{value:'credit'}});control(s,'Reason for correction').onChange({target:{value:'Verified paper receipt'}});draw();
  await button(s,'Review correction').onClick();draw();s.controls.find(c=>c.type==='checkbox').onChange({target:{checked:true}});draw();await button(s,'Save posted sale correction').onClick();
  assert.match(draw(),/Connection interrupted/);assert.equal(control(s,'Payment type').value,'credit');assert.equal(control(s,'Reason for correction').value,'Verified paper receipt');
  fail=false;await button(s,'Review correction').onClick();draw();s.controls.find(c=>c.type==='checkbox').onChange({target:{checked:true}});draw();await button(s,'Save posted sale correction').onClick();
  const writes=f.calls.filter(c=>c.action==='savePostedSaleEdit');assert.equal(writes.length,2);assert.deepEqual(writes[0],writes[1]);assert.equal(f.done.length,1);
 }finally{f.close();}
});
