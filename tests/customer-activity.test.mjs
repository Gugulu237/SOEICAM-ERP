import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {fixture,functionRoute,request,date,user as cashier} from './helpers/cashier.mjs';
import {customerActivityAction,confirmCustomerCollection} from '../src/server/domain/customer-activity.js';
import {approveReceipt,validateAllocations} from '../src/server/domain/customer-receipts.js';
import {cashierAction} from '../src/server/domain/cashier-workspace.js';
import {cashDepositors} from '../src/lib/cashier-receipts.js';
import {dailyCashSettlements} from '../src/lib/cash-settlement.js';
import {guardMutation} from '../src/server/access.js';
import {buildCashFlow} from '../src/lib/cash-flow.js';

const gm={id:'gm-user',role:'admin',full_name:'GM'},collector={id:'collector-login',role:'user',full_name:'Collector'};
async function setup(db) {
  const f=await fixture(db),s=f.entities;let current=collector,employee={id:'collector',user_id:collector.id,role:'commercial',status:'active',full_name:'Collector'};
  f.setActor=(user,staff)=>{current=user;employee=staff||null;};
  f.client.auth.me=async()=>current;f.client.auth.staff=async()=>employee;f.client.entities.Employee.filter=async()=>employee?[employee]:[];
  for(const entity of Object.values(s)){
    const filter=entity.filter;
    entity.filter=async(q,options,limit,skip)=>{if(!options||typeof options!=='object')return filter(q,options,limit,skip);const items=await filter(q,options.sort,options.limit,Number(options.cursor||options.skip||0));return {items,has_more:false};};
    entity.updateMany=async(q,changes)=>{const matches=await filter(q);for(const r of matches)await entity.update(r.id,changes.$set||changes);return {updated:matches.length};};
  }
  await s.Customer.update('customer-a',{is_active:true,salesperson_id:'collector',balance:1000});
  const inv=await s.Invoice.create({customer_id:'customer-a',customer_name:'Customer A',invoice_number:'INV-CREDIT-1',invoice_date:date,payment_type:'credit',status:'posted',balance:1000,total:1000,amount_paid:0,journal_id:'original-sale-journal'});
  const ar=await s.Account.create({account_number:'TEST-AR',name:'Receivables',account_type:'asset',is_active:true,is_posting:true,normal_balance:'debit',balance:1000});
  const rules=await s.PostingRule.filter({rule_key:'customer_receivable'});const rule={rule_key:'customer_receivable',account_id:ar.id,is_active:true};
  if(rules.length)await s.PostingRule.update(rules[0].id,rule);else await s.PostingRule.create(rule);
  return {...f,invoice:inv,ar,body:{action:'recordCustomerCollection',customerId:'customer-a',requestKey:crypto.randomUUID(),date,reference:'CUSTOMER-RECEIPT-01',amount:400,allocations:[{invoice_id:inv.id,amount:400}]}};
}

async function earlierCollection(f,{collectedBy=collector,employeeId='collector',confirmedBy}={}) {
  const s=f.entities, amount=f.body.amount, invoice=f.invoice;
  let payment=await s.Payment.create({
    payment_number:'COL-LEGACY',payment_type:'customer_payment',party_type:'customer',party_id:'customer-a',party_name:'Customer A',
    amount,payment_date:date,collection_date:date,payment_method:'cash',reference:'LEGACY-RECEIPT',status:confirmedBy?'pending_approval':'awaiting_cashier',
    receipt_channel:'staff_collection',collector_user_id:collectedBy.id,collector_employee_id:employeeId,collector_name:collectedBy.full_name,
    allocated_to_invoices:invoice.id,invoice_numbers:invoice.invoice_number,receipt_allocations:[{invoice_id:invoice.id,invoice_number:invoice.invoice_number,amount}],
    ...(confirmedBy?{cashier_confirmed_by:confirmedBy.id,cashier_confirmed_name:confirmedBy.full_name,treasury_account_id:'till',treasury_account_name:'till'}:{}),
  });
  const collection=await s.CashCollection.create({
    collection_origin:'customer_receipt',payment_id:payment.id,customer_id:'customer-a',commercial_id:employeeId,
    collector_user_id:collectedBy.id,collection_date:date,method:'cash',amount_collected:amount,
    status:confirmedBy?'received':'held_by_commercial',outstanding_amount:confirmedBy?0:amount,received_amount:confirmedBy?amount:0,
  });
  payment=await s.Payment.update(payment.id,{collection_id:collection.id});
  return {payment,collection};
}

