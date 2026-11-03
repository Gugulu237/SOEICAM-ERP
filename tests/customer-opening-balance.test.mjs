import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {build} from 'esbuild';
import {fixture,date} from './helpers/cashier.mjs';
import {customerOpeningWorkspace,saveCustomerOpening} from '../src/server/domain/customer-opening-balance.js';
import {postOpeningBalances} from '../src/server/domain/opening-balances.js';
import {saveOpeningPosition} from '../src/server/domain/opening-position.js';
import {verifiedOpeningDocument} from '../src/server/domain/opening-payments.js';
import {validateAllocations,approveReceipt} from '../src/server/domain/customer-receipts.js';
import {postJournal} from '../src/server/domain/field-ops.js';
import {guardMutation} from '../src/server/access.js';
import {companySalesRegister} from '../src/lib/company-sales.js';
const context={user:{id:'gm',role:'admin'},role:'admin',employee:null};
const previous=new Date(date.slice(0,8)+'01T12:00:00Z');previous.setUTCDate(0);const opening=previous.toISOString().slice(0,10);
async function setup(db){
  const f=await fixture(db),s=f.entities,original=s.AuditLog.create;
  s.AuditLog.create=async value=>{if(!value.id)return original(value);if(db)await db.query('INSERT INTO fixture_entity VALUES($1,$2,$3)',['AuditLog',value.id,JSON.stringify(value)]);else{if(f.rows.AuditLog.some(a=>a.id===value.id))throw Error('Duplicate audit id');f.rows.AuditLog.push(structuredClone(value));}return value;};
  s.FixedAsset={list:async()=>[],filter:async()=>[]};
  await s.Account.update('receivable',{account_type:'asset',is_control_account:true});
  const equity=await s.Account.create({name:'Opening equity',account_number:'100',account_type:'equity',normal_balance:'credit',is_active:true,is_posting:true,balance:0});
  const other=await s.Customer.create({business_name:'Second customer',is_active:true,balance:0});
  const body={requestKey:crypto.randomUUID(),confirmed:true,mode:'post',account_id:'receivable',offset_account_id:equity.id,date:opening,due_date:'2025-01-01',reference:'OLD-BALANCE',amount:25000};
  return {...f,equity,other,body};
}
test('each customer can enter one opening debt; later activity remains and no new sales, stock or cash are created',async()=>{
  const f=await setup(),s=f.entities;
  await postJournal({entities:s},{entryDate:date,description:'Later credit',sourceModule:'manual',sourceDocumentId:'later-credit',userId:'gm',lines:[{account_id:'receivable',party_type:'customer',party_id:'customer-a',debit:500},{account_id:f.equity.id,credit:500}]});
  const before={sales:f.rows.SalesOrder.length,moves:f.rows.StockMovement.length,cash:f.rows.TreasuryTransaction.length};
  const result=await saveCustomerOpening(s,context,'customer-a',f.body),invoice=await s.Invoice.get(result.receivables[0]);
  assert.equal(invoice.total,25000);assert.equal(invoice.balance,25000);assert.equal(invoice.opening_date,opening);assert.equal(invoice.due_date,'2025-01-01');
  assert.equal((await s.Customer.get('customer-a')).balance,25500);assert.equal((await s.Account.get('receivable')).balance,25500);
  assert.equal(await verifiedOpeningDocument(s,invoice,'Invoice'),true);
  assert.deepEqual({sales:f.rows.SalesOrder.length,moves:f.rows.StockMovement.length,cash:f.rows.TreasuryTransaction.length},before);
  assert.equal(companySalesRegister({invoices:await s.Invoice.list(),from:opening,to:date}).rows.length,0);
  const snapshot=structuredClone(f.rows);assert.equal((await saveCustomerOpening(s,context,'customer-a',f.body)).reused,true);assert.deepEqual(f.rows,snapshot);
  await assert.rejects(saveCustomerOpening(s,context,'customer-a',{...f.body,requestKey:crypto.randomUUID(),reference:'DIFFERENT',amount:200}),{status:409});
  await s.Invoice.update(invoice.id,{status:'paid',balance:0,amount_paid:25000});
  assert.equal((await customerOpeningWorkspace(s,context,'customer-a')).recorded,true);
  await assert.rejects(saveCustomerOpening(s,context,'customer-a',{...f.body,requestKey:crypto.randomUUID()}),/already recorded/);
  await saveCustomerOpening(s,context,f.other.id,{...f.body,requestKey:crypto.randomUUID(),reference:'SECOND',amount:12000});
  assert.equal((await s.Customer.get(f.other.id)).balance,12000);assert.equal((await s.Account.get('receivable')).balance,37500);
});
test('an existing GL opening is allocated customer by customer without a second journal or excess allocation',async()=>{
  const f=await setup(),s=f.entities;
  await postOpeningBalances(s,context,{requestKey:crypto.randomUUID(),date:opening,reference:'Prior trial balance',lines:[{account_id:'receivable',debit:40000},{account_id:f.equity.id,credit:40000}],acknowledgeControlBalances:true});
  const monetary=(await s.JournalLine.list()).map(l=>[l.id,l.debit,l.credit]);
  let workspace=await customerOpeningWorkspace(s,context,'customer-a');assert.equal(workspace.mode,'attach');assert.equal(workspace.available,40000);
  const body={...f.body,mode:'attach',offset_account_id:'',amount:15000};
  const first=await saveCustomerOpening(s,context,'customer-a',body);
  assert.equal(first.linked_only,true);assert.equal((await s.JournalEntry.list()).length,1);assert.equal((await s.Account.get('receivable')).balance,40000);
  assert.equal(await verifiedOpeningDocument(s,await s.Invoice.get(first.receivables[0]),'Invoice'),true);
  workspace=await customerOpeningWorkspace(s,context,f.other.id);assert.equal(workspace.available,25000);
  const snapshot=structuredClone(f.rows);await assert.rejects(saveCustomerOpening(s,context,f.other.id,{...body,amount:25001,requestKey:crypto.randomUUID()}),/exceeds/);assert.deepEqual(f.rows,snapshot);
  await saveCustomerOpening(s,context,f.other.id,{...body,amount:25000,requestKey:crypto.randomUUID()});
  assert.deepEqual((await s.JournalLine.list()).map(l=>[l.id,l.debit,l.credit]),monetary);assert.equal((await s.JournalEntry.list()).length,1);
  const third=await s.Customer.create({business_name:'Third',balance:0});assert.equal((await customerOpeningWorkspace(s,context,third.id)).can_enter,false);
});
test('bulk imports and customer profiles recognize each others prior opening entries',async()=>{
  const f=await setup(),s=f.entities;
  await saveOpeningPosition(s,context,{action:'post',requestKey:crypto.randomUUID(),date:opening,reference:'Bulk migration',details:[{kind:'receivable',party_id:'customer-a',reference:'ORIGINAL',amount:25000}],lines:[{account_id:f.equity.id,credit:25000}]});
  assert.equal((await customerOpeningWorkspace(s,context,'customer-a')).recorded,true);
  await assert.rejects(saveCustomerOpening(s,context,'customer-a',f.body),/already recorded/);
  const g=await setup();await saveCustomerOpening(g.entities,context,'customer-a',g.body);
  await assert.rejects(saveOpeningPosition(g.entities,context,{action:'post',requestKey:crypto.randomUUID(),date:opening,reference:'Duplicate bulk',details:[{kind:'receivable',party_id:'customer-a',reference:'NEW-REFERENCE',amount:25000}],lines:[{account_id:g.equity.id,credit:25000}]}),/already recorded/);
});
test('permissions, immutable evidence, invalid amounts and dates are checked before writes',async()=>{
  const f=await setup(),s=f.entities;
  for(const ctx of [{...context,role:'commercial',user:{id:'agent',role:'user'},employee:{role:'commercial',status:'active'}},{...context,employee:{role:'admin',status:'inactive'}},{...context,roleCatalogue:{roles:{admin:{modules:['customers']}}}}]){
    await assert.rejects(customerOpeningWorkspace(s,ctx,'customer-a'),{status:403});await assert.rejects(saveCustomerOpening(s,ctx,'customer-a',f.body),{status:403});
  }
  const snapshot=structuredClone(f.rows);
  for(const change of [{amount:0},{amount:-1},{amount:NaN},{amount:0.001},{amount:true},{confirmed:false},{date:'2026-02-30'},{date:'2999-01-01'},{due_date:'2026-02-30'},{due_date:'not-a-date'},{reference:''},{mode:'attach'},{account_id:'expense'},{offset_account_id:'till-gl'}]){await assert.rejects(saveCustomerOpening(s,context,'customer-a',{...f.body,...change}));assert.deepEqual(f.rows,snapshot);}
  for(const [entity,operation,value,existing] of [['Customer','update',{opening_balance_batch_id:'fake'},{id:'customer-a'}],['AuditLog','create',{id:'COB-forged'}],['AuditLog','delete',{}, {action:'import_customer_opening_balance'}]])assert.throws(()=>guardMutation(context,entity,operation,value,existing),{status:403});
  await s.AccountingPeriod.update('period',{start_date:opening,status:'closed'});await assert.rejects(saveCustomerOpening(s,context,'customer-a',f.body),/closed|locked/);
});
test('opening debt is collectible before the rest of a GL opening is allocated, using the original AR account',async()=>{
  const f=await setup(),s=f.entities;
  await postOpeningBalances(s,context,{requestKey:crypto.randomUUID(),date:opening,reference:'Old GL',lines:[{account_id:'receivable',debit:50000},{account_id:f.equity.id,credit:50000}],acknowledgeControlBalances:true});
  const result=await saveCustomerOpening(s,context,'customer-a',{...f.body,mode:'attach',offset_account_id:''}),invoice=await s.Invoice.get(result.receivables[0]);
  const otherAR=await s.Account.create({name:'New AR',account_type:'asset',normal_balance:'debit',is_active:true,is_posting:true,balance:0});await s.PostingRule.update('customer_receivable',{account_id:otherAR.id});
  const wrapped={entities:{...s}};for(const name of ['Invoice','Payment','PaymentAllocation','TreasuryTransaction'])wrapped.entities[name]={...s[name],filter:async(q,options)=>({items:await s[name].filter(q,null,options?.limit),has_more:false})};
  wrapped.entities.Payment.updateMany=async(query,change)=>{const p=await s.Payment.get(query.id);if(!p[Object.keys(query).find(k=>k!=='id')])await s.Payment.update(query.id,change.$set);};
  assert.equal((await validateAllocations(wrapped,[{invoice_id:invoice.id,amount:1000}],'customer-a'))[0].invoice.opening_account_id,'receivable');
  const payment=await s.Payment.create({payment_number:'OPENING-PAY',payment_type:'customer_payment',party_id:'customer-a',amount:1000,payment_date:date,treasury_account_id:'till',status:'pending_approval',cashier_confirmed_by:'cashier',receipt_posting_token:'',receipt_allocations:[{invoice_id:invoice.id,amount:1000}]});
  await approveReceipt(wrapped,payment,{id:'gm'});await approveReceipt(wrapped,await s.Payment.get(payment.id),{id:'gm'});
  assert.equal((await s.Invoice.get(invoice.id)).balance,24000);assert.equal((await s.Customer.get('customer-a')).balance,24000);assert.equal((await s.Account.get('receivable')).balance,49000);assert.equal((await s.Account.get(otherAR.id)).balance,0);
});
async function route(){
 const mocks={
  '@/server/auth':'export const authenticateRequest=async()=>globalThis.__customerOpening.context,checkOrigin=()=>{},apiError=e=>Response.json({error:e.message},{status:e.status||400});',
  '@/server/entities':'export const serviceEntities=new Proxy({},{get:(_,key)=>globalThis.__customerOpening.entities[key]});',
  '@/server/db':'let queue=Promise.resolve();export const database=()=>({unsafe:async(sql,args)=>{globalThis.__customerOpening.locks.push({sql,args});}});export const transaction=run=>{const execute=async()=>{const db=globalThis.__customerOpening.db;await db.exec("BEGIN");try{const result=await run();await db.exec("COMMIT");return result;}catch(e){await db.exec("ROLLBACK");throw e;}};const result=queue.then(execute);queue=result.catch(()=>{});return result;};'
 };
 const result=await build({entryPoints:['src/app/api/customers/[id]/opening-balance/route.js'],bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'opening-fixture',setup(b){b.onResolve({filter:/^@\/server\//},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
 return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
}
test('API rolls back late failures and serializes competing submissions into a single opening debt',async()=>{
 const db=new PGlite();try{
  const f=await setup(db),api=await route(),s=f.entities;globalThis.__customerOpening={...f,db,context,locks:[]};
  const post=body=>api.POST(new Request('http://localhost/api/customers/customer-a/opening-balance',{method:'POST',body:JSON.stringify(body)}),{params:Promise.resolve({id:'customer-a'})});
  const snapshot=(await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows,create=s.AuditLog.create;
  s.AuditLog.create=async v=>{if(v.action==='import_customer_opening_balance')throw Error('Audit unavailable');return create(v);};
  assert.equal((await post(f.body)).status,400);assert.deepEqual((await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows,snapshot);
  s.AuditLog.create=create;
  const responses=await Promise.all([post(f.body),post({...f.body,requestKey:crypto.randomUUID()})]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
  assert.equal((await s.Invoice.list()).length,1);assert.equal((await s.JournalEntry.list()).length,1);assert.equal((await s.Customer.get('customer-a')).balance,25000);
  assert.equal((await post(f.body)).status,200);assert.ok(globalThis.__customerOpening.locks.every(l=>l.sql.includes('pg_advisory_xact_lock')&&l.args[0]==='opening-balances'));
 }finally{delete globalThis.__customerOpening;await db.close();}
});
