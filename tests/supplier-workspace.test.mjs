import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {fixture,functionRoute,request,user,date} from './helpers/cashier.mjs';
import {supplierAction} from '../src/server/domain/supplier-workspace.js';
import {cashierAction} from '../src/server/domain/cashier-workspace.js';
import {purchaseOrderHtml,purchaseOrderEmail} from '../src/lib/supplier-documents.js';

async function setup(db){
  const f=await fixture(db),s=f.entities;
  await s.Employee.update('cashier',{role:'procurement'});
  const inv=await s.Account.create({name:'Materials',account_number:'1310',account_type:'asset',normal_balance:'debit',is_active:true,is_posting:true,balance:0});
  await s.PostingRule.create({rule_key:'supplier_payable',is_active:true,account_id:'payable',account_number:'4010',account_name:'Payable'});
  await s.PostingRule.create({rule_key:'raw_material_inventory',is_active:true,account_id:inv.id,account_number:'1310',account_name:'Materials'});
  const product=await s.Product.create({name:'Milk powder',sku:'MILK',inventory_type:'raw_material',unit_of_measure:'kg',purchase_price:100,inventory_account_id:inv.id,is_active:true,batch_tracking:true,expiry_tracking:true,current_cost:100});
  const warehouse=await s.Warehouse.create({name:'Raw materials',warehouse_type:'raw_material',is_active:true});
  await s.Supplier.update('supplier',{is_active:true,payment_terms_days:30});
  const body={action:'saveSupplierOrder',requestKey:crypto.randomUUID(),status:'pending_approval',order:{supplier_id:'supplier',order_date:date,warehouse_id:warehouse.id,payment_terms:'credit',lines:[{product_id:product.id,quantity:10,unit_price:100,tax_rate:10}]}};
  const run=body=>supplierAction(f.client,user,body);
  return {...f,run,product,warehouse,body,inv};
}
async function approved(f){
  const {order}=await f.run(f.body);
  await f.entities.Employee.update('cashier',{role:'admin'});
  await f.run({action:'approveSupplierOrder',orderId:order.id});
  await f.entities.Employee.update('cashier',{role:'procurement'});
  return order;
}
const receipt=(f,order,quantity=4)=>({action:'receiveSupplierOrder',orderId:order.id,date,warehouseId:f.warehouse.id,requestKey:crypto.randomUUID(),lines:[{po_line_id:f.rows.PurchaseOrderLine[0]?.id,quantity,lot_number:'MILK-100',expiry_date:'2029-12-31'}]});

test('supplier catalogue supports multiple suppliers without changing item costs; archive preserves history',async()=>{
  const f=await setup(),s=f.entities;
  const body={action:'saveSupplier',requestKey:crypto.randomUUID(),supplier:{name:'Vendor A',email:'vendor@example.com',payment_terms_days:14,supplier_items:[{product_id:f.product.id,unit_price:90,supplier_code:'M-01'}]}};
  const {supplier}=await f.run(body),retry=await f.run(body);
  assert.equal(supplier.id,retry.supplier.id);assert.equal(retry.reused,true);
  await assert.rejects(f.run({...body,supplier:{...body.supplier,name:'Changed'}}),/already saved/);
  await f.run({...body,requestKey:crypto.randomUUID(),supplier:{...body.supplier,name:'Vendor B'}});
  assert.equal((await s.Product.get(f.product.id)).current_cost,100);
  await f.run({...body,supplierId:supplier.id,supplier:{...body.supplier,is_active:false}});
  const view=await f.run({action:'supplierWorkspace',supplierId:supplier.id});
  assert.equal(view.supplier.is_active,false);assert.equal(view.supplier.supplier_items[0].unit,'kg');assert.equal(view.accounts.length,0);assert.equal(view.permissions.pay,false);
  await s.Employee.update('cashier',{role:'driver'});
  await assert.rejects(f.run({action:'supplierWorkspace'}),/Not permitted/);
  await assert.rejects(f.run(body),/Not permitted/);
});

test('orders are single-supplier, server totalled, retry safe and require the General Manager approval',async()=>{
  const f=await setup(),s=f.entities;
  const first=await f.run(f.body),retry=await f.run(f.body);
  assert.equal(first.order.id,retry.order.id);assert.equal(first.order.total,1100);assert.equal(first.order.tax_total,100);assert.equal((await s.PurchaseOrderLine.list()).length,1);
  await assert.rejects(f.run({...f.body,order:{...f.body.order,notes:'Changed'}}),/already saved/);
  await assert.rejects(f.run({action:'approveSupplierOrder',orderId:first.order.id}),/Not permitted/);
  await assert.rejects(f.run(receipt(f,first.order)),/approved purchase/);
  await assert.rejects(f.run({...f.body,orderId:first.order.id}),/Only a draft/);
  assert.equal((await s.GoodsReceipt.list()).length,0);
});

