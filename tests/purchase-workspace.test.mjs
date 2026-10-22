import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {build} from 'esbuild';
import {fixture,functionRoute,request,user,date} from './helpers/cashier.mjs';
import {purchaseWorkspace,purchasePaymentDecision} from '../src/server/domain/purchase-workspace.js';
import {supplierAction} from '../src/server/domain/supplier-workspace.js';
import {cashierAction} from '../src/server/domain/cashier-workspace.js';
import {purchaseSections,purchasePath,legacySupplierPath} from '../src/lib/purchase-workspace.js';

async function setup(db){
  const f=await fixture(db),s=f.entities;
  await s.Employee.update('cashier',{role:'procurement',department_id:'materials'});
  await s.Supplier.update('supplier',{is_active:true});
  const product=await s.Product.create({name:'Milk powder',inventory_type:'raw_material',unit_of_measure:'kg',is_active:true});
  const body={action:'saveSupplierOrder',requestKey:crypto.randomUUID(),status:'pending_approval',order:{supplier_id:'supplier',order_date:date,lines:[{product_id:product.id,quantity:10,unit_price:100,tax_rate:10}]}};
  return {...f,body,product,run:body=>supplierAction(f.client,user,body)};
}

test('Purchases combines suppliers with role-specific receiving and finance tabs, retaining deep links',()=>{
  assert.deepEqual(purchaseSections('admin').map(s=>s.key),['orders','suppliers','receiving','bills']);
  assert.deepEqual(purchaseSections('cashier').map(s=>s.key),['orders','suppliers','bills']);
  for(const role of ['production_manager','employee'])assert.deepEqual(purchaseSections(role).map(s=>s.key),['orders']);
  assert.deepEqual(purchaseSections('warehouse_manager').map(s=>s.key),['orders','receiving']);
  const link=legacySupplierPath({supplier:'vendor / A',tab:'bills',role:'admin'});
  assert.equal(link,purchasePath({section:'suppliers',supplier:'vendor / A',supplierTab:'bills'}));
  assert.equal(new URL(link,'http://localhost').searchParams.get('supplier'),'vendor / A');
  assert.ok(!link.includes('role='));
});

test('purchase workspace scopes requesters and warehouses and never exposes financial registers to Operations',async()=>{
  const f=await setup(),s=f.entities,{order}=await f.run(f.body);
  await s.PurchaseOrder.create({supplier_id:'supplier',po_number:'OTHER-DRAFT',status:'draft',requested_department_id:'other',requested_by_id:'other'});
  await s.Employee.update('cashier',{role:'production_manager'});
  const view=await purchaseWorkspace(f.client,user,{});assert.deepEqual(view.orders.map(o=>o.id),[order.id]);assert.equal(view.bills,undefined);assert.equal(view.payments,undefined);assert.equal(view.permissions.approve,false);
  for(const section of ['suppliers','bills','receiving'])await assert.rejects(purchaseWorkspace(f.client,user,{section}),/reserved/);
  await assert.rejects(purchaseWorkspace(f.client,user,{orderId:'po'}),/outside your permitted scope/);
  const options=await purchaseWorkspace(f.client,user,{compose:true});assert.equal(options.suppliers[0].name,'Supplier');assert.equal(options.suppliers[0].balance,undefined);assert.equal(options.suppliers[0].bank_account,undefined);
  await s.Employee.update('cashier',{role:'warehouse_manager'});
  const warehouse=await purchaseWorkspace(f.client,user,{section:'receiving'});assert.ok(warehouse.orders.some(o=>o.id==='po'));assert.equal(warehouse.bills,undefined);assert.equal(warehouse.permissions.approve,false);
  await s.Employee.update('cashier',{role:'driver'});await assert.rejects(purchaseWorkspace(f.client,user,{}),/restricted/);
});

test('department purchase requests use authenticated attribution and edited draft submissions retry once',async()=>{
  const f=await setup(),s=f.entities;await s.Employee.update('cashier',{role:'production_manager'});
  const draft={...f.body,status:'draft',order:{...f.body.order,requested_by_id:'forged-admin'}},{order}=await f.run(draft);
  assert.equal(order.requested_by_id,'cashier');assert.equal(order.requested_department_id,'materials');
  const submit={...f.body,orderId:order.id,requestKey:crypto.randomUUID(),order:{...f.body.order,notes:'10 kg for tomorrow'}};
  const first=await f.run(submit),retry=await f.run(submit);assert.equal(first.order.id,retry.order.id);assert.equal(retry.reused,true);assert.equal((await s.PurchaseOrderLine.list()).length,1);
  await assert.rejects(f.run({...submit,order:{...submit.order,notes:'Changed after submission'}}),/already saved/);
  await assert.rejects(f.run({...submit,requestKey:crypto.randomUUID()}),/Only a draft/);
  await s.Employee.update('cashier',{department_id:'other'});
  const other=await s.PurchaseOrder.create({status:'draft',supplier_id:'supplier',requested_department_id:'finance',requested_by_id:'someone-else'});
  await assert.rejects(f.run({...submit,orderId:other.id,requestKey:crypto.randomUUID()}),/outside/);
});

