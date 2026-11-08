import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {hookRuntime} from './helpers/commercial-ui.mjs';

const require=createRequire(import.meta.url),date='2026-11-08';
let compiled;
async function renderer(){
 if(compiled)return compiled;
 const files=/\/(?:DegustationAppropriation|DispatchReconciliation)\.jsx$/;
 const output=await build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Appropriation from './src/components/distribution/DegustationAppropriation.jsx';import Reconciliation from './src/components/distribution/DispatchReconciliation.jsx';export const render=(props,kind='appropriation')=>renderToStaticMarkup(React.createElement(kind==='reconciliation'?Reconciliation:Appropriation,props));",resolveDir:process.cwd(),loader:'jsx'},bundle:true,jsx:'automatic',platform:'node',format:'cjs',write:false,plugins:[{name:'degustation-appropriation-ui',setup(b){
  b.onResolve({filter:/^react\/jsx-runtime$/},a=>files.test(a.importer.replaceAll('\\','/'))?{path:'jsx',namespace:'capture'}:undefined);
  b.onLoad({filter:/.*/,namespace:'capture'},()=>({contents:`import {jsx as x,jsxs as xs,Fragment} from ${JSON.stringify(require.resolve('react/jsx-runtime'))};export {Fragment};export const jsx=(tag,props,key)=>{globalThis.__degustationUI.capture(tag,props,props?.children);return x(tag,props,key);};export const jsxs=(tag,props,key)=>{globalThis.__degustationUI.capture(tag,props,props?.children);return xs(tag,props,key);};`,resolveDir:process.cwd()}));
  b.onResolve({filter:/^react$/},a=>files.test(a.importer.replaceAll('\\','/'))?{path:a.importer.endsWith('DispatchReconciliation.jsx')?'reconciliation':'appropriation',namespace:'hooks'}:undefined);
  b.onLoad({filter:/.*/,namespace:'hooks'},a=>({contents:`import React from ${JSON.stringify(require.resolve('react'))};export default React;export const useState=v=>globalThis.__degustationUI.state(${JSON.stringify(a.path)},v),useRef=v=>globalThis.__degustationUI.ref(${JSON.stringify(a.path)},v),useEffect=(fn,deps)=>globalThis.__degustationUI.effect(${JSON.stringify(a.path)},fn,deps);`,resolveDir:process.cwd()}));
  const mocks={
   '@/api/erpClient':"export const erp={entities:{Account:'Account'}};",
   '@/lib/field-pos':"export const readAll=async entity=>{globalThis.__degustationUI.reads.push(entity);return structuredClone(globalThis.__degustationUI.accounts);};",
   '@/lib/accounting-controls-client':"export const accountingControlRequest=(area,body)=>globalThis.__degustationUI.request(area,body);",
   '@/lib/business-date':`export const businessDate=()=>${JSON.stringify(date)};`,
   '@/lib/localization':'export const useLocaleRender=()=>{};',
   '@/lib/router':"import React from 'react';export const Link=({to,children,...props})=>React.createElement('a',{...props,href:to},children);",
   '@/components/ui/input':"import React from 'react';export const Input=props=>{globalThis.__degustationUI.capture('input',props);return React.createElement('input',props);};",
   '@/components/ui/button':"import React from 'react';export const Button=({children,variant,...props})=>{globalThis.__degustationUI.capture('button',props,children);return React.createElement('button',props,children);};",
   '@/hooks/useCurrentUser':'export const useCurrentUser=()=>globalThis.__degustationUI.user;',
   '@/components/ui/use-toast':'export const useToast=()=>({toast:value=>globalThis.__degustationUI.notifications.push(value)});',
   '@/lib/dispatch':"export const getDispatchReconciliation=async dispatch=>{globalThis.__degustationUI.reconciliations.push(dispatch.id);return structuredClone(globalThis.__degustationUI.snapshot);};export const returnDispatchStock=async()=>{throw Error('No stock return expected in this audit fixture');};",
   '@/components/shared/ProductThumb':'export default ()=>null;',
   'lucide-react':'export const Undo2=()=>null,AlertTriangle=()=>null,RefreshCw=()=>null;',
   'appropriation-child':"import React from 'react';export default props=>{globalThis.__degustationUI.children.push(props);return React.createElement('div',{'data-appropriation-form':props.dispatch.id});};",
   'history':'export default ()=>null;',
  };
  b.onResolve({filter:/^\.\/DegustationAppropriation$/},()=>({path:'appropriation-child',namespace:'leaf'}));
  b.onResolve({filter:/^\.\/DegustationHistory$/},()=>({path:'history',namespace:'leaf'}));
  b.onResolve({filter:/^(?:@\/|lucide-react$)/},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'leaf'}:undefined);
  b.onLoad({filter:/.*/,namespace:'leaf'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));
 }}]});
 const module={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(require,module,module.exports);compiled=module.exports.render;return compiled;
}
const marketing={id:'marketing',account_number:'6970',name:'Marketing & Advertising',account_type:'expense',normal_balance:'debit',is_active:true,is_posting:true};
const expense={id:'degustation',account_number:'6971',name:'Degustation',parent_id:marketing.id,account_type:'expense',normal_balance:'debit',is_active:true,is_posting:true};
const otherExpense={...expense,id:'other-promo',account_number:'6972',name:'Other marketing promotions'};
const accounts=[marketing,expense,otherExpense,{id:'finished-goods',account_number:'1320',name:'Finished Goods Inventory',account_type:'asset',normal_balance:'debit',is_active:true,is_posting:true},{...expense,id:'top-level',parent_id:''},{...expense,id:'cogs',account_type:'cogs'},{...expense,id:'inactive',is_active:false},{...expense,id:'header',is_posting:false},{...expense,id:'credit',normal_balance:'credit'},{...expense,id:'cash',is_treasury:true},{...expense,id:'control',is_control_account:true},{...expense,id:'orphan',parent_id:'missing'}];
const manufacturingCogs={id:'manufacturing-cogs',account_number:'6100',name:'Cost of Goods Sold',account_type:'cogs',normal_balance:'debit',is_active:true,is_posting:true};
const dispatch={id:'legacy-run',dispatch_number:'DSP-PROMO',salesperson_name:'Stock holder',status:'loaded',total_loaded_value:500};
const preview=body=>({token:'verified-'+body.expenseAccountId+'-'+body.reference,dispatch:{...dispatch,employee_name:'Stock holder'},expense_account:accounts.find(a=>a.id===body.expenseAccountId),date,reference:body.reference,lots:[{id:'lot-1',product_id:'yogurt',product_name:'YOLA yogurt',lot_number:'PRODUCTION-1',quantity:13,value:260,inventory_account_id:'finished-goods'}],total_quantity:13,total_value:260,journal_lines:[{account_id:body.expenseAccountId,debit:260,credit:0},{account_id:'finished-goods',debit:0,credit:260}],stock_quantity_change:0,inventory_value_change:-260,cash_change:0});
const saved={journal_id:'promo-journal',journal_number:'JV-PROMO',total_quantity:13,total_value:260,reused:false};
const blockedDiagnostics={dispatch_id:dispatch.id,stock_warehouse_id:'custody',source_journals_verified:true,source_journals:[{id:'source-journal',journal_number:'JV-SALE',date:'2026-11-07',source_document_type:'Invoice',source_document_id:'source-invoice',inventory_cost:300}],mismatches:[{product_id:'yogurt',product_name:'YOLA yogurt',lot_number:'PRODUCTION-1',expiry_date:'2026-12-01',qc_status:'approved',production_order_id:'production-1',batch_number:'batch-1',balance_ids:['lot-1'],load_movement_ids:['load-1'],issue_movement_ids:['sale-issue-1'],loaded_quantity:100,loaded_value:500,released_quantity:87,released_value:300,expected_quantity:13,expected_value:200,current_quantity:13,current_value:260,quantity_delta:0,value_delta:60,loaded_unit_costs:[5],released_unit_costs:[3.45],current_unit_costs:[20]}]};
const snapshot={rows:[{id:'load-line',product_id:'yogurt',product_name:'YOLA yogurt',loaded:100,sold:87,replaced:0,returned:0,expected:13,actual:13,variance:0,degustation_allocated:13,degustation_given:0,degustation_remaining:13,degustation_returned:0,sales_value:1000}],orders:[{id:'sale'}],fieldSales:[],totalSales:1000,cashSales:0,creditSales:1000,hasVariance:false,remainingQty:13,degustationCost:0,degustations:[]};
const control=(r,label)=>r.controls.find(element=>element['aria-label']===label);
const button=(r,label)=>r.buttons.find(element=>element.label===label);
const change=(r,label,value)=>control(r,label).onChange({target:{value,checked:value}});
async function environment({kind='appropriation',accountRows=accounts,user={principalRole:'admin',role:'admin'},run=dispatch,data=snapshot,canManage=true}={}){
 const render=await renderer(),r=hookRuntime(),capture=r.capture.bind(r);r.accounts=accountRows;r.calls=[];r.reads=[];r.posted=[];r.elements=[];r.user=user;r.snapshot=data;r.reconciliations=[];r.children=[];
 r.capture=(tag,props,children)=>{capture(tag,props,children);r.elements.push({tag,props:props||{}});};
 r.request=async(area,body)=>{r.calls.push({area,body:structuredClone(body)});return body.action==='preview'?preview(body):saved;};
 globalThis.__degustationUI=r;
 let props=kind==='appropriation'?{dispatch:run,onPosted:value=>r.posted.push(value)}:{dispatch:run,userName:'auditor',onChanged:()=>{r.changed=(r.changed||0)+1;},snapshot:data,canManage};
 const draw=()=>{r.beforeRender();r.elements=[];r.children=[];return render(props,kind);};
 draw();await r.flush();draw();
 return {r,draw,setProps:value=>{props={...props,...value};},close:()=>{r.cleanup();delete globalThis.__degustationUI;}};
}
function reference(r,draw,value='  Owner reviewed reserved promo stock  '){change(r,'Review reference',value);return draw();}
async function review(r,draw){reference(r,draw);await button(r,'Preview reserved Dégustation expense').onClick();return draw();}