test('customer invoice payments post to the selected account once and preserve logged-in attribution',async()=>{
  const f=await setup(),s=f.entities;
  const space=await customerActivityAction(f.client,collector,{action:'customerCollectionWorkspace',customerId:'customer-a'});
  assert.equal(space.defaultCashAccountId,'till');
  assert.deepEqual(space.cashAccounts.find(a=>a.id==='bank'),{id:'bank',name:'bank',account_type:'bank'});
  const body={...f.body,treasuryAccountId:'bank',collectorId:'someone-else',collector_name:'forged'};
  const result=await customerActivityAction(f.client,collector,body);
  assert.equal(result.payment.status,'posted');
  assert.equal(result.payment.treasury_account_name,'bank');
  assert.equal(result.payment.receipt_posting_snapshot,undefined);
  const payment=await s.Payment.get(result.payment.id);
  assert.equal(payment.collector_user_id,collector.id);
  assert.equal(payment.collector_name,'Collector');
  assert.equal(payment.receipt_recorded_by,collector.id);
  assert.equal(payment.receipt_posted_directly,true);
  assert.equal(payment.cashier_confirmed_by,undefined);
  assert.equal(payment.approved_at,undefined);
  assert.equal((await s.Invoice.get(f.invoice.id)).balance,600);
  assert.equal((await s.Customer.get('customer-a')).balance,600);
  assert.equal((await s.Account.get(f.ar.id)).balance,600);
  assert.equal((await s.TreasuryAccount.get('bank')).balance,100400);
  assert.equal((await s.TreasuryAccount.get('till')).balance,100000);
  assert.equal((await s.CashCollection.filter({collection_origin:'customer_receipt'})).length,0);
  assert.deepEqual((await s.PaymentAllocation.list()).map(a=>[a.document_id,a.amount]),[[f.invoice.id,400]]);
  const [movement]=await s.TreasuryTransaction.list(),journals=await s.JournalEntry.list(),lines=await s.JournalLine.list();
  assert.equal(movement.source,'customer_receipt');
  assert.equal(movement.journal_id,journals[0].id);
  assert.equal(journals[0].source_module,'payments');
  assert.deepEqual(lines.map(l=>[l.account_id,l.debit,l.credit]),[['bank-gl',400,0],[f.ar.id,0,400]]);
  const flow=buildCashFlow({accounts:await s.Account.list(),treasury:await s.TreasuryAccount.list(),journals,cashLines:lines,periodLines:lines,from:date,to:date});
  assert.equal(flow.activities.find(a=>a.key==='operating').inflow,400);

  const repeat=await customerActivityAction(f.client,collector,body);
  assert.equal(repeat.reused,true);
  assert.equal((await s.Payment.list()).length,1);
  assert.equal((await s.JournalEntry.list()).length,1);
  assert.equal((await s.TreasuryTransaction.list()).length,1);
  const updated=await customerActivityAction(f.client,collector,{action:'customerCollectionWorkspace',customerId:'customer-a'});
  assert.equal(updated.invoices[0].available_amount,600);
  assert.equal(updated.cash_to_deposit,0);
  assert.deepEqual(updated.pending,[]);
});

