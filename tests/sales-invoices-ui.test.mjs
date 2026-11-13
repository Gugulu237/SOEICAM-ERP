import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { hookRuntime } from './helpers/commercial-ui.mjs';
import { invoiceDefaults } from '../src/lib/invoice-documents.js';
const require=createRequire(import.meta.url);

async function ui() {
  const output=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Workspace,{CreateInvoiceDialog} from './src/components/sales/InvoiceWorkspace.jsx';import Invoice from './src/views/SalesInvoice.jsx';export const render=(name,props)=>renderToStaticMarkup(React.createElement(name==='create'?CreateInvoiceDialog:name==='list'?Workspace:Invoice,props));`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'invoice-ui',setup(b){
    b.onResolve({filter:/^react$/},args=>/(InvoiceWorkspace|SalesInvoice)\.jsx$/.test(args.importer)?{path:args.importer.endsWith('SalesInvoice.jsx')?'detail':'create',namespace:'hooks'}:undefined);
    b.onLoad({filter:/.*/,namespace:'hooks'},({path:key})=>({contents:`import React from ${JSON.stringify(require.resolve('react'))};export default React;export const useState=v=>globalThis.__invoiceUI.state(${JSON.stringify(key)},v);export const useEffect=(fn,deps)=>globalThis.__invoiceUI.effect(${JSON.stringify(key)},fn,deps);export const useMemo=fn=>fn();`,resolveDir:process.cwd()}));
    const mocks={
      '@/hooks/usePhoneLayout':'export const usePhoneLayout=()=>!!globalThis.__invoiceUI.phone;',
      '@/components/shared/DataTable':"import React from 'react';export default function Table(props){return React.createElement('div',null,props.data.map(row=>React.createElement('div',{key:row.id},row.invoice_number,props.columns.find(c=>c.key==='customize')?.render(null,row))));}",
      '@/api/erpClient':`export const erp={customers:{invoiceDetail:(...args)=>globalThis.__invoiceUI.customerInvoice(...args)},functions:{invoke:async(name,body)=>({data:await globalThis.__invoiceUI.request(body)})}};`,
      '@/lib/router':`const navigate=path=>globalThis.__invoiceUI.navigation.push(path);export const useNavigate=()=>navigate;export const useParams=()=>globalThis.__invoiceUI.params||({id:'invoice-1'});export const useSearchParams=()=>[new URLSearchParams(globalThis.__invoiceUI.query||''),next=>{globalThis.__invoiceUI.query=next.toString();}];`,
      '@/hooks/useMenuBack':`export const useMenuBack=path=>()=>globalThis.__invoiceUI.navigation.push(path);`,
      '@/hooks/useCurrentUser':'export const useCurrentUser=()=>globalThis.__invoiceUI.session||({isAdmin:true,role:"admin"});',
      '@/components/ui/button':`import React from 'react';export function Button({children,onClick,...props}){globalThis.__invoiceUI.capture('button',{...props,onClick},children);return React.createElement('button',props,children);}`,
      '@/components/ui/dialog':`import React from 'react';export const Dialog=({children,open})=>open?React.createElement('div',null,children):null;export const DialogContent=({children})=>React.createElement('div',null,children);export const DialogHeader=DialogContent,DialogTitle=DialogContent,DialogDescription=DialogContent;`,
      '@/components/customers/CustomerReceivePayment':`export default props=>{globalThis.__invoiceUI.payment=props;return null;};`,
      '@/components/sales/SaleReversalDialog':`import React from 'react';export default props=>{globalThis.__invoiceUI.reversal=props;return React.createElement('p',null,'Checked sale reversal');};`,
      '@/components/sales/InvoiceEditor':`export default function Editor(props){globalThis.__invoiceUI.editor=props;return null;}`,
    };
    b.onResolve({filter:/^\.\/InvoiceEditor$/},()=>({path:'@/components/sales/InvoiceEditor',namespace:'mock'}));
    b.onResolve({filter:/^@\//},args=>Object.hasOwn(mocks,args.path)?{path:args.path,namespace:'mock'}:undefined);
    b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:mocks[args.path],resolveDir:process.cwd()}));
  }}]});const module={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(require,module,module.exports);return module.exports.render;
}
const options=invoiceDefaults({business_name:'Client',email:'client@example.test'}),source={id:'order-1',type:'order',number:'SO-1',customer_id:'customer',date:'2026-10-18',total:1000};
const preview={options,invoiceDate:'2026-10-18',dueDate:'2026-11-18',source:{total:1000,payment_type:'credit'},lines:[{product_name:'YOLA',quantity:2,unit:'ea',unit_price:500,total:1000}]};
const saved={invoice:{id:'invoice-1',invoice_number:'INV-1',customer_name:'Client',customer_id:'customer',payment_type:'credit',invoice_date:'2026-10-18',due_date:'2026-11-18',status:'posted',total:1000,subtotal:1000,tax_total:0,customer_balance:1000},company:{company_name:'SOEICAM',tax_id:'T',registration_number:'R'},lines:preview.lines,options,revision:3};

test('invoice form keeps client terms after failure and retries the same source, then opens the saved document',async()=>{
  const render=await ui(),state=hookRuntime(),calls=[];globalThis.__invoiceUI=state;let fail=true;state.request=async body=>{calls.push(body);if(body.action==='invoiceSource')return structuredClone(preview);if(fail)throw Error('Fixture connection failed');return structuredClone(saved);};
  const props={open:true,onOpenChange:()=>{},data:{sources:[source],customers:[{id:'customer',business_name:'Client'}]},initialKey:'order:order-1'};
  const draw=()=>{state.beforeRender();return render('create',props);};
  try{draw();await state.flush();draw();await state.flush();draw();state.editor.setOptions({...options,terms:'30 days agreed'});state.editor.setSaveDefaults(true);draw();await state.buttons.find(b=>b.label==='Issue invoice').onClick();const failed=draw();assert.match(failed,/Fixture connection failed/);assert.equal(state.editor.options.terms,'30 days agreed');fail=false;await state.buttons.find(b=>b.label==='Issue invoice').onClick();draw();const submits=calls.filter(c=>c.action==='createSalesInvoice');assert.equal(submits.length,2);assert.deepEqual(submits[0],submits[1]);assert.equal(submits[1].saveCustomerDefaults,true);assert.deepEqual(state.navigation,['/sales/invoices/invoice-1']);}finally{state.cleanup();delete globalThis.__invoiceUI;}
});

test('invoice customization disables sharing an unsaved preview and submits revision plus terms without financial changes',async()=>{
  const render=await ui(),state=hookRuntime(),calls=[];globalThis.__invoiceUI=state;state.request=async body=>{calls.push(body);return body.action==='invoiceDetail'?structuredClone(saved):{...structuredClone(saved),options:body.options,revision:4};};
  const draw=()=>{state.beforeRender();return render('detail');};
  try{draw();await state.flush();draw();await state.buttons.find(b=>b.label==='Customize').onClick();draw();assert.equal(state.buttons.find(b=>b.label==='Print / PDF').disabled,true);state.editor.setOptions({...options,reference:'CLIENT-PO',terms:'Client terms'});draw();await state.buttons.find(b=>b.label==='Save customization').onClick();const html=draw();assert.match(html,/Invoice details saved/);const request=calls.find(c=>c.action==='customizeSalesInvoice');assert.equal(request.revision,3);assert.equal(request.options.reference,'CLIENT-PO');assert.equal(request.total,undefined);assert.equal(state.buttons.find(b=>b.label==='Print / PDF').disabled,false);}finally{state.cleanup();delete globalThis.__invoiceUI;}
});

test('cashier invoice list exposes Customize directly and keeps issuing and letterhead controls hidden',async()=>{
 const render=await ui(),state=hookRuntime();globalThis.__invoiceUI=state;
 state.session={role:'cashier',isAdmin:false};state.request=async()=>({invoices:[{...saved.invoice,accounting_verified:true}],sources:[],customers:[],company:saved.company,permissions:{can_create:false}});
 const draw=()=>{state.beforeRender();return render('list');};
 try{draw();await state.flush();const html=draw();assert.match(html,/Customize/);assert.equal(state.buttons.some(b=>b.label==='Create invoice'||b.label==='Company letterhead'),false);state.buttons.find(b=>b.label==='Customize').onClick({stopPropagation(){}});assert.deepEqual(state.navigation,['/cashier/invoices/invoice-1?edit=1']);}finally{state.cleanup();delete globalThis.__invoiceUI;}
});
test('invoice customization opens from its direct link and returns a cashier to the cashier invoice list',async()=>{
 const render=await ui(),state=hookRuntime(),calls=[];globalThis.__invoiceUI=state;state.query='edit=1';state.session={role:'cashier',isAdmin:false};
 state.request=async body=>{calls.push(body);return body.action==='invoiceDetail'?structuredClone(saved):{...structuredClone(saved),options:body.options,revision:4};};
 const draw=()=>{state.beforeRender();return render('detail');};
 try{draw();await state.flush();draw();assert.ok(state.editor);assert.equal(state.buttons.find(b=>b.label==='Print / PDF').disabled,true);state.editor.setOptions({...options,layout:'classic',footer:'Client footer'});draw();await state.buttons.find(b=>b.label==='Save customization').onClick();draw();assert.equal(calls.at(-1).options.footer,'Client footer');state.buttons.find(b=>b['aria-label']==='Invoices').onClick();assert.deepEqual(state.navigation,['/cashier?section=invoices']);}finally{state.cleanup();delete globalThis.__invoiceUI;}
});


test('mobile invoice shares the receipt hierarchy, preserves verified source fields and keeps issuing guards and cashier boundaries',async()=>{
 const render=await ui();
 for(const verified of [true,false]){
  const state=hookRuntime();globalThis.__invoiceUI=state;state.phone=true;state.query='from=sales';state.session={role:'cashier',isAdmin:false};
  state.request=async()=>({...structuredClone(saved),accounting_verified:verified,invoice:{...saved.invoice,receipt_reference:'REC-007',salesperson_name:'Saved seller',recorded_by_name:'Saved recorder'},replacements:[{product_id:'p',product_name:'Replacement yoghurt',quantity:1,reason:'damaged'}]});
  const draw=()=>{state.beforeRender();return render('detail');};
  try{draw();await state.flush();const html=draw();assert.match(html,/REC-007/);assert.match(html,/Saved seller/);assert.match(html,/Saved recorder/);assert.match(html,/Replacement yoghurt/);assert.match(html,/Exchanges/);assert.match(html,/Invoice tools &amp; preview/);assert.equal(state.buttons.find(b=>b.label==='Print').disabled,!verified);assert.equal(state.buttons.find(b=>b.label==='Export PDF').disabled,!verified);assert.equal(state.buttons.some(b=>b.label==='Correct sale'),false);const receive=state.buttons.find(b=>b.label==='Receive Payment');assert.equal(Boolean(receive),verified);if(receive){receive.onClick();draw();assert.equal(state.payment.initialInvoice.id,'invoice-1');assert.equal(state.payment.initialInvoice.balance,1000);state.payment.onClose();draw();}state.buttons.find(b=>b['aria-label']==='Back').onClick();assert.equal(state.navigation.at(-1),'/cashier?section=invoices');state.session={role:'admin',isAdmin:true};draw();state.buttons.find(b=>b['aria-label']==='Back').onClick();assert.equal(state.navigation.at(-1),'/sales?tab=all');}finally{state.cleanup();delete globalThis.__invoiceUI;}
 }
});


test('sale correction chooses safe metadata editing or the checked source reversal without directly editing journal lines',async()=>{
 const render=await ui(),state=hookRuntime(),calls=[];globalThis.__invoiceUI=state;state.session={role:'admin',isAdmin:true};state.request=async body=>{calls.push(body);return structuredClone(saved);};
 const draw=()=>{state.beforeRender();return render('detail');};
 try{draw();await state.flush();draw();state.buttons.find(button=>button.label==='Correct sale').onClick();assert.match(draw(),/Products, customer or amounts/);state.buttons.find(button=>button.label==='Edit invoice details').onClick();draw();assert.ok(state.editor);state.buttons.find(button=>button.label==='Cancel').onClick();draw();state.buttons.find(button=>button.label==='Correct sale').onClick();draw();state.buttons.find(button=>button.label==='Review sale correction').onClick();draw();assert.equal(state.reversal.invoiceId,'invoice-1');assert.equal(calls.filter(call=>call.action!=='invoiceDetail').length,0);
 }finally{state.cleanup();delete globalThis.__invoiceUI;}
});

test('customer invoice uses the shared detail, keeps print and VAT versions, and returns to the customer profile',async()=>{
 const render=await ui();
 for(const phone of [true,false]){
  const state=hookRuntime(),calls=[];globalThis.__invoiceUI=state;
  state.phone=phone;state.params={id:'branch & town',invoiceId:'invoice-1'};
  state.query=phone?'edit=1&correct=1':'from=sales&edit=1&correct=1';
  state.request=async()=>assert.fail('Customer detail must use the Customers endpoint');
  state.customerInvoice=async(customerId,invoiceId,{original})=>{
   calls.push({customerId,invoiceId,original});
   return original
    ? {...structuredClone(saved),original_vat_document:true}
    : {...structuredClone(saved),vat_correction:{number:'VAT-INV-1',issued_date:'2026-10-19',accounting_date:'2026-10-18',journal_number:'JV-1'}};
  };
  const draw=()=>{state.beforeRender();return render('detail',{fromCustomer:true});};
  try{
   draw();await state.flush();assert.match(draw(),/VAT correction VAT-INV-1/);
   assert.deepEqual(calls[0],{customerId:'branch & town',invoiceId:'invoice-1',original:false});
   assert.equal(state.buttons.find(button=>button.label===(phone?'Print':'Print / PDF')).disabled,false);
   assert.equal(state.buttons.some(button=>['Customize','Correct sale','Receive Payment','Review sale correction'].includes(button.label)),false);
   state.buttons.find(button=>button.label==='View original invoice').onClick();
   draw();await state.flush();assert.match(draw(),/Original invoice VAT figures/);
   assert.equal(calls.at(-1).original,true);
   state.buttons.find(button=>button['aria-label']===(phone?'Back':'Back to customers')).onClick();
   assert.deepEqual(state.navigation,['/customers?view=list&customer=branch%20%26%20town'+(phone?'':'&tab=sales')]);
  }finally{state.cleanup();delete globalThis.__invoiceUI;}
 }
});