test('reserved expense selects an active debit-normal expense child and requires an explicit review before any write',async()=>{
 const f=await environment(),{r,draw}=f;
 try{
  assert.deepEqual(r.reads,['Account']);assert.equal(r.calls.length,0);assert.equal(control(r,'Degustation expense account').value,expense.id);assert.equal(control(r,'Expense date').value,date);assert.equal(control(r,'Expense date').readOnly,true);
  const html=draw(),options=html.match(/<select aria-label="Degustation expense account"[\s\S]*?<\/select>/)[0];assert.match(options,/Marketing &amp; Advertising \/ 6971 \/ Degustation/);assert.match(options,/other-promo/);assert.doesNotMatch(options,/top-level|value="cogs"|inactive|header|credit|cash|control|orphan/);
  assert.equal(button(r,'Preview reserved Dégustation expense').disabled,true);const result=await review(r,draw);
  assert.deepEqual(r.calls,[{area:'degustation-appropriation',body:{action:'preview',dispatchId:dispatch.id,expenseAccountId:expense.id,date,reference:'Owner reviewed reserved promo stock'}}]);
  assert.match(result,/Physical units retained/);assert.match(result,/13/);assert.match(result,/260 XAF/);assert.match(result,/PRODUCTION-1/);assert.match(result.match(/<section[\s\S]*?<\/section>/)[0],/Marketing &amp; Advertising \/ 6971 \/ Degustation/);assert.match(result,/no customer giveaway or sale is created/);assert.match(result,/Cash, sales, customer balances and physical quantities remain unchanged/);assert.match(result,/Later customer giveaways are not expensed again/);assert.match(result,/returns restore only the remaining original cost/);
  const journal=result.match(/<table aria-label="Proposed journal"[\s\S]*?<\/table>/)[0].replace(/<[^>]*>/g,'');assert.match(journal,/AccountDebitCredit/);assert.match(journal,/6971 \/ Degustation260 XAF0 XAF/);assert.match(journal,/1320 \/ Finished Goods Inventory0 XAF260 XAF/);assert.doesNotMatch(result,/Zero carrying value; no journal will be posted/);
  assert.equal(button(r,'Confirm reserved Dégustation expense').disabled,true);await button(r,'Confirm reserved Dégustation expense').onClick();assert.equal(r.calls.length,1,'review is mandatory even if a callback is invoked directly');
 }finally{f.close();}
});