test('collection guards reject changed retry payloads, duplicate receipts, over-collections, foreign invoices, inactive staff and unassigned customers',async()=>{
  const f=await setup(),s=f.entities;
  await customerActivityAction(f.client,collector,f.body);
  await assert.rejects(customerActivityAction(f.client,collector,{...f.body,reference:'changed'}),/different payment/);
  await assert.rejects(customerActivityAction(f.client,collector,{...f.body,treasuryAccountId:'bank'}),/different payment/);
  await assert.rejects(customerActivityAction(f.client,collector,{...f.body,requestKey:crypto.randomUUID(),treasuryAccountId:'inactive',reference:'SECOND'}),/active treasury deposit account/);
  await assert.rejects(customerActivityAction(f.client,collector,{...f.body,requestKey:crypto.randomUUID()}),/already recorded/);
  await assert.rejects(customerActivityAction(f.client,collector,{...f.body,requestKey:crypto.randomUUID(),reference:'another',amount:700,allocations:[{invoice_id:f.invoice.id,amount:700}]}),/remains after pending/);
  for(const amount of [true,-1,NaN,Infinity,1.001])await assert.rejects(customerActivityAction(f.client,collector,{...f.body,requestKey:crypto.randomUUID(),amount}));
  await assert.rejects(validateAllocations(f.client.asServiceRole,[{invoice_id:f.invoice.id,amount:601}],'customer-a'),/remains after pending/);
  await s.Customer.update('customer-a',{salesperson_id:'another'});await assert.rejects(customerActivityAction(f.client,collector,f.body),/assigned/);
  f.setActor(collector,{id:'collector',role:'commercial',status:'inactive'});await assert.rejects(customerActivityAction(f.client,collector,f.body),/active staff/);
  f.setActor({id:'driver',role:'user'},{id:'driver',role:'driver',status:'active'});await assert.rejects(customerActivityAction(f.client,{id:'driver',role:'user'},f.body),/restricted/);
});

test('earlier staff-held cash posts on physical receipt with its saved reference and rejects a self-confirmation, shortfall or changed destination',async()=>{
  const f=await setup(),s=f.entities;
  const {payment,collection}=await earlierCollection(f,{collectedBy:gm,employeeId:gm.id});
  f.setActor(gm);
  const body={paymentId:payment.id,requestKey:crypto.randomUUID(),date,amount:400,treasuryAccountId:'till'};
  await assert.rejects(confirmCustomerCollection(f.client,gm,body),/cash you collected/);
  f.setActor(cashier,await s.Employee.get('cashier'));
  const before=await cashierAction(f.client,cashier,{action:'cashierWorkspace',date});
  assert.equal(cashDepositors(before).filter(r=>r.kind==='staff_receipt').length,1);
  await assert.rejects(confirmCustomerCollection(f.client,cashier,{...body,amount:200}),/full recorded/);
  await assert.rejects(confirmCustomerCollection(f.client,cashier,{...body,treasuryAccountId:'bank'}),/cash account/);
  assert.equal((await s.CashCollection.get(collection.id)).outstanding_amount,400);
  const result=await confirmCustomerCollection(f.client,cashier,body);
  assert.equal(result.payment.status,'posted');
  assert.equal(result.payment.receipt_recorded_by_name,cashier.full_name);
  const settled=await s.CashCollection.get(collection.id);
  assert.equal(settled.outstanding_amount,0);
  assert.equal(settled.journal_id,result.payment.journal_id);
  assert.equal(settled.acknowledgement_reference,payment.reference);
  assert.equal((await s.TreasuryTransaction.list())[0].reference,payment.reference);
  assert.equal(dailyCashSettlements([settled])[0].status,'settled');
  assert.equal((await confirmCustomerCollection(f.client,cashier,body)).reused,true);
  await assert.rejects(confirmCustomerCollection(f.client,cashier,{...body,reference:'changed'}),/different details/);
  assert.equal((await s.Invoice.get(f.invoice.id)).balance,600);
  assert.equal((await s.TreasuryAccount.get('till')).balance,100400);
  assert.equal((await s.JournalEntry.list()).length,1);
  const after=await cashierAction(f.client,cashier,{action:'cashierWorkspace',date});
  assert.deepEqual(after.staffCollections,[]);
  assert.deepEqual(after.receipts,[]);
  assert.deepEqual(after.cashCustomers.filter(r=>r.document_number===f.invoice.invoice_number).map(r=>[r.received,r.status]),[[400,'posted']]);
});

