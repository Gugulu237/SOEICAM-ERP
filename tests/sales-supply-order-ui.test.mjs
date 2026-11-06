import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url);
let compiled;
async function bundle(){
  compiled ||= build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Form from './src/views/SalesOrderForm.jsx';export const render=(props)=>renderToStaticMarkup(React.createElement(Form,props));",resolveDir:process.cwd(),loader:'jsx'},bundle:true,format:'cjs',platform:'node',write:false,plugins:[{name:'sales-order-ui',setup(b){
    b.onResolve({filter:/^react$/},a=>(/(?:SalesOrderForm|SaleReplacements)\.jsx$/.test(a.importer))?{path:'hooks',namespace:'fixture'}:undefined);
    b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:"import React from "+JSON.stringify(require.resolve('react'))+";export default {...React,createElement:(tag,props,...children)=>{globalThis.__suppliedOrderUI.capture(tag,props,children);return React.createElement(tag,props,...children);}};export const useState=v=>globalThis.__suppliedOrderUI.state('form',v),useRef=v=>globalThis.__suppliedOrderUI.ref('form',v),useMemo=fn=>fn(),useEffect=(f,d)=>globalThis.__suppliedOrderUI.effect('form',f,d);",resolveDir:process.cwd()}));
    const mocks={
      '@/components/sales/SaleStockPicker':"import React from 'react';export const vehicleSaleLabel=r=>r.vehicle_registration||r.vehicle_name||r.dispatch_number;export default function Picker(p){globalThis.__suppliedOrderUI.sourcePicker=p;return React.createElement('button',{'aria-label':'Stock source',onClick:()=>p.onOpenChange(true)},p.options.find(o=>o.id===p.value)?.label||p.fallbackLabel);}",
      '@/hooks/usePhoneLayout':"export const usePhoneLayout=()=>!!globalThis.__suppliedOrderUI.phone;",
      '@/components/field/CustomerPicker':"import React from 'react';export default function Picker(p){globalThis.__suppliedOrderUI.customerPicker=p;const props={'aria-label':'Customer',value:p.value,onChange:e=>p.onChange(e.target.value)};globalThis.__suppliedOrderUI.capture('select',props,[]);return React.createElement('select',props,p.customers.map(c=>React.createElement('option',{key:c.id,value:c.id},c.business_name)));}",
      '@/components/sales/SaleProductPicker':"export default function Picker(p){if(p.purpose==='replacement')globalThis.__suppliedOrderUI.replacementPicker=p;else globalThis.__suppliedOrderUI.productPicker=p;return null;}",
      '@/api/erpClient':"export const erp=new Proxy({},{get:(_,k)=>globalThis.__suppliedOrderUI.client[k]});",
      '@/lib/field-ops':"export const invokeFieldOps=body=>globalThis.__suppliedOrderUI.invoke(body);",
      '@/lib/router':"export const useParams=()=>({id:globalThis.__suppliedOrderUI.routeId});export const useNavigate=()=>path=>globalThis.__suppliedOrderUI.navigation.push(path);export const useBack=()=>()=>{};",
      '@/components/ui/use-toast':"export const useToast=()=>({toast:()=>{}});",
      '@/components/shared/LearnMore':"export default ()=>null;",
      '@/components/ui/button':"import React from 'react';export function Button({children,variant,size,...p}){globalThis.__suppliedOrderUI.capture('button',p,children);return React.createElement('button',p,children);}",
      '@/components/ui/input':"import React from 'react';export function Input(p){globalThis.__suppliedOrderUI.capture('input',p,[]);return React.createElement('input',p);}",
    };
    b.onResolve({filter:/^@\//},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'leaf'}:undefined);
    b.onLoad({filter:/.*/,namespace:'leaf'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));
  }}]}).then(out=>{const m={exports:{}};new Function('require','module','exports',out.outputFiles[0].text)(require,m,m.exports);return m.exports;});
  return compiled;
}
const options={currentSellerId:'seller',sellers:[{id:'seller',name:'Salesperson A'},{id:'other',name:'Salesperson B'}],date:'2026-10-25',runs:[{id:'run-a',commercial_name:'Agent A',driver_name:'Driver A',vehicle_name:'Van A',vehicle_registration:'CE 123 AB',dispatch_number:'DSP-1'}],warehouses:[{id:'main',name:'Main Cold Room'}],customers:[{id:'customer',business_name:'Customer',payment_terms_days:0}]};
const stock={source:{stock_warehouse_id:'van'},products:[{id:'yola',name:'YOLA 500 g',unit:'ea',inventory_type:'assembly',available:10,selling_price:500,tax_rate:0}]};
function setup(render,workspace=options,stockData=stock){
  const r=hookRuntime(),calls=[];r.client={entities:{CustomerLocation:{filter:async()=>[]},Customer:{filter:async()=>[]}}};r.fail=true;r.routeId=undefined;
  r.invoke=async body=>{calls.push(body);if(body.action==='salesOrderWorkspace')return {data:workspace};if(body.action==='salesOrderStock')return {data:stockData};if(body.action==='salesOrderDeliveryPoints')return {data:{points:[]}};if(r.fail)throw Error('Connection interrupted');return {data:{order:{id:'order'},invoiceId:'invoice'}};};
  globalThis.__suppliedOrderUI=r;
  const paint=()=>{r.beforeRender();return render();},control=label=>r.controls.find(c=>c['aria-label']===label),button=label=>r.buttons.find(b=>b.label===label);
  return {r,calls,paint,control,button,async ready(){paint();await r.flush();paint();await r.flush();return paint();},close(){r.cleanup();delete globalThis.__suppliedOrderUI;}};
}