test('missing eligible expense children blocks the operation and directs accounting setup',async()=>{
 const f=await environment({accountRows:[marketing,{...expense,parent_id:'',id:'root'},{...expense,id:'disabled',is_active:false}]}),{r,draw}=f;
 try{assert.equal(control(r,'Degustation expense account').value,'');assert.equal(button(r,'Preview reserved Dégustation expense').disabled,true);const html=draw();assert.match(html,/Create an active Degustation expense sub-account under Marketing before continuing/);assert.match(html,/href="\/accounting"/);await button(r,'Preview reserved Dégustation expense').onClick();assert.equal(r.calls.length,0);}finally{f.close();}
});

test('an earlier same-name child outside Marketing or an ineligible currency cannot shadow the intended expense',async()=>{
 const rent={...marketing,id:'rent-parent',account_number:'6510',name:'Premises rent'};
 const accountRows=[rent,{...expense,id:'rent-degustation',parent_id:rent.id},{...expense,id:'usd-degustation',currency:'USD'},{...expense,id:'credit-degustation',normal_balance:'credit'},...accounts];
 const f=await environment({accountRows}),{r,draw}=f;
 try{assert.equal(control(r,'Degustation expense account').value,expense.id);const html=draw(),options=html.match(/<select aria-label="Degustation expense account"[\s\S]*?<\/select>/)[0];assert.doesNotMatch(options,/usd-degustation|credit-degustation/);await review(r,draw);assert.equal(r.calls[0].body.expenseAccountId,expense.id);assert.match(draw(),/Marketing &amp; Advertising/);}finally{f.close();}
});