test('staff collection receipt uses a saved collection reference and accepts retries of earlier cashier references',async()=>{
  for(const explicit of [undefined,'EARLIER-ACK']){
    const f=await setup(),s=f.entities,{payment,collection}=await earlierCollection(f);
    await s.Payment.update(payment.id,{reference:''});
    await s.CashCollection.update(collection.id,{receipt_reference:'COLLECTION-REF'});
    f.setActor(cashier,await s.Employee.get('cashier'));
    const body={paymentId:payment.id,requestKey:crypto.randomUUID(),date,amount:400,treasuryAccountId:'till'};
    await confirmCustomerCollection(f.client,cashier,{...body,reference:explicit});
    assert.equal((await s.CashCollection.get(collection.id)).acknowledgement_reference,explicit||'COLLECTION-REF');
    assert.equal((await confirmCustomerCollection(f.client,cashier,body)).reused,true);
    assert.equal((await s.TreasuryTransaction.list()).length,1);
  }
});

test('invoice collections remain visible in staff liability but cannot enter the sales cash handover twice',()=>{
  const rows=[{id:'receipt',commercial_id:'staff',commercial_name:'Staff',collection_date:date,method:'cash',status:'held_by_commercial',collection_origin:'customer_receipt',amount_collected:400,outstanding_amount:400,received_amount:0},{id:'sale',commercial_id:'staff',commercial_name:'Staff',collection_date:date,method:'cash',status:'held_by_commercial',amount_collected:600,outstanding_amount:600,received_amount:0}];
  const day=dailyCashSettlements(rows)[0];assert.equal(day.outstanding,1000);assert.equal(day.customer_receipt_outstanding,400);assert.equal(day.depositable,600);assert.equal(day.requestable,600);assert.deepEqual(day.collection_ids,['sale']);
});

test('multi-product spoilage reports bind the exact customer and reporter, avoid stock/financial writes and retain reviewed follow-up history',async()=>{
  const f=await setup(),s=f.entities;
  const products=await Promise.all(['Vanilla','Strawberry'].map(name=>s.Product.create({name,is_active:true,inventory_type:'finished_product',current_cost:100,sales_unit:'cup'})));
  const body={action:'reportCustomerSpoilage',customerId:'customer-a',requestKey:crypto.randomUUID(),date,reference:'SP-TEST',reason:'expired',notes:'Counted expired cups; reduce the next supply.',lines:products.map((p,i)=>({product_id:p.id,quantity:i+2}))};
  const result=await customerActivityAction(f.client,collector,{...body,recorded_by:'forged'});assert.equal(result.recorded,2);
  const records=await s.SpoilageRecord.filter({record_type:'customer_spoilage_report'});assert.equal(records.length,2);assert.equal(records[0].location_id,'');assert.equal(records[0].recorded_by,collector.id);assert.equal(records[0].review_status,'pending');
  assert.equal((await customerActivityAction(f.client,collector,body)).reused,true);
  assert.equal((await s.JournalEntry.list()).length,0);assert.equal((await s.StockMovement.list()).length,0);
  await assert.rejects(customerActivityAction(f.client,collector,{action:'reviewCustomerSpoilage',customerId:'customer-a',reportId:records[0].id,revision:0,decision:'monitor',note:'Reduce supply.'}),/authorized manager/);
  f.setActor(gm);await customerActivityAction(f.client,gm,{action:'reviewCustomerSpoilage',customerId:'customer-a',reportId:records[0].id,revision:0,decision:'monitor',note:'Reduce next supply by two cups; sales supervisor to review in 7 days.'});
  await assert.rejects(customerActivityAction(f.client,gm,{action:'reviewCustomerSpoilage',customerId:'customer-a',reportId:records[0].id,revision:0,decision:'resolved',note:'Done'}),/changed/);
  assert.equal((await s.SpoilageRecord.get(records[0].id)).review_revision,1);
  assert.throws(()=>guardMutation({role:'admin',user:gm},'SpoilageRecord','update',{status:'replaced'},records[0]),/checked customer spoilage/);
  assert.equal((await s.StockMovement.list()).length,0);
});

