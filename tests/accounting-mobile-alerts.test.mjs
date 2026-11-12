import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {cashierAction} from '../src/server/domain/cashier-workspace.js';
import {recurringExpenseWorkspace} from '../src/server/domain/recurring-expenses.js';
import {recurringBillId} from '../src/server/domain/recurring-bill-evidence.js';
import {fixture,date,user,functionRoute,request} from './helpers/cashier.mjs';
import {hookRuntime} from './helpers/commercial-ui.mjs';
const require=createRequire(import.meta.url);

function limitedStores(entities,names,reads){
 return new Proxy(entities,{get(target,name){assert.ok(names.includes(name),'Unexpected private table read: '+String(name));reads.add(name);return target[name];}});
}

test('cash confirmations use recorded pending facts, preserve bank visibility and read only three tables without writes',async()=>{
 const f=await fixture(),s=f.entities;
 f.client.auth.staff=()=>s.Employee.get('cashier');
 await s.CashHandover.create({handover_number:'PART',handover_date:date,commercial_name:'Partial Agent',expected_amount:2500,received_amount:800,status:'partially_received',private_notes:'private'});
 await s.CashHandover.create({handover_number:'BANK',handover_date:date,commercial_name:'Bank Agent',expected_amount:900,received_amount:0,status:'submitted',treasury_account_id:'bank'});
 await s.CashHandover.create({handover_number:'DONE',handover_date:date,commercial_name:'Already received',expected_amount:500,received_amount:500,status:'received'});
 await s.CashHandover.create({handover_number:'ZERO',handover_date:date,commercial_name:'Resolved',expected_amount:500,received_amount:500,status:'disputed'});
 await s.Payment.create({payment_number:'STAFF',payment_type:'customer_payment',status:'awaiting_cashier',receipt_channel:'staff_collection',collector_name:'Staff A',party_name:'Customer A',amount:'600',collection_date:date,collector_user_id:'private-id'});
 await s.Payment.create({payment_number:'UNRECORDED',payment_type:'customer_payment',status:'pending_approval',amount:800});
 const confirmed={payment_type:'customer_payment',status:'pending_approval',amount:400,party_id:'customer-a',party_name:'Customer A',payment_date:date,invoice_numbers:'INV-READY',cashier_confirmed_by:user.id,receipt_allocations:[{invoice_id:'ready',amount:400}]};
 await s.Payment.create({...confirmed,payment_number:'READY',payment_method:'cash',treasury_account_id:'till'});
 await s.Payment.create({...confirmed,payment_number:'BANK-READY',payment_method:'bank_transfer',treasury_account_id:'bank'});
 await s.Payment.create({payment_number:'OTHER',payment_type:'supplier_payment',status:'awaiting_cashier',receipt_channel:'staff_collection',amount:900});
 const before=structuredClone(f.rows),reads=new Set();
 f.client.asServiceRole.entities=limitedStores(s,['TreasuryAccount','CashHandover','Payment'],reads);
 const queue=await cashierAction(f.client,user,{action:'cashierWorkspace',view:'confirmations',date});
 assert.deepEqual([...reads].sort(),['CashHandover','Payment','TreasuryAccount']);
 assert.equal(queue.rows.length,4);assert.equal(queue.rows.find(r=>r.reference==='PART').amount,1700);assert.equal(queue.rows.find(r=>r.reference.startsWith('STAFF')).amount,600);
 assert.ok(queue.rows.every(r=>Object.keys(r).every(k=>['id','name','reference','date','kind','amount'].includes(k))));
 assert.equal(queue.rows.find(r=>r.reference==='READY · INV-READY').kind,'confirmed_receipt');
 assert.ok(!queue.rows.some(r=>['BANK','DONE','ZERO','UNRECORDED','OTHER','BANK-READY'].some(ref=>r.reference===ref||r.reference.startsWith(ref+' · '))));
 const gm=await cashierAction(f.client,{id:'gm',role:'admin'},{action:'cashierWorkspace',view:'confirmations',date});assert.ok(gm.rows.some(r=>r.reference==='BANK'));assert.ok(gm.rows.some(r=>r.reference==='BANK-READY · INV-READY'));
 assert.deepEqual(f.rows,before,'read projection must not create journals, receipts, cash movements or audit writes');
});