test('failed promotional posting preserves its reviewed payload and retry key and success links the journal once',async()=>{
 const f=await environment(),{r,draw}=f;const request=r.request;let fail=true;
 r.request=async(area,body)=>{if(body.action==='post'&&fail){r.calls.push({area,body:structuredClone(body)});throw Error('Connection interrupted');}return request(area,body);};
 try{
  await review(r,draw);change(r,'Confirm reserved Dégustation review',true);draw();await button(r,'Confirm reserved Dégustation expense').onClick();assert.match(draw(),/Connection interrupted/);assert.equal(r.posted.length,0);assert.equal(control(r,'Confirm reserved Dégustation review').checked,true);
  fail=false;const submit=button(r,'Confirm reserved Dégustation expense');await Promise.all([submit.onClick(),submit.onClick()]);const html=draw(),posts=r.calls.filter(x=>x.body.action==='post');assert.equal(posts.length,2);assert.deepEqual(posts[0],posts[1]);assert.match(posts[1].body.requestKey,/^[a-f\d-]{36}$/);
  assert.deepEqual(posts[1],{area:'degustation-appropriation',body:{action:'post',dispatchId:dispatch.id,expenseAccountId:expense.id,date,reference:'Owner reviewed reserved promo stock',token:'verified-degustation-Owner reviewed reserved promo stock',requestKey:posts[1].body.requestKey,confirmed:true}});
  assert.deepEqual(r.posted,[saved]);assert.match(html,/Reserved Dégustation expensed\. The promotional units remain in employee custody/);assert.match(html,/href="\/accounting\/journals\/promo-journal"/);assert.match(html,/JV-PROMO/);assert.equal(button(r,'Confirm reserved Dégustation expense'),undefined);assert.equal(button(r,'Preview reserved Dégustation expense'),undefined);
 }finally{f.close();}
});

test('changing account or review evidence discards the old reviewed preview',async()=>{
 const f=await environment(),{r,draw}=f;
 try{
  await review(r,draw);change(r,'Confirm reserved Dégustation review',true);draw();change(r,'Degustation expense account',otherExpense.id);assert.doesNotMatch(draw(),/Physical units retained/);assert.equal(button(r,'Confirm reserved Dégustation expense'),undefined);
  await button(r,'Preview reserved Dégustation expense').onClick();draw();assert.equal(control(r,'Confirm reserved Dégustation review').checked,false);change(r,'Review reference','Revised physical promo count');draw();assert.equal(button(r,'Confirm reserved Dégustation expense'),undefined);
  await button(r,'Preview reserved Dégustation expense').onClick();draw();change(r,'Confirm reserved Dégustation review',true);draw();await button(r,'Confirm reserved Dégustation expense').onClick();assert.deepEqual(r.calls.at(-1).body,{action:'post',dispatchId:dispatch.id,expenseAccountId:otherExpense.id,date,reference:'Revised physical promo count',token:'verified-other-promo-Revised physical promo count',requestKey:r.calls.at(-1).body.requestKey,confirmed:true});assert.equal(r.calls.filter(x=>x.body.action==='post').length,1);
 }finally{f.close();}
});

test('an in-flight expense disables controls and prevents repeated posts or stale edits',async()=>{
 const f=await environment(),{r,draw}=f;const request=r.request;let resolvePost;
 r.request=(area,body)=>body.action==='post'?new Promise(resolve=>{r.calls.push({area,body:structuredClone(body)});resolvePost=resolve;}):request(area,body);
 try{
  await review(r,draw);change(r,'Confirm reserved Dégustation review',true);draw();const submit=button(r,'Confirm reserved Dégustation expense'),pending=submit.onClick();draw();assert.equal(r.elements.find(x=>x.tag==='fieldset').props.disabled,true);assert.equal(control(r,'Confirm reserved Dégustation review').disabled,true);assert.equal(button(r,'Posting promotional expense...').disabled,true);
  change(r,'Review reference','Ignored edit');change(r,'Confirm reserved Dégustation review',false);await submit.onClick();draw();assert.equal(control(r,'Review reference').value,'  Owner reviewed reserved promo stock  ');assert.equal(control(r,'Confirm reserved Dégustation review').checked,true);assert.equal(r.calls.filter(x=>x.body.action==='post').length,1);
  resolvePost(saved);await pending;assert.match(draw(),/Reserved Dégustation expensed/);assert.equal(r.posted.length,1);
 }finally{f.close();}
});