test('spoilage rejects wrong outlets, duplicate products, invalid quantities and changed retry payloads',async()=>{
  const f=await setup(),s=f.entities,p=await s.Product.create({name:'Cup',is_active:true,inventory_type:'finished_product'});
  const body={action:'reportCustomerSpoilage',customerId:'customer-a',requestKey:crypto.randomUUID(),date,reference:'SP',reason:'expired',notes:'Found at entrance',lines:[{product_id:p.id,quantity:2}]};
  const location=await s.CustomerLocation.create({customer_id:'other',is_active:true,name:'Other branch'});
  await assert.rejects(customerActivityAction(f.client,collector,{...body,locationId:location.id}),/belonging/);
  for(const quantity of [-1,0,true,1.00001,Infinity])await assert.rejects(customerActivityAction(f.client,collector,{...body,lines:[{product_id:p.id,quantity}]}),/positive product/);
  await assert.rejects(customerActivityAction(f.client,collector,{...body,lines:[...body.lines,...body.lines]}),/different products/);
  await customerActivityAction(f.client,collector,body);await assert.rejects(customerActivityAction(f.client,collector,{...body,notes:'changed'}),/different details/);
});

test('late failures roll back collection documents and multi-product spoilage through the actual API transaction',async()=>{
  const db=new PGlite();try{
    const f=await setup(db),route=await functionRoute();globalThis.__cashierClient=f.client;
    globalThis.__cashierTransaction=async fn=>{await db.exec('BEGIN');try{const r=await fn();await db.exec('COMMIT');return r;}catch(e){await db.exec('ROLLBACK');throw e;}};
    const audit=f.entities.AuditLog.create;f.entities.AuditLog.create=async()=>{throw Error('Audit unavailable');};
    const response=await route(request(f.body),{params:Promise.resolve({name:'fieldOps'})});assert.equal(response.status,400);
    assert.equal((await f.entities.Payment.list()).length,0);
    assert.equal((await f.entities.JournalEntry.list()).length,0);
    assert.equal((await f.entities.TreasuryTransaction.list()).length,0);
    assert.equal((await f.entities.PaymentAllocation.list()).length,0);
    assert.equal((await f.entities.Invoice.get(f.invoice.id)).balance,1000);
    assert.equal((await f.entities.Customer.get('customer-a')).balance,1000);
    assert.equal((await f.entities.TreasuryAccount.get('till')).balance,100000);
    f.entities.AuditLog.create=audit;
    const retry=await route(request(f.body),{params:Promise.resolve({name:'fieldOps'})});assert.equal(retry.status,200);
    const products=await Promise.all([1,2].map(i=>f.entities.Product.create({name:'Cup '+i,is_active:true,inventory_type:'finished_product'})));
    f.entities.AuditLog.create=async()=>{throw Error('Audit unavailable');};
    const spoil=await route(request({action:'reportCustomerSpoilage',customerId:'customer-a',requestKey:crypto.randomUUID(),date,reference:'SP',reason:'expired',notes:'Shelf review',lines:products.map(p=>({product_id:p.id,quantity:2}))}),{params:Promise.resolve({name:'fieldOps'})});
    assert.equal(spoil.status,400);assert.equal((await f.entities.SpoilageRecord.filter({record_type:'customer_spoilage_report'})).length,0);
  }finally{delete globalThis.__cashierClient;delete globalThis.__cashierTransaction;await db.close();}
});