test('partial receipts create exactly one inventory/AP journal and bill, reject overreceipt, and finish cumulatively',async()=>{
  const f=await setup(),s=f.entities,order=await approved(f),body=receipt(f,order);
  const first=await f.run(body),retry=await f.run(body);
  assert.equal(first.receipt.id,retry.receipt.id);assert.equal(first.bill.total,440);assert.equal(first.bill.balance,440);
  assert.equal((await s.GoodsReceipt.list()).length,1);assert.equal((await s.Bill.list()).length,1);assert.equal((await s.JournalEntry.list()).length,1);
  const journalLines=await s.JournalLine.list();assert.equal(journalLines.find(l=>l.account_id===f.inv.id).debit,440);assert.equal(journalLines.find(l=>l.account_id==='payable').credit,440);
  const lot=(await s.StockBalance.list()).find(b=>b.product_id===f.product.id);
  assert.equal(lot.quantity,4);assert.equal(lot.total_value,440);assert.equal(lot.expiry_date,'2029-12-31');assert.equal(lot.warehouse_name,'Raw materials');
  assert.equal((await s.PurchaseOrder.get(order.id)).status,'partially_received');
  await assert.rejects(f.run({...body,lines:[{...body.lines[0],quantity:5}]}),/already recorded/);
  await assert.rejects(f.run({...body,requestKey:crypto.randomUUID(),lines:[{...body.lines[0],quantity:7}]}),/remaining order/);
  const linked=await f.run({action:'registerSupplierBill',orderId:order.id});assert.equal(linked.bills[0].id,first.bill.id);assert.equal((await s.JournalEntry.list()).length,1);
  await f.run({...body,requestKey:crypto.randomUUID(),lines:[{...body.lines[0],quantity:6}]});
  assert.equal((await s.PurchaseOrder.get(order.id)).status,'received');assert.equal((await s.Supplier.get('supplier')).balance,1100);
  assert.equal((await s.StockBalance.list()).find(b=>b.product_id===f.product.id).quantity,10);
  const view=await f.run({action:'supplierWorkspace',supplierId:'supplier'});assert.equal(view.supplier.unpaid_bills,1100);assert.equal(view.receipts.length,2);
});

test('bill payment requests reserve the order, require approval and settle the bill once on release',async()=>{
  const f=await setup(),s=f.entities,order=await approved(f),{bill}=await f.run(receipt(f,order));
  await s.Employee.update('cashier',{role:'cashier'});
  const body={action:'cashierRequestPayment',billId:bill.id,accountId:'till',amount:200,date,reference:'Vendor transfer',requestKey:crypto.randomUUID()};
  const {payment}=await cashierAction(f.client,user,body);
  assert.equal((await s.Bill.get(bill.id)).balance,440);assert.equal((await s.TreasuryAccount.get('till')).balance,100000);
  await assert.rejects(cashierAction(f.client,user,{...body,requestKey:crypto.randomUUID()}),/awaiting processing/);
  const release={action:'cashierReleasePayment',paymentId:payment.id,accountId:'till',requestKey:crypto.randomUUID(),date};
  await assert.rejects(cashierAction(f.client,user,release),/approved by the General Manager/);
  await s.Payment.update(payment.id,{status:'approved',approved_by:'GM',approved_at:new Date().toISOString()});
  await s.Bill.update(bill.id,{amount_paid:1});
  await assert.rejects(cashierAction(f.client,user,release),/current bill balance/);
  await s.Bill.update(bill.id,{amount_paid:0});
  await cashierAction(f.client,user,release);await cashierAction(f.client,user,release);
  assert.equal((await s.Bill.get(bill.id)).balance,240);assert.equal((await s.Bill.get(bill.id)).amount_paid,200);assert.equal((await s.Supplier.get('supplier')).balance,240);
  assert.equal((await s.PaymentAllocation.list()).length,1);assert.equal((await s.TreasuryAccount.get('till')).balance,99800);
  assert.equal((await s.JournalEntry.list()).length,2);
});

