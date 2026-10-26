import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { hookRuntime } from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url);
let compiled;
async function renderer(){
  if(compiled)return compiled;
  const output=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Dialog from './src/components/inventory/StockAdjustmentDialog.jsx';import Zones from './src/components/inventory/WarehouseZones.jsx';export const render=(kind,props)=>renderToStaticMarkup(React.createElement({dialog:Dialog,zones:Zones}[kind],props));`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,jsx:'automatic',platform:'node',format:'cjs',write:false,plugins:[{name:'adjustment-ui',setup(b){
    b.onResolve({filter:/^react\/jsx-runtime$/},a=>/(StockAdjustmentDialog|WarehouseZones|WarehouseStockItems)\.jsx$/.test(a.importer)?{path:'jsx',namespace:'capture-jsx'}:undefined);
    b.onLoad({filter:/.*/,namespace:'capture-jsx'},()=>({contents:`import {jsx as baseJsx,jsxs as baseJsxs,Fragment} from ${JSON.stringify(require.resolve('react/jsx-runtime'))};export {Fragment};export const jsx=(tag,props,key)=>{globalThis.__adjustmentUI.capture(tag,props,props?.children);return baseJsx(tag,props,key);};export const jsxs=(tag,props,key)=>{globalThis.__adjustmentUI.capture(tag,props,props?.children);return baseJsxs(tag,props,key);};`,resolveDir:process.cwd()}));
    b.onResolve({filter:/^react$/},a=>/(StockAdjustmentDialog|WarehouseZones|WarehouseStockItems)\.jsx$/.test(a.importer)?{path:a.importer,namespace:'hooks'}:undefined);
    b.onLoad({filter:/.*/,namespace:'hooks'},({path:key})=>({contents:`import React from ${JSON.stringify(require.resolve('react'))};const key=${JSON.stringify(key)};export default {...React,createElement:(tag,props,...children)=>{globalThis.__adjustmentUI.capture(tag,props,children);return React.createElement(tag,props,...children);}};export const useRef=value=>globalThis.__adjustmentUI.ref(key,value);export const useState=value=>globalThis.__adjustmentUI.state(key,value),useEffect=(fn,deps)=>globalThis.__adjustmentUI.effect(key,fn,deps),useMemo=fn=>fn();export const Fragment=React.Fragment,lazy=React.lazy,Suspense=React.Suspense;`,resolveDir:process.cwd()}));
    const mocks={
      '@/lib/field-ops':`export const invokeFieldOps=body=>globalThis.__adjustmentUI.invoke(body);`,
      '@/lib/navigation-context':`export const usePageState=(key,initial)=>globalThis.__adjustmentUI.state(key,initial);`,
      '@/components/ui/use-toast':`export const useToast=()=>({toast:value=>globalThis.__adjustmentUI.notifications.push(value)});`,
      '@/components/ui/input':`import React from 'react';export const Input=props=>{globalThis.__adjustmentUI.capture('input',props,[]);return React.createElement('input',props);};`,
      '@/components/ui/button':`import React from 'react';export const Button=({children,variant,size,...props})=>{globalThis.__adjustmentUI.capture('button',props,children);return React.createElement('button',props,children);};`,
      '@/components/ui/dialog':`import React from 'react';export const Dialog=({children})=>React.createElement('div',null,children);export const DialogContent=Dialog,DialogHeader=Dialog,DialogTitle=Dialog,DialogDescription=Dialog,DialogFooter=Dialog;`,
    };
    b.onResolve({filter:/^@\//},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'leaf'}:undefined);
    b.onLoad({filter:/.*/,namespace:'leaf'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));
  }}]});
  const mod={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(require,mod,mod.exports);compiled=mod.exports.render;return compiled;
}
function runtime(){const r=hookRuntime(),before=r.beforeRender.bind(r);r.elements=[];r.capture=(tag,props,children)=>r.elements.push({tag,props:props || {},children});r.beforeRender=()=>{before();r.elements=[];};return r;}
const warehouse={id:'raw',name:'Ingredients',warehouse_type:'raw_material',is_active:true};
const product={id:'milk',name:'Milk powder',sku:'MILK',inventory_type:'raw_material',unit_of_measure:'kg',current_cost:10,is_active:true};
const workspace={warehouse,warehouses:[warehouse],accounts:[{id:'variance',account_number:'6590',name:'Inventory adjustments'}],items:[{id:'milk',name:'Milk powder',unit:'kg',unit_cost:10}],rows:[{balance_id:'lot',product_id:'milk',product_name:'Milk powder',unit:'kg',lot_number:'MILK-01',book_quantity:10,book_value:100,unit_cost:10,qc_status:'quarantine',fingerprint:'server-snapshot'}]};
const postedReceipt=(body,journal_number)=>({id:'WA-1',reference:body.reference,date:body.date,journal_number,value_difference:-20,rows:body.rows.map(row=>({...workspace.rows[0],...row,difference:Number(row.counted_quantity)-10,value_after:Number(row.counted_quantity)*10,value_difference:(Number(row.counted_quantity)-10)*10}))});
const element=(r,tag,label)=>r.elements.find(e=>e.tag===tag && e.props['aria-label']===label)?.props;
const button=(r,text)=>r.elements.find(e=>e.tag==='button' && JSON.stringify(e.children).includes(text))?.props;

test('warehouse count shows old/new quantity and value change, preserves a failed draft, then retries the same checked save',async()=>{
  const render=await renderer(),r=runtime(),calls=[];globalThis.__adjustmentUI=r;let fail=true,saved=0,closed=false;
  r.invoke=async body=>{calls.push(body);if(body.action==='warehouseAdjustmentWorkspace')return {data:workspace};if(fail)throw Error('Connection interrupted');return {data:postedReceipt(body,'JV-001')};};
  const draw=()=>{r.beforeRender();return render('dialog',{open:true,warehouseId:'raw',onOpenChange:value=>closed=!value,onSaved:()=>saved++});};
  try{draw();await r.flush();let html=draw();assert.match(html,/Adjust warehouse quantity/);assert.match(html,/Milk powder/);assert.match(html,/MILK-01/);assert.equal(button(r,'Save quantity adjustment').disabled,true);
    element(r,'input','Physical quantity for Milk powder').onChange({target:{value:'8'}});element(r,'input','Count sheet / reference').onChange({target:{value:'COUNT-012'}});element(r,'input','Adjustment reason').onChange({target:{value:'Signed physical count verified'}});element(r,'select','Adjustment account').onChange({target:{value:'variance'}});
    html=draw();assert.match(html,/-2/);assert.match(html,/-20/);assert.equal(button(r,'Save quantity adjustment').disabled,false);
    await button(r,'Save quantity adjustment').onClick();assert.match(draw(),/Connection interrupted/);assert.equal(element(r,'input','Physical quantity for Milk powder').value,'8');assert.equal(saved,0);assert.equal(closed,false);
    fail=false;await button(r,'Save quantity adjustment').onClick();assert.equal(saved,1);assert.equal(closed,false);assert.match(draw(),/Save or print the posted receipt/);assert.ok(button(r,'Print / save PDF'));button(r,'Done').onClick();assert.equal(closed,true);const writes=calls.filter(c=>c.action==='postWarehouseAdjustment');assert.equal(writes[0].requestKey,writes[1].requestKey);assert.equal(writes[1].warehouseId,'raw');assert.equal(writes[1].rows[0].fingerprint,'server-snapshot');assert.equal(writes[1].rows[0].counted_quantity,8);
  }finally{r.cleanup();delete globalThis.__adjustmentUI;}
});

test('a zero-stock catalogue item can be counted as a new lot, with explicit batch details and a quality-hold explanation',async()=>{
  const render=await renderer(),r=runtime();globalThis.__adjustmentUI=r;r.invoke=async()=>({data:{...workspace,rows:[]}});
  const draw=()=>{r.beforeRender();return render('dialog',{open:true,warehouseId:'raw',productId:'milk',onOpenChange:()=>{}});};
  try{draw();await r.flush();const html=draw();assert.ok(element(r,'input','Lot number for Milk powder'));assert.ok(element(r,'input','Printed expiry for Milk powder'));assert.match(html,/Newly counted lots remain on quality hold/);assert.equal(element(r,'input','Physical quantity for Milk powder').value,'');}finally{r.cleanup();delete globalThis.__adjustmentUI;}
});

test('large warehouse counts paginate and retain counted quantities across pages and searches',async()=>{
  const render=await renderer(),r=runtime(),calls=[];globalThis.__adjustmentUI=r;
  r.invoke=async body=>{calls.push(body);return {data:body.action==='warehouseAdjustmentWorkspace'?{...workspace,rows:Array.from({length:60},(_,i)=>({...workspace.rows[0],balance_id:'lot-'+i,product_name:'Milk powder '+i,lot_number:'LOT-'+i,fingerprint:'snapshot-'+i}))}:postedReceipt(body,'JV-002')};};
  const draw=()=>{r.beforeRender();return render('dialog',{open:true,warehouseId:'raw',onOpenChange:()=>{}});};
  try{draw();await r.flush();draw();assert.equal(r.elements.filter(e=>e.tag==='input' && e.props.type==='number').length,25);
    element(r,'input','Physical quantity for Milk powder 0').onChange({target:{value:'8'}});button(r,'Next').onClick();draw();element(r,'input','Physical quantity for Milk powder 25').onChange({target:{value:'9'}});
    element(r,'input','Search count items or lots').onChange({target:{value:'LOT-45'}});draw();assert.ok(element(r,'input','Physical quantity for Milk powder 45'));element(r,'input','Physical quantity for Milk powder 45').onChange({target:{value:'11'}});
    element(r,'input','Count sheet / reference').onChange({target:{value:'COUNT-ALL'}});element(r,'input','Adjustment reason').onChange({target:{value:'Signed warehouse count verified'}});element(r,'select','Adjustment account').onChange({target:{value:'variance'}});draw();await button(r,'Save quantity adjustment').onClick();
    const saved=calls.find(c=>c.action==='postWarehouseAdjustment');assert.deepEqual(saved.rows.map(row=>row.balance_id),['lot-0','lot-25','lot-45']);
  }finally{r.cleanup();delete globalThis.__adjustmentUI;}
});

test('warehouse and item actions carry the selected location; managed vehicle locations and read-only views have no count action',async()=>{
  const render=await renderer(),r=runtime(),calls=[];globalThis.__adjustmentUI=r;
  const props={warehouses:[warehouse],products:[product],balances:[],vehicles:[],selectedId:'raw',onSelect:()=>{},onAdjust:(...values)=>calls.push(values)};
  const draw=extra=>{r.beforeRender();return render('zones',{...props,...extra});};
  try{let html=draw();assert.match(html,/Adjust quantity/);button(r,'Adjust quantity').onClick();element(r,'button','Adjust quantity for Milk powder').onClick();assert.equal(calls[0][0].id,'raw');assert.equal(calls[1][1].id,'milk');
    html=draw({onAdjust:undefined});assert.doesNotMatch(html,/Adjust quantity/);
    html=draw({warehouses:[{...warehouse,warehouse_type:'vehicle'}]});assert.doesNotMatch(html,/Adjust quantity/);
  }finally{r.cleanup();delete globalThis.__adjustmentUI;}
});

test('authorized accounting correction accepts an explicit zero count, previews the residual write-off and sends confirmation',async()=>{
 const render=await renderer(),r=runtime(),calls=[];globalThis.__adjustmentUI=r;
 r.invoke=async body=>{calls.push(body);return {data:body.action==='warehouseAdjustmentWorkspace'?{...workspace,can_reconcile_value:true,rows:[{...workspace.rows[0],book_quantity:0,book_value:25,requires_reconciliation:true}]}:postedReceipt(body,'JV-CORRECTION')};};
 const draw=()=>{r.beforeRender();return render('dialog',{open:true,warehouseId:'raw',onOpenChange(){}});};
 try{draw();await r.flush();assert.match(draw(),/accounting correction/);element(r,'input','Physical quantity for Milk powder').onChange({target:{value:'0'}});element(r,'input','Count sheet / reference').onChange({target:{value:'COUNT-VAL'}});element(r,'input','Adjustment reason').onChange({target:{value:'Verified empty lot and residual carrying value'}});element(r,'select','Adjustment account').onChange({target:{value:'variance'}});draw();assert.equal(button(r,'Save quantity adjustment').disabled,true);
 element(r,'input','Confirm valuation correction for Milk powder').onChange({target:{checked:true}});assert.match(draw(),/-25/);assert.equal(button(r,'Save quantity adjustment').disabled,false);await button(r,'Save quantity adjustment').onClick();const saved=calls.find(c=>c.action==='postWarehouseAdjustment');assert.equal(saved.rows[0].counted_quantity,0);assert.equal(saved.rows[0].confirm_reconciliation,true);
 }finally{r.cleanup();delete globalThis.__adjustmentUI;}
});
test('a blocked valuation lot remains visible with a specific reason while other warehouse quantities are editable',async()=>{
 const render=await renderer(),r=runtime();globalThis.__adjustmentUI=r;r.invoke=async()=>({data:{...workspace,can_reconcile_value:false,rows:[{...workspace.rows[0],book_quantity:0,book_value:25,requires_reconciliation:true},{...workspace.rows[0],balance_id:'good',product_name:'Other material'}]}});
 const draw=()=>{r.beforeRender();return render('dialog',{open:true,warehouseId:'raw',onOpenChange(){}});};
 try{draw();await r.flush();assert.match(draw(),/Ask Accounting or the General Manager/);assert.equal(element(r,'input','Physical quantity for Milk powder').disabled,true);assert.equal(!!element(r,'input','Physical quantity for Other material').disabled,false);}
 finally{r.cleanup();delete globalThis.__adjustmentUI;}
});

test('rapid repeated quantity submission writes once and reports busy state until the posted receipt returns',async()=>{
 const render=await renderer(),r=runtime(),busy=[];globalThis.__adjustmentUI=r;let finish,writes=0;
 r.invoke=async body=>body.action==='warehouseAdjustmentWorkspace'?{data:workspace}:new Promise(resolve=>{writes++;finish=()=>resolve({data:postedReceipt(body,'JV-DOUBLE')});});
 const draw=()=>{r.beforeRender();return render('dialog',{open:true,warehouseId:'raw',onOpenChange:()=>{},onBusyChange:v=>busy.push(v)});};
 try{
  draw();await r.flush();draw();
  element(r,'input','Physical quantity for Milk powder').onChange({target:{value:'8'}});
  element(r,'input','Count sheet / reference').onChange({target:{value:'COUNT-DOUBLE'}});
  element(r,'input','Adjustment reason').onChange({target:{value:'Verified physical stock'}});draw();
  const save=button(r,'Save quantity adjustment'),waiting=save.onClick();await save.onClick();assert.equal(writes,1);draw();assert.equal(button(r,'Cancel').disabled,true);
  finish();await waiting;assert.match(draw(),/Save or print the posted receipt/);assert.deepEqual(busy,[true,false]);
 }finally{r.cleanup();delete globalThis.__adjustmentUI;}
});