test('a failed view refresh cannot turn a committed expense into a posting failure',async()=>{
 for(const asyncFailure of [false,true]){
  const f=await environment(),{r,draw}=f;let callbacks=0;
  f.setProps({onPosted:()=>{callbacks++;if(asyncFailure)return Promise.reject(Error('View refresh failed'));throw Error('View refresh failed');}});
  try{await review(r,draw);change(r,'Confirm reserved Dégustation review',true);draw();await button(r,'Confirm reserved Dégustation expense').onClick();await r.flush();const html=draw();assert.equal(callbacks,1);assert.equal(r.calls.filter(x=>x.body.action==='post').length,1);assert.match(html,/Reserved Dégustation expensed\. The promotional units remain in employee custody/);assert.match(html,/JV-PROMO/);assert.equal(button(r,'Confirm reserved Dégustation expense'),undefined);assert.doesNotMatch(html,/role="alert"[^>]*>View refresh failed/);}finally{f.close();}
 }
});

test('reconciliation loads the appropriation form only for principal administrators with an open reserved load',async()=>{
 for(const user of [{principalRole:'warehouse_manager',role:'admin'},{principalRole:'user',role:'admin'},{principalRole:'admin',role:'admin'}]){
  const f=await environment({kind:'reconciliation',user}),{r,draw}=f;
  try{let html=draw();const allowed=user.principalRole==='admin';assert.equal(html.includes('Expense reserved Dégustation'),allowed);assert.equal(r.children.length,0);assert.equal(r.calls.length,0);if(allowed){r.elements.find(x=>x.tag==='details').props.onToggle({currentTarget:{open:true}});html=draw();assert.match(html,/data-appropriation-form="legacy-run"/);assert.equal(r.children.length,1);assert.equal(r.children[0].dispatch.id,dispatch.id);assert.equal(r.reads.length,0,'account reads belong to the lazily opened child');}}
  finally{f.close();}
 }
 for(const overrides of [{run:{...dispatch,unsold_return_request_id:'pending-return'}},{run:{...dispatch,status:'returned'}},{canManage:false},{data:{...snapshot,rows:snapshot.rows.map(x=>({...x,degustation_remaining:0}))}}]){
  const f=await environment({kind:'reconciliation',...overrides});try{assert.doesNotMatch(f.draw(),/Expense reserved Dégustation/);}finally{f.close();}
 }
});

test('the reconciliation refresh keeps the recorded expense authoritative if its parent refresh fails',async()=>{
 const f=await environment({kind:'reconciliation'}),{r,draw}=f;
 f.setProps({onChanged:async()=>{throw Error('Parent refresh failed');}});
 try{
  draw();r.elements.find(x=>x.tag==='details').props.onToggle({currentTarget:{open:true}});draw();assert.equal(r.children.length,1);
  r.snapshot={...snapshot,degustationAppropriation:{...saved},degustationCost:260};await r.children[0].onPosted(saved);draw();await r.flush();const html=draw();
  assert.deepEqual(r.reconciliations,[dispatch.id]);assert.match(html,/Expensed promotional stock still held/);assert.match(html,/Expense recorded\. Refresh the reconciliation to see the updated balances/);assert.doesNotMatch(html,/role="alert"/);assert.doesNotMatch(html,/Expense reserved Dégustation/);assert.equal(r.calls.length,0);
 }finally{f.close();}
});

test('an expensed reserved load keeps all 13 units in custody and distinct from customer giveaways',async()=>{
 const appropriation={journal_id:'promo-journal',journal_number:'JV-PROMO',total_quantity:13,total_value:260};
 const f=await environment({kind:'reconciliation',data:{...snapshot,degustationAppropriation:appropriation,degustationCost:260}});
 try{const html=f.draw();assert.match(html,/Expensed promotional stock still held: <strong>13/);assert.match(html,/These quantities are reserved for Dégustation and cannot be sold/);assert.match(html,/Actual customer giveaways remain separately recorded/);assert.match(html,/Given away[^<]*<!-- -->[^<]*0|Given away[^<]*: [\s\S]*?0/);assert.match(html,/Remaining[\s\S]*?13/);assert.match(html,/href="\/accounting\/journals\/promo-journal"/);assert.doesNotMatch(html,/Expense reserved Dégustation/);assert.equal(f.r.calls.length,0);assert.equal(f.r.children.length,0);}
 finally{f.close();}
});

test('a blocked preview displays lot carrying-value evidence and verified source journals without authorizing a post',async()=>{
 const f=await environment({run:{...dispatch,vehicle_warehouse_id:'custody'}}),{r,draw}=f;
 r.request=async(area,body)=>{r.calls.push({area,body:structuredClone(body)});throw Object.assign(Error('Remaining lot values do not reconcile.'),{status:409,diagnostics:structuredClone(blockedDiagnostics)});};
 try{
  const html=await review(r,draw);assert.match(html,/Inventory carrying-value differences/);assert.match(html,/No expense has been posted/);assert.match(html,/Source sale journals verified/);assert.match(html,/Expected remaining/);assert.match(html,/Currently recorded/);assert.match(html,/200 XAF/);assert.match(html,/260 XAF/);assert.match(html,/60 XAF/);assert.match(html,/100\.000/);assert.match(html,/87\.000/);assert.match(html,/load-1/);assert.match(html,/sale-issue-1/);assert.match(html,/production-1/);assert.match(html,/batch-1/);assert.match(html,/Current unit costs/);assert.match(html,/20 XAF/);assert.match(html,/href="\/accounting\/journals\/source-journal"/);assert.match(html,/JV-SALE/);assert.match(html,/300 XAF/);
  assert.equal(button(r,'Confirm reserved Dégustation expense'),undefined);assert.equal(control(r,'Confirm reserved Dégustation review'),undefined);assert.deepEqual(r.calls.map(call=>call.body.action),['preview']);assert.equal(r.posted.length,0);
 }finally{f.close();}
});