test('General Manager order authorization rechecks supplier, lines and totals, is retry-safe and moves no cash or stock',async()=>{
  const f=await setup(),s=f.entities,{order}=await f.run(f.body),approve={action:'approveSupplierOrder',orderId:order.id};
  await assert.rejects(f.run(approve),/restricted/);await s.Employee.update('cashier',{role:'admin'});
  await s.PurchaseOrder.update(order.id,{total:10});await assert.rejects(f.run(approve),/total/);
  await s.PurchaseOrder.update(order.id,{total:1100});await s.Supplier.update('supplier',{is_active:false});await assert.rejects(f.run(approve),/supplier/);
  await s.Supplier.update('supplier',{is_active:true});const first=await f.run(approve),retry=await f.run(approve);assert.equal(first.order.approved_by,user.id);assert.equal(retry.reused,true);
  assert.equal((await s.JournalEntry.list()).length,0);assert.equal((await s.GoodsReceipt.list()).length,0);assert.equal((await s.TreasuryTransaction.list()).length,0);
  assert.equal((await s.AuditLog.list()).filter(a=>a.action==='approve').length,1);
  await assert.rejects(f.run({action:'rejectSupplierOrder',orderId:order.id}),/awaiting approval/);
});

test('payment authorization uses fresh balances and server identity, and keeps money untouched until checked release',async()=>{
  const f=await setup(),s=f.entities;await s.Employee.update('cashier',{role:'cashier'});
  const bill=await s.Bill.create({supplier_id:'supplier',po_id:'po',status:'open',total:1000,amount_paid:0,balance:1000});
  const {payment}=await cashierAction(f.client,user,{action:'cashierRequestPayment',billId:bill.id,amount:500,accountId:'till',date,reference:'Invoice 001',requestKey:crypto.randomUUID()});
  const body={action:'approvePurchasePayment',paymentId:payment.id,approved_by:'forged'};
  await assert.rejects(purchasePaymentDecision(f.client,user,body),/restricted/);
  await s.Employee.update('cashier',{role:'admin'});await s.Bill.update(bill.id,{amount_paid:800,balance:200});await assert.rejects(purchasePaymentDecision(f.client,user,body),/current supplier bill/);
  await s.Bill.update(bill.id,{amount_paid:0,balance:1000});const approved=await purchasePaymentDecision(f.client,user,body);assert.equal(approved.payment.approved_by,user.id);
  assert.equal((await purchasePaymentDecision(f.client,user,body)).reused,true);assert.equal((await s.TreasuryAccount.get('till')).balance,100000);assert.equal((await s.JournalEntry.list()).length,0);assert.equal((await s.Bill.get(bill.id)).balance,1000);
  await s.Employee.update('cashier',{role:'cashier'});const release={action:'cashierReleasePayment',paymentId:payment.id,accountId:'till',date,requestKey:crypto.randomUUID()};await cashierAction(f.client,user,release);await cashierAction(f.client,user,release);
  assert.equal((await s.TreasuryAccount.get('till')).balance,99500);assert.equal((await s.Bill.get(bill.id)).balance,500);assert.equal((await s.JournalEntry.list()).length,1);
});

test('a late approval audit failure rolls back payment authorization at the actual API transaction boundary',async()=>{
  const db=new PGlite();try{
    const f=await setup(db),s=f.entities;await s.Employee.update('cashier',{role:'cashier'});
    const {payment}=await cashierAction(f.client,user,{action:'cashierRequestPayment',orderId:'po',amount:500,accountId:'till',date,reference:'Advance',requestKey:crypto.randomUUID()});
    await s.Employee.update('cashier',{role:'admin'});const route=await functionRoute(),original=s.AuditLog.create;
    globalThis.__cashierClient=f.client;globalThis.__cashierTransaction=async fn=>{await db.exec('BEGIN');try{const result=await fn();await db.exec('COMMIT');return result;}catch(e){await db.exec('ROLLBACK');throw e;}};
    s.AuditLog.create=async()=>{throw Error('Approval audit unavailable');};
    const body={action:'approvePurchasePayment',paymentId:payment.id};const failed=await route(request(body),{params:Promise.resolve({name:'fieldOps'})});assert.equal(failed.status,400);assert.equal((await s.Payment.get(payment.id)).status,'pending_approval');assert.equal((await s.Payment.get(payment.id)).approved_by,undefined);
    s.AuditLog.create=original;const response=await route(request(body),{params:Promise.resolve({name:'fieldOps'})});assert.equal(response.status,200);assert.equal((await s.Payment.get(payment.id)).status,'approved');assert.equal((await s.TreasuryTransaction.list()).length,0);
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
    assert.equal((await f.entities.PurchaseOrder.get(order.id)).status,'pending_approval');assert.equal((await f.entities.PurchaseOrderLine.get(line.id)).unit_price,100);
  }finally{delete globalThis.__purchaseStores;}
});

