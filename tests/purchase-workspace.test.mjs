import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {build} from 'esbuild';
import {fixture,functionRoute,request,user,date} from './helpers/cashier.mjs';
import {purchaseWorkspace,purchasePaymentDecision} from '../src/server/domain/purchase-workspace.js';
import {supplierAction} from '../src/server/domain/supplier-workspace.js';
import {cashierAction} from '../src/server/domain/cashier-workspace.js';
import {postJournal} from '../src/server/domain/field-ops.js';
import {purchaseSections,purchasePath,legacySupplierPath} from '../src/lib/purchase-workspace.js';

async function setup(db){
  const f=await fixture(db),s=f.entities;
  await s.Employee.update('cashier',{role:'admin',department_id:'materials'});
  await s.Supplier.update('supplier',{is_active:true});
  const product=await s.Product.create({name:'Milk powder',inventory_type:'raw_material',unit_of_measure:'kg',is_active:true});
  const body={action:'saveSupplierOrder',requestKey:crypto.randomUUID(),status:'confirmed',order:{supplier_id:'supplier',order_date:date,lines:[{product_id:product.id,quantity:10,unit_price:100,tax_rate:10}]}};
  return {...f,body,product,run:body=>supplierAction(f.client,user,body)};
}

test('Purchases combines all administrator destinations and retains deep links',()=>{
  assert.deepEqual(purchaseSections('admin').map(s=>s.key),['orders','suppliers','receiving','bills','payments']);
  for(const role of ['cashier','procurement','production_manager','employee','warehouse_manager','driver'])assert.deepEqual(purchaseSections(role),[]);
  const link=legacySupplierPath({supplier:'vendor / A',tab:'bills',role:'admin'});
  assert.equal(link,purchasePath({section:'suppliers',supplier:'vendor / A',supplierTab:'bills'}));
  assert.equal(new URL(link,'http://localhost').searchParams.get('supplier'),'vendor / A');
  assert.ok(!link.includes('role='));
});

test('only administrators can read, save or receive purchases',async()=>{
  const f=await setup(),s=f.entities,{order}=await f.run(f.body);
  for(const role of ['cashier','procurement','production_manager','employee','warehouse_manager','driver']){
    await s.Employee.update('cashier',{role});
    await assert.rejects(purchaseWorkspace(f.client,user,{section:'orders'}),{status:403});
    await assert.rejects(f.run({action:'supplierWorkspace',supplierId:'supplier'}),{status:403});
    await assert.rejects(f.run(f.body),{status:403});
    await assert.rejects(f.run({action:'receiveSupplierOrder',orderId:order.id}),{status:403});
  }
  await s.Employee.update('cashier',{role:'admin'});
  const options=await purchaseWorkspace(f.client,user,{compose:true});
  assert.equal(options.suppliers[0].name,'Supplier');
  assert.equal(options.suppliers[0].bank_account,undefined);
});

test('admin draft confirmation uses authenticated attribution, becomes receivable immediately and retries once',async()=>{
  const f=await setup(),s=f.entities;
  const draft={...f.body,status:'draft',order:{...f.body.order,requested_by_id:'forged-admin'}},{order}=await f.run(draft);
  assert.equal(order.requested_by_id,'cashier');assert.equal(order.requested_department_id,'materials');
  const submit={...f.body,orderId:order.id,requestKey:crypto.randomUUID(),order:{...f.body.order,notes:'10 kg for tomorrow'}};
  const first=await f.run(submit),retry=await f.run(submit);assert.equal(first.order.id,retry.order.id);assert.equal(retry.reused,true);assert.equal((await s.PurchaseOrderLine.list()).length,1);
  assert.equal(first.order.status,'approved');assert.equal(first.order.purchase_confirmed_by,user.id);assert.equal(first.order.approved_by,undefined);
  await assert.rejects(f.run({...submit,order:{...submit.order,notes:'Changed after submission'}}),/already saved/);
  await assert.rejects(f.run({...submit,requestKey:crypto.randomUUID()}),/Only a draft/);
});

