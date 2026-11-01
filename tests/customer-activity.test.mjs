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

test('customer cash is assigned to the logged-in collector, reserved once, received separately and posted only after independent GM approval',async()=>{
  const f=await setup(),s=f.entities;
  const result=await customerActivityAction(f.client,collector,{...f.body,collectorId:'someone-else',commercialId:'another-agent',collector_name:'forged'});
  let payment=await s.Payment.get(result.payment.id),collection=await s.CashCollection.get(payment.collection_id);
  assert.equal(payment.status,'awaiting_cashier');assert.equal(payment.collector_user_id,collector.id);assert.equal(payment.collector_name,'Collector');
  assert.equal(collection.commercial_id,'collector');assert.equal(collection.outstanding_amount,400);assert.equal((await s.Invoice.get(f.invoice.id)).balance,1000);
  assert.equal((await s.JournalEntry.list()).length,0);assert.equal((await s.TreasuryAccount.get('till')).balance,100000);
  const repeat=await customerActivityAction(f.client,collector,f.body);assert.equal(repeat.reused,true);assert.equal((await s.Payment.list()).length,1);
  const space=await customerActivityAction(f.client,collector,{action:'customerCollectionWorkspace',customerId:'customer-a'});assert.equal(space.invoices[0].available_amount,600);assert.equal(space.cash_to_deposit,400);
  await assert.rejects(approveReceipt(f.client.asServiceRole,payment,gm),/confirmation/);
  const own=await s.Employee.get('cashier');f.setActor(cashier,own);
  const desk=await cashierAction(f.client,cashier,{action:'cashierWorkspace',date});assert.equal(desk.staffCollections.length,1);
  assert.equal(cashDepositors(desk).filter(r=>r.kind==='staff_receipt').length,1);assert.equal(desk.collections.some(c=>c.id===collection.id),false);
  const receive={action:'confirmCollection',paymentId:payment.id,requestKey:crypto.randomUUID(),date,reference:'CASHIER-ACK-01',amount:400,treasuryAccountId:'till'};
  await confirmCustomerCollection(f.client,cashier,receive);payment=await s.Payment.get(payment.id);collection=await s.CashCollection.get(collection.id);
  assert.equal(payment.status,'pending_approval');assert.equal(collection.outstanding_amount,0);assert.equal(collection.received_by_user_id,cashier.id);
  assert.equal((await s.Invoice.get(f.invoice.id)).balance,1000);assert.equal((await s.JournalEntry.list()).length,0);
  assert.equal((await confirmCustomerCollection(f.client,cashier,receive)).reused,true);
  await assert.rejects(approveReceipt(f.client.asServiceRole,payment,cashier),/cannot approve/);
  await assert.rejects(approveReceipt(f.client.asServiceRole,payment,collector),/cannot approve/);
  f.setActor(gm);
  const route=await functionRoute();globalThis.__cashierClient=f.client;globalThis.__cashierTransaction=fn=>fn();
  try {
    const rejected=await route(request({action:'reject',paymentId:payment.id,reason:'Needs review'}),{params:Promise.resolve({name:'customerReceipts'})});
    assert.equal(rejected.status,400);assert.match((await rejected.json()).error,/reconciled before cancellation/);
    assert.equal((await s.Payment.get(payment.id)).status,'pending_approval');
    await assert.rejects(validateAllocations(f.client.asServiceRole,[{invoice_id:f.invoice.id,amount:601}],'customer-a'),/remains after pending/);
  } finally {delete globalThis.__cashierClient;delete globalThis.__cashierTransaction;}
  await approveReceipt(f.client.asServiceRole,payment,gm);
  assert.equal((await s.Invoice.get(f.invoice.id)).balance,600);assert.equal((await s.Customer.get('customer-a')).balance,600);
  assert.equal((await s.TreasuryAccount.get('till')).balance,100400);assert.equal((await s.JournalEntry.list()).length,1);
  assert.equal((await s.Account.get(f.ar.id)).balance,600);
  const posted=await s.Payment.get(payment.id);await approveReceipt(f.client.asServiceRole,posted,gm);
  assert.equal((await s.JournalEntry.list()).length,1);assert.equal((await s.TreasuryAccount.get('till')).balance,100400);
  const days=dailyCashSettlements([collection]);assert.equal(days[0].status,'settled');
});