test('a pre-release confirmed staff receipt can still be approved through the historical workflow exactly once',async()=>{
  const f=await setup(),s=f.entities,{payment}=await earlierCollection(f,{collectedBy:gm,employeeId:gm.id,confirmedBy:cashier});
  f.setActor(gm);
  const route=await functionRoute();globalThis.__cashierClient=f.client;globalThis.__cashierTransaction=fn=>fn();
  try{
    const rejected=await route(request({action:'reject',paymentId:payment.id,reason:'Needs review'}),{params:Promise.resolve({name:'customerReceipts'})});
    assert.equal(rejected.status,400);
    assert.match((await rejected.json()).error,/reconciled before cancellation/);
    await assert.rejects(validateAllocations(f.client.asServiceRole,[{invoice_id:f.invoice.id,amount:601}],'customer-a'),/remains after pending/);

    f.setActor(cashier,await s.Employee.get('cashier'));
    const denied=await route(request({action:'approve',paymentId:payment.id,topAdmin:true}),{params:Promise.resolve({name:'customerReceipts'})});
    assert.equal(denied.status,403);
    assert.equal((await s.Payment.get(payment.id)).status,'pending_approval');
    f.setActor(gm);
    for(let i=0;i<2;i++){
      const approved=await route(request({action:'approve',paymentId:payment.id,topAdmin:false}),{params:Promise.resolve({name:'customerReceipts'})});
      assert.equal(approved.status,200,await approved.clone().text());
    }
    const posted=await s.Payment.get(payment.id);
    assert.equal(posted.status,'posted');
    assert.equal(posted.self_approved,true);
    assert.equal(posted.approval_by_top_admin,true);
    assert.equal(posted.approved_by_user_id,gm.id);
    assert.equal((await s.JournalEntry.list()).length,1);
    assert.equal((await s.Customer.get('customer-a')).balance,600);
    assert.equal((await s.TreasuryAccount.get('till')).balance,100400);
  }finally{delete globalThis.__cashierClient;delete globalThis.__cashierTransaction;}
});

test('cash-desk invoice confirmation posts the full payment through the checked API with a deposit-only account list',async()=>{
  const f=await setup(),s=f.entities,route=await functionRoute();
  globalThis.__cashierClient=f.client;globalThis.__cashierTransaction=fn=>fn();
  const invoke=body=>route(request(body),{params:Promise.resolve({name:'customerReceipts'})});
  try{
    const denied=await invoke({action:'depositOptions'});
    assert.equal(denied.status,403);
    f.setActor(cashier,await s.Employee.get('cashier'));
    const options=await invoke({action:'depositOptions'});
    assert.equal(options.status,200);
    assert.deepEqual((await options.json()).cashAccounts.find(a=>a.id==='bank'),{id:'bank',name:'bank',account_type:'bank'});
    const body={...f.body,action:'confirm',treasuryAccountId:'till',amount:1000,allocations:[{invoice_id:f.invoice.id,amount:1000}]};
    const res=await invoke(body);
    assert.equal(res.status,200,await res.clone().text());
    const {payment}=await res.json();
    assert.equal(payment.status,'posted');
    assert.equal(payment.receipt_recorded_by_name,cashier.full_name);
    assert.equal(payment.receipt_posting_snapshot,undefined);
    assert.equal((await s.Invoice.get(f.invoice.id)).status,'paid');
    assert.equal((await s.Invoice.get(f.invoice.id)).balance,0);
    assert.equal((await s.Customer.get('customer-a')).balance,0);
    assert.equal((await s.TreasuryAccount.get('till')).balance,101000);
    assert.equal((await (await invoke(body)).json()).reused,true);
    assert.equal((await s.JournalEntry.list()).length,1);
    assert.throws(()=>guardMutation({role:'admin',user:gm},'Payment','update',{amount:1},{...payment,payment_type:'customer_payment'}),/immutable/);
  }finally{delete globalThis.__cashierClient;delete globalThis.__cashierTransaction;}
});

