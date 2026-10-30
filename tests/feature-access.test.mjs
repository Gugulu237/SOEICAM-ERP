import {saveManualJournal} from '../src/server/domain/manual-journals.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import path from 'node:path';
import {featureContext,entityFeatureContext} from '../src/server/feature-access.js';
import {principalRole,effectiveRole,FEATURE_AUTHORITY} from '../src/server/domain/roles.js';
import {catalogueFromStored,validateRoleProfile,decorateEmployee,assertModule} from '../src/server/domain/role-catalogue.js';
import {assertEntityAccess,guardMutation} from '../src/server/access.js';
import {fixture,user,date} from './helpers/cashier.mjs';
import {salesOrderAction} from '../src/server/domain/sales-orders.js';

function context(modules=['inventory','sales'],template='employee'){
 const profile=validateRoleProfile({key:'delivery_worker',label:'Delivery worker',category:'Operations',template_role:template,modules});
 const roleCatalogue=catalogueFromStored({revision:1,roles:{delivery_worker:profile}}),account={...user,role:'user'};
 const employee=decorateEmployee(account,{id:'cashier',user_id:account.id,full_name:'Actual worker',role:'delivery_worker',status:'active'},roleCatalogue);
 return {user:account,employee,roleCatalogue,role:effectiveRole(account,employee)};
}
test('checked features authorize their workflows without changing job role, identity or other features',()=>{
 const original=context(),inventory=featureContext(original,'inventory');
 assert.equal(original.role,'employee');assert.equal(inventory.user.id,original.user.id);assert.equal(inventory.user.role,'user');assert.equal(principalRole(inventory.user,inventory.employee),'employee');assert.equal(effectiveRole(inventory.user,inventory.employee),'admin');
 assert.equal(inventory.user[FEATURE_AUTHORITY].module,'inventory');assert.equal(assertEntityAccess(inventory,'StockBalance','filter'),'admin');assert.equal(assertEntityAccess(inventory,'Product','update'),'admin');
 assert.throws(()=>assertModule(inventory,'accounting'),/does not allow/);
 const accounting=featureContext(original,'accounting');assert.equal(accounting,original);assert.throws(()=>assertEntityAccess(accounting,'JournalEntry','filter'));
 assert.equal(JSON.stringify(inventory.user).includes('verified-feature-authority'),false);
});
test('revoked or forged grants and inactive staff cannot acquire module authority',()=>{
 const revoked=context([]);revoked.employee.full_access_modules=['inventory'];
 assert.equal(featureContext(revoked,'inventory'),revoked);assert.throws(()=>assertEntityAccess(revoked,'StockBalance','filter'));
 const inactive=context();inactive.employee.status='inactive';assert.equal(featureContext(inactive,'inventory'),inactive);
 const forged=context([]);forged.user.feature_authority={role:'admin'};forged.employee.access_template='employee';assert.equal(effectiveRole(forged.user,forged.employee),'employee');
});
test('generic financial invariants and protection of GM identities survive full feature access',()=>{
 const ctx=context(['employees','accounting']),hr=featureContext(ctx,'employees'),accounting=featureContext(ctx,'accounting');
 assert.throws(()=>guardMutation(hr,'Employee','update',{role:'admin'},{id:'other',role:'employee'}),/General Manager/);
 assert.throws(()=>guardMutation(hr,'User','update',{role:'admin'},{id:'other'}),/General Manager/);
 assert.throws(()=>guardMutation(accounting,'Account','update',{balance:100},{id:'cash',balance:0}),/checked/);
 assert.equal(entityFeatureContext(context(['inventory']),'Employee','update').role,'employee');
 assert.throws(()=>assertEntityAccess(featureContext(context(['inventory']),'inventory'),'Employee','update'),/another feature/);
});
let compiled;
async function requestClient(){
 compiled ||= build({stdin:{contents:"export {createClientFromRequest} from './src/server/request-client.js';export {default as invoke} from './src/server/functions/fieldOps.js';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'checked-features',setup(b){
  const replacements={
   'auth.js':'export const authenticateRequest=async()=>globalThis.__featureTest.context;',
   'entities.js':'export const serviceEntities=new Proxy({},{get:(_,k)=>globalThis.__featureTest.stores[k]});export const entityStore=k=>globalThis.__featureTest.stores[k];',
   'db.js':'export const transaction=fn=>fn();export const database=()=>({unsafe:async()=>[]});',
   'files.js':'export const validateReceiptPhotos=async()=>{},validateExpenseReceipt=async()=>{};',
   'request-timing.js':'export const timingForRequest=()=>null;',
  };
  b.onResolve({filter:/server-only|(?:auth|entities|db|files|request-timing)\.js$/},args=>{
   if(args.path==='server-only')return {path:'empty',namespace:'feature-mock'};
   const resolved=path.resolve(path.dirname(args.importer),args.path),name=path.basename(resolved);
   if(resolved===path.resolve('src/server',name)&&replacements[name])return {path:name,namespace:'feature-mock'};
  });
  b.onLoad({filter:/.*/,namespace:'feature-mock'},args=>({contents:args.path==='empty'?'':replacements[args.path]}));
 }}]}).then(out=>import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64')));
 return (await compiled).createClientFromRequest(new Request('http://localhost/api/functions/fieldOps'));
}
test('actual request client lets general staff use checked Inventory and Sales features and records the real seller once',async()=>{
 const f=await fixture(),ctx=context();globalThis.__featureTest={context:ctx,stores:f.entities};
 const create=f.entities.AuditLog.create;f.entities.AuditLog.create=async value=>{if(!value.id)return create(value);if(f.rows.AuditLog.some(r=>r.id===value.id))throw Error('Duplicate request');f.rows.AuditLog.push(structuredClone(value));return structuredClone(value);};
 try{
  await f.entities.Employee.update('cashier',{role:'delivery_worker',full_name:'Actual worker'});
  await f.entities.CompanySettings.update('settings',{company_name:'SOEICAM',next_invoice_number:1});
  await f.entities.StockBalance.create({warehouse_id:'factory',product_id:'product-a',quantity:5,total_value:1500,unit_cost:300,qc_status:'approved'});
  const client=await requestClient();assert.equal((await client.entities.Product.get('product-a')).id,'product-a');
  await assert.rejects(client.entities.JournalEntry.filter({}),/does not allow|permit/);
  const sales=client.auth.forFeature('sales'),actor=await sales.auth.me();
  const options=await salesOrderAction(sales,actor,{action:'salesOrderWorkspace'});assert.equal(options.defaultSource,'company');
  const body={action:'recordSuppliedOrder',sourceType:'company',requestKey:crypto.randomUUID(),date,customerId:'customer-a',sellerId:'cashier',paymentType:'credit',expectedTotal:1000,lines:[{product_id:'product-a',quantity:2,unit_price:500,discount_pct:0}]};
  const result=await salesOrderAction(sales,actor,body);assert.equal(result.order.sales_supply_recorded_by,user.id);assert.equal(result.order.salesperson_id,'cashier');assert.equal((await f.entities.JournalEntry.list()).length,1);assert.equal((await f.entities.InvoiceLine.list())[0].cogs_total,600);
  assert.equal((await salesOrderAction(sales,actor,body)).reused,true);
  const reply=await (await compiled).invoke(new Request('http://localhost/api/functions/fieldOps',{method:'POST',body:JSON.stringify(body)}));assert.equal(reply.status,200);assert.equal((await reply.json()).reused,true);
  const stockReply=await (await compiled).invoke(new Request('http://localhost/api/functions/fieldOps',{method:'POST',body:JSON.stringify({action:'salesOrderStock',sourceType:'company',date})}));assert.equal(stockReply.status,200);assert.equal((await stockReply.json()).products[0].available,3);
  globalThis.__featureTest.context=context([]);const revoked=await requestClient();await assert.rejects(revoked.entities.Product.get('product-a'));await assert.rejects(salesOrderAction(revoked,await revoked.auth.me(),{action:'salesOrderWorkspace'}),/Your role does not allow Sales/);
 }finally{delete globalThis.__featureTest;}
});