test('collection guards reject changed retry payloads, duplicate receipts, over-collections, foreign invoices, inactive staff and unassigned customers',async()=>{
  const f=await setup(),s=f.entities;
  await customerActivityAction(f.client,collector,f.body);
  await assert.rejects(customerActivityAction(f.client,collector,{...f.body,reference:'changed'}),/different payment/);
  await assert.rejects(customerActivityAction(f.client,collector,{...f.body,requestKey:crypto.randomUUID()}),/already recorded/);
  await assert.rejects(customerActivityAction(f.client,collector,{...f.body,requestKey:crypto.randomUUID(),reference:'another',amount:700,allocations:[{invoice_id:f.invoice.id,amount:700}]}),/remains after pending/);
  for(const amount of [true,-1,NaN,Infinity,1.001])await assert.rejects(customerActivityAction(f.client,collector,{...f.body,requestKey:crypto.randomUUID(),amount}));
  await assert.rejects(validateAllocations(f.client.asServiceRole,[{invoice_id:f.invoice.id,amount:601}],'customer-a'),/remains after pending/);
  await s.Customer.update('customer-a',{salesperson_id:'another'});await assert.rejects(customerActivityAction(f.client,collector,f.body),/assigned/);
  f.setActor(collector,{id:'collector',role:'commercial',status:'inactive'});await assert.rejects(customerActivityAction(f.client,collector,f.body),/active staff/);
  f.setActor({id:'driver',role:'user'},{id:'driver',role:'driver',status:'active'});await assert.rejects(customerActivityAction(f.client,{id:'driver',role:'user'},f.body),/restricted/);
});

test('a collector cannot clear their own debt; a shortfall, wrong account or changed confirmation reference leaves the obligation intact',async()=>{
  const f=await setup(),s=f.entities;f.setActor(gm);
  const result=await customerActivityAction(f.client,gm,f.body),payment=await s.Payment.get(result.payment.id);
  const body={paymentId:payment.id,requestKey:crypto.randomUUID(),date,reference:'ACK',amount:400,treasuryAccountId:'till'};
  await assert.rejects(confirmCustomerCollection(f.client,gm,body),/cash you collected/);
  f.setActor(cashier,await s.Employee.get('cashier'));
  await assert.rejects(confirmCustomerCollection(f.client,cashier,{...body,amount:200}),/full recorded/);
  await assert.rejects(confirmCustomerCollection(f.client,cashier,{...body,treasuryAccountId:'bank'}),/cash account/);
  assert.equal((await s.CashCollection.get(payment.collection_id)).outstanding_amount,400);
  await confirmCustomerCollection(f.client,cashier,body);
  await assert.rejects(confirmCustomerCollection(f.client,cashier,{...body,reference:'changed'}),/different details/);
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
    assert.equal((await f.entities.Payment.list()).length,0);assert.equal((await f.entities.CashCollection.filter({collection_origin:'customer_receipt'})).length,0);
    f.entities.AuditLog.create=audit;
    const retry=await route(request(f.body),{params:Promise.resolve({name:'fieldOps'})});assert.equal(retry.status,200);
    const products=await Promise.all([1,2].map(i=>f.entities.Product.create({name:'Cup '+i,is_active:true,inventory_type:'finished_product'})));
    f.entities.AuditLog.create=async()=>{throw Error('Audit unavailable');};
    const spoil=await route(request({action:'reportCustomerSpoilage',customerId:'customer-a',requestKey:crypto.randomUUID(),date,reference:'SP',reason:'expired',notes:'Shelf review',lines:products.map(p=>({product_id:p.id,quantity:2}))}),{params:Promise.resolve({name:'fieldOps'})});
    assert.equal(spoil.status,400);assert.equal((await f.entities.SpoilageRecord.filter({record_type:'customer_spoilage_report'})).length,0);
  }finally{delete globalThis.__cashierClient;delete globalThis.__cashierTransaction;await db.close();}
});