async function selectCustomer(f){f.control('Customer').onChange({target:{value:'customer'}});for(let i=0;i<3;i++){f.paint();await f.r.flush();}f.paint();}
async function productsStep(f){await selectCustomer(f);f.button('Continue to products').onClick();return f.paint();}
function quantity(f,value){f.r.productPicker.onQuantityChange(f.r.productPicker.products[0],value);return f.paint();}
function reviewStep(f,reference='RCPT-001'){f.button('No replacements').onClick();f.paint();f.button('Review sale').onClick();f.paint();if(reference!==null){f.control('Receipt reference number').onChange({target:{value:reference}});f.paint();}}

for(const device of ['phone','tablet','desktop'])test(device+' uses three steps, one product chooser, signed-in seller and mandatory receipt without premature posting',async()=>{
  const {render}=await bundle(),f=setup(render,{...options,defaultSource:'company',currentSeller:{id:'seller',name:'Salesperson A'}});f.r.phone=device==='phone';
  try{
    let html=await f.ready();assert.match(html,/Step 1 of 3/);assert.equal(f.button('Record sale & deduct stock'),undefined);
    assert.equal(f.control('Person making the sale').value,'Salesperson A');assert.equal(f.control('Person making the sale').readOnly,true);
    f.button('Continue to products').onClick();assert.match(f.paint(),/Choose a customer before continuing/);
    html=await productsStep(f);assert.match(html,/Step 2 of 3/);assert.equal(f.control('Customer'),undefined);assert.equal(f.button('Add product'),undefined);
    assert.equal(f.r.buttons.filter(b=>b.label==='Choose products').length,1);
    f.button('Review sale').onClick();assert.match(f.paint(),/Add at least one product/);
    f.button('Choose products').onClick();f.paint();assert.equal(f.r.productPicker.open,true);
    quantity(f,'6');assert.equal(f.control('Qty 1').value,'6');assert.equal(f.control('Qty 2'),undefined);
    f.r.productPicker.onOpenChange(false);f.paint();reviewStep(f,null);assert.match(f.paint(),/Step 3 of 3/);
    assert.equal(f.calls.filter(c=>c.action==='recordSuppliedOrder').length,0);
    await f.button('Record sale & deduct stock').onClick();assert.match(f.paint(),/reference number of the receipt/);assert.equal(f.calls.filter(c=>c.action==='recordSuppliedOrder').length,0);
    f.control('Receipt reference number').onChange({target:{value:'  RECEIPT-007  '}});f.paint();
    const save=f.button('Record sale & deduct stock').onClick;await Promise.all([save(),save()]);assert.match(f.paint(),/Connection interrupted/);
    assert.equal(f.calls.filter(c=>c.action==='recordSuppliedOrder').length,1);assert.equal(f.control('Receipt reference number').value,'  RECEIPT-007  ');
    f.button('Edit products').onClick();f.paint();assert.equal(f.control('Qty 1').value,'6');reviewStep(f,'  RECEIPT-007  ');
    f.r.fail=false;await f.button('Record sale & deduct stock').onClick();
    const writes=f.calls.filter(c=>c.action==='recordSuppliedOrder');assert.equal(writes.length,2);assert.equal(writes[0].requestKey,writes[1].requestKey);
    assert.equal(writes[1].sellerId,undefined,'server resolves the signed-in seller');assert.equal(writes[1].receiptReference,'RECEIPT-007');assert.equal(writes[1].lines[0].quantity,'6');assert.deepEqual(f.r.navigation,['/sales/invoices/invoice']);
  }finally{f.close();}
});

