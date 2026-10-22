import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { hookRuntime } from './helpers/commercial-ui.mjs';
import { invoiceDefaults } from '../src/lib/invoice-documents.js';
const require=createRequire(import.meta.url);

async function ui() {
  const output=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {CreateInvoiceDialog} from './src/components/sales/InvoiceWorkspace.jsx';import Invoice from './src/views/SalesInvoice.jsx';export const render=(name,props)=>renderToStaticMarkup(React.createElement(name==='create'?CreateInvoiceDialog:Invoice,props));`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'invoice-ui',setup(b){
    b.onResolve({filter:/^react$/},args=>/(InvoiceWorkspace|SalesInvoice)\.jsx$/.test(args.importer)?{path:args.importer.endsWith('SalesInvoice.jsx')?'detail':'create',namespace:'hooks'}:undefined);
    b.onLoad({filter:/.*/,namespace:'hooks'},({path:key})=>({contents:`import React from ${JSON.stringify(require.resolve('react'))};export default React;export const useState=v=>globalThis.__invoiceUI.state(${JSON.stringify(key)},v);export const useEffect=(fn,deps)=>globalThis.__invoiceUI.effect(${JSON.stringify(key)},fn,deps);export const useMemo=fn=>fn();`,resolveDir:process.cwd()}));
    const mocks={
      '@/api/erpClient':`export const erp={functions:{invoke:async(name,body)=>({data:await globalThis.__invoiceUI.request(body)})}};`,
      '@/lib/router':`const navigate=path=>globalThis.__invoiceUI.navigation.push(path);export const useNavigate=()=>navigate;export const useParams=()=>({id:'invoice-1'});export const useSearchParams=()=>[new URLSearchParams()];`,
      '@/hooks/useCurrentUser':'export const useCurrentUser=()=>({isAdmin:true});',
      '@/components/ui/button':`import React from 'react';export function Button({children,onClick,...props}){globalThis.__invoiceUI.capture('button',{...props,onClick},children);return React.createElement('button',props,children);}`,
      '@/components/ui/dialog':`import React from 'react';export const Dialog=({children,open})=>open?React.createElement('div',null,children):null;export const DialogContent=({children})=>React.createElement('div',null,children);export const DialogHeader=DialogContent,DialogTitle=DialogContent,DialogDescription=DialogContent;`,
      '@/components/sales/InvoiceEditor':`export default function Editor(props){globalThis.__invoiceUI.editor=props;return null;}`,
    };
    b.onResolve({filter:/^\.\/InvoiceEditor$/},()=>({path:'@/components/sales/InvoiceEditor',namespace:'mock'}));
    b.onResolve({filter:/^@\//},args=>Object.hasOwn(mocks,args.path)?{path:args.path,namespace:'mock'}:undefined);
    b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:mocks[args.path],resolveDir:process.cwd()}));
  }}]});const module={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(require,module,module.exports);return module.exports.render;
}
const options=invoiceDefaults({business_name:'Client',email:'client@example.test'}),source={id:'order-1',type:'order',number:'SO-1',customer_id:'customer',date:'2026-10-18',total:1000};
const preview={options,invoiceDate:'2026-10-18',dueDate:'2026-11-18',source:{total:1000,payment_type:'credit'},lines:[{product_name:'YOLA',quantity:2,unit:'ea',unit_price:500,total:1000}]};
const saved={invoice:{id:'invoice-1',invoice_number:'INV-1',customer_name:'Client',invoice_date:'2026-10-18',due_date:'2026-11-18',status:'posted',total:1000,subtotal:1000,tax_total:0,customer_balance:1000},company:{company_name:'SOEICAM',tax_id:'T',registration_number:'R'},lines:preview.lines,options,revision:3};

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