test('diagnostic text is escaped and journal links stay within the encoded journal route',async()=>{
 const f=await environment(),{r,draw}=f,diagnostics=structuredClone(blockedDiagnostics),journalId='source/id?next=<script>';
 diagnostics.mismatches[0].product_name='<script>unsafe()</script>';diagnostics.mismatches[0].lot_number='<img src=x onerror=unsafe()>';diagnostics.source_journals[0].id=journalId;diagnostics.source_journals[0].journal_number='<b>JV-SALE</b>';
 r.request=async()=>{throw Object.assign(Error('<img src=x onerror=unsafe()>'),{status:409,diagnostics});};
 try{const html=await review(r,draw);assert.doesNotMatch(html,/<script>|<img|<b>JV-SALE/);assert.match(html,/&lt;script&gt;unsafe\(\)&lt;\/script&gt;/);assert.match(html,/&lt;img src=x onerror=unsafe\(\)&gt;/);assert.match(html,/&lt;b&gt;JV-SALE&lt;\/b&gt;/);assert.ok(html.includes('href="/accounting/journals/'+encodeURIComponent(journalId)+'"'));assert.equal(button(r,'Confirm reserved Dégustation expense'),undefined);}finally{f.close();}
});

test('diagnostics cannot claim another run or warehouse and unverified evidence is not labelled verified',async()=>{
 for(const changes of [{dispatch_id:'another-run'},{stock_warehouse_id:'another-custody'},{source_journals_verified:false}]){
  const f=await environment({run:{...dispatch,vehicle_warehouse_id:'custody'}}),{r,draw}=f,diagnostics={...structuredClone(blockedDiagnostics),...changes};
  r.request=async()=>{throw Object.assign(Error('Review stock values.'),{status:409,diagnostics});};
  try{const html=await review(r,draw);if(changes.source_journals_verified===false){assert.match(html,/Inventory carrying-value differences/);assert.doesNotMatch(html,/Source sale journals verified|Verified source journals|href="\/accounting\/journals\/source-journal"/);}else assert.doesNotMatch(html,/Inventory carrying-value differences|source-journal|200 XAF/);assert.match(html,/Review stock values/);assert.equal(button(r,'Confirm reserved Dégustation expense'),undefined);}finally{f.close();}
 }
});

test('editing the review or starting a new preview removes old lot diagnostics',async()=>{
 const f=await environment(),{r,draw}=f;
 const reject=async()=>{throw Object.assign(Error('Review stock values.'),{status:409,diagnostics:structuredClone(blockedDiagnostics)});};r.request=reject;
 try{
  await review(r,draw);change(r,'Review reference','New physical count');assert.doesNotMatch(draw(),/Inventory carrying-value differences/);await button(r,'Preview reserved Dégustation expense').onClick();assert.match(draw(),/Inventory carrying-value differences/);
  change(r,'Degustation expense account',otherExpense.id);assert.doesNotMatch(draw(),/Inventory carrying-value differences/);await button(r,'Preview reserved Dégustation expense').onClick();assert.match(draw(),/Inventory carrying-value differences/);
  let resolvePreview,payload;r.request=(_area,body)=>new Promise(resolve=>{resolvePreview=resolve;payload=body;});const pending=button(r,'Preview reserved Dégustation expense').onClick();assert.doesNotMatch(draw(),/Inventory carrying-value differences/);assert.equal(button(r,'Preparing expense preview...').disabled,true);resolvePreview(preview(payload));await pending;const html=draw();assert.doesNotMatch(html,/Inventory carrying-value differences/);assert.match(html,/Physical units retained/);assert.equal(control(r,'Confirm reserved Dégustation review').checked,false);
 }finally{f.close();}
});