test('the signed-in account displays even if it has no employee dropdown record',async()=>{
  const {render}=await bundle(),f=setup(render,{...options,currentSellerId:'user:gm',currentSeller:{id:'user:gm',name:'Logged in manager'},sellers:[]});
  try{await f.ready();assert.equal(f.control('Person making the sale').value,'Logged in manager');await productsStep(f);quantity(f,1);reviewStep(f);f.r.fail=false;await f.button('Record sale & deduct stock').onClick();assert.equal(f.calls.find(c=>c.action==='recordSuppliedOrder').sellerId,undefined);}finally{f.close();}
});

test('source popup displays the vehicle registration, preserves salesperson identity and requests the exact chosen stock',async()=>{
  const {render}=await bundle(),f=setup(render);
  try{
    await f.ready();await productsStep(f);assert.equal(f.r.sourcePicker.value,'issued:run-a');
    assert.equal(f.r.sourcePicker.options.find(o=>o.id==='issued:run-a').label,'CE 123 AB');assert.ok(f.r.sourcePicker.options.some(o=>o.id==='warehouse:main'));
    f.r.sourcePicker.onChange('warehouse:main');f.paint();await f.r.flush();f.paint();
    const read=f.calls.filter(c=>c.action==='salesOrderStock').at(-1);assert.equal(read.sourceType,'warehouse');assert.equal(read.warehouseId,'main');assert.equal(read.dispatchId,undefined);
    quantity(f,2);reviewStep(f);f.r.fail=false;await f.button('Record sale & deduct stock').onClick();
    const write=f.calls.find(c=>c.action==='recordSuppliedOrder');assert.equal(write.sourceType,'warehouse');assert.equal(write.warehouseId,'main');assert.equal(write.dispatchId,undefined);assert.equal(write.sellerId,undefined);
  }finally{f.close();}
});

test('company stock remains automatic without individual warehouse choices, while an older draft retains its source and uses the signed-in seller',async()=>{
  const {render}=await bundle(),f=setup(render,{...options,defaultSource:'company'});
  try{await f.ready();await productsStep(f);assert.equal(f.r.sourcePicker.value,'company');assert.equal(f.r.sourcePicker.options.some(o=>o.id==='warehouse:main'),false);quantity(f,1);reviewStep(f);f.r.fail=false;await f.button('Record sale & deduct stock').onClick();assert.equal(f.calls.find(c=>c.action==='recordSuppliedOrder').sourceType,'company');}finally{f.close();}
  const g=setup(render,{...options,defaultSource:'company'});g.r.routeId='old';
  g.r.client.entities.SalesOrder={get:async()=>({id:'old',status:'draft',warehouse_id:'main',warehouse_name:'Main Cold Room',customer_id:'customer',order_date:'2026-10-25',salesperson_id:'other',receipt_reference:'OLD-REF'})};g.r.client.entities.SalesOrderLine={filter:async()=>[]};
  try{await g.ready();assert.equal(g.control('Person making the sale').value,'Salesperson A');g.button('Continue to products').onClick();assert.match(g.paint(),/Main Cold Room/);assert.equal(g.r.sourcePicker.value,'warehouse:main');quantity(g,1);reviewStep(g,null);assert.equal(g.control('Receipt reference number').value,'OLD-REF');g.r.fail=false;await g.button('Record sale & deduct stock').onClick();assert.equal(g.calls.find(c=>c.action==='recordSuppliedOrder').sellerId,undefined);}finally{g.close();}
});

