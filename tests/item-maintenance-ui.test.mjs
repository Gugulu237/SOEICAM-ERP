import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url);
let compiled;
async function renderer(){
 if(compiled)return compiled;
 const mocks={
 '@/components/inventory/StockAdjustmentDialog':'export default ()=>null;',
 '@/hooks/useCurrentUser':'export const useCurrentUser=()=>globalThis.__itemActions.session;',
 '@/api/erpClient':'export const invalidateERPReads=()=>{globalThis.__itemActions.invalidations++;};',
 '@/components/ui/button':'import React from "react";export const Button=({children,variant,size,...props})=>{globalThis.__itemActions.capture("button",props,children);return React.createElement("button",props,children);};',
 '@/components/ui/textarea':'import React from "react";export const Textarea=props=>{globalThis.__itemActions.controls.push({...props,tag:"textarea"});return React.createElement("textarea",props);};',
 '@/components/ui/dialog':'import React from "react";const Box=({children})=>React.createElement("div",null,children);export const Dialog=props=>{globalThis.__itemActions.dialog=props;return props.open?React.createElement("div",null,props.children):null;};export const DialogContent=Box,DialogHeader=Box,DialogTitle=Box,DialogDescription=Box,DialogFooter=Box;',
 };
 const output=await build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Actions from './src/components/items/ItemMaintenance.jsx';export const render=props=>renderToStaticMarkup(React.createElement(Actions,props));",resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'item-actions',setup(b){
  b.onResolve({filter:/^react$/},a=>/ItemMaintenance\.jsx$|ItemRemoval\.jsx$/.test(a.importer)?{path:a.importer.endsWith('ItemRemoval.jsx')?'removal':'maintenance',namespace:'hooks'}:undefined);
  b.onLoad({filter:/.*/,namespace:'hooks'},a=>({contents:'import React from '+JSON.stringify(require.resolve('react'))+';const key='+JSON.stringify(a.path)+';export default {...React,createElement:(tag,props,...children)=>{if(tag==="form")globalThis.__itemActions.form=props;return React.createElement(tag,props,...children);}};export const useState=v=>globalThis.__itemActions.state(key,v),useRef=v=>globalThis.__itemActions.ref(key,v),Suspense=React.Suspense;export const lazy=()=>props=>{globalThis.__itemActions.adjustment=props;return null;};',resolveDir:process.cwd()}));
  b.onResolve({filter:/^@\//},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));
 }}]});const m={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(require,m,m.exports);compiled=m.exports.render;return compiled;
}
const item={id:'milk',name:'Milk powder',inventory_type:'raw_material',is_active:true,unit_of_measure:'kg'};
const event={preventDefault(){}};
test('item editor opens a quantity adjustment for the selected item and retains role boundaries',async()=>{
 const rt=hookRuntime(),render=await renderer();rt.session={role:'admin'};globalThis.__itemActions=rt;
 const draw=(current=item)=>{rt.beforeRender();rt.adjustment=null;return render({item:current});};
 try{
  draw();assert.ok(rt.buttons.find(b=>b.label==='Delete item'));rt.buttons.find(b=>b.label==='Adjust quantity').onClick();draw();
  assert.equal(rt.adjustment.productId,'milk');assert.equal(rt.adjustment.open,true);
  rt.session={role:'warehouse_manager',allowedModules:['inventory']};draw();assert.ok(rt.buttons.find(b=>b.label==='Delete item'));assert.ok(!rt.buttons.find(b=>b.label==='Adjust quantity'));
  rt.session={role:'commercial',allowedModules:['inventory','inventory_adjustments']};assert.equal(draw(),'');
 }finally{rt.cleanup();delete globalThis.__itemActions;}
});
test('deletion keeps failed input and retry reference, blocks duplicate submissions and refreshes the catalogue only after success',async()=>{
 const rt=hookRuntime(),render=await renderer(),calls=[],done=[],busy=[];rt.session={role:'admin'};rt.invalidations=0;globalThis.__itemActions=rt;
 const originalFetch=globalThis.fetch;let fail=true,finish;
 globalThis.fetch=async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});if(fail)throw Error('Connection interrupted');return new Promise(resolve=>{finish=()=>resolve({ok:true,json:async()=>({item:{...item,is_active:false,item_removed_at:'2026-10-26'}})});});};
 const draw=()=>{rt.beforeRender();return render({item,onDone:value=>done.push(value),onBusyChange:value=>busy.push(value)});};
 const button=label=>rt.buttons.filter(b=>b.label===label).at(-1);
 try{
  draw();button('Delete item').onClick();let html=draw();assert.match(html,/retaining stock history/);assert.equal(button('Delete item').disabled,true);
  const reason=rt.controls.find(c=>c.tag==='textarea');assert.ok(reason);reason.onChange({target:{value:'Duplicate item created in error'}});draw();
  await rt.form.onSubmit(event);assert.match(draw(),/Connection interrupted/);assert.equal(rt.controls.find(c=>c.tag==='textarea').value,'Duplicate item created in error');
  assert.equal(done.length,0);fail=false;const submit=rt.form.onSubmit,waiting=submit(event);await submit(event);draw();
  assert.equal(calls.length,2);assert.equal(button('Cancel').disabled,true);rt.dialog.onOpenChange(false);assert.equal(rt.dialog.open,true);
  finish();await waiting;draw();assert.equal(done.length,1);assert.equal(rt.invalidations,1);assert.equal(calls[0].body.requestKey,calls[1].body.requestKey);assert.equal(calls[1].url,'/api/items/milk/lifecycle');assert.deepEqual(busy,[true,false,true,false]);
 }finally{rt.cleanup();globalThis.fetch=originalFetch;delete globalThis.__itemActions;}
});
test('deleted items expose Restore without quantity or activation actions and send their current revision',async()=>{
 const rt=hookRuntime(),render=await renderer(),calls=[];rt.session={role:'admin'};rt.invalidations=0;globalThis.__itemActions=rt;
 const originalFetch=globalThis.fetch;globalThis.fetch=async(url,options)=>{calls.push(JSON.parse(options.body));return {ok:true,json:async()=>({item:{...item,is_active:false,item_removed_at:null}})};};
 const deleted={...item,is_active:false,item_removed_at:'2026-10-26',item_lifecycle_revision:3},draw=()=>{rt.beforeRender();return render({item:deleted});};
 try{let html=draw();assert.match(html,/Restore item/);assert.ok(!rt.buttons.find(b=>b.label==='Adjust quantity'));rt.buttons.find(b=>b.label==='Restore item').onClick();draw();rt.controls.find(c=>c.tag==='textarea').onChange({target:{value:'Verified this item is still required'}});draw();await rt.form.onSubmit(event);assert.equal(calls[0].action,'restore');assert.equal(calls[0].revision,3);}finally{rt.cleanup();globalThis.fetch=originalFetch;delete globalThis.__itemActions;}
});
