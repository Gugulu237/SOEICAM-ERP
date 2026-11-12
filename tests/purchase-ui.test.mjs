import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
import {purchasePermissions} from '../src/lib/purchase-workspace.js';
const require=createRequire(import.meta.url);
async function ui(){
  const output=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Workspace,{PurchaseOrderDialog} from './src/components/purchases/PurchasesWorkspace.jsx';import SupplierWorkspace from './src/components/suppliers/SupplierWorkspace.jsx';export const render=(props,detail=false)=>renderToStaticMarkup(React.createElement(detail==='supplier'?SupplierWorkspace:detail?PurchaseOrderDialog:Workspace,props));`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,format:'cjs',platform:'node',write:false,plugins:[{name:'purchase-ui',setup(b){
    b.onResolve({filter:/^react$/},args=>/(?:PurchasesWorkspace|SupplierWorkspace)\.jsx$/.test(args.importer)?{path:'hooks',namespace:'fixture'}:undefined);
    b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`import React from ${JSON.stringify(require.resolve('react'))};export default {...React,createElement:(tag,props,...children)=>{globalThis.__purchaseUI.capture(tag,props,children);return React.createElement(tag,props,...children);}};export const useState=v=>globalThis.__purchaseUI.state('purchase',v);export const useRef=v=>globalThis.__purchaseUI.ref('purchase',v);export const useEffect=(fn,deps)=>globalThis.__purchaseUI.effect('purchase',fn,deps);export function useCallback(fn,deps){const slot=globalThis.__purchaseUI.ref('purchase',null);if(!slot.current || deps.some((v,i)=>!Object.is(v,slot.current.deps[i])))slot.current={fn,deps};return slot.current.fn;}`,resolveDir:process.cwd()}));
    const mocks={
      'next/dynamic':`import React from 'react';export default function dynamic(){return function Lazy(){globalThis.__purchaseUI.suppliersMounted=true;return React.createElement('p',null,'Supplier management loaded');};}`,
      '@/lib/router':`import React from 'react';export const Link=({to,children,...props})=>React.createElement('a',{...props,href:to},children);export const useNavigate=()=>path=>{globalThis.__purchaseUI.query=path.split('?')[1]||'';};export const useSearchParams=()=>[new URLSearchParams(globalThis.__purchaseUI.query || ''),value=>{const r=globalThis.__purchaseUI;const next=typeof value==='function'?value(new URLSearchParams(r.query || '')):value;r.query=next.toString();}];`,
      '@/hooks/usePhoneLayout': `export const usePhoneLayout=()=>Boolean(globalThis.__purchaseUI.phone);`,
      '@/hooks/useCurrentUser':`export const useCurrentUser=()=>globalThis.__purchaseUI.session;`,
      '@/api/erpClient':`export const invalidateERPReads=()=>{};export const erp={functions:{invoke:async(name,body)=>({data:await globalThis.__purchaseUI.request(body)})}};`,
      '@/components/ui/use-toast':`export const useToast=()=>({toast:v=>globalThis.__purchaseUI.notifications.push(v)});`,
      '@/components/ui/button':`import React from 'react';export function Button({children,onClick,asChild,...props}){globalThis.__purchaseUI.capture('button',{...props,onClick},children);return React.createElement('button',props,children);}`,
      '@/components/ui/dialog':`import React from 'react';export const Dialog=({children})=>React.createElement('div',null,children);export const DialogContent=Dialog,DialogHeader=Dialog,DialogTitle=Dialog,DialogDescription=Dialog,DialogFooter=Dialog;`,
    };
    b.onResolve({filter:/^(?:@\/|next\/dynamic$)/},args=>Object.hasOwn(mocks,args.path)?{path:args.path,namespace:'leaf'}:undefined);
    b.onLoad({filter:/.*/,namespace:'leaf'},args=>({contents:mocks[args.path],resolveDir:process.cwd()}));
  }}]});const mod={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(require,mod,mod.exports);return mod.exports.render;
}
const order={id:'order-a',po_number:'PO-TEST-01',supplier_id:'supplier-a',supplier_name:'Dairy supplier',order_date:'2026-10-18',status:'pending_approval',total:1100,subtotal:1000,tax_total:100,requested_by_name:'Buyer'};
function runtime(role='admin'){const r=hookRuntime();r.session={role,loading:false};return r;}

test('the unified purchase register renders real row values and opens order and supplier details in place',async()=>{
  const render=await ui(),r=runtime(),calls=[];globalThis.__purchaseUI=r;r.query='section=orders';r.request=async body=>{calls.push(body);return {permissions:purchasePermissions('admin'),orders:[order]};};
  const draw=()=>{r.beforeRender();return render();};
  try{draw();await r.flush();const html=draw();assert.match(html,/PO-TEST-01/);assert.match(html,/Dairy supplier/);assert.match(html,/Buyer/);assert.equal(r.suppliersMounted,undefined);assert.deepEqual(calls.map(c=>c.action),['purchasesWorkspace']);
    r.buttons.find(b=>b.label==='Review existing order').onClick();assert.equal(new URLSearchParams(r.query).get('order'),order.id);assert.equal(new URLSearchParams(r.query).get('section'),'orders');
    r.query='section=orders';draw();r.buttons.find(b=>b.label==='Dairy supplier').onClick();assert.equal(new URLSearchParams(r.query).get('section'),'suppliers');assert.equal(new URLSearchParams(r.query).get('supplier'),'supplier-a');draw();assert.equal(r.suppliersMounted,true);
  }finally{r.cleanup();delete globalThis.__purchaseUI;}
});

test('cashier purchase links show an access error without fetching any purchase data',async()=>{
  const render=await ui(),r=runtime('cashier');globalThis.__purchaseUI=r;r.query='section=payments';const calls=[];
  r.request=async body=>{calls.push(body);return {};};
  const draw=()=>{r.beforeRender();return render();};
  try{assert.match(draw(),/Purchases are reserved for administrators/);await r.flush();assert.deepEqual(calls,[]);assert.equal(r.suppliersMounted,undefined);}finally{r.cleanup();delete globalThis.__purchaseUI;}
});

test('an administrator can confirm an existing order and retry a failed confirmation',async()=>{
  const render=await ui(),r=runtime(),calls=[];globalThis.__purchaseUI=r;let fail=true,saved=0;
  r.request=async body=>{calls.push(body);if(body.action==='confirmSupplierOrder'&&fail)throw Error('Confirmation connection interrupted');return {permissions:purchasePermissions('admin'),order,supplier:{id:'supplier-a',name:'Dairy supplier'},orderLines:[{id:'line-a',product_name:'Milk powder',quantity:10,unit:'kg',unit_price:100,total:1100}],requires_supplier_split:false};};
  const props={orderId:order.id,onClose:()=>{},onSaved:()=>saved++,openSupplier:()=>{}},draw=()=>{r.beforeRender();return render(props,true);};
  try{draw();await r.flush();assert.match(draw(),/Milk powder/);await r.buttons.find(b=>b.label==='Confirm existing order').onClick();assert.match(draw(),/Confirmation connection interrupted/);assert.equal(saved,0);fail=false;await r.buttons.find(b=>b.label==='Confirm existing order').onClick();assert.equal(saved,1);assert.deepEqual(calls.filter(b=>b.action==='confirmSupplierOrder'),[{action:'confirmSupplierOrder',orderId:order.id,reason:''},{action:'confirmSupplierOrder',orderId:order.id,reason:''}]);}finally{r.cleanup();delete globalThis.__purchaseUI;}
});

test('order details offer direct cash payment before delivery and a bill payment after credit delivery',async()=>{
  const render=await ui();
  for(const phone of [false,true]){
    const r=runtime();r.phone=phone;globalThis.__purchaseUI=r;
    let currentOrder={...order,payment_terms:'cash',status:'approved'};
    let bills=[];
    const calls=[];
    r.request=async body=>{
      calls.push(body);
      return {permissions:purchasePermissions('admin'),order:currentOrder,orderPayments:[],orderBills:bills};
    };
    const props={orderId:order.id,onClose:()=>{},onSaved:()=>{},openSupplier:()=>{}};
    const draw=()=>{r.beforeRender();return render(props,true);};
    try{
      draw();await r.flush();
      assert.match(draw(),/Pay cash/);
      assert.ok(r.buttons.some(button=>button.label==='Record cash payment'));
      assert.ok(r.buttons.some(button=>button.label==='Receive goods'));
      assert.deepEqual(calls.map(call=>call.action),['purchasesWorkspace']);
    }finally{r.cleanup();delete globalThis.__purchaseUI;}

    const credit=runtime();credit.phone=phone;globalThis.__purchaseUI=credit;
    currentOrder={...order,payment_terms:'credit',status:'partially_received'};
    bills=[{id:'bill',bill_number:'BILL-ON-CREDIT',status:'open',balance:440,due_date:'2026-11-17'}];
    credit.request=r.request;
    const drawCredit=()=>{credit.beforeRender();return render(props,true);};
    try{
      drawCredit();await credit.flush();
      assert.match(drawCredit(),/Buy on credit/);
      assert.match(drawCredit(),/BILL-ON-CREDIT/);
      assert.ok(credit.buttons.some(button=>button.label==='Pay supplier bill'));
      assert.ok(!credit.buttons.some(button=>button.label==='Record cash payment'));
    }finally{credit.cleanup();delete globalThis.__purchaseUI;}
  }
});

test('purchase landing opens four separate destinations without fetching registers until selected',async()=>{
  const render=await ui(),r=runtime(),calls=[];globalThis.__purchaseUI=r;
  r.request=async body=>{calls.push(body);return {permissions:purchasePermissions('admin'),orders:[order],date:'2026-10-18',bills:[{id:'bill-one',bill_number:'BILL-ONLY',supplier_name:'Vendor',status:'open',balance:50}],payments:[{id:'payment-one',payment_number:'PAYMENT-ONLY',party_name:'Vendor',status:'posted',amount:50}]};};
  const draw=()=>{r.beforeRender();return render();};
  try{
    let html=draw();await r.flush();assert.equal(calls.length,0);assert.equal(r.suppliersMounted,undefined);
    assert.deepEqual(r.buttons.map(b=>b['aria-label']),['Purchase orders','Suppliers','Bills','Payments']);
    assert.doesNotMatch(html,/<table|Search purchase orders|Refresh/);
    r.buttons.find(b=>b['aria-label']==='Purchase orders').onClick();draw();await r.flush();html=draw();assert.match(html,/PO-TEST-01/);assert.equal(calls.at(-1).section,'orders');
    r.buttons.find(b=>b["aria-label"]==='Purchases menu').onClick();draw();await r.flush();draw();
    r.buttons.find(b=>b['aria-label']==='Bills').onClick();draw();await r.flush();html=draw();assert.match(html,/BILL-ONLY/);assert.doesNotMatch(html,/PAYMENT-ONLY|Payment authorization|New purchase order|Purchases sections|Search purchase payments/);assert.match(html,/Search supplier bills|Unpaid supplier bills/);
    r.buttons.find(b=>b["aria-label"]==='Purchases menu').onClick();draw();await r.flush();draw();
    r.buttons.find(b=>b['aria-label']==='Payments').onClick();draw();await r.flush();html=draw();assert.match(html,/PAYMENT-ONLY/);assert.doesNotMatch(html,/BILL-ONLY|Unpaid supplier bills|Overdue bills|New purchase order|Purchases sections/);assert.match(html,/Search purchase payments|Posted payments|Approved for release/);assert.equal(calls.at(-1).section,'payments');
    r.buttons.find(b=>b["aria-label"]==='Purchases menu').onClick();draw();await r.flush();draw();
    r.buttons.find(b=>b['aria-label']==='Suppliers').onClick();draw();assert.equal(r.suppliersMounted,true);
  }finally{r.cleanup();delete globalThis.__purchaseUI;}
});

test('a direct purchase order link cannot load records for warehouse staff',async()=>{
  const render=await ui(),r=runtime('warehouse_manager'),calls=[];globalThis.__purchaseUI=r;r.query='order=order-a';
  r.request=async body=>{calls.push(body);return {};};
  try{r.beforeRender();assert.match(render(),/Purchases are reserved for administrators/);await r.flush();assert.deepEqual(calls,[]);}
  finally{r.cleanup();delete globalThis.__purchaseUI;}
});

test('goods receiving remains reachable from purchase orders and shows only orders awaiting delivery',async()=>{
  const render=await ui(),r=runtime('admin');globalThis.__purchaseUI=r;r.query='section=orders';
  r.request=async()=>({permissions:purchasePermissions('admin'),orders:[order,{...order,id:'awaiting',po_number:'PO-AWAITING',status:'approved'},{...order,id:'complete',po_number:'PO-COMPLETE',status:'received'}]});
  const draw=()=>{r.beforeRender();return render();};
  try{draw();await r.flush();draw();r.buttons.find(b=>b.label==='Receive goods').onClick();draw();await r.flush();const html=draw();
    assert.equal(new URLSearchParams(r.query).get('section'),'receiving');assert.match(html,/PO-AWAITING/);assert.doesNotMatch(html,/PO-TEST-01|PO-COMPLETE|Awaiting authorization|New purchase order|Purchases sections/);
    r.buttons.find(b=>b['aria-label']==='Purchase orders').onClick();assert.equal(r.query,'section=orders');
  }finally{r.cleanup();delete globalThis.__purchaseUI;}
});

test('supplier profiles have a list return and a compact report selector without the horizontal tab carousel',async()=>{
  const render=await ui(),r=runtime(),calls=[];globalThis.__purchaseUI=r;r.query='section=suppliers';
  const supplier={id:'vendor',name:'Milk vendor',is_active:true,unpaid_bills:0,overdue:0,ledger_balance:0,balance_difference:0};
  r.request=async body=>{calls.push(body);return {permissions:{manage:true,purchase:true,receive:true,pay:true},suppliers:[supplier],supplier:body.supplierId?supplier:undefined,products:[],orders:[],bills:[],payments:[],receipts:[]};};
  const draw=()=>{r.beforeRender();return render({embedded:true},'supplier');};
  try{
    draw();await r.flush();let html=draw();assert.match(html,/Milk vendor/);assert.doesNotMatch(html,/Supplier details/);
    r.buttons.find(b=>b['aria-label']==='Milk vendor').onClick();draw();await r.flush();html=draw();assert.equal(new URLSearchParams(r.query).get('supplier'),'vendor');assert.match(html,/<aside class="hidden lg:block/);assert.doesNotMatch(html,/<nav/);
    assert.equal((html.match(/data-page-back=/g)||[]).length,1);assert.equal(r.buttons.filter(b=>b['data-page-back']!==undefined)[0]['aria-label'],'Back to suppliers');
    const selector=r.controls.find(c=>c['aria-label']==='Supplier details');assert.equal(selector.value,'overview');selector.onChange({target:{value:'items'}});draw();assert.equal(new URLSearchParams(r.query).get('supplier_tab'),'items');assert.equal(calls.filter(c=>c.action!=='supplierWorkspace').length,0);
    r.buttons.find(b=>b["aria-label"]==='Back to suppliers').onClick();assert.equal(r.query,'section=suppliers');draw();await r.flush();html=draw();assert.doesNotMatch(html,/Supplier details/);
  }finally{r.cleanup();delete globalThis.__purchaseUI;}
});
