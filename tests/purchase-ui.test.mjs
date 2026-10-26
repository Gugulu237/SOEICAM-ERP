import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';
import {purchasePermissions} from '../src/lib/purchase-workspace.js';
const require=createRequire(import.meta.url);
async function ui(){
  const output=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Workspace,{PurchaseOrderDialog} from './src/components/purchases/PurchasesWorkspace.jsx';export const render=(props,detail=false)=>renderToStaticMarkup(React.createElement(detail?PurchaseOrderDialog:Workspace,props));`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,format:'cjs',platform:'node',write:false,plugins:[{name:'purchase-ui',setup(b){
    b.onResolve({filter:/^react$/},args=>args.importer.endsWith('PurchasesWorkspace.jsx')?{path:'hooks',namespace:'fixture'}:undefined);
    b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`import React from ${JSON.stringify(require.resolve('react'))};export default {...React,createElement:(tag,props,...children)=>{globalThis.__purchaseUI.capture(tag,props,children);return React.createElement(tag,props,...children);}};export const useState=v=>globalThis.__purchaseUI.state('purchase',v);export const useRef=v=>globalThis.__purchaseUI.ref('purchase',v);export const useEffect=(fn,deps)=>globalThis.__purchaseUI.effect('purchase',fn,deps);export function useCallback(fn,deps){const slot=globalThis.__purchaseUI.ref('purchase',null);if(!slot.current || deps.some((v,i)=>!Object.is(v,slot.current.deps[i])))slot.current={fn,deps};return slot.current.fn;}`,resolveDir:process.cwd()}));
    const mocks={
      'next/dynamic':`import React from 'react';export default function dynamic(){return function Lazy(){globalThis.__purchaseUI.suppliersMounted=true;return React.createElement('p',null,'Supplier management loaded');};}`,
      '@/lib/router':`import React from 'react';export const Link=({to,children,...props})=>React.createElement('a',{...props,href:to},children);export const useSearchParams=()=>[new URLSearchParams(globalThis.__purchaseUI.query || ''),value=>{const r=globalThis.__purchaseUI;const next=typeof value==='function'?value(new URLSearchParams(r.query || '')):value;r.query=next.toString();}];`,
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
  const render=await ui(),r=runtime(),calls=[];globalThis.__purchaseUI=r;r.request=async body=>{calls.push(body);return {permissions:purchasePermissions('admin'),orders:[order]};};
  const draw=()=>{r.beforeRender();return render();};
  try{draw();await r.flush();const html=draw();assert.match(html,/PO-TEST-01/);assert.match(html,/Dairy supplier/);assert.match(html,/Buyer/);assert.equal(r.suppliersMounted,undefined);assert.deepEqual(calls.map(c=>c.action),['purchasesWorkspace']);
    r.buttons.find(b=>b.label==='Review / approve').onClick();assert.equal(new URLSearchParams(r.query).get('order'),order.id);assert.equal(new URLSearchParams(r.query).get('section'),null);
    r.query='';draw();r.buttons.find(b=>b.label==='Dairy supplier').onClick();assert.equal(new URLSearchParams(r.query).get('section'),'suppliers');assert.equal(new URLSearchParams(r.query).get('supplier'),'supplier-a');draw();assert.equal(r.suppliersMounted,true);
  }finally{r.cleanup();delete globalThis.__purchaseUI;}
});

test('cashier purchase screens expose approval requests and release only, never authorize or create purchases',async()=>{
  const render=await ui(),r=runtime('cashier');globalThis.__purchaseUI=r;r.query='section=bills';r.request=async()=>({permissions:purchasePermissions('cashier'),orders:[],date:'2026-10-18',bills:[],payments:[{id:'p1',payment_number:'PAY-PENDING',party_name:'Supplier',status:'pending_approval',amount:500,payment_method:'cash'},{id:'p2',payment_number:'PAY-READY',party_name:'Supplier',status:'approved',amount:500,payment_method:'cash',treasury_account_id:'till'}]});
  const draw=()=>{r.beforeRender();return render();};
  try{draw();await r.flush();const html=draw();assert.match(html,/PAY-PENDING/);assert.match(html,/PAY-READY/);assert.equal(r.buttons.some(b=>['Authorize','Refuse','New purchase order'].includes(b.label)),false);assert.equal(r.buttons.some(b=>b.label==='Release payment'),true);assert.equal(r.buttons.some(b=>b.label==='Receiving'),false);assert.equal(r.suppliersMounted,undefined);}finally{r.cleanup();delete globalThis.__purchaseUI;}
});

test('reviewing a purchase sends checked GM authorization without client approval metadata and keeps failed requests visible',async()=>{
  const render=await ui(),r=runtime(),calls=[];globalThis.__purchaseUI=r;let fail=true,saved=0;
  r.request=async body=>{calls.push(body);if(body.action==='approveSupplierOrder'&&fail)throw Error('Approval connection interrupted');return {permissions:purchasePermissions('admin'),order,supplier:{id:'supplier-a',name:'Dairy supplier'},orderLines:[{id:'line-a',product_name:'Milk powder',quantity:10,unit:'kg',unit_price:100,total:1100}],requires_supplier_split:false};};
  const props={orderId:order.id,onClose:()=>{},onSaved:()=>saved++,openSupplier:()=>{}},draw=()=>{r.beforeRender();return render(props,true);};
  try{draw();await r.flush();assert.match(draw(),/Milk powder/);await r.buttons.find(b=>b.label==='Approve purchase').onClick();assert.match(draw(),/Approval connection interrupted/);assert.equal(saved,0);fail=false;await r.buttons.find(b=>b.label==='Approve purchase').onClick();assert.equal(saved,1);assert.deepEqual(calls.filter(b=>b.action==='approveSupplierOrder'),[{action:'approveSupplierOrder',orderId:order.id,reason:''},{action:'approveSupplierOrder',orderId:order.id,reason:''}]);}finally{r.cleanup();delete globalThis.__purchaseUI;}
});