test('a cashier posts a previously confirmed invoice receipt using its saved date, amount, account and reference',async()=>{
  const f=await setup(),s=f.entities,{payment,collection}=await earlierCollection(f,{confirmedBy:gm});
  await s.Payment.update(payment.id,{cashier_confirmed_at:date+'T11:00:00Z',cashier_receipt_reference:'EXISTING-ACK'});
  const route=await functionRoute();
  globalThis.__cashierClient=f.client;globalThis.__cashierTransaction=fn=>fn();
  const invoke=body=>route(request(body),{params:Promise.resolve({name:'customerReceipts'})});
  try {
    const body={action:'postConfirmed',paymentId:payment.id};
    assert.equal((await invoke(body)).status,403);
    f.setActor(cashier,await s.Employee.get('cashier'));
    for(let attempt=0;attempt<2;attempt++){
      const result=await invoke({...body,treasuryAccountId:'bank',reference:'UNTRUSTED',amount:900});
      assert.equal(result.status,200,await result.clone().text());
      const {payment:posted}=await result.json();
      assert.equal(posted.status,'posted');
      assert.equal(posted.receipt_posting_snapshot,undefined);
    }
    const posted=await s.Payment.get(payment.id);
    assert.equal(posted.receipt_recorded_by,gm.id);
    assert.equal(posted.receipt_recorded_at,date+'T11:00:00Z');
    assert.equal(posted.approved_at,undefined);
    assert.equal((await s.Invoice.get(f.invoice.id)).balance,600);
    assert.equal((await s.Invoice.get(f.invoice.id)).deposited_by,gm.id);
    assert.equal((await s.Customer.get('customer-a')).balance,600);
    assert.equal((await s.CashCollection.get(collection.id)).journal_id,posted.journal_id);
    assert.equal((await s.TreasuryAccount.get('till')).balance,100400);
    assert.equal((await s.TreasuryAccount.get('bank')).balance,100000);
    assert.equal((await s.JournalEntry.list()).length,1);
    const [movement,...duplicates]=await s.TreasuryTransaction.list();
    assert.equal(duplicates.length,0);
    assert.equal(movement.reference,'EXISTING-ACK');
    assert.equal(movement.created_by,gm.id);
    assert.equal(movement.transaction_date,date);
    assert.equal((await s.AuditLog.list()).filter(r=>r.action==='post_customer_receipt').length,1);

    await s.Payment.update(payment.id,{status:'approved'});
    await s.JournalEntry.update(posted.journal_id,{status:'reversed',reversed_by_journal:'reversal'});
    const reversed=await invoke(body);
    assert.equal(reversed.status,400);
    assert.match((await reversed.json()).error,/journal needs reconciliation/);
    assert.equal((await s.Payment.get(payment.id)).status,'approved');
    assert.equal((await s.TreasuryTransaction.list()).length,1);
  } finally {delete globalThis.__cashierClient;delete globalThis.__cashierTransaction;}
});

test('confirmed receipt completion keeps bank history scoped and rolls back failed ledger posting',async()=>{
  const db=new PGlite();
  try{
    const f=await setup(db),s=f.entities,{payment,collection}=await earlierCollection(f,{confirmedBy:cashier});
    await s.Payment.update(payment.id,{status:'approved',treasury_account_id:'bank',treasury_account_name:'bank'});
    const route=await functionRoute();globalThis.__cashierClient=f.client;
    globalThis.__cashierTransaction=async fn=>{await db.exec('BEGIN');try{const result=await fn();await db.exec('COMMIT');return result;}catch(e){await db.exec('ROLLBACK');throw e;}};
    const invoke=()=>route(request({action:'postConfirmed',paymentId:payment.id}),{params:Promise.resolve({name:'customerReceipts'})});
    f.setActor(cashier,await s.Employee.get('cashier'));
    assert.equal((await invoke()).status,403);
    f.setActor(gm);
    await s.CashCollection.update(collection.id,{outstanding_amount:1});
    const inconsistent=await invoke();
    assert.equal(inconsistent.status,400);
    assert.match((await inconsistent.json()).error,/collection needs reconciliation/);
    await s.CashCollection.update(collection.id,{outstanding_amount:0});
    const mismatched=await s.TreasuryTransaction.create({source:'customer_receipt',source_document_id:payment.id,treasury_account_id:'till',amount:payment.amount,transaction_date:date,transaction_type:'receipt'});
    const invalidMovement=await invoke();
    assert.equal(invalidMovement.status,400);
    assert.match((await invalidMovement.json()).error,/treasury receipt needs reconciliation/);
    assert.equal((await s.Invoice.get(f.invoice.id)).balance,1000);
    assert.equal((await s.JournalEntry.list()).length,0);
    await s.TreasuryTransaction.deleteMany({id:mismatched.id});
    const audit=s.AuditLog.create;
    s.AuditLog.create=async data=>{if(data.action==='post_customer_receipt')throw Error('Audit unavailable');return audit(data);};
    assert.equal((await invoke()).status,400);
    assert.equal((await s.Payment.get(payment.id)).status,'approved');
    assert.equal((await s.Invoice.get(f.invoice.id)).balance,1000);
    assert.equal((await s.TreasuryAccount.get('bank')).balance,100000);
    assert.equal((await s.TreasuryTransaction.list()).length,0);
    assert.equal((await s.JournalEntry.list()).length,0);
    s.AuditLog.create=audit;
    const result=await invoke();
    assert.equal(result.status,200,await result.clone().text());
    assert.equal((await s.Payment.get(payment.id)).status,'posted');
    assert.equal((await s.TreasuryAccount.get('bank')).balance,100400);
  } finally {delete globalThis.__cashierClient;delete globalThis.__cashierTransaction;await db.close();}
});