test('a posting conflict discards its old confirmation whether or not structured diagnostics are returned',async()=>{
 for(const diagnostics of [null,structuredClone(blockedDiagnostics)]){
  const f=await environment(),{r,draw}=f;const request=r.request;
  r.request=async(area,body)=>{if(body.action==='post'){r.calls.push({area,body:structuredClone(body)});throw Object.assign(Error('Preview the changed stock again.'),{status:409,...(diagnostics?{diagnostics}:{})});}return request(area,body);};
  try{await review(r,draw);change(r,'Confirm reserved Dégustation review',true);draw();await button(r,'Confirm reserved Dégustation expense').onClick();const html=draw();assert.match(html,/Preview the changed stock again/);assert.equal(button(r,'Confirm reserved Dégustation expense'),undefined);assert.equal(control(r,'Confirm reserved Dégustation review'),undefined);assert.equal(button(r,'Preview reserved Dégustation expense').disabled,false);assert.equal(r.calls.filter(call=>call.body.action==='post').length,1);assert.equal(r.posted.length,0);assert.equal(html.includes('Inventory carrying-value differences'),!!diagnostics);}finally{f.close();}
 }
});

test('the accounting client exposes diagnostics only for appropriation conflicts and preserves ordinary success invalidation',async()=>{
 const output=await build({entryPoints:['src/lib/accounting-controls-client.js'],bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'accounting-client-test',setup(b){b.onResolve({filter:/^@\/api\/erpClient$/},()=>({path:'erp',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const invalidateERPReads=()=>globalThis.__accountingClientInvalidations++;'}));}}]});
 const module={exports:{}};new Function('module','exports',output.outputFiles[0].text)(module,module.exports);const request=module.exports.accountingControlRequest,nativeFetch=globalThis.fetch,calls=[];globalThis.__accountingClientInvalidations=0;
 try{
  for(const sample of [{area:'degustation-appropriation',status:409,diagnostics:blockedDiagnostics,attached:true},{area:'setup-stock-correction',status:409,diagnostics:blockedDiagnostics,attached:false},{area:'degustation-appropriation',status:400,diagnostics:blockedDiagnostics,attached:false},{area:'degustation-appropriation',status:409,diagnostics:[],attached:false}]){
   globalThis.fetch=async(url,options)=>{calls.push({url,options});return {ok:false,status:sample.status,json:async()=>({error:'Inventory values need review.',diagnostics:sample.diagnostics})};};
   await assert.rejects(request(sample.area,{action:'preview'}),error=>{assert.equal(error.message,'Inventory values need review.');assert.equal(error.status,sample.status);assert.equal(Object.hasOwn(error,'diagnostics'),sample.attached);if(sample.attached)assert.deepEqual(error.diagnostics,blockedDiagnostics);return true;});
  }
  assert.equal(globalThis.__accountingClientInvalidations,0);assert.equal(calls[0].url,'/api/accounting/degustation-appropriation');assert.equal(calls[0].options.credentials,'same-origin');assert.equal(calls[0].options.cache,'no-store');assert.equal(calls[0].options.body,JSON.stringify({action:'preview'}));
  globalThis.fetch=async()=>({ok:true,status:200,json:async()=>saved});assert.deepEqual(await request('degustation-appropriation',{action:'post'}),saved);assert.equal(globalThis.__accountingClientInvalidations,1);await request('other-control');assert.equal(globalThis.__accountingClientInvalidations,1);
 }finally{globalThis.fetch=nativeFetch;delete globalThis.__accountingClientInvalidations;}
});

test('legacy rounding is reviewed as a separate balanced correction before the promotional expense and both journals link on success',async()=>{
 const f=await environment({accountRows:[...accounts,manufacturingCogs]}),{r,draw}=f,roundedSaved={...saved,rounding_journal_id:'rounding/journal',rounding_journal_number:'JV-ROUND'};
 r.request=async(area,body)=>{r.calls.push({area,body:structuredClone(body)});if(body.action==='post')return roundedSaved;return {...preview(body),inventory_value_change:-260.11,lots:preview(body).lots.map(lot=>({...lot,recorded_value_before:260.15})),legacy_rounding:{required:true,policy:'verified-legacy-rounded-unit-cost-v1',cogs_change:0.11,inventory_value_change:-0.11,cache_value_change:-0.15,journal_lines:[{account_id:manufacturingCogs.id,debit:0.11,credit:0},{account_id:'finished-goods',debit:0,credit:0.11}],lots:[{...blockedDiagnostics.mismatches[0],current_value:260.15,receipt_unit_cost:5,legacy_remaining_value:260.11,reconciled_value:260,cache_value_change:-0.15,exhausted:false,cogs_adjustment:0.11,rounding_bound:0.5}]}};};
 try{
  const html=await review(r,draw),plain=html.replace(/<[^>]*>/g,'');assert.match(plain,/Marketing expense: 260 XAF/);assert.match(plain,/Combined inventory journal change: -260.11 XAF/);assert.match(plain,/COGS adjustment0.11 XAF/);assert.match(plain,/Inventory journal adjustment-0.11 XAF/);assert.match(plain,/Recorded inventory value correction-0.15 XAF/);assert.match(plain,/Original sale journals remain unchanged/);assert.match(plain,/Recorded inventory valueLegacy remaining costReconciled carrying value260.15 XAF260.11 XAF260 XAF/);assert.match(html,/<details class="min-w-0"><summary[^>]*>Lot rounding evidence<\/summary>/);assert.doesNotMatch(html,/<details[^>]*open/);
  const correction=html.match(/<table aria-label="Rounding correction journal"[\s\S]*?<\/table>/)[0].replace(/<[^>]*>/g,'');assert.match(correction,/6100 \/ Cost of Goods Sold0.11 XAF0 XAF/);assert.match(correction,/1320 \/ Finished Goods Inventory0 XAF0.11 XAF/);const appropriation=html.match(/<table aria-label="Proposed journal"[\s\S]*?<\/table>/)[0].replace(/<[^>]*>/g,'');assert.match(appropriation,/6971 \/ Degustation260 XAF0 XAF/);assert.doesNotMatch(appropriation,/6100/);
  assert.match(html,/I reviewed the reserved quantities, reconciled costs, expense account, employee custody and both proposed journals/);assert.ok(html.indexOf('Rounding correction journal')<html.indexOf('Confirm reserved D\u00e9gustation review'));assert.equal(button(r,'Confirm reserved D\u00e9gustation expense').disabled,true);assert.equal(r.calls.filter(call=>call.body.action==='post').length,0);
  change(r,'Confirm reserved D\u00e9gustation review',true);draw();await button(r,'Confirm reserved D\u00e9gustation expense').onClick();const success=draw();assert.match(success,/href="\/accounting\/journals\/promo-journal"/);assert.match(success,/href="\/accounting\/journals\/rounding%2Fjournal"/);assert.match(success,/Rounding correction<!-- -->: <!-- -->JV-ROUND|Rounding correction: JV-ROUND/);assert.deepEqual(r.posted,[roundedSaved]);assert.equal(r.calls.filter(call=>call.body.action==='post').length,1);assert.equal(r.calls.find(call=>call.body.action==='post').body.roundingReviewPolicy,'verified-legacy-rounded-unit-cost-v1');
 }finally{f.close();}
});

test('a zero-value promotional lot still identifies its required rounding journal precisely',async()=>{
 const f=await environment({accountRows:[...accounts,manufacturingCogs]}),{r,draw}=f;
 r.request=async(_area,body)=>({...preview(body),total_value:0,journal_lines:[],inventory_value_change:-0.11,lots:preview(body).lots.map(lot=>({...lot,value:0})),legacy_rounding:{required:true,policy:'verified-legacy-rounded-unit-cost-v1',cogs_change:0.11,inventory_value_change:-0.11,cache_value_change:0,journal_lines:[{account_id:manufacturingCogs.id,debit:0.11,credit:0},{account_id:'finished-goods',debit:0,credit:0.11}],lots:[{...blockedDiagnostics.mismatches[0],current_value:0,legacy_remaining_value:0.11,reconciled_value:0,cache_value_change:0,exhausted:true,cogs_adjustment:0.11}]}});
 try{const html=await review(r,draw);assert.match(html,/Zero promotional carrying value; no appropriation journal will be posted/);assert.doesNotMatch(html,/Zero carrying value; no journal will be posted/);assert.match(html,/Fully issued lot/);assert.match(html,/I reviewed the reserved quantities, reconciled costs, expense account, employee custody and the rounding correction journal/);assert.doesNotMatch(html,/and both proposed journals/);assert.equal(button(r,'Confirm reserved D\u00e9gustation expense').disabled,true);}finally{f.close();}
});

test('a recorded-value-only rounding correction requires review without claiming a second journal or a COGS change',async()=>{
 const f=await environment(),{r,draw}=f;
 r.request=async(_area,body)=>({...preview(body),legacy_rounding:{required:true,policy:'verified-legacy-rounded-unit-cost-v1',cogs_change:0,inventory_value_change:0,cache_value_change:-0.15,journal_lines:[],lots:[{...blockedDiagnostics.mismatches[0],current_value:260.15,legacy_remaining_value:260,reconciled_value:260,cache_value_change:-0.15,exhausted:false,cogs_adjustment:0}]}});
 try{const html=await review(r,draw);assert.match(html,/No rounding journal is required; only the recorded lot value is reconciled/);assert.match(html,/without changing COGS or posting another journal/);assert.match(html,/I reviewed the reserved quantities, reconciled costs, expense account, employee custody and the recorded inventory value correction/);assert.doesNotMatch(html,/aria-label="Rounding correction journal"|and both proposed journals|separate rounding journal changes COGS/);assert.match(html,/aria-label="Proposed journal"/);assert.equal(button(r,'Confirm reserved D\u00e9gustation expense').disabled,true);}finally{f.close();}
});
