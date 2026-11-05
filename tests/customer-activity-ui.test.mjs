import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url);
const out=await build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Collection from './src/components/customers/CustomerCollectionDialog.jsx';import Spoilage from './src/components/customers/SpoilageDialog.jsx';export const render=(mode,props)=>renderToStaticMarkup(React.createElement(mode==='collection'?Collection:Spoilage,props));",loader:'jsx',resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'customer-activity-ui',setup(b){
  b.onResolve({filter:/^react$/},a=>/(CustomerCollectionDialog|SpoilageDialog)\.jsx$/.test(a.importer)?{path:a.importer.split(/[\\/]/).at(-1),namespace:'hooks'}:undefined);
  b.onLoad({filter:/.*/,namespace:'hooks'},({path:key})=>({resolveDir:process.cwd(),contents:"import React from "+JSON.stringify(require.resolve('react'))+";export default {...React,createElement:(tag,props,...children)=>{globalThis.__activityUI.capture(tag,props,children);if(tag==='textarea')globalThis.__activityUI.controls.push(props);return React.createElement(tag,props,...children);}};export const useState=v=>globalThis.__activityUI.state("+JSON.stringify(key)+",v),useRef=v=>globalThis.__activityUI.ref("+JSON.stringify(key)+",v),useEffect=(fn,deps)=>globalThis.__activityUI.effect("+JSON.stringify(key)+",fn,deps);"}));
  const mocks={
    '@/lib/localization':"export const useLocaleRender=()=>{};",
    '@/lib/field-ops':"export const invokeFieldOps=async body=>({data:await globalThis.__activityUI.request(body)}),errorMessage=e=>e.message;",
    '@/components/ui/input':"import React from 'react';export const Input=props=>{globalThis.__activityUI.capture('input',props,[]);return React.createElement('input',props);};",
    '@/components/ui/button':"import React from 'react';export const Button=({children,...props})=>{globalThis.__activityUI.capture('button',props,children);return React.createElement('button',props,children);};",
    '@/components/ui/dialog':"import React from 'react';export const Dialog=({children,onOpenChange})=>{globalThis.__activityUI.dismiss=onOpenChange;return React.createElement('div',null,children);};export const DialogContent=({children})=>React.createElement('div',null,children),DialogHeader=DialogContent,DialogTitle=DialogContent,DialogDescription=DialogContent;",
    '@/components/sales/SaleProductPicker':"export default props=>{globalThis.__activityUI.picker=props;return null;};"
  };
  b.onResolve({filter:/.*/},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'leaf'}:undefined);
  b.onLoad({filter:/.*/,namespace:'leaf'},a=>({resolveDir:process.cwd(),contents:mocks[a.path]}));
}}]});
const mod={exports:{}};new Function('require','module','exports',out.outputFiles[0].text)(require,mod,mod.exports);
const customer={id:'branch',business_name:'Branch A'};
test('collecting cash displays the authenticated collector, submits only invoice allocations and prevents double clicks',async()=>{
  const s=hookRuntime();globalThis.__activityUI=s;const calls=[],done=[];let fail=true;
  s.request=async body=>{calls.push(body);if(body.action==='customerCollectionWorkspace')return {collector:{name:'Signed-in staff'},date:'2026-11-01',cash_to_deposit:250,pending:[],invoices:[{id:'inv',invoice_number:'INV-1',available_amount:1000}]};if(fail)throw Error('Connection interrupted');return {payment:{id:'saved'}};};
  const draw=()=>{s.beforeRender();return mod.exports.render('collection',{customer,onClose:()=>{},onDone:r=>done.push(r)});};
  try{
    draw();await s.flush();assert.match(draw(),/Signed-in staff/);assert.equal(s.controls.some(c=>c.tag==='select'),false);
    s.controls.find(c=>c.type==='checkbox').onChange();draw();s.controls.find(c=>c['aria-label']==='Cash received (XAF)').onChange({target:{value:'400'}});s.controls.find(c=>c['aria-label']==='Customer receipt reference').onChange({target:{value:'REC-01'}});draw();
    await s.buttons.find(b=>b.label==='Record cash collected').onClick();assert.match(draw(),/Connection interrupted/);
    assert.equal(s.controls.find(c=>c['aria-label']==='Cash received (XAF)').value,'400');
    fail=false;const save=s.buttons.find(b=>b.label==='Record cash collected');await Promise.all([save.onClick(),save.onClick()]);
    const writes=calls.filter(c=>c.action==='recordCustomerCollection');assert.equal(writes.length,2);assert.equal(writes[0].requestKey,writes[1].requestKey);
    assert.equal(writes[1].customerId,'branch');assert.deepEqual(writes[1].allocations,[{invoice_id:'inv',amount:400}]);assert.equal(writes[1].collectorId,undefined);assert.equal(done.length,1);
  }finally{s.cleanup();delete globalThis.__activityUI;}
});
test('spoilage entry works without legacy delivery points and keeps product quantities and reporting notes after errors',async()=>{
  const s=hookRuntime();globalThis.__activityUI=s;const calls=[],done=[];let fail=true;
  s.request=async body=>{calls.push(body);if(body.action==='customerSpoilageWorkspace')return {date:'2026-11-01',reporter:{name:'Signed-in staff'},products:[{id:'cup',name:'Vanilla cup'}],locations:[]};if(fail)throw Error('Please retry');return {recorded:1};};
  const draw=()=>{s.beforeRender();return mod.exports.render('spoilage',{open:true,customer,onOpenChange:()=>{},onSaved:r=>done.push(r)});};
  try{
    draw();await s.flush();assert.match(draw(),/Signed-in staff/);s.buttons.find(b=>b.label==='Choose products').onClick();draw();
    assert.equal(s.picker.purpose,'spoilage');s.picker.onQuantityChange({id:'cup'},'7');s.picker.onOpenChange(false);draw();
    s.controls.find(c=>c['aria-label']==='What happened / action needed').onChange({target:{value:'Shorten supply interval; inspect storage temperature.'}});draw();
    await s.buttons.find(b=>b.label==='Submit spoilage report').onClick();assert.match(draw(),/Please retry/);assert.match(draw(),/Vanilla cup/);
    fail=false;const save=s.buttons.find(b=>b.label==='Submit spoilage report');await Promise.all([save.onClick(),save.onClick()]);
    const writes=calls.filter(c=>c.action==='reportCustomerSpoilage');assert.equal(writes.length,2);assert.equal(writes[0].requestKey,writes[1].requestKey);assert.equal(writes[1].customerId,'branch');assert.equal(writes[1].locationId,'');assert.deepEqual(writes[1].lines,[{product_id:'cup',quantity:7}]);assert.equal(writes[1].recorded_by,undefined);assert.equal(done.length,1);
  }finally{s.cleanup();delete globalThis.__activityUI;}
});


test('collection opened from an invoice preselects that invoice and its available balance',async()=>{
 const s=hookRuntime();globalThis.__activityUI=s;s.request=async()=>({collector:{name:'General Manager'},date:'2026-11-05',cash_to_deposit:0,pending:[],invoices:[{id:'other',invoice_number:'INV-OTHER',available_amount:100},{id:'selected',invoice_number:'INV-SELECTED',available_amount:400}]});
 const draw=()=>{s.beforeRender();return mod.exports.render('collection',{customer,invoiceId:'selected',onClose:()=>{},onDone:()=>{}});};
 try{draw();await s.flush();draw();assert.equal(s.controls.find(c=>c['aria-label']==='Cash received (XAF)').value,'400');assert.deepEqual(s.controls.filter(c=>c.type==='checkbox').map(c=>c.checked),[false,true]);}finally{s.cleanup();delete globalThis.__activityUI;}
});
