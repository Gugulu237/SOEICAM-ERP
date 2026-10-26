import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url);
async function ui(){
  const output=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {SupplierReceiveForm,SupplierPaymentForm} from './src/components/suppliers/SupplierDialogs.jsx';export const render=(props,payment=false)=>renderToStaticMarkup(React.createElement(payment?SupplierPaymentForm:SupplierReceiveForm,props));`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',write:false,
    plugins:[{name:'supplier-ui',setup(b){
      b.onResolve({filter:/^react$/},args=>args.importer.endsWith('SupplierDialogs.jsx')?{path:'hooks',namespace:'fixture'}:undefined);
      b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`import React from ${JSON.stringify(require.resolve('react'))};export default {...React,createElement:(tag,props,...children)=>{globalThis.__supplierUI.capture(tag,props,children);return React.createElement(tag,props,...children);}};export const useState=v=>globalThis.__supplierUI.state('form',v);`,resolveDir:process.cwd()}));
      const mocks={
        '@/api/erpClient':`export const invalidateERPReads=()=>{};export const erp={functions:{invoke:(name,body)=>globalThis.__supplierUI.invoke(name,body)}};`,
        '@/components/ui/use-toast':`export const useToast=()=>({toast:v=>globalThis.__supplierUI.notifications.push(v)});`,
        '@/components/ui/dialog':`import React from 'react';export const Dialog=({children})=>React.createElement('div',null,children);export const DialogContent=Dialog,DialogHeader=Dialog,DialogTitle=Dialog,DialogFooter=Dialog;`,
        '@/components/ui/button':`import React from 'react';export function Button({children,...props}){globalThis.__supplierUI.capture('button',props,children);return React.createElement('button',props,children);}`,
        '@/components/ui/input':`import React from 'react';export function Input(props){globalThis.__supplierUI.inputs.push(props);return React.createElement('input',props);}`,
      };
      b.onResolve({filter:/^@\//},args=>Object.hasOwn(mocks,args.path)?{path:args.path,namespace:'leaf'}:undefined);
      b.onLoad({filter:/.*/,namespace:'leaf'},args=>({contents:mocks[args.path],resolveDir:process.cwd()}));
    }}]});
  const mod={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(require,mod,mod.exports);return mod.exports.render;
}
function runtime(){const r=hookRuntime(),before=r.beforeRender.bind(r);r.inputs=[];r.beforeRender=()=>{before();r.inputs=[];};return r;}
test('receiving form keeps a failed draft and retry key, then submits exact quantities and batch in place',async()=>{
  const render=await ui(),r=runtime(),calls=[];let fail=true,saved=0,closed=0;
  r.invoke=async(name,body)=>{calls.push(body);if(fail)throw Error('Connection interrupted');return {data:{receipt:{id:'receipt'}}};};globalThis.__supplierUI=r;
  const props={data:{products:[{id:'milk',name:'Milk',inventory_type:'raw_material'}],warehouses:[{id:'warehouse',name:'Materials',warehouse_type:'raw_material',is_active:true}],orderLines:[{id:'line',po_id:'po',product_id:'milk',product_name:'Milk',quantity:10,received_quantity:4,unit:'kg'}]},order:{id:'po',po_number:'PO-01',warehouse_id:'warehouse'},onClose:()=>closed++,onSaved:()=>saved++};
  try{
    r.beforeRender();let html=render(props);assert.match(html,/Remaining: 6 kg/);
    r.inputs.find(p=>p.placeholder===undefined&&p.type===undefined).onChange({target:{value:'MILK-01'}});
    r.beforeRender();render(props);await r.buttons.find(b=>b.label==='Confirm receipt').onClick();
    assert.equal(closed,0);assert.equal(saved,0);assert.match(r.notifications.at(-1).description,/Connection interrupted/);
    r.beforeRender();html=render(props);assert.match(html,/MILK-01/);fail=false;await r.buttons.find(b=>b.label==='Confirm receipt').onClick();
    assert.equal(calls[0].requestKey,calls[1].requestKey);assert.equal(calls[1].action,'receiveSupplierOrder');assert.equal(calls[1].lines[0].quantity,6);assert.equal(calls[1].lines[0].lot_number,'MILK-01');assert.equal(saved,1);assert.equal(closed,1);assert.equal(r.navigation.length,0);
  }finally{r.cleanup();delete globalThis.__supplierUI;}
});
test('bill payment form requires a treasury account and reference and requests approval without claiming cash release',async()=>{
  const render=await ui(),r=runtime();r.invoke=async()=>{throw Error('Should not run without required fields');};globalThis.__supplierUI=r;
  try{r.beforeRender();const html=render({data:{accounts:[{id:'till',name:'Cash till',balance:1000}]},bill:{id:'bill',bill_number:'BILL-01',balance:500},onClose:()=>{},onSaved:()=>{}},true);assert.match(html,/Cash and the bill balance change only on release/);assert.equal(r.buttons.find(b=>b.label==='Request payment approval').disabled,true);assert.match(html,/Cash till/);}finally{r.cleanup();delete globalThis.__supplierUI;}
});

test('finished goods receipt ignores the old materials destination and uses only an active Cold Room',async()=>{
  const render=await ui(),r=runtime(),calls=[];r.invoke=async(name,body)=>{calls.push(body);return {data:{receipt:{id:'receipt'}}};};globalThis.__supplierUI=r;
  const props={data:{products:[{id:'yola',name:'YOLA',inventory_type:'assembly'}],warehouses:[{id:'materials',name:'Materials store',warehouse_type:'raw_material',is_active:true},{id:'cold',name:'Cold Room',warehouse_type:'cold_room',is_active:true},{id:'closed',name:'Closed cold store',warehouse_type:'cold_room',is_active:false}],orderLines:[{id:'line',po_id:'po',product_id:'yola',product_name:'YOLA',quantity:10,received_quantity:0,unit:'ea'}]},order:{id:'po',po_number:'PO-02',warehouse_id:'materials'},onClose:()=>{},onSaved:()=>{}};
  try{
    r.beforeRender();const html=render(props);assert.match(html,/Cold Room/);assert.doesNotMatch(html,/>Materials store<|>Closed cold store</);assert.equal(r.buttons.find(b=>b.label==='Confirm receipt').disabled,false);
    await r.buttons.find(b=>b.label==='Confirm receipt').onClick();assert.equal(calls[0].warehouseId,'cold');
  }finally{r.cleanup();delete globalThis.__supplierUI;}
});

test('finished goods receiving stays disabled until an active Cold Room exists',async()=>{
  const render=await ui(),r=runtime();r.invoke=async()=>{assert.fail('No receipt should be posted');};globalThis.__supplierUI=r;
  try{
    r.beforeRender();render({data:{products:[{id:'yola',inventory_type:'assembly'}],warehouses:[{id:'materials',name:'Materials',warehouse_type:'raw_material'}],orderLines:[{id:'line',po_id:'po',product_id:'yola',product_name:'YOLA',quantity:1,unit:'ea'}]},order:{id:'po',warehouse_id:'materials'},onClose:()=>{},onSaved:()=>{}});
    assert.equal(r.buttons.find(b=>b.label==='Confirm receipt').disabled,true);
  }finally{r.cleanup();delete globalThis.__supplierUI;}
});