test('cash confirmation projection keeps native role and module denials before private reads',async()=>{
 for(const employee of [{role:'production_manager',status:'active'},{role:'commercial',status:'active'},{role:'driver',status:'active'},{role:'cashier',status:'inactive'}]){
  const client={auth:{staff:async()=>employee},asServiceRole:{get entities(){throw Error('Private read before authorization');}}};
  await assert.rejects(cashierAction(client,user,{action:'cashierWorkspace',view:'confirmations',date}),/Not permitted|active Cashier/);
 }
 const route=await functionRoute(),f=await fixture(),previous=globalThis.__cashierClient,previousTx=globalThis.__cashierTransaction;
 globalThis.__cashierClient={...f.client,auth:{...f.client.auth,assertModule:module=>{assert.equal(module,'cashier');throw Error('Cashier module disabled');}},asServiceRole:{get entities(){throw Error('Private read before module authorization');}}};
 globalThis.__cashierTransaction=fn=>fn();
 try{const result=await route(request({action:'cashierWorkspace',view:'confirmations',date}),{params:Promise.resolve({name:'fieldOps'})});assert.equal(result.status,400);assert.match((await result.json()).error,/Cashier module disabled/);}finally{globalThis.__cashierClient=previous;globalThis.__cashierTransaction=previousTx;}
});

test('overdue recurring alerts separate accrued debt from unrecognized schedules and omit paid, cancelled and not-yet-due facts',async()=>{
 const f=await fixture(),s=f.entities,today='2026-11-10';
 const schedule=(effective,amount,due)=>({versions:[{enabled:true,amount,supplier_id:'supplier',supplier_name:'Landlord',due_day:due,effective_month:effective,effective_date:effective+'-01',payable_account_id:'payable'}]});
 for(const [id,effective,amount,due] of [['rent','2026-09',100,5],['partial','2026-11',80,5],['future','2026-11',200,30],['today','2026-11',300,10],['cancelled','2026-11',500,5]])f.rows.Account.push({id,name:id,account_number:id,account_type:'expense',normal_balance:'debit',is_active:true,is_posting:true,recurring_expense:schedule(effective,amount,due)});
 f.rows.Bill.push({id:recurringBillId('rent','2026-09'),accounting_source:'recurring_expense',status:'open',balance:40},{id:recurringBillId('rent','2026-10'),accounting_source:'recurring_expense',status:'paid',balance:0},{id:recurringBillId('partial','2026-11'),accounting_source:'recurring_expense',status:'partially_paid',balance:25},{id:recurringBillId('cancelled','2026-11'),accounting_source:'recurring_expense',status:'cancelled',balance:500});
 const before=structuredClone(f.rows),reads=new Set(),stores=limitedStores(s,['Account','Bill'],reads),context={user:{id:'gm',role:'admin'},role:'admin',employee:null};
 const alerts=await recurringExpenseWorkspace(stores,context,{reportOnly:true,alertsOnly:true,today});
 assert.deepEqual(alerts,{date:today,overdue_accrued_count:2,overdue_accrued_total:65,overdue_pending_count:1,overdue_pending_total:100});assert.deepEqual([...reads].sort(),['Account','Bill']);assert.deepEqual(f.rows,before);
 const original=await recurringExpenseWorkspace(stores,context,{reportOnly:true,today});assert.deepEqual(Object.keys(original).sort(),['can_review','pending_count','pending_total']);
 await assert.rejects(recurringExpenseWorkspace(new Proxy({},{get(){throw Error('Unauthorized private reader');}}),{user:{id:'field'},role:'commercial',employee:{id:'field',role:'commercial',status:'active',allowed_modules:['accounting']}},{reportOnly:true,alertsOnly:true,today}),{status:403});
});

