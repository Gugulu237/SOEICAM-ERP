import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {supplierTimelineEntries} from '../src/components/suppliers/supplier-timeline.js';
import {hookRuntime} from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url);

test('supplier activity interleaves actual document dates and identifies only posted order advances',()=>{
  const bills=[{id:'shared',bill_number:'BILL-1',bill_date:'2026-11-14',balance:60,total:100,status:'open'}];
  const payments=[{id:'shared',payment_number:'PAY-1',payment_date:'2026-11-10',po_id:'po',amount:150,status:'posted'},
    {id:'request',payment_date:'2026-11-15',po_id:'po',amount:50,status:'pending_approval'},
    {id:'settled',payment_date:'2026-11-16',po_id:'po',bill_id:'shared',amount:40,status:'posted'},
    {id:'unknown-date',po_id:'po',amount:10,status:'approved'}];
  const snapshot=JSON.stringify({bills,payments});
  const rows=supplierTimelineEntries({bills,payments,orders:[{id:'po',po_number:'PO-1'}]});
  assert.deepEqual(rows.map(row=>row.id),['payment:settled','payment:request','bill:shared','payment:shared','payment:unknown-date']);
  assert.deepEqual(rows.map(row=>row.kind),['payment','payment','bill','advance','payment']);
  assert.equal(rows[0].relatedReference,'BILL-1');assert.equal(rows[3].relatedReference,'PO-1');
  assert.equal(rows[2].outstanding,true);assert.equal(rows.length,bills.length+payments.length);
  assert.equal(JSON.stringify({bills,payments}),snapshot);
  assert.equal(rows.some(row=>'availableAdvance' in row||'availableAmount' in row),false);
});

