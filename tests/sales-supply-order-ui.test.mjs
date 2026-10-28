import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url);
let compiled;
async function bundle(){
  compiled ||= build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Form from './src/views/SalesOrderForm.jsx';export const render=()=>renderToStaticMarkup(React.createElement(Form));",resolveDir:process.cwd(),loader:'jsx'},bundle:true,format:'cjs',platform:'node',write:false,plugins:[{name:'sales-order-ui',setup(b){
    b.onResolve({filter:/^react$/},a=>a.importer.endsWith('SalesOrderForm.jsx')?{path:'hooks',namespace:'fixture'}:undefined);
    b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:"import React from "+JSON.stringify(require.resolve('react'))+";export default {...React,createElement:(tag,props,...children)=>{globalThis.__suppliedOrderUI.capture(tag,props,children);return React.createElement(tag,props,...children);}};export const useState=v=>globalThis.__suppliedOrderUI.state('form',v),useRef=v=>globalThis.__suppliedOrderUI.ref('form',v),useMemo=fn=>fn(),useEffect=(f,d)=>globalThis.__suppliedOrderUI.effect('form',f,d);",resolveDir:process.cwd()}));
    const mocks={
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
const options={currentSellerId:'seller',sellers:[{id:'seller',name:'Salesperson A'},{id:'other',name:'Salesperson B'}],date:'2026-10-25',runs:[{id:'run-a',commercial_name:'Agent A',driver_name:'Driver A',vehicle_name:'Van A',dispatch_number:'DSP-1'}],warehouses:[{id:'main',name:'Main Cold Room'}],customers:[{id:'customer',business_name:'Customer',payment_terms_days:0}]};
const stock={source:{stock_warehouse_id:'van'},products:[{id:'yola',name:'YOLA 500 g',unit:'ea',inventory_type:'assembly',available:10,selling_price:500,tax_rate:0}]};
function setup(render,workspace=options,stockData=stock){
  const r=hookRuntime(),calls=[];r.client={entities:{CustomerLocation:{filter:async()=>[]},Customer:{filter:async()=>[]}}};r.fail=true;r.routeId=undefined;
  r.invoke=async body=>{calls.push(body);if(body.action==='salesOrderWorkspace')return {data:workspace};if(body.action==='salesOrderStock')return {data:stockData};if(body.action==='salesOrderDeliveryPoints')return {data:{points:[]}};if(r.fail)throw Error('Connection interrupted');return {data:{order:{id:'order'},invoiceId:'invoice'}};};
  globalThis.__suppliedOrderUI=r;
  const paint=()=>{r.beforeRender();return render();},control=label=>r.controls.find(c=>c['aria-label']===label),button=label=>r.buttons.find(b=>b.label===label);
  return {r,calls,paint,control,button,async ready(){paint();await r.flush();paint();await r.flush();return paint();},close(){r.cleanup();delete globalThis.__suppliedOrderUI;}};
}

test('sale entry defaults to the issued load, shows the main warehouse choice and keeps quantities plus retry identity after an interrupted save',async()=>{
  const {render}=await bundle(),f=setup(render);
  try{
    const html=await f.ready();assert.match(html,/Agent A/);assert.match(html,/Main Cold Room/);assert.equal(f.control('Stock source').value,'issued:run-a');
    f.control('Customer').onChange({target:{value:'customer'}});f.paint();await f.r.flush();f.paint();
    f.button('Add product').onClick();f.paint();f.control('Product 1').onChange({target:{value:'yola'}});f.paint();
    f.control('Qty 1').onChange({target:{value:'2'}});f.paint();
    assert.equal(f.button('Record sale & deduct stock').disabled,false);
    const save=f.button('Record sale & deduct stock').onClick;await Promise.all([save(),save()]);assert.equal(f.calls.filter(b=>b.action==='recordSuppliedOrder').length,1);
    assert.match(f.paint(),/Connection interrupted/);assert.equal(f.control('Qty 1').value,'2');assert.equal(f.control('Stock source').value,'issued:run-a');
    f.r.fail=false;await f.button('Record sale & deduct stock').onClick();
    const writes=f.calls.filter(b=>b.action==='recordSuppliedOrder');assert.equal(writes[0].requestKey,writes[1].requestKey);assert.equal(writes[1].dispatchId,'run-a');assert.equal(writes[1].sellerId,'seller');assert.equal(writes[1].sourceType,'issued');assert.equal(writes[1].expectedTotal,1000);assert.deepEqual(f.r.navigation,['/sales/invoices/invoice']);
  }finally{f.close();}
});

test('choosing the main warehouse requests that stock explicitly and never carries the previous issued load into the sale',async()=>{
  const {render}=await bundle(),f=setup(render);
  try{
    await f.ready();f.control('Stock source').onChange({target:{value:'warehouse:main'}});f.paint();await f.r.flush();f.paint();
    const read=f.calls.filter(b=>b.action==='salesOrderStock').at(-1);assert.equal(read.sourceType,'warehouse');assert.equal(read.warehouseId,'main');assert.equal(read.dispatchId,undefined);
    f.control('Customer').onChange({target:{value:'customer'}});f.paint();await f.r.flush();f.paint();
    f.button('Add product').onClick();f.paint();f.control('Product 1').onChange({target:{value:'yola'}});f.paint();f.r.fail=false;
    await f.button('Record sale & deduct stock').onClick();const write=f.calls.find(b=>b.action==='recordSuppliedOrder');
    assert.equal(write.sourceType,'warehouse');assert.equal(write.warehouseId,'main');assert.equal(write.dispatchId,undefined);
  }finally{f.close();}
});

test('customer and sale details precede stock source; changing the salesperson or date does not change the chosen stock holder',async()=>{
  const {render}=await bundle(),f=setup(render);
  try{
    const html=await f.ready();
    assert.ok(html.indexOf('aria-label="Customer"')<html.indexOf('aria-label="Stock source"'));
    f.control('Customer').onChange({target:{value:'customer'}});f.control('Person making the sale').onChange({target:{value:'other'}});f.paint();await f.r.flush();f.paint();
    const past=new Date(Date.now()-86400000).toISOString().slice(0,10);
    f.control('Sale date').onChange({target:{value:past}});f.paint();await f.r.flush();f.paint();
    assert.equal(f.control('Stock source').value,'issued:run-a');
    f.button('Add product').onClick();f.paint();f.control('Product 1').onChange({target:{value:'yola'}});f.paint();f.r.fail=false;
    await f.button('Record sale & deduct stock').onClick();
    const write=f.calls.find(b=>b.action==='recordSuppliedOrder');
    assert.equal(write.sellerId,'other');assert.equal(write.dispatchId,'run-a');assert.equal(write.date,past);
  }finally{f.close();}
});


test('new sale automatically shows company stock and hides individual warehouse choices',async()=>{
 const {render}=await bundle(),f=setup(render,{...options,defaultSource:'company',warehouses:[...options.warehouses,{id:'other',name:'Second storage'}]});
 try{
  const html=await f.ready();assert.equal(f.control('Stock source').value,'company');assert.match(html,/Company stock/);assert.doesNotMatch(html,/Main Cold Room|Second storage/);
  const read=f.calls.filter(c=>c.action==='salesOrderStock').at(-1);assert.equal(read.sourceType,'company');assert.equal(read.warehouseId,undefined);assert.equal(read.dispatchId,undefined);
  f.control('Customer').onChange({target:{value:'customer'}});f.paint();await f.r.flush();f.paint();f.button('Add product').onClick();f.paint();f.control('Product 1').onChange({target:{value:'yola'}});f.paint();f.r.fail=false;
  await f.button('Record sale & deduct stock').onClick();const write=f.calls.find(c=>c.action==='recordSuppliedOrder');assert.equal(write.sourceType,'company');assert.equal(write.warehouseId,undefined);assert.equal(write.dispatchId,undefined);
 }finally{f.close();}
});


test('an older unsupplied order retains its recorded warehouse when opened under company-stock mode',async()=>{
 const {render}=await bundle(),f=setup(render,{...options,defaultSource:'company'});f.r.routeId='old';
 f.r.client.entities.SalesOrder={get:async()=>({id:'old',status:'draft',warehouse_id:'main',warehouse_name:'Main Cold Room',customer_id:'customer',order_date:'2026-10-25',salesperson_id:'seller'})};f.r.client.entities.SalesOrderLine={filter:async()=>[]};
 try{const html=await f.ready();assert.equal(f.control('Stock source').value,'warehouse:main');assert.match(html,/Main Cold Room/);assert.equal(f.calls.filter(c=>c.action==='salesOrderStock').at(-1).warehouseId,'main');}finally{f.close();}
});


test('VAT-inclusive listed prices stay unchanged in sale entry and its submitted total',async()=>{
 const {render}=await bundle(),f=setup(render,{...options,defaultSource:'company'},{...stock,products:stock.products.map(p=>({...p,tax_rate:19.25}))});
 try{await f.ready();f.control('Customer').onChange({target:{value:'customer'}});f.paint();await f.r.flush();f.paint();f.button('Add product').onClick();f.paint();f.control('Product 1').onChange({target:{value:'yola'}});f.paint();f.control('Qty 1').onChange({target:{value:'2'}});let html=f.paint();assert.match(html,/VAT included/);assert.match(html,/already include VAT/);f.r.fail=false;await f.button('Record sale & deduct stock').onClick();assert.equal(f.calls.find(c=>c.action==='recordSuppliedOrder').expectedTotal,1000);}finally{f.close();}
});

test('invalid price previews show validation instead of crashing the sale page',async()=>{
 const {render}=await bundle(),f=setup(render);
 try{await f.ready();f.button('Add product').onClick();f.paint();f.control('Product 1').onChange({target:{value:'yola'}});f.paint();f.control('Qty 1').onChange({target:{value:'-1'}});assert.doesNotThrow(()=>f.paint());assert.equal(f.button('Record sale & deduct stock').disabled,true);}finally{f.close();}
});