test('feature lookups work across job titles, but never authorize writes to a dependency feature',()=>{
 for(const [module,entity] of [['inventory','Account'],['purchases','Product'],['accounting','Customer'],['cashier','Employee'],['payroll','Employee'],['manufacturing','Warehouse']]){
  const ctx=featureContext(context([module]),module);assert.equal(assertEntityAccess(ctx,entity,'filter'),'admin');
  if(entity==='Employee')assert.throws(()=>assertEntityAccess(ctx,entity,'update'),/another feature/);
 }
});

test('the real user hook exposes enabled actions only inside the selected feature and retains the signed-in job title',async()=>{
 const out=await build({stdin:{contents:"export {useCurrentUser} from './src/hooks/useCurrentUser.js';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'feature-ui',setup(b){
  b.onResolve({filter:/^(?:next\/navigation|@\/lib\/AuthContext)$/},args=>({path:args.path,namespace:'feature-ui'}));
  b.onLoad({filter:/.*/,namespace:'feature-ui'},args=>({contents:args.path==='next/navigation'?"export const usePathname=()=>globalThis.__featureHook.path,useSearchParams=()=>new URLSearchParams(globalThis.__featureHook.query);":"export const useAuth=()=>globalThis.__featureHook.auth;"}));
 }}]});
 const {useCurrentUser}=await import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));
 const ctx=context(['inventory','quality']);globalThis.__featureHook={path:'/inventory',query:'',auth:{user:ctx.user,employee:ctx.employee,isLoadingAuth:false}};
 try{assert.equal(useCurrentUser().role,'admin');assert.equal(useCurrentUser().principalRole,'employee');globalThis.__featureHook.path='/';assert.equal(useCurrentUser().role,'employee');globalThis.__featureHook.path='/manufacturing';globalThis.__featureHook.query='section=quality';assert.equal(useCurrentUser().role,'admin');globalThis.__featureHook.path='/accounting';assert.equal(useCurrentUser().role,'employee');
 for(const template of ['driver','commercial'])for(const route of ['/inventory','/sales','/accounting','/customers','/distribution']){
  const restricted=context(['inventory','sales','accounting','customers','distribution'],template);
  globalThis.__featureHook={path:route,query:'',auth:{user:restricted.user,employee:restricted.employee,isLoadingAuth:false}};
  const profile=useCurrentUser();assert.equal(profile.role,template);assert.equal(profile.principalRole,template);assert.equal(profile.canIssueCustody,false);assert.equal(profile.canApproveFieldSale,false);assert.equal(profile.canDisburse,false);
 }}finally{delete globalThis.__featureHook;}
});