test('posted advances are allocated to a new receipt bill without moving cash or posting twice',async()=>{
  const f=await setup(),s=f.entities,order=await approved(f);
  await s.Employee.update('cashier',{role:'cashier'});
  const {payment}=await cashierAction(f.client,user,{action:'cashierRequestPayment',orderId:order.id,accountId:'till',amount:300,date,reference:'Advance',requestKey:crypto.randomUUID()});
  await s.Payment.update(payment.id,{status:'approved',approved_by:'GM',approved_at:new Date().toISOString()});
  await cashierAction(f.client,user,{action:'cashierReleasePayment',paymentId:payment.id,accountId:'till',date,requestKey:crypto.randomUUID()});
  await s.Employee.update('cashier',{role:'procurement'});
  const {bill}=await f.run(receipt(f,order));
  assert.equal(bill.balance,140);assert.equal(bill.amount_paid,300);assert.equal((await s.Supplier.get('supplier')).balance,140);
  assert.equal((await s.JournalEntry.list()).length,2);assert.equal((await s.TreasuryAccount.get('till')).balance,99700);
});

test('late receiving failure rolls back inventory, bill, sequences and accounting at the real API transaction boundary',async()=>{
  const db=new PGlite();try{
    const f=await setup(db),s=f.entities,order=await approved(f),line=(await s.PurchaseOrderLine.list())[0];
    const body={...receipt(f,order),lines:[{po_line_id:line.id,quantity:4,lot_number:'MILK-100',expiry_date:'2029-12-31'}]};
    const route=await functionRoute(),original=s.AuditLog.create;
    s.AuditLog.create=async value=>{if(value.action==='goods_receipt')throw Error('Simulated late receipt failure');return original(value);};
    globalThis.__cashierClient=f.client;globalThis.__cashierTransaction=async fn=>{await db.exec('BEGIN');try{const result=await fn();await db.exec('COMMIT');return result;}catch(e){await db.exec('ROLLBACK');throw e;}};
    const settings=await s.CompanySettings.list();
    const failed=await route(request(body),{params:Promise.resolve({name:'fieldOps'})});assert.equal(failed.status,400);
    assert.equal((await s.GoodsReceipt.list()).length,0);assert.equal((await s.Bill.list()).length,0);assert.equal((await s.JournalEntry.list()).length,0);assert.equal((await s.StockMovement.list()).filter(m=>m.product_id===f.product.id).length,0);assert.deepEqual(await s.CompanySettings.list(),settings);
    s.AuditLog.create=original;
    const success=await route(request(body),{params:Promise.resolve({name:'fieldOps'})});assert.equal(success.status,200);assert.equal((await s.Bill.list()).length,1);
  }finally{delete globalThis.__cashierClient;delete globalThis.__cashierTransaction;await db.close();}
});

test('supplier PO exports escape document content and open an email draft for the selected contact',()=>{
  const order={po_number:'PO-01',supplier_name:'<script>bad()</script>',order_date:date,status:'approved',total:200,notes:'<img src=x onerror=bad()>'},lines=[{product_name:'Milk & flour',quantity:2,unit:'kg',unit_price:100,total:200}];
  const html=purchaseOrderHtml(order,lines);assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('Milk &amp; flour'));
  const email=purchaseOrderEmail({email:'vendor@example.com'},order,lines);assert.ok(email.startsWith('mailto:vendor%40example.com?'));assert.ok(email.includes('PO-01'));assert.ok(!email.includes('\n'));
});

test('supplier amounts owed come from posted, dated supplier AP lines; cached balances and drafts do not become debt',async()=>{
  const f=await setup(),s=f.entities;
  await s.Supplier.update('supplier',{balance:99999});
  const posted=await s.JournalEntry.create({status:'posted',entry_date:date}),draft=await s.JournalEntry.create({status:'draft',entry_date:date}),future=await s.JournalEntry.create({status:'posted',entry_date:'2099-12-31'});
  for(const [id,credit,debit] of [[posted.id,1000,0],[posted.id,0,200],[draft.id,3000,0],[future.id,4000,0],['orphan',5000,0]])await s.JournalLine.create({journal_id:id,account_id:'payable',party_type:'supplier',party_id:'supplier',credit,debit});
  const view=await f.run({action:'supplierWorkspace',supplierId:'supplier'});
  assert.equal(view.supplier.ledger_balance,800);assert.equal(view.supplier.recorded_balance,99999);assert.equal(view.supplier.balance_difference,99199);assert.equal(view.supplier.unpaid_bills,0);
});