async function supplierUI(){
  const output=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Workspace from './src/components/suppliers/SupplierWorkspace.jsx';export const render=()=>renderToStaticMarkup(React.createElement(Workspace,{embedded:true}));`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,format:'cjs',platform:'node',write:false,plugins:[{name:'supplier-timeline',setup(b){
    b.onResolve({filter:/^react$/},args=>args.importer.endsWith('SupplierWorkspace.jsx')?{path:'hooks',namespace:'fixture'}:undefined);
    b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`import React from ${JSON.stringify(require.resolve('react'))};export default {...React,createElement:(tag,props,...children)=>{globalThis.__supplierTimeline.capture(tag,props,children);return React.createElement(tag,props,...children);}};export const useState=v=>globalThis.__supplierTimeline.state('workspace',v);export const useRef=v=>globalThis.__supplierTimeline.ref('workspace',v);export const useEffect=(fn,deps)=>globalThis.__supplierTimeline.effect('workspace',fn,deps);export const useCallback=fn=>fn;`,resolveDir:process.cwd()}));
    const mocks={
      '@/hooks/usePhoneLayout':`export const usePhoneLayout=()=>true;`,
      '@/hooks/useCurrentUser':`export const useCurrentUser=()=>({user:{id:'viewer'}});`,
      '@/hooks/useMenuBack':`export const useMenuBack=()=>()=>{};`,
      '@/lib/router':`import React from 'react';export const Link=({to,children,...props})=>React.createElement('a',{...props,href:to},children);export const useNavigate=()=>path=>globalThis.__supplierTimeline.navigation.push(path);export const useSearchParams=()=>[new URLSearchParams(globalThis.__supplierTimeline.query),value=>{const r=globalThis.__supplierTimeline;r.query=(typeof value==='function'?value(new URLSearchParams(r.query)):value).toString();}];`,
      '@/api/erpClient':`export const invalidateERPReads=()=>{};export const erp={functions:{invoke:async(name,body)=>({data:await globalThis.__supplierTimeline.request(body)})}};`,
      '@/components/ui/use-toast':`export const useToast=()=>({toast:v=>globalThis.__supplierTimeline.notifications.push(v)});`,
      '@/components/ui/button':`import React from 'react';export function Button({children,onClick,...props}){globalThis.__supplierTimeline.capture('button',{...props,onClick},children);return React.createElement('button',props,children);}`,
      '@/components/ui/dialog':`import React from 'react';export const Dialog=({children})=>React.createElement('div',null,children);export const DialogContent=Dialog,DialogHeader=Dialog,DialogTitle=Dialog,DialogDescription=Dialog,DialogFooter=Dialog;`,
    };
    b.onResolve({filter:/^@\//},args=>Object.hasOwn(mocks,args.path)?{path:args.path,namespace:'leaf'}:undefined);
    b.onLoad({filter:/.*/,namespace:'leaf'},args=>({contents:mocks[args.path],resolveDir:process.cwd()}));
  }}]});
  const module={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(require,module,module.exports);return module.exports.render;
}

const supplier={id:'supplier',name:'Actual supplier',unpaid_bills:60,ledger_balance:-90,balance_difference:0};
const payload={supplier,suppliers:[supplier],permissions:{pay:true,approve:true},date:'2026-11-17',products:[],orders:[{id:'po',po_number:'PO-1',status:'approved'}],receipts:[],
  bills:[{id:'bill',bill_number:'BILL-1',po_id:'po',bill_date:'2026-11-14',due_date:'2026-11-28',balance:60,total:100,amount_paid:40,status:'open'}],
  payments:[{id:'advance',payment_number:'ADV-1',po_id:'po',payment_date:'2026-11-10',amount:150,status:'posted'},
    {id:'request',payment_number:'REQ-1',po_id:'po',payment_date:'2026-11-15',amount:25,status:'pending_approval'},
    {id:'release',payment_number:'REL-1',po_id:'po',payment_date:'2026-11-16',amount:30,status:'approved',treasury_account_id:'till'}]};

test('mobile supplier overview renders one combined timeline and reuses checked approve/release operations',async()=>{
  const render=await supplierUI(),r=hookRuntime(),writes=[];r.query='section=suppliers&supplier=supplier';globalThis.__supplierTimeline=r;
  r.request=async body=>{if(body.action==='supplierWorkspace')return payload;writes.push(body);return {};};
  const draw=()=>{r.beforeRender();return render();};
  try{
    draw();await r.flush();const html=draw();
    assert.match(html,/Bills, advances &amp; payments/);assert.match(html,/ADV-1/);assert.match(html,/Advance paid/);assert.doesNotMatch(html,/Available advances/);
    assert.ok(html.indexOf('payment:release')<html.indexOf('payment:request'));assert.ok(html.indexOf('payment:request')<html.indexOf('bill:bill'));assert.ok(html.indexOf('bill:bill')<html.indexOf('payment:advance'));
    assert.equal((html.match(/data-supplier-activity=/g)||[]).length,4);assert.match(html,/Supplier details/);assert.match(html,/Net supplier advance \/ credit/);
    await r.buttons.find(button=>button.label==='Approve payment').onClick();
    assert.deepEqual(writes[0],{action:'approvePurchasePayment',paymentId:'request'});
    draw();await r.buttons.find(button=>button.label==='Release approved payment').onClick();
    assert.deepEqual(writes[1],{action:'cashierReleasePayment',requestKey:'supplier-release-release',paymentId:'release',accountId:'till'});
  }finally{r.cleanup();delete globalThis.__supplierTimeline;}
});

test('mobile supplier timeline keeps view-only readers free of payment actions',async()=>{
  const render=await supplierUI(),r=hookRuntime();r.query='section=suppliers&supplier=supplier';globalThis.__supplierTimeline=r;
  r.request=async body=>{assert.equal(body.action,'supplierWorkspace');return {...payload,permissions:{}};};
  const draw=()=>{r.beforeRender();return render();};
  try{draw();await r.flush();const html=draw();assert.match(html,/ADV-1|BILL-1|REQ-1/);assert.doesNotMatch(html,/Pay bill|Approve payment|Release approved payment/);}finally{r.cleanup();delete globalThis.__supplierTimeline;}
});