test('direct quantity editing merges rows and cannot advance with excessive, blank, zero or invalid amounts',async()=>{
  const {render}=await bundle(),f=setup(render,{...options,defaultSource:'company'});
  try{await f.ready();await productsStep(f);quantity(f,2);quantity(f,'4');assert.equal(f.control('Qty 1').value,'4');assert.equal(f.control('Qty 2'),undefined);
    for(const value of ['11','','0','-1','NaN']){quantity(f,value);f.button('Review sale').onClick();assert.match(f.paint(),/Review product quantities/);assert.equal(f.button('Record sale & deduct stock'),undefined);}
    quantity(f,'1.5');reviewStep(f);f.r.fail=false;await f.button('Record sale & deduct stock').onClick();assert.equal(f.calls.find(c=>c.action==='recordSuppliedOrder').lines.length,1);
  }finally{f.close();}
});

test('review retains VAT-inclusive prices and shows invalid price previews without crashing',async()=>{
  const {render}=await bundle(),f=setup(render,{...options,defaultSource:'company'},{...stock,products:stock.products.map(p=>({...p,tax_rate:19.25}))});
  try{await f.ready();await productsStep(f);quantity(f,2);assert.match(f.paint(),/already include VAT/);reviewStep(f);assert.match(f.paint(),/VAT included/);f.r.fail=false;await f.button('Record sale & deduct stock').onClick();assert.equal(f.calls.find(c=>c.action==='recordSuppliedOrder').expectedTotal,1000);}finally{f.close();}
});


test('replacement question is required, product picker preserves free quantities and shortage checks, and failed saves retain the answer',async()=>{
  const {render}=await bundle(),f=setup(render);
  try{
    await f.ready();await productsStep(f);f.button('Choose products').onClick();f.paint();quantity(f,2);f.r.productPicker.onOpenChange(false);f.paint();
    f.button('Review sale').onClick();assert.match(f.paint(),/Please answer whether spoiled goods/);
    f.button('Yes, goods replaced').onClick();f.paint();f.button('Review sale').onClick();assert.match(f.paint(),/Add the products and quantities replaced/);
    f.button('Choose replacement products').onClick();f.paint();assert.equal(f.r.replacementPicker.purpose,'replacement');assert.equal(f.r.replacementPicker.products[0].available,8);
    f.r.replacementPicker.onQuantityChange(f.r.replacementPicker.products[0],9);f.r.replacementPicker.onOpenChange(false);f.paint();
    f.r.controls.find(c=>c.id==='exchange-expiry-0').onChange({target:{value:'2000-01-01'}});f.paint();f.button('Review sale').onClick();assert.match(f.paint(),/exceed the available/);
    f.r.controls.find(c=>c.id==='exchange-qty-0').onChange({target:{value:'3'}});f.paint();assert.equal(f.r.productPicker.products[0].available,7,'paid picker reserves the three replacement units');f.button('Review sale').onClick();assert.match(f.paint(),/Free spoilage replacements/);
    f.control('Receipt reference number').onChange({target:{value:'WITH-EXCHANGE'}});f.paint();await f.button('Record sale & deduct stock').onClick();assert.match(f.paint(),/Connection interrupted/);
    const body=f.calls.find(c=>c.action==='recordSuppliedOrder');assert.equal(body.replacementsDeclared,true);assert.equal(body.stockReplacements[0].quantity,'3');assert.equal(body.expectedTotal,1000);assert.equal(body.lines[0].quantity,2);
    f.button('Edit products').onClick();f.paint();assert.equal(f.r.controls.find(c=>c.id==='exchange-qty-0').value,'3');
  }finally{f.close();}
});