let compiled;
async function renderer(){
 if(compiled)return compiled;
 const out=await build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Manager from './src/components/home/MobileManagerHome.jsx';import Accounting from './src/components/accounting/mobile/MobileAccountingHome.jsx';import Accountant from './src/components/home/MobileAccountantHome.jsx';export const render=(kind,props)=>renderToStaticMarkup(React.createElement({manager:Manager,accounting:Accounting,accountant:Accountant}[kind],props));export {canReadCashConfirmations,loadCashConfirmations} from './src/lib/cash-confirmations.js';",resolveDir:process.cwd(),loader:'jsx'},bundle:true,jsx:'automatic',platform:'node',format:'cjs',write:false,plugins:[{name:'accounting-alert-fixtures',setup(b){
 b.onResolve({filter:/^react$/},a=>/(MobileManagerHome|MobileAccountingHome|MobileAccountantHome)\.jsx$/.test(a.importer)?{path:a.importer,namespace:'hooks'}:undefined);
 b.onLoad({filter:/.*/,namespace:'hooks'},({path:key})=>({contents:`import React from ${JSON.stringify(require.resolve('react'))};export default React;const key=${JSON.stringify(key)};export const useState=v=>globalThis.__accountingAlertsUI.state(key,v),useEffect=(f,d)=>globalThis.__accountingAlertsUI.effect(key,f,d);`,resolveDir:process.cwd()}));
 const mocks={
  '@/hooks/useCurrentUser':'export const useCurrentUser=()=>globalThis.__accountingAlertsUI.session;',
  '@/lib/localization':'export const useLocaleRender=()=>null;',
  '@/lib/business-date':"export const businessDate=()=> '2026-11-10';",
  '@/lib/router':"import React from 'react';export const Link=({to,children,...p})=>React.createElement('a',{href:to,...p},children);export const useNavigate=()=>path=>globalThis.__accountingAlertsUI.navigation.push(path);",
  '@/api/erpClient':"export const erp={functions:{invoke:async(_name,body)=>{const r=globalThis.__accountingAlertsUI;r.cashRequests.push(body);return {data:r.cash};}}};",
  '@/lib/recurring-expense-client':"export const recurringExpenseRequest=async(body,query={})=>{const r=globalThis.__accountingAlertsUI;r.recurringRequests.push({body,query});return query.summary==='alerts'?r.alerts:r.charges;};",
  './WorkspaceAccess':"export const useWorkspaceAccess=()=>{const modules=globalThis.__accountingAlertsUI.modules;return {can:module=>modules.includes(module),canOpen:path=>modules.includes(path.startsWith('/accounting')?'accounting':path.startsWith('/sales')?'sales':path.startsWith('/cashier')?'cashier':'inventory')};};",
  './useMobileHomeInventory':"export const useMobileHomeInventory=enabled=>{globalThis.__accountingAlertsUI.inventoryEnabled=enabled;return {data:null,error:''};};",
  './StaffMobileParts':"import React from 'react';export const StaffDate=()=>null,StaffModules=()=>null,StaffSection=({children})=>React.createElement('section',null,children),StaffMetrics=({metrics})=>React.createElement('section',null,metrics.filter(Boolean).map(m=>React.createElement('p',{key:m.label},m.label+': '+m.value)));",
 };
 b.onResolve({filter:/(?:^|\/)loadMobileAccountingSummary(?:\.js)?$/},()=>({path:'finance',namespace:'mocks'}));
 b.onResolve({filter:/.*/},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'mocks'}:undefined);
 b.onLoad({filter:/.*/,namespace:'mocks'},a=>({contents:a.path==='finance'?"export const loadMobileAccountingSummary=async options=>{const r=globalThis.__accountingAlertsUI;r.financeRequests.push(options);return {sales:1000,netProfit:600,payables:120,receivables:345};};":mocks[a.path],resolveDir:process.cwd()}));
 }}]});const mod={exports:{}};new Function('require','module','exports',out.outputFiles[0].text)(require,mod,mod.exports);compiled=mod.exports;return compiled;
}
function uiRuntime(){const r=hookRuntime();Object.assign(r,{financeRequests:[],cashRequests:[],recurringRequests:[],modules:['accounting','cashier','inventory','sales'],session:{role:'admin',principalRole:'admin',allowedModules:['accounting','cashier'],employee:null},cash:{date:'2026-11-10',rows:[{id:'cash:actual',name:'Actual cashier depositor',reference:'ACTUAL-123',amount:1700,kind:'handover'}]},alerts:{date:'2026-11-10',overdue_accrued_count:2,overdue_accrued_total:65,overdue_pending_count:1,overdue_pending_total:100},charges:{rows:[]}});return r;}

 test('cash queue browser gate uses native Cashier/full Cashier authority rather than broad Accounting feature role',async()=>{
 const {canReadCashConfirmations:canRead,loadCashConfirmations:load}=await renderer(),r=uiRuntime();globalThis.__accountingAlertsUI=r;
 try{
  for(const authority of [{principalRole:'warehouse_manager',role:'admin',allowedModules:['accounting'],employee:{status:'active'}},{principalRole:'production_manager',role:'admin',allowedModules:['accounting','cashier'],employee:{status:'active',full_access_modules:[]}},{principalRole:'commercial',role:'admin',allowedModules:['cashier'],employee:{status:'active',full_access_modules:['cashier']}},{principalRole:'driver',role:'admin',allowedModules:['cashier'],employee:{status:'active',full_access_modules:['cashier']}},{principalRole:'cashier',role:'cashier',allowedModules:[],employee:{status:'active'}},{principalRole:'cashier',role:'cashier',allowedModules:['cashier'],employee:{status:'inactive'}}]){assert.equal(canRead(authority),false);assert.equal(await load(authority),null);}
  assert.equal(r.cashRequests.length,0);
  const authority={principalRole:'warehouse_manager',role:'admin',allowedModules:['accounting','cashier'],employee:{status:'active',full_access_modules:['cashier']}};assert.equal(canRead(authority),true);await load(authority,{date:'2026-11-10'});assert.deepEqual(r.cashRequests,[{action:'cashierWorkspace',view:'confirmations',date:'2026-11-10'}]);
 }finally{r.cleanup();delete globalThis.__accountingAlertsUI;}
});