test('Confirming an older order rechecks supplier, lines and totals, is retry-safe and moves no cash or stock',async()=>{
  const f=await setup(),s=f.entities,{order}=await f.run({...f.body,status:'draft'}),approve={action:'confirmSupplierOrder',orderId:order.id};
  await s.PurchaseOrder.update(order.id,{status:'pending_approval'});
  await s.PurchaseOrder.update(order.id,{total:10});await assert.rejects(f.run(approve),/total/);
  await s.PurchaseOrder.update(order.id,{total:1100});await s.Supplier.update('supplier',{is_active:false});await assert.rejects(f.run(approve),/supplier/);
  await s.Supplier.update('supplier',{is_active:true});const first=await f.run(approve),retry=await f.run(approve);assert.equal(first.order.purchase_confirmed_by,user.id);assert.equal(retry.reused,true);
  assert.equal((await s.JournalEntry.list()).length,0);assert.equal((await s.GoodsReceipt.list()).length,0);assert.equal((await s.TreasuryTransaction.list()).length,0);
  assert.equal((await s.AuditLog.list()).filter(a=>a.action==='confirm_supplier_order').length,1);
  await assert.rejects(f.run({action:'rejectSupplierOrder',orderId:order.id}),/awaiting approval/);
});

test('payment authorization uses fresh balances and server identity, and keeps money untouched until checked release',async()=>{
  const f=await setup(),s=f.entities;await s.Employee.update('cashier',{role:'cashier'});
  const receipt=await s.GoodsReceipt.create({supplier_id:'supplier',po_id:'po',status:'confirmed',receipt_date:date,total:1000});
  const {journal}=await postJournal(f.client.asServiceRole,{entryDate:date,description:'Goods received',sourceModule:'procurement',sourceDocumentType:'GoodsReceipt',sourceDocumentId:receipt.id,userId:user.id,lines:[{account_id:'inventory',debit:1000,credit:0},{account_id:'payable',debit:0,credit:1000,party_type:'supplier',party_id:'supplier'}]});
  await s.GoodsReceipt.update(receipt.id,{journal_id:journal.id});await s.Supplier.update('supplier',{balance:1000});
  const bill=await s.Bill.create({supplier_id:'supplier',po_id:'po',receipt_id:receipt.id,journal_id:journal.id,payable_account_id:'payable',status:'open',total:1000,amount_paid:0,balance:1000});
  const payment=await s.Payment.create({payment_number:'LEGACY-001',payment_type:'supplier_payment',party_type:'supplier',party_id:'supplier',po_id:'po',bill_id:bill.id,amount:500,treasury_account_id:'till',payment_method:'cash',status:'pending_approval'});
  const body={action:'approvePurchasePayment',paymentId:payment.id,approved_by:'forged'};
  await assert.rejects(purchasePaymentDecision(f.client,user,body),/restricted/);
  await s.Employee.update('cashier',{role:'admin'});await s.Bill.update(bill.id,{amount_paid:800,balance:200});await assert.rejects(purchasePaymentDecision(f.client,user,body),/current supplier bill/);
  await s.Bill.update(bill.id,{amount_paid:0,balance:1000});const approved=await purchasePaymentDecision(f.client,user,body);assert.equal(approved.payment.approved_by,user.id);
  assert.equal((await purchasePaymentDecision(f.client,user,body)).reused,true);assert.equal((await s.TreasuryAccount.get('till')).balance,100000);assert.equal((await s.JournalEntry.list()).length,1);assert.equal((await s.Bill.get(bill.id)).balance,1000);
  const release={action:'cashierReleasePayment',paymentId:payment.id,accountId:'till',date,requestKey:crypto.randomUUID()};await cashierAction(f.client,user,release);await cashierAction(f.client,user,release);
  assert.equal((await s.TreasuryAccount.get('till')).balance,99500);assert.equal((await s.Bill.get(bill.id)).balance,500);assert.equal((await s.JournalEntry.list()).length,2);
});