test('Sales records replacements only as an exchange and opens its receipt without an invoice',async()=>{
  const {render}=await bundle(),f=setup(render),original=f.r.invoke;
  f.r.invoke=async body=>body.action==='recordSuppliedOrder'?(f.calls.push(body),{data:{order:{id:'exchange'},invoiceId:'',exchangeOnly:true}}):original(body);
  try{
    await f.ready();await productsStep(f);f.button('Yes, goods replaced').onClick();f.paint();f.button('Choose replacement products').onClick();for(let i=0;i<3;i++){f.paint();await f.r.flush();}f.paint();
    f.r.replacementPicker.onQuantityChange(f.r.replacementPicker.products[0],3);f.r.replacementPicker.onOpenChange(false);f.paint();f.r.controls.find(c=>c.id==='exchange-reason-0').onChange({target:{value:'damaged'}});f.paint();
    f.button('Review sale').onClick();assert.match(f.paint(),/Exchange only — no customer charge/);f.control('Receipt reference number').onChange({target:{value:'EXCHANGE-1'}});f.paint();assert.equal(f.button('Record exchange & deduct stock').disabled,false);await f.button('Record exchange & deduct stock').onClick();
    const body=f.calls.find(c=>c.action==='recordSuppliedOrder');assert.deepEqual(body.lines,[]);assert.equal(body.paymentType,'exchange');assert.equal(body.expectedTotal,0);assert.equal(body.stockReplacements[0].quantity,3);assert.deepEqual(f.r.navigation,['/sales/exchange']);
  }finally{f.close();}
});

test('Sales refreshes source availability and new products on focus without discarding entered quantities',async()=>{
  const {render}=await bundle(),current=structuredClone(stock),events=new Map(),previous={window:globalThis.window,document:globalThis.document};let tick;
  globalThis.window={location:{search:''},setInterval(fn){tick=fn;return 1;},clearInterval(){},addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name)};
  globalThis.document={hidden:false,addEventListener(){},removeEventListener(){}};
  const f=setup(render,options,current);
  try{
    await f.ready();await productsStep(f);quantity(f,4);current.products[0].available=2;current.products.push({id:'new',name:'New finished product',inventory_type:'assembly',available:9,selling_price:500});
    events.get('focus')();for(let i=0;i<3;i++){f.paint();await f.r.flush();}f.paint();assert.equal(f.control('Qty 1').value,4);assert.equal(f.r.productPicker.products[0].available,2);assert.equal(f.r.productPicker.products.find(p=>p.id==='new').available,9);
    f.button('No replacements').onClick();f.paint();f.button('Review sale').onClick();assert.match(f.paint(),/Review product quantities/);assert.equal(f.calls.some(c=>c.action==='recordSuppliedOrder'),false);
    const before=f.calls.length;tick();for(let i=0;i<3;i++){f.paint();await f.r.flush();}assert.ok(f.calls.length>before);
  }finally{f.close();globalThis.window=previous.window;globalThis.document=previous.document;}
});

test('personal stock sale uses scoped endpoints and returns to the employee stock page',async()=>{
 const {render}=await bundle(),f=setup(()=>render({ownIssuedStock:true}),{...options,warehouses:[]});
 f.r.invoke=async body=>{f.calls.push(body);if(body.action==='employeeSalesWorkspace')return {data:{...options,warehouses:[]}};if(body.action==='employeeSalesStock')return {data:stock};if(body.action==='employeeSalesDeliveryPoints')return {data:{points:[]}};if(body.action==='employeeRecordSupply')return {data:{order:{id:'own'},invoiceId:'own-invoice'}};throw Error('Unscoped action '+body.action);};
 try{await f.ready();await productsStep(f);quantity(f,2);reviewStep(f);await f.button('Record sale & deduct stock').onClick();assert.equal(f.calls.at(-1).action,'employeeRecordSupply');assert.equal(f.calls.at(-1).dispatchId,'run-a');assert.equal(f.calls.at(-1).sourceType,'issued');assert.deepEqual(f.r.navigation,['/my-stock']);assert.equal(f.r.sourcePicker.options.length,1);}finally{f.close();}
});
