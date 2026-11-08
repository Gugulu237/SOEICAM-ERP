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
const dispatch={id:'legacy-run',dispatch_number:'DSP-PROMO',salesperson_name:'Stock holder',status:'loaded',total_loaded_value:500};
const preview=body=>({token:'verified-'+body.expenseAccountId+'-'+body.reference,dispatch:{...dispatch,employee_name:'Stock holder'},expense_account:accounts.find(a=>a.id===body.expenseAccountId),date,reference:body.reference,lots:[{id:'lot-1',product_id:'yogurt',product_name:'YOLA yogurt',lot_number:'PRODUCTION-1',quantity:13,value:260,inventory_account_id:'finished-goods'}],total_quantity:13,total_value:260,journal_lines:[{account_id:body.expenseAccountId,debit:260,credit:0},{account_id:'finished-goods',debit:0,credit:260}],stock_quantity_change:0,inventory_value_change:-260,cash_change:0});
const saved={journal_id:'promo-journal',journal_number:'JV-PROMO',total_quantity:13,total_value:260,reused:false};
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
