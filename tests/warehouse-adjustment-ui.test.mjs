import test from 'node:test';
// Legacy detailed corrections and the default item-count workflow share checked posting.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { hookRuntime } from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url);
let compiled;
async function renderer(){
  if(compiled)return compiled;
  const output=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import History from './src/components/inventory/AdjustmentHistory.jsx';import Correction from './src/components/inventory/ExistingStockCorrection.jsx';import Simple from './src/components/inventory/StockAdjustmentDialog.jsx';import Dialog from './src/components/inventory/DetailedStockAdjustmentDialog.jsx';import Zones from './src/components/inventory/WarehouseZones.jsx';export const render=(kind,props)=>renderToStaticMarkup(React.createElement({simple:Simple,dialog:Dialog,zones:Zones,correction:Correction,history:History}[kind],props));`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,jsx:'automatic',platform:'node',format:'cjs',write:false,plugins:[{name:'adjustment-ui',setup(b){
    b.onResolve({filter:/^react\/jsx-runtime$/},a=>/(AdjustmentHistory|ExistingStockCorrection|StockAdjustmentDialog|WarehouseZones|WarehouseStockItems|InventoryAdjustmentTreatment)\.jsx$/.test(a.importer)?{path:'jsx',namespace:'capture-jsx'}:undefined);
    b.onLoad({filter:/.*/,namespace:'capture-jsx'},()=>({contents:`import {jsx as baseJsx,jsxs as baseJsxs,Fragment} from ${JSON.stringify(require.resolve('react/jsx-runtime'))};export {Fragment};export const jsx=(tag,props,key)=>{globalThis.__adjustmentUI.capture(tag,props,props?.children);return baseJsx(tag,props,key);};export const jsxs=(tag,props,key)=>{globalThis.__adjustmentUI.capture(tag,props,props?.children);return baseJsxs(tag,props,key);};`,resolveDir:process.cwd()}));
    b.onResolve({filter:/^react$/},a=>/(AdjustmentHistory|ExistingStockCorrection|StockAdjustmentDialog|WarehouseZones|WarehouseStockItems|InventoryAdjustmentTreatment)\.jsx$/.test(a.importer)?{path:a.importer,namespace:'hooks'}:undefined);
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
const workspace={warehouse,warehouses:[warehouse],accounts:[{id:'variance',account_number:'6590',name:'Inventory adjustments'}],gain_accounts:[{id:'surplus',account_number:'7580',name:'Stock surplus'}],correction_accounts:[{id:'opening-equity',account_number:'3990',name:'Opening stock equity',account_type:'equity',normal_balance:'credit',is_active:true,is_posting:true}],items:[{id:'milk',name:'Milk powder',unit:'kg',unit_cost:10}],rows:[{balance_id:'lot',warehouse_id:'raw',product_id:'milk',product_name:'Milk powder',unit:'kg',lot_number:'MILK-01',book_quantity:10,book_value:100,unit_cost:10,qc_status:'quarantine',fingerprint:'server-snapshot'}]};
const postedReceipt=(body,journal_number)=>({id:'WA-1',reference:body.reference,date:body.date,journal_number,value_difference:-20,rows:body.rows.map(row=>({...workspace.rows[0],...row,difference:Number(row.counted_quantity)-10,value_after:Number(row.counted_quantity)*10,value_difference:(Number(row.counted_quantity)-10)*10}))});
const element=(r,tag,label)=>r.elements.find(e=>e.tag===tag && e.props['aria-label']===label)?.props;
const button=(r,text)=>r.elements.find(e=>e.tag==='button' && JSON.stringify(e.children).includes(text))?.props;
function chooseOperating(r,draw){const purpose=element(r,'select','Accounting purpose');assert.ok(purpose,'the user must explicitly choose the accounting purpose');purpose.onChange({target:{value:'operating'}});return draw();}
function operatingLossAccount(r,draw){chooseOperating(r,draw);return element(r,'select','Adjustment account');}
function reviewOperating(r,draw){button(r,'Review adjustment').onClick();draw();return chooseOperating(r,draw);}
test('adjustment history opens an immutable receipt, pages results and offers a new physical count',async()=>{
 const render=await renderer(),r=runtime(),calls=[];globalThis.__adjustmentUI=r;let counts=0;
 r.invoke=async body=>{calls.push(body);return {data:body.adjustmentId?{adjustment:{...postedReceipt({reference:'COUNT-SIGNED',date:'2026-11-01',rows:[{balance_id:'lot',counted_quantity:8}]},'JV-0001'),warehouse_name:'Ingredients'},recorded_by:'Warehouse manager',reason:'Signed physical inventory count'}:{adjustments:body.page===1?[{id:'WA-test',date:'2026-11-01',reference:'COUNT-SIGNED',warehouse_name:'Ingredients',line_count:1,value_difference:-20,journal_number:'JV-0001',recorded_by:'Warehouse manager'}]:[],page:body.page,total:21,has_more:body.page===1}};};
 const draw=()=>{r.beforeRender();return render('history',{onAdjust:()=>counts++});};
 try{
  draw();await r.flush();let html=draw();assert.match(html,/COUNT-SIGNED/);assert.match(html,/Warehouse manager/);assert.match(html,/JV-0001/);
  button(r,'Record physical count').onClick();assert.equal(counts,1);
  button(r,'COUNT-SIGNED').onClick();draw();await r.flush();html=draw();assert.match(html,/Posted stock adjustment/);assert.match(html,/Signed physical inventory count/);assert.match(html,/Before count/);assert.ok(button(r,'Print / save PDF'));
  button(r,'Next').onClick();draw();await r.flush();draw();assert.equal(calls.at(-1).page,2);assert.equal(button(r,'Next').disabled,true);assert.ok(calls.every(c=>c.action==='warehouseAdjustmentHistory'));
 }finally{r.cleanup();delete globalThis.__adjustmentUI;}
});

test('warehouse count shows old/new quantity and value change, preserves a failed draft, then retries the same checked save',async()=>{
  const render=await renderer(),r=runtime(),calls=[];globalThis.__adjustmentUI=r;let fail=true,saved=0,closed=false;
  r.invoke=async body=>{calls.push(body);if(body.action==='warehouseAdjustmentWorkspace')return {data:workspace};if(fail)throw Error('Connection interrupted');return {data:postedReceipt(body,'JV-001')};};
  const draw=()=>{r.beforeRender();return render('dialog',{open:true,warehouseId:'raw',onOpenChange:value=>closed=!value,onSaved:()=>saved++});};
  try{draw();await r.flush();let html=draw();assert.match(html,/Adjust warehouse quantity/);assert.match(html,/Milk powder/);assert.match(html,/MILK-01/);assert.equal(button(r,'Save quantity adjustment').disabled,true);
    element(r,'input','Physical quantity for Milk powder').onChange({target:{value:'8'}});element(r,'input','Count sheet / reference').onChange({target:{value:'COUNT-012'}});element(r,'input','Adjustment reason').onChange({target:{value:'Signed physical count verified'}});operatingLossAccount(r,draw).onChange({target:{value:'variance'}});
    html=draw();assert.match(html,/-2/);assert.match(html,/-20/);assert.equal(button(r,'Save quantity adjustment').disabled,false);
    await button(r,'Save quantity adjustment').onClick();assert.match(draw(),/Connection interrupted/);assert.equal(element(r,'input','Physical quantity for Milk powder').value,'8');assert.equal(saved,0);assert.equal(closed,false);
    fail=false;await button(r,'Save quantity adjustment').onClick();assert.equal(saved,1);assert.equal(closed,false);assert.match(draw(),/Save or print the posted receipt/);assert.ok(button(r,'Print / save PDF'));button(r,'Done').onClick();assert.equal(closed,true);const writes=calls.filter(c=>c.action==='postWarehouseAdjustment');assert.equal(writes[0].requestKey,writes[1].requestKey);assert.equal(writes[1].warehouseId,'raw');assert.equal(writes[1].rows[0].fingerprint,'server-snapshot');assert.equal(writes[1].rows[0].counted_quantity,8);
  }finally{r.cleanup();delete globalThis.__adjustmentUI;}
});

test('a zero-stock catalogue item can be counted as a new lot, with explicit batch details and a quality-hold explanation',async()=>{
  const render=await renderer(),r=runtime();globalThis.__adjustmentUI=r;r.invoke=async()=>({data:{...workspace,rows:[]}});
  const draw=()=>{r.beforeRender();return render('dialog',{open:true,warehouseId:'raw',productId:'milk',onOpenChange:()=>{}});};
  try{draw();await r.flush();const html=draw();assert.ok(element(r,'input','Lot number for Milk powder'));assert.ok(element(r,'input','Printed expiry for Milk powder'));assert.match(html,/does not remove expiry dates or automatically release/);assert.equal(element(r,'input','Physical quantity for Milk powder').value,'');}finally{r.cleanup();delete globalThis.__adjustmentUI;}
});

test('large warehouse counts paginate and retain counted quantities across pages and searches',async()=>{
  const render=await renderer(),r=runtime(),calls=[];globalThis.__adjustmentUI=r;
  r.invoke=async body=>{calls.push(body);return {data:body.action==='warehouseAdjustmentWorkspace'?{...workspace,rows:Array.from({length:60},(_,i)=>({...workspace.rows[0],balance_id:'lot-'+i,product_id:'item-'+i,product_name:'Milk powder '+i,lot_number:'LOT-'+i,fingerprint:'snapshot-'+i}))}:postedReceipt(body,'JV-002')};};
  const draw=()=>{r.beforeRender();return render('dialog',{open:true,warehouseId:'raw',onOpenChange:()=>{}});};
  try{draw();await r.flush();draw();assert.equal(r.elements.filter(e=>e.tag==='input' && e.props.type==='number').length,25);
    element(r,'input','Physical quantity for Milk powder 0').onChange({target:{value:'8'}});button(r,'Next').onClick();draw();element(r,'input','Physical quantity for Milk powder 25').onChange({target:{value:'9'}});
    element(r,'input','Search count items or lots').onChange({target:{value:'LOT-45'}});draw();assert.ok(element(r,'input','Physical quantity for Milk powder 45'));element(r,'input','Physical quantity for Milk powder 45').onChange({target:{value:'11'}});
    element(r,'input','Count sheet / reference').onChange({target:{value:'COUNT-ALL'}});element(r,'input','Adjustment reason').onChange({target:{value:'Signed warehouse count verified'}});operatingLossAccount(r,draw).onChange({target:{value:'variance'}});draw();element(r,'select','Inventory surplus account').onChange({target:{value:'surplus'}});draw();await button(r,'Save quantity adjustment').onClick();
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
 try{draw();await r.flush();assert.match(draw(),/accounting correction/);element(r,'input','Physical quantity for Milk powder').onChange({target:{value:'0'}});element(r,'input','Count sheet / reference').onChange({target:{value:'COUNT-VAL'}});element(r,'input','Adjustment reason').onChange({target:{value:'Verified empty lot and residual carrying value'}});chooseOperating(r,draw);assert.equal(button(r,'Save quantity adjustment').disabled,true);
 element(r,'input','Confirm valuation correction for Milk powder').onChange({target:{checked:true}});assert.match(draw(),/-25/);element(r,'select','Adjustment account').onChange({target:{value:'variance'}});draw();assert.equal(button(r,'Save quantity adjustment').disabled,false);await button(r,'Save quantity adjustment').onClick();const saved=calls.find(c=>c.action==='postWarehouseAdjustment');assert.equal(saved.rows[0].counted_quantity,0);assert.equal(saved.rows[0].confirm_reconciliation,true);
 }finally{r.cleanup();delete globalThis.__adjustmentUI;}
});
test('a blocked valuation lot remains visible with a specific reason while other warehouse quantities are editable',async()=>{
 const render=await renderer(),r=runtime();globalThis.__adjustmentUI=r;r.invoke=async()=>({data:{...workspace,can_reconcile_value:false,rows:[{...workspace.rows[0],book_quantity:0,book_value:25,requires_reconciliation:true},{...workspace.rows[0],balance_id:'good',product_id:'other',product_name:'Other material'}]}});
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
  element(r,'input','Adjustment reason').onChange({target:{value:'Verified physical stock'}});chooseOperating(r,draw);
  const save=button(r,'Save quantity adjustment'),waiting=save.onClick();await save.onClick();assert.equal(writes,1);draw();assert.equal(button(r,'Cancel').disabled,true);
  finish();await waiting;assert.match(draw(),/Save or print the posted receipt/);assert.deepEqual(busy,[true,false]);
 }finally{r.cleanup();delete globalThis.__adjustmentUI;}
});


test('ready-for-sale release submits the existing count without inventing another quantity adjustment',async()=>{
 const render=await renderer(),r=runtime(),calls=[];globalThis.__adjustmentUI=r;
 const readyWorkspace={...workspace,rows:[{...workspace.rows[0],product_name:'YOLA',inventory_type:'assembly',requires_expiry:true,adjusted_stock:true,production_order_id:'',expiry_date:'2099-01-01'}]};
 r.invoke=async body=>{calls.push(body);return {data:body.action==='warehouseAdjustmentWorkspace'?readyWorkspace:postedReceipt(body,'')};};
 const draw=()=>{r.beforeRender();return render('dialog',{open:true,warehouseId:'raw',onOpenChange:()=>{}});};
 try{draw();await r.flush();draw();assert.equal(element(r,'input','Physical quantity for YOLA').value,'');element(r,'input','Ready for sale: YOLA').onChange({target:{checked:true}});element(r,'input','Count sheet / reference').onChange({target:{value:'CHECKED'}});element(r,'input','Adjustment reason').onChange({target:{value:'Printed expiry and quality physically verified'}});chooseOperating(r,draw);assert.equal(button(r,'Save quantity adjustment').disabled,false);await button(r,'Save quantity adjustment').onClick();const body=calls.find(c=>c.action==='postWarehouseAdjustment');assert.equal(body.rows[0].counted_quantity,10);assert.equal(body.rows[0].ready_for_sale,true);assert.equal(body.rows[0].fingerprint,'server-snapshot');}finally{r.cleanup();delete globalThis.__adjustmentUI;}
});


test('expiry-tracked ingredients show production-use controls and never sale controls',async()=>{
 const render=await renderer(),r=runtime(),calls=[];globalThis.__adjustmentUI=r;
 const materials={...workspace,items:[{...workspace.items[0],inventory_type:'raw_material',requires_expiry:true}],rows:[{...workspace.rows[0],inventory_type:'raw_material',requires_expiry:true,adjusted_stock:true,expiry_date:'2099-01-01',production_order_id:''}]};
 r.invoke=async body=>{calls.push(body);return {data:body.action==='warehouseAdjustmentWorkspace'?materials:postedReceipt(body,'')};};
 const draw=()=>{r.beforeRender();return render('dialog',{open:true,warehouseId:'raw',onOpenChange:()=>{}});};
 try{draw();await r.flush();const html=draw();assert.doesNotMatch(html,/Ready for sale/);assert.ok(element(r,'input','Ready for production use: Milk powder'));element(r,'input','Ready for production use: Milk powder').onChange({target:{checked:true}});element(r,'input','Count sheet / reference').onChange({target:{value:'USE-CHECK'}});element(r,'input','Adjustment reason').onChange({target:{value:'Materials physically checked for production'}});chooseOperating(r,draw);await button(r,'Save quantity adjustment').onClick();const row=calls.find(c=>c.action==='postWarehouseAdjustment').rows[0];assert.equal(row.ready_for_use,true);assert.equal(Object.hasOwn(row,'ready_for_sale'),false);assert.equal(row.counted_quantity,10);}finally{r.cleanup();delete globalThis.__adjustmentUI;}
});

test('packaging counts do not present finished-product sale instructions',async()=>{
 const render=await renderer(),r=runtime();globalThis.__adjustmentUI=r;r.invoke=async()=>({data:{...workspace,rows:[{...workspace.rows[0],inventory_type:'packaging',adjusted_stock:true,product_name:'YOLA cups',production_order_id:''}],items:[{...workspace.items[0],inventory_type:'packaging'}]}});
 const draw=()=>{r.beforeRender();return render('dialog',{open:true,warehouseId:'raw',onOpenChange:()=>{}});};
 try{draw();await r.flush();const html=draw();assert.doesNotMatch(html,/Ready for sale/);assert.match(html,/Ingredients and packaging are for production use/);assert.ok(element(r,'input','Ready for production use: YOLA cups'));}finally{r.cleanup();delete globalThis.__adjustmentUI;}
});


test('expired adjusted stock has no bulk expiry removal or quality release checkbox',async()=>{
 const render=await renderer(),r=runtime();globalThis.__adjustmentUI=r;
 r.invoke=async()=>({data:{...workspace,rows:[{...workspace.rows[0],inventory_type:'assembly',adjusted_stock:true,expiry_date:'2020-01-01',qc_status:'quarantine'}]}});
 const draw=()=>{r.beforeRender();return render('dialog',{open:true,warehouseId:'raw',onOpenChange:()=>{}});};
 try{draw();await r.flush();const html=draw();assert.equal(button(r,'Select adjusted stock to release without expiry'),undefined);assert.equal(element(r,'input','Ready for sale: Milk powder'),undefined);assert.match(html,/2020-01-01/);assert.equal(button(r,'Save quantity adjustment').disabled,true);}finally{r.cleanup();delete globalThis.__adjustmentUI;}
});


test('existing stock correction keeps rejected lots unselected and requires explicit confirmation before saving',async()=>{
 const render=await renderer(),r=runtime(),calls=[];globalThis.__adjustmentUI=r;
 r.invoke=async body=>{calls.push(body);return {data:body.action==='existingStockWorkspace'?{can_correct_existing:true,can_correct_rejected:true,lots:[{id:'old-stock',product_name:'YOLA',lot_number:'OLD-1',quantity:5,total_value:50,qc_status:'rejected',expiry_date:'2020-01-01',fingerprint:'checked'}]}:{corrected:1}};};
 const draw=()=>{r.beforeRender();return render('correction',{});};
 try{draw();await r.flush();draw();assert.equal(element(r,'input','Correct existing lot OLD-1').checked,false);element(r,'input','Correct existing lot OLD-1').onChange({target:{checked:true}});draw();assert.equal(button(r,'Correct selected existing stock').disabled,true);element(r,'input','Confirm rejected existing stock is usable').onChange({target:{checked:true}});element(r,'input','Confirm incorrect import metadata').onChange({target:{checked:true}});element(r,'input','Count sheet / reference').onChange({target:{value:'IMPORT-CHECK'}});element(r,'input','Correction reason').onChange({target:{value:'Verified erroneous import metadata'}});draw();assert.equal(button(r,'Correct selected existing stock').disabled,false);await button(r,'Correct selected existing stock').onClick();const body=calls.find(c=>c.action==='correctExistingStock');assert.equal(body.confirm_rejected_stock,true);assert.deepEqual(body.rows,[{id:'old-stock',fingerprint:'checked'}]);}finally{r.cleanup();delete globalThis.__adjustmentUI;}
});


test('admin count previews quantity times the current configured cost and submits the reviewed valuation basis',async()=>{
 const render=await renderer(),r=runtime(),calls=[];globalThis.__adjustmentUI=r;
 const priced={...workspace,can_reconcile_value:true,rows:[{...workspace.rows[0],configured_unit_cost:12}]};
 r.invoke=async body=>{calls.push(body);return {data:body.action==='warehouseAdjustmentWorkspace'?priced:postedReceipt(body,'JV-PRICE')};};
 const draw=()=>{r.beforeRender();return render('dialog',{open:true,warehouseId:'raw',onOpenChange(){}});};
 try{draw();await r.flush();draw();assert.equal(element(r,'input','Use current item cost for Milk powder').checked,false);element(r,'input','Use current item cost for Milk powder').onChange({target:{checked:true}});element(r,'input','Physical quantity for Milk powder').onChange({target:{value:'8'}});element(r,'input','Count sheet / reference').onChange({target:{value:'NEW-COST'}});element(r,'input','Adjustment reason').onChange({target:{value:'Counted stock at updated milk cost'}});operatingLossAccount(r,draw).onChange({target:{value:'variance'}});const preview=draw();assert.match(preview,/-4/);assert.match(preview,/Value after count/);assert.match(preview,/96/);await button(r,'Save quantity adjustment').onClick();assert.equal(calls.find(c=>c.action==='postWarehouseAdjustment').rows[0].use_current_cost,true);}finally{r.cleanup();delete globalThis.__adjustmentUI;}
});


test('a changed valuation preserves the typed count but requires a fresh recount',async()=>{
 const render=await renderer(),r=runtime(),calls=[],beforeWindow=globalThis.window,beforeDocument=globalThis.document;
 const target=new EventTarget();target.setInterval=()=>1;target.clearInterval=()=>{};const document=new EventTarget();document.visibilityState='visible';globalThis.window=target;globalThis.document=document;globalThis.__adjustmentUI=r;
 let price=10;
 r.invoke=async body=>{calls.push(body);return {data:body.action==='warehouseAdjustmentWorkspace'?{...workspace,can_reconcile_value:true,rows:[{...workspace.rows[0],configured_unit_cost:price,fingerprint:'price-'+price}]}:postedReceipt(body,'JV-LIVE')};};
 const draw=()=>{r.beforeRender();return render('dialog',{open:true,warehouseId:'raw',onOpenChange(){}});};
 try{draw();await r.flush();draw();await r.flush();element(r,'input','Physical quantity for Milk powder').onChange({target:{value:'8'}});element(r,'input','Count sheet / reference').onChange({target:{value:'LIVE-COST'}});element(r,'input','Adjustment reason').onChange({target:{value:'Physical count with latest material price'}});operatingLossAccount(r,draw).onChange({target:{value:'variance'}});draw();price=12;target.dispatchEvent(new Event('soeicam:item-catalogue-changed'));await r.flush();draw();assert.equal(element(r,'input','Physical quantity for Milk powder').value,'8');assert.equal(button(r,'Save quantity adjustment').disabled,true);assert.match(draw(),/Reload quantities and count again/);await button(r,'Save quantity adjustment').onClick();assert.equal(calls.filter(c=>c.action==='postWarehouseAdjustment').length,0);}finally{r.cleanup();globalThis.window=beforeWindow;globalThis.document=beforeDocument;delete globalThis.__adjustmentUI;}
});

test('one item total covers all lots; selecting it again cannot create duplicate stock and a batch search keeps the full total',async()=>{
 const render=await renderer(),r=runtime(),calls=[];globalThis.__adjustmentUI=r;
 const lots=[workspace.rows[0],{...workspace.rows[0],balance_id:'second',lot_number:'MILK-02',book_quantity:5,book_value:50,fingerprint:'snapshot-two'}];
 r.invoke=async body=>{calls.push(body);return {data:body.action==='warehouseAdjustmentWorkspace'?{...workspace,rows:lots}:postedReceipt(body,'JV-GROUP')};};
 const draw=()=>{r.beforeRender();return render('dialog',{open:true,warehouseId:'raw',onOpenChange(){}});};
 try {
   draw();await r.flush();let html=draw();assert.equal((html.match(/data-count-product=/g)||[]).length,1);assert.match(html,/Total on hand for Milk powder[^>]*>15\.000/);
   assert.equal(r.elements.filter(e=>e.tag==='input'&&e.props.type==='number').length,0);
   element(r,'select','Add counted item').onChange({target:{value:'milk'}});draw();button(r,'Count item').onClick();draw();button(r,'Count item').onClick();draw();
   assert.equal(r.elements.filter(e=>e.tag==='input'&&e.props.type==='number').length,2);assert.equal(element(r,'input','Lot number for Milk powder'),undefined);
   element(r,'input','Physical quantity for Milk powder / MILK-01 / Stock record 1').onChange({target:{value:'8'}});
   element(r,'input','Search count items or lots').onChange({target:{value:'MILK-02'}});html=draw();assert.match(html,/Total on hand for Milk powder[^>]*>15\.000/);assert.match(html,/13\.000/);
   assert.equal(element(r,'input','Physical quantity for Milk powder / MILK-01 / Stock record 1').value,'8');
   const sort=r.elements.find(e=>typeof e.tag==='function'&&e.tag.name==='ProductSortSelect');sort.props.onChange('size');draw();
   element(r,'input','Count sheet / reference').onChange({target:{value:'COUNT-LOTS'}});element(r,'input','Adjustment reason').onChange({target:{value:'Counted individual physical lots'}});chooseOperating(r,draw);
   await button(r,'Save quantity adjustment').onClick();
   assert.deepEqual(calls.find(c=>c.action==='postWarehouseAdjustment').rows,[{balance_id:'lot',fingerprint:'server-snapshot',counted_quantity:8}]);
 }finally{r.cleanup();delete globalThis.__adjustmentUI;}
});

test('new lots require an explicit action and repeated clicks keep a single draft for that product',async()=>{
 const render=await renderer(),r=runtime();globalThis.__adjustmentUI=r;r.invoke=async()=>({data:workspace});
 const draw=()=>{r.beforeRender();return render('dialog',{open:true,warehouseId:'raw',onOpenChange(){}});};
 try {
   draw();await r.flush();draw();element(r,'button','Add another counted lot for Milk powder').onClick();draw();
   assert.equal(r.elements.filter(e=>e.tag==='input'&&e.props['aria-label']==='Lot number for Milk powder').length,1);
   element(r,'button','Add another counted lot for Milk powder').onClick();draw();
   assert.equal(r.elements.filter(e=>e.tag==='input'&&e.props['aria-label']==='Lot number for Milk powder').length,1);
   assert.match(draw(),/Total on hand for Milk powder[^>]*>10\.000/);
 }finally{r.cleanup();delete globalThis.__adjustmentUI;}
});


const simpleWorkspace=()=>({...structuredClone(workspace),date:'2026-11-03',gain_accounts:[{id:'surplus',account_number:'7580',name:'Stock surplus'}],items:workspace.items.map(item=>({...item,inventory_account:{id:'inventory',account_number:'1310',name:'Inventory'}}))});
for(const [group,name,unit] of [['packaging','Cups','ea'],['ingredients','Milk powder','kg']])test(`${group} shortages with binary-noise stock quantities reach review and posting without batch or expiry entry`,async()=>{
 const render=await renderer();
 for(const quantity of ['48','0']){
  const r=runtime(),data=simpleWorkspace(),calls=[];globalThis.__adjustmentUI=r;
  data.item_group=group;
  data.items[0]={...data.items[0],name,unit,inventory_type:'raw_material',count_group:group,count_fingerprint:'item-proof'};
  // Historical opening arithmetic can persist this value instead of exact 50.
  data.rows[0]={...data.rows[0],product_name:name,unit,book_quantity:49.99999999999999,book_value:500,inventory_type:'raw_material',count_group:group,lot_number:group==='packaging'?'':'MILK-01',expiry_date:''};
  r.invoke=async body=>{calls.push(body);return {data:body.action==='warehouseAdjustmentWorkspace'?data:postedReceipt(body,'JV-NORMALIZED')};};
  const draw=()=>{r.beforeRender();return render('simple',{open:true,warehouseId:'raw',onOpenChange(){}});};
  try{
   draw();await r.flush();draw();const count=element(r,'input','Physical quantity for '+name);assert.equal(Boolean(count.disabled),false);
   count.onChange({target:{value:quantity}});draw();assert.equal(element(r,'input','Physical quantity for '+name)['aria-invalid'],false);assert.equal(button(r,'Review adjustment').disabled,false);
   let html=reviewOperating(r,draw);assert.match(html,/Review stock adjustment/);assert.match(html,/Accounting entry/);assert.match(html,/Debit/);assert.match(html,/Credit/);
   assert.equal(element(r,'input','Lot number for '+name),undefined);assert.equal(element(r,'input','Printed expiry for '+name),undefined);
   assert.equal(r.elements.some(e=>e.tag==='input'&&String(e.props['aria-label']).startsWith('Batch quantity for ')),false);
   assert.equal(element(r,'select','Inventory loss account').value,'variance');assert.equal(element(r,'select','Inventory surplus account'),undefined);
   assert.equal(button(r,'Post adjustment').disabled,true,'a valid shortage still requires its count reference and reason');
   element(r,'input','Count sheet / reference').onChange({target:{value:'COUNT-'+group+'-'+quantity}});element(r,'input','Adjustment reason').onChange({target:{value:'Verified physical shortage'}});draw();assert.equal(button(r,'Post adjustment').disabled,false);
   await button(r,'Post adjustment').onClick();assert.match(draw(),/Stock count posted/);
   const writes=calls.filter(body=>body.action==='postWarehouseAdjustment');assert.equal(writes.length,1);const posted=writes[0];
   assert.equal(posted.lossAccountId,'variance');assert.equal(posted.itemGroup,group);
   assert.deepEqual(posted.item_counts,[{product_id:'milk',item_fingerprint:'item-proof',counted_quantity:Number(quantity),snapshots:[{balance_id:'lot',fingerprint:'server-snapshot'}]}]);
   assert.deepEqual(posted.rows,[{balance_id:'lot',fingerprint:'server-snapshot',counted_quantity:Number(quantity)}]);
   assert.equal(data.rows[0].book_quantity,49.99999999999999,'client normalization must not mutate the loaded stock proof');
  }finally{r.cleanup();delete globalThis.__adjustmentUI;}
 }
});

test('quantity normalization still blocks invalid physical counts, genuine recorded precision errors and missing inventory mapping',async()=>{
 const render=await renderer();
 for(const scenario of ['negative','physical precision','recorded precision','inventory mapping']){
  const r=runtime(),data=simpleWorkspace(),calls=[];globalThis.__adjustmentUI=r;
  data.item_group='ingredients';data.items[0].count_group='ingredients';
  data.rows[0]={...data.rows[0],book_quantity:scenario==='recorded precision'?49.9999:49.99999999999999,book_value:500};
  if(scenario==='inventory mapping')delete data.items[0].inventory_account;
  r.invoke=async body=>{calls.push(body);return {data};};
  const draw=()=>{r.beforeRender();return render('simple',{open:true,warehouseId:'raw',onOpenChange(){}});};
  try{
   draw();await r.flush();draw();element(r,'input','Physical quantity for Milk powder').onChange({target:{value:scenario==='negative'?'-1':scenario==='physical precision'?'48.0001':'48'}});let html=draw();
   if(scenario==='inventory mapping'){
    assert.equal(button(r,'Review adjustment').disabled,false);reviewOperating(r,draw);
    element(r,'input','Count sheet / reference').onChange({target:{value:'COUNT-MISSING-ACCOUNT'}});element(r,'input','Adjustment reason').onChange({target:{value:'Verified physical shortage'}});html=draw();
    assert.match(html,/Configure the inventory asset account/);assert.equal(button(r,'Post adjustment').disabled,true);await button(r,'Post adjustment').onClick();
   }else{
    assert.equal(button(r,'Review adjustment').disabled,true);assert.equal(element(r,'input','Physical quantity for Milk powder')['aria-invalid'],true);
    assert.match(html,scenario==='recorded precision'?/Recorded stock needs an accounting correction/:/Physical quantities must be non-negative with up to three decimal places/);
   }
   assert.equal(calls.some(body=>body.action==='postWarehouseAdjustment'),false,scenario+' must not post');
  }finally{r.cleanup();delete globalThis.__adjustmentUI;}
 }
});

test('packaging count review has no batch or expiry inputs and can submit the physical quantity',async()=>{
 const render=await renderer(),r=runtime(),data=simpleWorkspace(),calls=[];globalThis.__adjustmentUI=r;
 data.items[0]={...data.items[0],count_group:'packaging',inventory_type:'raw_material'};data.rows=[];data.item_group='packaging';
 r.invoke=async body=>{calls.push(body);return {data:body.action==='warehouseAdjustmentWorkspace'?data:postedReceipt(body,'JV-PACK')};};
 const draw=()=>{r.beforeRender();return render('simple',{open:true,warehouseId:'raw',onOpenChange(){}});};
 try{
  draw();await r.flush();draw();element(r,'input','Physical quantity for Milk powder').onChange({target:{value:'100'}});draw();let html=reviewOperating(r,draw);
  assert.equal(element(r,'input','Lot number for Milk powder'),undefined);assert.equal(element(r,'input','Printed expiry for Milk powder'),undefined);assert.match(html,/No batch or expiry is needed for packaging/);
  element(r,'input','Count sheet / reference').onChange({target:{value:'PACK-COUNT'}});element(r,'input','Adjustment reason').onChange({target:{value:'Physical packaging verified'}});draw();assert.equal(button(r,'Post adjustment').disabled,false);
  await button(r,'Post adjustment').onClick();const posted=calls.find(c=>c.action==='postWarehouseAdjustment');assert.equal(posted.rows[0].counted_quantity,100);assert.equal(posted.rows[0].expiry_date,'');assert.equal(posted.rows[0].lot_number,'');
 }finally{r.cleanup();delete globalThis.__adjustmentUI;}
});
test('simple item count shows one input per product and posts the reviewed physical total with all snapshots',async()=>{
 const render=await renderer(),r=runtime(),calls=[],data=simpleWorkspace();globalThis.__adjustmentUI=r;
 r.invoke=async body=>{calls.push(body);return {data:body.action==='warehouseAdjustmentWorkspace'?data:postedReceipt(body,'JV-COUNT')};};
 const draw=()=>{r.beforeRender();return render('simple',{open:true,warehouseId:'raw',onOpenChange(){}});};
 try{
  draw();await r.flush();let html=draw();assert.ok(element(r,'input','Physical quantity for Milk powder'));assert.equal(element(r,'input','Count sheet / reference'),undefined);
  assert.equal(element(r,'input','Use current item cost for Milk powder'),undefined);assert.doesNotMatch(html,/Ready for sale|Add counted lot|Verified unit cost/);
  element(r,'input','Physical quantity for Milk powder').onChange({target:{value:'8'}});html=draw();assert.match(html,/-2/);html=reviewOperating(r,draw);assert.match(html,/Review stock adjustment/);assert.match(html,/Debit/);assert.match(html,/Credit/);
  assert.ok(element(r,'select','Inventory loss account'));assert.equal(element(r,'select','Inventory surplus account'),undefined);
  element(r,'input','Count sheet / reference').onChange({target:{value:'COUNT-SIMPLE'}});element(r,'input','Adjustment reason').onChange({target:{value:'Physical stock verified'}});draw();assert.equal(button(r,'Post adjustment').disabled,false);
  await button(r,'Post adjustment').onClick();const body=calls.find(call=>call.action==='postWarehouseAdjustment');
  assert.equal(body.lossAccountId,'variance');assert.equal(body.item_counts[0].counted_quantity,8);assert.deepEqual(body.item_counts[0].snapshots,[{balance_id:'lot',fingerprint:'server-snapshot'}]);assert.equal(body.rows[0].counted_quantity,8);
  assert.equal(Object.hasOwn(body.rows[0],'use_current_cost'),false);assert.equal(Object.hasOwn(body.rows[0],'ready_for_sale'),false);
 }finally{r.cleanup();delete globalThis.__adjustmentUI;}
});
test('shortage review prefills batch allocation and preserves explicit corrections without hiding invalid counts',async()=>{
 const render=await renderer(),r=runtime(),data=simpleWorkspace(),calls=[];globalThis.__adjustmentUI=r;
 data.rows.push({...data.rows[0],balance_id:'second',fingerprint:'second-proof',book_quantity:5,book_value:50,lot_number:'MILK-02'});
 r.invoke=async body=>{calls.push(body);return {data:body.action==='warehouseAdjustmentWorkspace'?data:postedReceipt(body,'JV-MULTI')};};
 const draw=()=>{r.beforeRender();return render('simple',{open:true,warehouseId:'raw',onOpenChange(){}});};
 try{
  draw();await r.flush();let html=draw();assert.equal(r.elements.filter(e=>e.tag==='input'&&e.props['aria-label']==='Physical quantity for Milk powder').length,1);assert.doesNotMatch(html,/MILK-01|MILK-02/);assert.match(html,/15/);
  element(r,'input','Physical quantity for Milk powder').onChange({target:{value:'13'}});draw();html=reviewOperating(r,draw);assert.match(html,/shortage is allocated automatically/);assert.match(html,/Review batch quantities/);assert.equal(button(r,'Post adjustment').disabled,true);
  assert.equal(element(r,'input','Batch quantity for Milk powder: MILK-01').value,8);assert.equal(element(r,'input','Batch quantity for Milk powder: MILK-02').value,5);
  element(r,'input','Count sheet / reference').onChange({target:{value:'BATCH-COUNT'}});element(r,'input','Adjustment reason').onChange({target:{value:'Two units missing from lot one'}});draw();assert.equal(button(r,'Post adjustment').disabled,false);
  element(r,'input','Batch quantity for Milk powder: MILK-02').onChange({target:{value:''}});draw();assert.equal(element(r,'input','Batch quantity for Milk powder: MILK-02').value,'');assert.equal(button(r,'Post adjustment').disabled,true);
  element(r,'input','Batch quantity for Milk powder: MILK-02').onChange({target:{value:'5'}});draw();assert.equal(button(r,'Post adjustment').disabled,false);
  element(r,'input','Batch quantity for Milk powder: MILK-01').onChange({target:{value:'-1'}});draw();assert.ok(element(r,'input','Batch quantity for Milk powder: MILK-01'),'invalid draft must remain editable');
  element(r,'input','Batch quantity for Milk powder: MILK-01').onChange({target:{value:'8'}});draw();element(r,'input','Count sheet / reference').onChange({target:{value:'BATCH-COUNT'}});element(r,'input','Adjustment reason').onChange({target:{value:'Two units missing from lot one'}});draw();assert.equal(button(r,'Post adjustment').disabled,false);
  await button(r,'Post adjustment').onClick();const body=calls.find(call=>call.action==='postWarehouseAdjustment');assert.equal(body.rows.length,1);assert.equal(body.rows[0].balance_id,'lot');assert.equal(body.item_counts[0].counted_quantity,13);assert.equal(body.item_counts[0].snapshots.length,2);assert.equal(body.item_counts[0].allocation_method,undefined);
 }finally{r.cleanup();delete globalThis.__adjustmentUI;}
});

test('a multi-batch shortage posts from the item total with a loss account and no repeated batch entry',async()=>{
 const render=await renderer(),r=runtime(),data=simpleWorkspace(),calls=[];globalThis.__adjustmentUI=r;
 data.accounts.push({id:'other-expense',account_number:'6250',name:'Other expenses'});
 data.rows.push({...data.rows[0],balance_id:'second',fingerprint:'second-proof',book_quantity:5,book_value:100,unit_cost:20,lot_number:'MILK-02'});
 r.invoke=async body=>{calls.push(body);return {data:body.action==='warehouseAdjustmentWorkspace'?data:postedReceipt(body,'JV-AUTO-LOSS')};};
 const draw=()=>{r.beforeRender();return render('simple',{open:true,warehouseId:'raw',onOpenChange(){}});};
 try{
  draw();await r.flush();draw();element(r,'input','Physical quantity for Milk powder').onChange({target:{value:'3'}});draw();assert.equal(button(r,'Review adjustment').disabled,false);let html=reviewOperating(r,draw);
  assert.match(html,/Select the inventory loss account to record this shortage as an expense/);assert.equal(element(r,'select','Inventory surplus account'),undefined);
  element(r,'select','Inventory loss account').onChange({target:{value:'variance'}});element(r,'input','Count sheet / reference').onChange({target:{value:'AUTO-SHORTAGE'}});element(r,'input','Adjustment reason').onChange({target:{value:'Warehouse physical shortage verified'}});html=draw();
  assert.match(html,/Accounting entry/);assert.match(html,/Debit/);assert.match(html,/Credit/);assert.equal(button(r,'Post adjustment').disabled,false);
  await button(r,'Post adjustment').onClick();const body=calls.find(call=>call.action==='postWarehouseAdjustment');assert.equal(body.lossAccountId,'variance');assert.equal(body.item_counts[0].allocation_method,'fefo');assert.equal(body.item_counts[0].counted_quantity,3);assert.equal(body.item_counts[0].snapshots.length,2);assert.deepEqual(body.rows.map(row=>[row.balance_id,row.counted_quantity]),[['lot',0],['second',3]]);
  assert.match(draw(),/Stock count posted/);
 }finally{r.cleanup();delete globalThis.__adjustmentUI;}
});
test('blank and matching counts do not post; zero counts all batches empty and surplus uses its own account',async()=>{
 const render=await renderer();
 for(const quantity of ['','10','0','12']){
  const r=runtime(),data=simpleWorkspace();globalThis.__adjustmentUI=r;r.invoke=async()=>({data});
  const draw=()=>{r.beforeRender();return render('simple',{open:true,onOpenChange(){}});};
  try{draw();await r.flush();draw();element(r,'input','Physical quantity for Milk powder').onChange({target:{value:quantity}});draw();
   if(quantity===''||quantity==='10'){assert.equal(button(r,'Review adjustment').disabled,true);continue;}
   reviewOperating(r,draw);
   assert.ok(element(r,'select',quantity==='12'?'Inventory surplus account':'Inventory loss account'));
   assert.equal(element(r,'select',quantity==='12'?'Inventory loss account':'Inventory surplus account'),undefined);
  }finally{r.cleanup();delete globalThis.__adjustmentUI;}
 }
});


test('count groups follow the warehouse and can be selected independently without posting hidden groups',async()=>{
 const render=await renderer(),r=runtime(),calls=[];globalThis.__adjustmentUI=r;
 const stores=[{id:'pack',name:'Packaging',warehouse_type:'packaging'},{id:'raw',name:'Raw materials',warehouse_type:'raw_material'},{id:'cold',name:'Cold Room',warehouse_type:'cold_room'}];
 const items=[{id:'small',name:'Cup 250g',size:'250 g',count_group:'packaging'},{id:'large',name:'Cup 500g',size:'500 g',count_group:'packaging'},{id:'milk',name:'Milk powder',count_group:'ingredients'},{id:'yola',name:'YOLA',count_group:'finished'}].map(item=>({...item,unit:'ea',unit_cost:10,count_fingerprint:'item-'+item.id,inventory_account:{id:'inventory',name:'Inventory'}}));
 r.invoke=async body=>{
  calls.push(body);if(body.action!=='warehouseAdjustmentWorkspace')return {data:postedReceipt(body,'JV-GROUP-UI')};
  const selected=stores.find(w=>w.id===body.warehouseId)||stores[0],group=body.itemGroup==='auto'?({pack:'packaging',raw:'ingredients',cold:'finished'}[selected.id]):body.itemGroup;
  const selectedItems=items.filter(item=>group==='all'||item.count_group===group);
  return {data:{...simpleWorkspace(),warehouse:selected,warehouses:stores,item_group:group,items:selectedItems,rows:selectedItems.map(item=>({...workspace.rows[0],product_id:item.id,product_name:item.name,balance_id:selected.id+'-'+item.id,warehouse_id:selected.id,fingerprint:'stock-'+selected.id+'-'+item.id,unit:'ea',book_quantity:5,book_value:50}))}};
 };
 const draw=()=>{r.beforeRender();return render('simple',{open:true,warehouseId:'pack',onOpenChange(){}});};
 const load=async()=>{draw();await r.flush();return draw();};
 try {
  await load();assert.equal(element(r,'select','Count item group').value,'packaging');assert.ok(element(r,'input','Physical quantity for Cup 250g'));assert.equal(element(r,'input','Physical quantity for Milk powder'),undefined);
  element(r,'select','Adjustment warehouse').onChange({target:{value:'cold'}});await load();assert.equal(element(r,'select','Count item group').value,'finished');assert.ok(element(r,'input','Physical quantity for YOLA'));assert.equal(element(r,'input','Physical quantity for Cup 250g'),undefined);
  element(r,'select','Adjustment warehouse').onChange({target:{value:'raw'}});await load();assert.equal(element(r,'select','Count item group').value,'ingredients');
  element(r,'select','Count item group').onChange({target:{value:'packaging'}});await load();assert.equal(calls.at(-1).warehouseId,'raw');assert.equal(calls.at(-1).itemGroup,'packaging');
  const sort=r.elements.find(e=>typeof e.tag==='function'&&e.tag.name==='ProductSortSelect');sort.props.onChange('size-desc');draw();
  assert.deepEqual(r.elements.filter(e=>e.tag==='input'&&e.props.type==='number').map(e=>e.props['aria-label']),['Physical quantity for Cup 500g','Physical quantity for Cup 250g']);
  element(r,'input','Physical quantity for Cup 250g').onChange({target:{value:'3'}});draw();assert.equal(element(r,'select','Count item group').disabled,true);assert.equal(element(r,'select','Adjustment warehouse').disabled,true);
  element(r,'select','Count item group').onChange({target:{value:'finished'}});draw();assert.equal(element(r,'select','Count item group').value,'packaging');
  reviewOperating(r,draw);element(r,'input','Count sheet / reference').onChange({target:{value:'PACK-ONLY'}});element(r,'input','Adjustment reason').onChange({target:{value:'Counted packaging independently'}});draw();
  await button(r,'Post adjustment').onClick();const posted=calls.find(call=>call.action==='postWarehouseAdjustment');assert.equal(posted.warehouseId,'raw');assert.equal(posted.itemGroup,'packaging');assert.deepEqual(posted.item_counts.map(item=>item.product_id),['small']);assert.equal(posted.rows[0].balance_id,'raw-small');
 }finally{r.cleanup();delete globalThis.__adjustmentUI;}
});

function liveCountHarness(render){
 const r=runtime(),calls=[],live=simpleWorkspace(),previous={window:globalThis.window,document:globalThis.document};
 live.item_group='ingredients';live.items[0].count_group='ingredients';live.items[0].count_fingerprint='milk-proof';
 live.items.push({...live.items[0],id:'sugar',name:'Sugar',count_fingerprint:'sugar-proof'});
 live.rows.push({...live.rows[0],product_id:'sugar',product_name:'Sugar',balance_id:'sugar-lot',fingerprint:'sugar-stock',book_quantity:5,book_value:50});
 const target=new EventTarget(),doc=new EventTarget();doc.visibilityState='visible';let poll;
 target.setInterval=fn=>{poll=fn;return 1;};target.clearInterval=()=>{};globalThis.window=target;globalThis.document=doc;globalThis.__adjustmentUI=r;
 let readError='',postFails=false;
 r.invoke=async body=>{calls.push(body);if(body.action==='warehouseAdjustmentWorkspace'){if(readError)throw Error(readError);return {data:structuredClone(live)};}if(postFails)throw Error('Response interrupted');return {data:postedReceipt(body,'JV-LIVE')};};
 const draw=()=>{r.beforeRender();return render('simple',{open:true,warehouseId:'raw',onOpenChange(){}});};
 const review=()=>{reviewOperating(r,draw);element(r,'input','Count sheet / reference').onChange({target:{value:'LIVE-COUNT'}});element(r,'input','Adjustment reason').onChange({target:{value:'Physical count verified'}});return draw();};
 return {r,calls,live,target,draw,review,setReadError:value=>{readError=value;},setPostFails:value=>{postFails=value;},
  async ready(){draw();await r.flush();return draw();},async poll(){poll();await r.flush();return draw();},
  close(){r.cleanup();globalThis.window=previous.window;globalThis.document=previous.document;delete globalThis.__adjustmentUI;}};
}

test('live checks retain unchanged counts, refresh uncounted stock and require recount after a counted lot changes',async()=>{
 const f=liveCountHarness(await renderer()),{r,live,draw}=f;
 try{
  await f.ready();element(r,'input','Physical quantity for Milk powder').onChange({target:{value:'8'}});draw();
  await f.poll();assert.equal(element(r,'input','Physical quantity for Milk powder').value,'8');assert.doesNotMatch(draw(),/Stock or item details changed/);
  live.rows[1].book_quantity=7;live.rows[1].book_value=70;live.rows[1].fingerprint='sugar-fresh';
  await f.poll();assert.match(draw(),/Total on hand for Sugar[^>]*>7/);assert.equal(element(r,'input','Physical quantity for Milk powder').value,'8');assert.doesNotMatch(draw(),/Stock or item details changed/);
  live.rows[0].book_quantity=9;live.rows[0].book_value=90;live.rows[0].fingerprint='milk-moved';
  await f.poll();assert.match(draw(),/Stock or item details changed/);assert.equal(element(r,'input','Physical quantity for Milk powder').value,'8');
  f.review();assert.equal(button(r,'Post adjustment').disabled,true);await button(r,'Post adjustment').onClick();assert.equal(f.calls.filter(c=>c.action==='postWarehouseAdjustment').length,0);
  button(r,'Reload and clear counts').onClick();draw();await r.flush();assert.match(draw(),/Total on hand for Milk powder[^>]*>9/);assert.equal(element(r,'input','Physical quantity for Milk powder').value,'');assert.equal(element(r,'select','Count item group').value,'ingredients');
 }finally{f.close();}
});

test('refreshing an empty sheet loads current stock; a failed check keeps typed quantities and blocks posting until rechecked',async()=>{
 const f=liveCountHarness(await renderer()),{r,live,draw}=f;
 try{
  await f.ready();live.rows[0].book_quantity=12;live.rows[0].book_value=120;live.rows[0].fingerprint='received';
  f.target.dispatchEvent(new Event('focus'));await r.flush();assert.match(draw(),/Total on hand for Milk powder[^>]*>12/);
  element(r,'input','Physical quantity for Milk powder').onChange({target:{value:'11'}});draw();f.setReadError('Offline');await f.poll();
  assert.equal(element(r,'input','Physical quantity for Milk powder').value,'11');assert.match(draw(),/Could not check current stock/);
  f.review();assert.equal(button(r,'Post adjustment').disabled,true);
  f.setReadError('');await f.poll();assert.equal(button(r,'Post adjustment').disabled,false);
 }finally{f.close();}
});

test('an interrupted save preserves its proof and retry key instead of replacing them during background sync',async()=>{
 const f=liveCountHarness(await renderer()),{r,live,draw}=f;
 try{
  await f.ready();element(r,'input','Physical quantity for Milk powder').onChange({target:{value:'8'}});draw();f.review();f.setPostFails(true);
  await button(r,'Post adjustment').onClick();draw();assert.match(draw(),/Response interrupted/);
  const reads=f.calls.filter(c=>c.action==='warehouseAdjustmentWorkspace').length;
  live.rows[0].book_quantity=8;live.rows[0].book_value=80;live.rows[0].fingerprint='already-posted';await f.poll();assert.equal(f.calls.filter(c=>c.action==='warehouseAdjustmentWorkspace').length,reads);
  assert.equal(button(r,'Post adjustment').disabled,false);f.setPostFails(false);await button(r,'Post adjustment').onClick();draw();
  const writes=f.calls.filter(c=>c.action==='postWarehouseAdjustment');assert.equal(writes.length,2);assert.deepEqual(writes[0],writes[1]);assert.match(draw(),/Stock count posted/);
 }finally{f.close();}
});

test('held counted finished stock requires missing-expiry acknowledgement before release without a quantity change',async()=>{
 const render=await renderer(),r=runtime(),calls=[];globalThis.__adjustmentUI=r;
 const data={...workspace,rows:[{...workspace.rows[0],product_name:'YOLA 1KG Non Sucre',inventory_type:'assembly',adjusted_stock:true,production_order_id:'',expiry_date:'',book_quantity:14,book_value:140}]};
 r.invoke=async body=>{calls.push(body);return {data:body.action==='warehouseAdjustmentWorkspace'?data:postedReceipt(body,'')};};
 const draw=()=>{r.beforeRender();return render('dialog',{open:true,warehouseId:'raw',onOpenChange(){}});};
 try{draw();await r.flush();draw();element(r,'input','Ready for sale: YOLA 1KG Non Sucre').onChange({target:{checked:true}});element(r,'input','Count sheet / reference').onChange({target:{value:'RELEASE-010'}});element(r,'input','Adjustment reason').onChange({target:{value:'Owner confirms counted stock fit for sale'}});chooseOperating(r,draw);
 assert.match(draw(),/No expiry date is available/);assert.equal(button(r,'Save quantity adjustment').disabled,true);
 element(r,'input','Confirm missing expiry for YOLA 1KG Non Sucre').onChange({target:{checked:true}});draw();assert.equal(button(r,'Save quantity adjustment').disabled,false);await button(r,'Save quantity adjustment').onClick();
 const body=calls.find(c=>c.action==='postWarehouseAdjustment');assert.equal(body.rows[0].counted_quantity,14);assert.equal(body.rows[0].ready_for_sale,true);assert.equal(body.rows[0].confirm_missing_expiry,true);assert.equal(body.rows[0].expiry_date,undefined);assert.equal(body.rows[0].use_current_cost,undefined);
 }finally{r.cleanup();delete globalThis.__adjustmentUI;}
});

test('new finished count exposes ready-for-sale choice and sends explicit undated approval only after acknowledgement',async()=>{
 const render=await renderer(),r=runtime(),data=simpleWorkspace(),calls=[];globalThis.__adjustmentUI=r;
 data.item_group='finished';data.items[0]={...data.items[0],name:'YOLA',inventory_type:'assembly',count_group:'finished',count_fingerprint:'item-proof'};data.rows=[];
 r.invoke=async body=>{calls.push(body);return {data:body.action==='warehouseAdjustmentWorkspace'?data:postedReceipt(body,'JV-COUNT')};};
 const draw=()=>{r.beforeRender();return render('simple',{open:true,warehouseId:'raw',onOpenChange(){}});};
 try{draw();await r.flush();draw();element(r,'input','Physical quantity for YOLA').onChange({target:{value:'14'}});draw();reviewOperating(r,draw);element(r,'input','Lot number for YOLA').onChange({target:{value:'010'}});element(r,'input','Count sheet / reference').onChange({target:{value:'COUNT-010'}});element(r,'input','Adjustment reason').onChange({target:{value:'Verified finished stock'}});draw();element(r,'select','Inventory surplus account').onChange({target:{value:'surplus'}});draw();
 assert.equal(element(r,'input','Ready for sale: YOLA').checked,false);element(r,'input','Ready for sale: YOLA').onChange({target:{checked:true}});draw();assert.equal(button(r,'Post adjustment').disabled,true);element(r,'input','Confirm missing expiry for YOLA').onChange({target:{checked:true}});draw();assert.equal(button(r,'Post adjustment').disabled,false);await button(r,'Post adjustment').onClick();
 const saved=calls.find(c=>c.action==='postWarehouseAdjustment');assert.equal(saved.rows[0].ready_for_sale,true);assert.equal(saved.rows[0].confirm_missing_expiry,true);assert.equal(saved.rows[0].counted_quantity,14);
 }finally{r.cleanup();delete globalThis.__adjustmentUI;}
});


for(const counted of [8,12])test(`opening item correction for ${counted<10?'shortage':'surplus'} requires equity plus confirmation, previews both ledger sides and sends no P&L accounts`,async()=>{
 const render=await renderer(),r=runtime(),data=simpleWorkspace(),calls=[];globalThis.__adjustmentUI=r;
 r.invoke=async body=>{calls.push(body);return {data:body.action==='warehouseAdjustmentWorkspace'?data:postedReceipt(body,'JV-OPENING')};};
 const draw=()=>{r.beforeRender();return render('simple',{open:true,warehouseId:'raw',onOpenChange(){}});};
 try{
  draw();await r.flush();draw();element(r,'input','Physical quantity for Milk powder').onChange({target:{value:String(counted)}});draw();button(r,'Review adjustment').onClick();draw();
  assert.equal(element(r,'select','Accounting purpose').value,'');element(r,'input','Count sheet / reference').onChange({target:{value:'OPENING-'+counted}});element(r,'input','Adjustment reason').onChange({target:{value:'Verified opening stock quantity error'}});draw();
  assert.equal(button(r,'Post adjustment').disabled,true);await button(r,'Post adjustment').onClick();assert.equal(calls.filter(row=>row.action==='postWarehouseAdjustment').length,0);
  element(r,'select','Accounting purpose').onChange({target:{value:'opening_correction'}});draw();assert.equal(element(r,'select','Opening stock equity counterpart').value,'');assert.equal(element(r,'input','Confirm opening stock correction').checked,false);
  assert.equal(element(r,'select','Inventory loss account'),undefined);assert.equal(element(r,'select','Inventory surplus account'),undefined);assert.equal(button(r,'Post adjustment').disabled,true);
  element(r,'input','Confirm opening stock correction').onChange({target:{checked:true}});draw();assert.equal(button(r,'Post adjustment').disabled,true,'confirmation without an equity account is insufficient');
  element(r,'select','Opening stock equity counterpart').onChange({target:{value:'opening-equity'}});draw();assert.equal(element(r,'input','Confirm opening stock correction').checked,false,'changing the equity account invalidates earlier confirmation');assert.equal(button(r,'Post adjustment').disabled,true);element(r,'input','Confirm opening stock correction').onChange({target:{checked:true}});let html=draw();assert.equal(button(r,'Post adjustment').disabled,false);
  const ledger=html.slice(html.indexOf('Accounting entry')).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ');
  assert.match(ledger,new RegExp('3990 · Opening stock equity '+(counted<10?'Debit':'Credit')+' 20 XAF'));assert.match(ledger,new RegExp('1310 · Inventory '+(counted<10?'Credit':'Debit')+' 20 XAF'));assert.doesNotMatch(ledger,/Inventory adjustments|Stock surplus/);
  element(r,'input','Confirm opening stock correction').onChange({target:{checked:false}});draw();assert.equal(button(r,'Post adjustment').disabled,true,'equity selection alone is insufficient');
  element(r,'input','Confirm opening stock correction').onChange({target:{checked:true}});draw();await button(r,'Post adjustment').onClick();
  const writes=calls.filter(row=>row.action==='postWarehouseAdjustment');assert.equal(writes.length,1);const body=writes[0];assert.equal(body.purpose,'opening_correction');assert.equal(body.correctionAccountId,'opening-equity');assert.equal(body.correctionConfirmed,true);assert.equal(body.item_counts[0].counted_quantity,counted);assert.equal(body.rows[0].fingerprint,'server-snapshot');
  for(const key of ['accountId','lossAccountId','gainAccountId'])assert.equal(Object.hasOwn(body,key),false,key+' must not be sent for an equity correction');
 }finally{r.cleanup();delete globalThis.__adjustmentUI;}
});

for(const counted of [8,12])test(`detailed opening correction for ${counted<10?'shortage':'surplus'} uses the explicitly confirmed equity treatment without operating counterparts`,async()=>{
 const render=await renderer(),r=runtime(),calls=[];globalThis.__adjustmentUI=r;
 r.invoke=async body=>{calls.push(body);return {data:body.action==='warehouseAdjustmentWorkspace'?workspace:postedReceipt(body,'JV-DETAILED-OPENING')};};
 const draw=()=>{r.beforeRender();return render('dialog',{open:true,warehouseId:'raw',onOpenChange(){}});};
 try{
  draw();await r.flush();draw();element(r,'input','Physical quantity for Milk powder').onChange({target:{value:String(counted)}});element(r,'input','Count sheet / reference').onChange({target:{value:'DETAILED-OPENING-'+counted}});element(r,'input','Adjustment reason').onChange({target:{value:'Verified opening stock count correction'}});draw();assert.equal(element(r,'select','Accounting purpose').value,'');assert.equal(button(r,'Save quantity adjustment').disabled,true);
  element(r,'select','Accounting purpose').onChange({target:{value:'opening_correction'}});draw();element(r,'select','Opening stock equity counterpart').onChange({target:{value:'opening-equity'}});draw();assert.equal(button(r,'Save quantity adjustment').disabled,true);assert.equal(element(r,'input','Confirm opening stock correction').checked,false);
  assert.equal(element(r,'select','Adjustment account'),undefined);assert.equal(element(r,'select','Inventory surplus account'),undefined);
  element(r,'input','Confirm opening stock correction').onChange({target:{checked:true}});const html=draw();assert.match(html,/no income or expense is recorded/);assert.match(html,/Opening stock equity/);assert.equal(button(r,'Save quantity adjustment').disabled,false);await button(r,'Save quantity adjustment').onClick();
  const body=calls.find(row=>row.action==='postWarehouseAdjustment');assert.equal(body.purpose,'opening_correction');assert.equal(body.correctionAccountId,'opening-equity');assert.equal(body.correctionConfirmed,true);assert.equal(body.rows[0].counted_quantity,counted);assert.equal(body.rows[0].fingerprint,'server-snapshot');
  for(const key of ['accountId','lossAccountId','gainAccountId'])assert.equal(Object.hasOwn(body,key),false);assert.equal(Object.hasOwn(body.rows[0],'use_current_cost'),false);assert.equal(Object.hasOwn(body.rows[0],'confirm_reconciliation'),false);
 }finally{r.cleanup();delete globalThis.__adjustmentUI;}
});

test('detailed opening treatment disables revaluation and refuses a current-cost choice retained from operating mode',async()=>{
 const render=await renderer(),r=runtime(),calls=[];globalThis.__adjustmentUI=r;
 const data={...workspace,can_reconcile_value:true,rows:[{...workspace.rows[0],configured_unit_cost:12}]};
 r.invoke=async body=>{calls.push(body);return {data};};
 const draw=()=>{r.beforeRender();return render('dialog',{open:true,warehouseId:'raw',onOpenChange(){}});};
 try{
  draw();await r.flush();draw();chooseOperating(r,draw);assert.equal(element(r,'input','Use current item cost for Milk powder').disabled,false);element(r,'input','Use current item cost for Milk powder').onChange({target:{checked:true}});element(r,'input','Physical quantity for Milk powder').onChange({target:{value:'8'}});element(r,'input','Count sheet / reference').onChange({target:{value:'NO-REVALUE'}});element(r,'input','Adjustment reason').onChange({target:{value:'Opening correction must preserve existing cost'}});draw();
  element(r,'select','Accounting purpose').onChange({target:{value:'opening_correction'}});draw();assert.equal(element(r,'input','Use current item cost for Milk powder').disabled,true);element(r,'select','Opening stock equity counterpart').onChange({target:{value:'opening-equity'}});element(r,'input','Confirm opening stock correction').onChange({target:{checked:true}});const html=draw();assert.match(html,/Opening stock count corrections cannot revalue existing stock/);assert.equal(button(r,'Save quantity adjustment').disabled,true);
  await button(r,'Save quantity adjustment').onClick();assert.equal(calls.some(row=>row.action==='postWarehouseAdjustment'),false);
 }finally{r.cleanup();delete globalThis.__adjustmentUI;}
});

test('a positive detailed operating count requires an explicitly selected surplus account',async()=>{
 const render=await renderer(),r=runtime(),calls=[];globalThis.__adjustmentUI=r;
 r.invoke=async body=>{calls.push(body);return {data:body.action==='warehouseAdjustmentWorkspace'?workspace:postedReceipt(body,'JV-OPERATING-SURPLUS')};};
 const draw=()=>{r.beforeRender();return render('dialog',{open:true,warehouseId:'raw',onOpenChange(){}});};
 try{
  draw();await r.flush();draw();element(r,'input','Physical quantity for Milk powder').onChange({target:{value:'12'}});element(r,'input','Count sheet / reference').onChange({target:{value:'OPERATING-SURPLUS'}});element(r,'input','Adjustment reason').onChange({target:{value:'Verified operating stock surplus'}});chooseOperating(r,draw);
  assert.equal(element(r,'select','Inventory surplus account').value,'');assert.equal(button(r,'Save quantity adjustment').disabled,true);await button(r,'Save quantity adjustment').onClick();assert.equal(calls.some(row=>row.action==='postWarehouseAdjustment'),false);
  element(r,'select','Inventory surplus account').onChange({target:{value:'surplus'}});draw();assert.equal(button(r,'Save quantity adjustment').disabled,false);await button(r,'Save quantity adjustment').onClick();const body=calls.find(row=>row.action==='postWarehouseAdjustment');assert.equal(body.purpose,'operating');assert.equal(body.gainAccountId,'surplus');assert.equal(body.correctionAccountId,undefined);assert.equal(body.correctionConfirmed,undefined);
 }finally{r.cleanup();delete globalThis.__adjustmentUI;}
});