test('late direct purchase payment failure rolls back cash, ledger and payment at the API boundary',async()=>{
  const db=new PGlite();try{
    const f=await setup(db),s=f.entities,route=await functionRoute(),original=s.AuditLog.create;
    const prepayment=await s.Account.create({account_number:'4090',name:'Supplier prepayments',account_type:'asset',normal_balance:'debit',is_active:true,is_posting:true,balance:0});
    await s.PostingRule.create({rule_key:'supplier_prepayment',account_id:prepayment.id,is_active:true});
    globalThis.__cashierClient=f.client;globalThis.__cashierTransaction=async fn=>{await db.exec('BEGIN');try{const result=await fn();await db.exec('COMMIT');return result;}catch(e){await db.exec('ROLLBACK');throw e;}};
    s.AuditLog.create=async value=>{if(value.action==='cashier_disbursement')throw Error('Payment audit unavailable');return original(value);};
    const body={action:'recordPurchasePayment',orderId:'po',amount:500,accountId:'till',date,reference:'Advance',requestKey:crypto.randomUUID()};
    const send=()=>route(request(body),{params:Promise.resolve({name:'fieldOps'})});
    assert.equal((await send()).status,400);
    for(const entity of ['Payment','TreasuryTransaction','JournalEntry'])assert.deepEqual(await s[entity].list(),[]);
    assert.equal((await s.TreasuryAccount.get('till')).balance,100000);
    s.AuditLog.create=original;
    const response=await send();assert.equal(response.status,200);assert.equal((await response.json()).payment.status,'posted');
    const retry=await send();assert.equal((await retry.json()).reused,true);
    assert.equal((await s.TreasuryTransaction.list()).length,1);
    assert.equal((await s.TreasuryAccount.get('till')).balance,99500);
  }finally{delete globalThis.__cashierClient;delete globalThis.__cashierTransaction;await db.close();}
});

test('the real public entity endpoints cannot bypass purchase forms or rewrite a submitted order, even for the GM',async()=>{
  const f=await setup(),{order}=await f.run(f.body);
  const output=await build({entryPoints:['src/server/entity-api.js'],bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'purchase-stores',setup(b){
    b.onResolve({filter:/^server-only$/},()=>({path:'empty',namespace:'fixture'}));
    b.onResolve({filter:/(?:^|\/)entities\.js$/},()=>({path:'stores',namespace:'fixture'}));
    b.onResolve({filter:/(?:^|\/)db\.js$/},()=>({path:'db',namespace:'fixture'}));
    b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:path==='stores'?'export const serviceEntities=new Proxy({}, {get:(_,key)=>globalThis.__purchaseStores[key]});export const entityStore=name=>globalThis.__purchaseStores[name];':path==='db'?'export const database=()=>{throw Error("Unexpected catalogue read in unrelated test");};export const transaction=fn=>fn();':''}));
  }}]});
  const {entityOperation}=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
  globalThis.__purchaseStores=f.entities;const admin={user:{id:'gm',role:'admin'},role:'admin'};
  try{
    await assert.rejects(entityOperation(admin,'PurchaseOrder','update',[order.id,{status:'approved',approved_by:'gm'}]),/checked Purchases/);
    const line=(await f.entities.PurchaseOrderLine.list())[0];await assert.rejects(entityOperation(admin,'PurchaseOrderLine','update',[line.id,{unit_price:1}]),/checked Purchases/);
    await assert.rejects(entityOperation(admin,'PurchaseOrder','create',[{status:'approved'}]),/checked Purchases/);
    assert.equal((await f.entities.PurchaseOrder.get(order.id)).status,'approved');assert.equal((await f.entities.PurchaseOrderLine.get(line.id)).unit_price,100);
  }finally{delete globalThis.__purchaseStores;}
});



test('separate payments destination uses the same finance permissions as bills',async()=>{
  const f=await setup(),s=f.entities;
  await s.Employee.update('cashier',{role:'warehouse_manager'});
  await assert.rejects(purchaseWorkspace(f.client,user,{section:'payments'}),/reserved/);
  await s.Employee.update('cashier',{role:'admin'});
  const result=await purchaseWorkspace(f.client,user,{section:'payments'});
  assert.ok(Array.isArray(result.payments));assert.ok(Array.isArray(result.bills));assert.equal(result.permissions.approve,true);
});