test('Accounting renders authorized actual cash queue and removes it when Cashier access is revoked',async()=>{
 const {render}=await renderer(),r=uiRuntime();globalThis.__accountingAlertsUI=r;
 const draw=()=>{r.beforeRender();return render('accounting',{});};
 try{draw();await r.flush();let html=draw();assert.match(html,/Actual cashier depositor/);assert.match(html,/ACTUAL-123/);assert.match(html,/Cash awaiting confirmation/);assert.match(html,/href="\/cashier\?section=handovers"/);assert.equal(r.cashRequests.length,1);
 r.session={...r.session,allowedModules:['accounting']};html=draw();await r.flush();assert.doesNotMatch(html,/Actual cashier depositor|Cash awaiting confirmation/);assert.equal(r.cashRequests.length,1);
 }finally{r.cleanup();delete globalThis.__accountingAlertsUI;}
});

test('GM recurring alerts use actual overdue summaries; GM and Accountant previews make no finance or queue calls or retain live totals',async()=>{
 const {render}=await renderer(),r=uiRuntime(),previousWindow=globalThis.window;globalThis.__accountingAlertsUI=r;globalThis.window={addEventListener(){},removeEventListener(){}};
 const data={date:'2026-11-10',approvalQueues:[]},draw=(kind,preview)=>{r.beforeRender();return render(kind,{data,loading:false,preview});};
 try{draw('manager',false);await r.flush();let html=draw('manager',false);assert.match(html,/Overdue recurring payables/);assert.match(html,/2 accrued unpaid charges/);assert.match(html,/Overdue recurring charges to recognize/);assert.match(html,/1 scheduled charges not yet included in profit/);assert.deepEqual(r.recurringRequests,[{body:null,query:{summary:'alerts'}}]);assert.equal(r.financeRequests.length,1);
 html=draw('manager',true);await r.flush();assert.doesNotMatch(html,/Overdue recurring payables|Overdue recurring charges to recognize/);assert.equal(r.financeRequests.length,1);assert.equal(r.recurringRequests.length,1);assert.equal(r.cashRequests.length,0);
 draw('accountant',true);await r.flush();html=draw('accountant',true);assert.equal(r.financeRequests.length,1);assert.equal(r.inventoryEnabled,false);assert.doesNotMatch(html,/600|345/);
 r.modules=['sales'];draw('manager',false);await r.flush();assert.equal(r.financeRequests.length,1);assert.equal(r.recurringRequests.length,1);
 }finally{r.cleanup();globalThis.window=previousWindow;delete globalThis.__accountingAlertsUI;}
});