test('Accounting checkbox authorizes a balanced manual draft for general staff without changing their role',async()=>{
 const f=await fixture(),ctx=featureContext(context(['accounting']),'accounting');
 const journal=await saveManualJournal(f.entities,ctx,{requestKey:crypto.randomUUID(),entryDate:date,description:'Checked feature journal draft',status:'draft',lines:[{account_id:'expense',debit:100,credit:0},{account_id:'payable',debit:0,credit:100}]});
 assert.equal(journal.status,'draft');assert.equal(journal.total_debit,journal.total_credit);assert.equal(principalRole(ctx.user,ctx.employee),'employee');
});

test('Cashier and Accounting checkboxes open invoice lookups without requiring the Sales checkbox',async()=>{
 for(const module of ['cashier','accounting']){
  const f=await fixture(),ctx=context([module]);globalThis.__featureTest={context:ctx,stores:f.entities};
  try{await requestClient();const response=await (await compiled).invoke(new Request('http://localhost/api/functions/fieldOps',{method:'POST',body:JSON.stringify({action:'invoiceWorkspace'})}));assert.equal(response.status,200);assert.equal((await response.json()).permissions.can_create,false);}finally{delete globalThis.__featureTest;}
 }
});


test('owning-feature access takes precedence over a dependency lookup so HR retains employee details',()=>{
 const ctx=entityFeatureContext(context(['inventory','employees']),'Employee','filter');assert.equal(ctx.user[FEATURE_AUTHORITY].module,'employees');
});

test('approval grants authorize only the specific checked decision target',()=>{
 const ctx=featureContext(context(['approvals']),'approvals','admin','approveSupplierOrder');assert.doesNotThrow(()=>assertModule(ctx,'purchases'));assert.throws(()=>assertModule(ctx,'cashier'));
 const unbound=featureContext(context(['approvals']),'approvals');assert.throws(()=>assertModule(unbound,'purchases'));
 assert.throws(()=>guardMutation(unbound,'ExpenseRequest','update',{amount:1},{status:'pending_approval'}),/review decisions/);
});

test('actual request client refuses company stock issues and sales for drivers and commercial agents despite saved grants',async()=>{
 for(const template of ['driver','commercial']){
  const f=await fixture(),ctx=context(['inventory','sales','accounting','distribution'],template);globalThis.__featureTest={context:ctx,stores:f.entities};
  try{
   const before=structuredClone(f.rows),client=await requestClient(),sales=client.auth.forFeature('sales'),actor=await sales.auth.me();
   assert.equal(effectiveRole(actor,ctx.employee),template);
   await assert.rejects(client.entities.StockBalance.create({product_id:'product-a',quantity:100}));
   const body={action:'recordSuppliedOrder',sourceType:'company',requestKey:crypto.randomUUID(),date,customerId:'customer-a',sellerId:'cashier',paymentType:'credit',expectedTotal:1000,lines:[{product_id:'product-a',quantity:2,unit_price:500,discount_pct:0}]};
   await assert.rejects(salesOrderAction(sales,actor,body),/Not permitted/);
   const response=await (await compiled).invoke(new Request('http://localhost/api/functions/fieldOps',{method:'POST',body:JSON.stringify(body)}));assert.equal(response.status,400);
   assert.deepEqual(f.rows,before);
  }finally{delete globalThis.__featureTest;}
 }
});