test('verified earlier cash invoices use the sale reference once and generate stable references for later installments',async()=>{
  const f=await setup(),s=f.entities;
  const invoice=await s.Invoice.create({invoice_number:'INV-CASH-OLD',receipt_reference:'SALE-ORIGINAL',customer_id:'customer-a',customer_name:'Customer A',invoice_date:date,status:'posted',payment_type:'cash',total:700,balance:700,amount_paid:0});
  const journal=await s.JournalEntry.create({source_document_type:'Invoice',source_document_id:invoice.id,status:'posted'});
  await s.Invoice.update(invoice.id,{journal_id:journal.id});
  const [clearing]=await s.Account.filter({account_number:'1050'});
  await s.Account.update(clearing.id,{balance:700});
  const cashLine=await s.JournalLine.create({journal_id:journal.id,account_id:clearing.id,debit:700,credit:0,party_id:'customer-a'});
  f.setActor(cashier,await s.Employee.get('cashier'));
  const route=await functionRoute();globalThis.__cashierClient=f.client;globalThis.__cashierTransaction=fn=>fn();
  const invoke=body=>route(request(body),{params:Promise.resolve({name:'customerReceipts'})});
  const first={action:'confirm',customerId:'customer-a',requestKey:crypto.randomUUID(),date,treasuryAccountId:'till',amount:300,allocations:[{invoice_id:invoice.id,amount:300}]};
  try {
    const credit=await invoke({...first,allocations:[{invoice_id:f.invoice.id,amount:300}]});
    assert.equal(credit.status,400);
    assert.match((await credit.json()).error,/receipt or transaction reference/);
    await s.JournalLine.update(cashLine.id,{debit:100});
    const unverified=await invoke(first);
    assert.equal(unverified.status,400);
    assert.match((await unverified.json()).error,/original cash invoice journal/);
    await s.JournalLine.update(cashLine.id,{debit:700});
    const res=await invoke(first);
    assert.equal(res.status,200,await res.clone().text());
    assert.equal((await res.json()).payment.reference,'SALE-ORIGINAL');
    assert.equal((await (await invoke(first)).json()).reused,true);
    const second={...first,commercialReceipt:true,requestKey:crypto.randomUUID(),amount:400,allocations:[{invoice_id:invoice.id,amount:400}]};
    const next=await invoke(second);
    assert.equal(next.status,200,await next.clone().text());
    const {payment}=await next.json();
    assert.match(payment.reference,/^RCP-[0-9A-F]{20}$/);
    assert.equal(payment.reference,payment.payment_number);
    assert.equal((await (await invoke(second)).json()).payment.reference,payment.reference);
    assert.equal((await s.Invoice.get(invoice.id)).status,'paid');
    assert.equal((await s.Invoice.get(invoice.id)).cash_deposited,true);
    assert.equal((await s.Customer.get('customer-a')).balance,1000);
    assert.equal((await s.TreasuryAccount.get('till')).balance,100700);
    assert.equal((await s.Account.get(clearing.id)).balance,0);
    assert.equal((await s.TreasuryTransaction.list()).length,2);
  } finally {delete globalThis.__cashierClient;delete globalThis.__cashierTransaction;}
});
