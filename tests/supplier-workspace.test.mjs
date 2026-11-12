import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {fixture,functionRoute,request,user,date} from './helpers/cashier.mjs';
import {supplierAction} from '../src/server/domain/supplier-workspace.js';
import {purchaseWorkspace} from '../src/server/domain/purchase-workspace.js';
import {cashierAction} from '../src/server/domain/cashier-workspace.js';
import {postJournal} from '../src/server/domain/field-ops.js';
import {supplierPayableMismatches} from '../src/server/domain/supplier-payables.js';
import {accountingIntegrity} from '../src/server/domain/accounting-integrity.js';
import {purchaseOrderHtml,purchaseOrderEmail} from '../src/lib/supplier-documents.js';

async function setup(db){
  const f=await fixture(db),s=f.entities;
  await s.Employee.update('cashier',{role:'admin'});
  const inv=await s.Account.create({name:'Materials',account_number:'1310',account_type:'asset',normal_balance:'debit',is_active:true,is_posting:true,balance:0});
  await s.PostingRule.create({rule_key:'supplier_payable',is_active:true,account_id:'payable',account_number:'4010',account_name:'Payable'});
  const prepayment=await s.Account.create({name:'Supplier prepayments',account_number:'4090',account_type:'asset',normal_balance:'debit',is_active:true,is_posting:true,balance:0});
  await s.PostingRule.create({rule_key:'supplier_prepayment',is_active:true,account_id:prepayment.id});
  await s.PostingRule.create({rule_key:'raw_material_inventory',is_active:true,account_id:inv.id,account_number:'1310',account_name:'Materials'});
  const product=await s.Product.create({name:'Milk powder',sku:'MILK',inventory_type:'raw_material',unit_of_measure:'kg',purchase_price:100,inventory_account_id:inv.id,is_active:true,batch_tracking:true,expiry_tracking:true,current_cost:100});
  const warehouse=await s.Warehouse.create({name:'Raw materials',warehouse_type:'raw_material',is_active:true});
  await s.Supplier.update('supplier',{is_active:true,payment_terms_days:30});
  const body={action:'saveSupplierOrder',requestKey:crypto.randomUUID(),status:'confirmed',order:{supplier_id:'supplier',order_date:date,warehouse_id:warehouse.id,payment_terms:'credit',lines:[{product_id:product.id,quantity:10,unit_price:100,tax_rate:10}]}};
  const run=body=>supplierAction(f.client,user,body);
  return {...f,run,product,warehouse,body,inv,prepayment};
}
async function approved(f){return (await f.run(f.body)).order;}
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
  assert.equal(view.supplier.is_active,false);assert.equal(view.supplier.supplier_items[0].unit,'kg');assert.equal(view.accounts.length,3);assert.equal(view.permissions.pay,true);
  await s.Employee.update('cashier',{role:'driver'});
  await assert.rejects(f.run({action:'supplierWorkspace'}),/reserved for administrators/);
  await assert.rejects(f.run(body),/reserved for administrators/);
});

test('orders are single-supplier, server totalled and immediately ready to receive',async()=>{
  const f=await setup(),s=f.entities;
  const first=await f.run(f.body),retry=await f.run(f.body);
  assert.equal(first.order.id,retry.order.id);assert.equal(first.order.total,1100);assert.equal(first.order.tax_total,100);assert.equal((await s.PurchaseOrderLine.list()).length,1);
  await assert.rejects(f.run({...f.body,order:{...f.body.order,notes:'Changed'}}),/already saved/);
  assert.equal(first.order.status,'approved');assert.equal(first.order.purchase_confirmed_by,user.id);
  assert.equal(first.order.approved_by,undefined);
  await assert.rejects(f.run({...f.body,orderId:first.order.id}),/Only a draft/);
  assert.equal((await s.GoodsReceipt.list()).length,0);
});

test('partial receipts create exactly one inventory/AP journal and bill, reject overreceipt, and finish cumulatively',async()=>{
  const f=await setup(),s=f.entities,order=await approved(f),body=receipt(f,order);
  assert.equal((await s.Account.get('payable')).balance,0);
  assert.equal((await s.TreasuryTransaction.list()).length,0);
  const first=await f.run(body),retry=await f.run(body);
  assert.equal(first.receipt.id,retry.receipt.id);assert.equal(first.bill.total,440);assert.equal(first.bill.balance,440);
  const due=new Date(date+'T12:00:00Z');due.setUTCDate(due.getUTCDate()+30);
  assert.equal(first.bill.due_date,due.toISOString().slice(0,10));
  const detail=await purchaseWorkspace(f.client,user,{orderId:order.id});
  assert.deepEqual(detail.orderBills.map(bill=>[bill.id,bill.balance]),[[first.bill.id,440]]);
  assert.deepEqual(detail.orderPayments,[]);
  assert.equal((await s.TreasuryTransaction.list()).length,0);
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

test('admins can pay a received purchase bill once and staff cannot post it',async()=>{
  const f=await setup(),s=f.entities,order=await approved(f),{bill}=await f.run(receipt(f,order));
  const body={action:'recordPurchasePayment',billId:bill.id,accountId:'till',amount:200,date,reference:'Vendor transfer',requestKey:crypto.randomUUID()};
  await s.Employee.update('cashier',{role:'cashier'});
  await assert.rejects(cashierAction(f.client,user,body),{status:403});
  assert.equal((await s.Bill.get(bill.id)).balance,440);
  await s.Employee.update('cashier',{role:'admin'});
  await s.Bill.update(bill.id,{amount_paid:1});
  await assert.rejects(cashierAction(f.client,user,body),/Reconcile the bill total/);
  await s.Bill.update(bill.id,{amount_paid:0});
  const {payment}=await cashierAction(f.client,user,body);
  assert.equal(payment.status,'posted');assert.equal(payment.approved_by,undefined);
  assert.equal((await cashierAction(f.client,user,body)).reused,true);
  assert.equal((await s.Bill.get(bill.id)).balance,240);assert.equal((await s.Bill.get(bill.id)).amount_paid,200);assert.equal((await s.Supplier.get('supplier')).balance,240);
  assert.equal((await s.PaymentAllocation.list()).length,1);assert.equal((await s.TreasuryAccount.get('till')).balance,99800);
  assert.equal((await s.JournalEntry.list()).length,2);
});

test('cash purchase payments apply to received bills without moving cash twice',async()=>{
  const f=await setup(),s=f.entities;
  const {order}=await f.run({...f.body,order:{...f.body.order,payment_terms:'cash'}});
  const before=await purchaseWorkspace(f.client,user,{orderId:order.id});
  assert.equal(before.order.payment_terms,'cash');
  assert.ok(before.accounts.some(account=>account.id==='till'));
  assert.deepEqual(before.orderBills,[]);
  const {payment}=await cashierAction(f.client,user,{action:'recordPurchasePayment',orderId:order.id,accountId:'till',amount:300,date,reference:'Advance',requestKey:crypto.randomUUID()});
  assert.equal((await s.Account.get(f.prepayment.id)).balance,300);assert.equal((await s.Account.get('payable')).balance,0);
  const {bill}=await f.run(receipt(f,order));
  assert.equal(bill.due_date,date);
  assert.equal(bill.balance,140);assert.equal(bill.amount_paid,300);assert.equal((await s.Supplier.get('supplier')).balance,140);
  const after=await purchaseWorkspace(f.client,user,{orderId:order.id});
  assert.deepEqual(after.orderPayments.map(p=>[p.id,p.status,p.amount]),[[payment.id,'posted',300]]);
  assert.equal(after.orderBills[0].balance,140);
  assert.equal((await s.JournalEntry.list()).length,3);assert.equal((await s.TreasuryAccount.get('till')).balance,99700);
  assert.equal((await s.Account.get(f.prepayment.id)).balance,0);assert.equal((await s.Account.get('payable')).balance,140);
  await f.run({action:'registerSupplierBill',orderId:order.id});assert.equal((await s.JournalEntry.list()).length,3);assert.equal((await s.PaymentAllocation.list()).length,1);
});

test('partial supplier payments clear each bill original AP account even when the posting rule changes',async()=>{
  const f=await setup(),s=f.entities,order=await approved(f);
  const other=await s.Account.create({name:'Supplier Payables',account_number:'4000',account_type:'liability',normal_balance:'credit',is_active:true,is_posting:true,balance:0});
  const rule=(await s.PostingRule.filter({rule_key:'supplier_payable'}))[0];
  await s.PostingRule.update(rule.id,{account_id:other.id});
  const first=await f.run(receipt(f,order));assert.equal(first.bill.payable_account_id,other.id);
  await s.PostingRule.update(rule.id,{account_id:'payable'});
  const second=await f.run(receipt(f,order,6));assert.equal(second.bill.payable_account_id,'payable');
  for(const [bill,amount]of [[first.bill,200],[second.bill,660],[first.bill,240]]){
    const body={action:'recordPurchasePayment',billId:bill.id,accountId:'till',amount,date,reference:'Pay original liability',requestKey:crypto.randomUUID()};
    const {payment}=await cashierAction(f.client,user,body);await cashierAction(f.client,user,body);
    const saved=await s.Payment.get(payment.id),lines=await s.JournalLine.filter({journal_id:saved.journal_id});
    assert.equal(lines.find(l=>l.debit>0).account_id,bill.payable_account_id);
  }
  assert.equal((await s.Account.get(other.id)).balance,0);assert.equal((await s.Account.get('payable')).balance,0);
  assert.equal((await s.TreasuryAccount.get('till')).balance,98900);assert.equal((await s.Supplier.get('supplier')).balance,0);
  assert.equal((await s.PaymentAllocation.list()).length,3);assert.equal((await s.JournalEntry.list()).length,5);
});

test('receipt AP evidence is checked before cash moves and changed or reversed originals cannot be paid',async()=>{
  for(const change of ['header','party','account','reversed']){
    const f=await setup(),s=f.entities,order=await approved(f),{bill}=await f.run(receipt(f,order));
    const payment={action:'recordPurchasePayment',billId:bill.id,accountId:'till',amount:200,date,reference:'Vendor payment',requestKey:crypto.randomUUID()};
    if(change==='header')await s.JournalEntry.update(bill.journal_id,{total_credit:441});
    if(change==='reversed')await s.JournalEntry.update(bill.journal_id,{status:'reversed'});
    if(change==='account')await s.Bill.update(bill.id,{payable_account_id:f.prepayment.id});
    if(change==='party'){const line=(await s.JournalLine.filter({journal_id:bill.journal_id,account_id:'payable'}))[0];await s.JournalLine.update(line.id,{party_id:'different-supplier'});}
    await assert.rejects(cashierAction(f.client,user,payment),/Reconcile the original supplier/);
    assert.equal((await s.TreasuryAccount.get('till')).balance,100000);assert.equal((await s.TreasuryTransaction.list()).length,0);
    assert.equal((await s.Bill.get(bill.id)).balance,440);assert.equal((await s.PaymentAllocation.list()).length,0);
  }
});

test('one supplier advance clears the original asset across partial receipts and changed AP mappings exactly once',async()=>{
  const f=await setup(),s=f.entities,order=await approved(f);
  await cashierAction(f.client,user,{action:'recordPurchasePayment',orderId:order.id,accountId:'till',amount:800,date,reference:'Prepayment',requestKey:crypto.randomUUID()});
  const replacement=await s.Account.create({name:'New prepayments',account_number:'4091',account_type:'asset',normal_balance:'debit',is_active:true,balance:0});
  await s.PostingRule.update((await s.PostingRule.filter({rule_key:'supplier_prepayment'}))[0].id,{account_id:replacement.id});
  const body=receipt(f,order),first=await f.run(body);await f.run(body);
  assert.equal(first.bill.balance,0);assert.equal((await s.Account.get(f.prepayment.id)).balance,360);
  const ap=await s.Account.create({name:'Other supplier AP',account_number:'4000',account_type:'liability',normal_balance:'credit',is_active:true,balance:0});
  await s.PostingRule.update((await s.PostingRule.filter({rule_key:'supplier_payable'}))[0].id,{account_id:ap.id});
  const second=await f.run(receipt(f,order,6));await f.run({action:'registerSupplierBill',orderId:order.id});
  assert.equal(second.bill.balance,300);assert.equal((await s.Account.get(ap.id)).balance,300);assert.equal((await s.Account.get('payable')).balance,0);
  assert.equal((await s.Account.get(f.prepayment.id)).balance,0);assert.equal((await s.Account.get(replacement.id)).balance,0);
  assert.equal((await s.TreasuryAccount.get('till')).balance,99200);assert.equal((await s.PaymentAllocation.list()).length,2);assert.equal((await s.JournalEntry.list()).length,5);
  assert.equal((await f.run({action:'supplierWorkspace',supplierId:'supplier'})).supplier.ledger_balance,300);
});

test('a damaged advance source rolls back new receipt stock and accounting at the API transaction boundary',async()=>{
  const db=new PGlite();try{
    const f=await setup(db),s=f.entities,order=await approved(f);
    const {payment}=await cashierAction(f.client,user,{action:'recordPurchasePayment',orderId:order.id,accountId:'till',amount:300,date,reference:'Advance',requestKey:crypto.randomUUID()});
    await s.JournalEntry.update((await s.Payment.get(payment.id)).journal_id,{total_debit:301});
    const before=await s.StockBalance.list(),route=await functionRoute();globalThis.__cashierClient=f.client;
    globalThis.__cashierTransaction=async fn=>{await db.exec('BEGIN');try{const r=await fn();await db.exec('COMMIT');return r;}catch(e){await db.exec('ROLLBACK');throw e;}};
    const body=receipt(f,order);body.lines[0].po_line_id=(await s.PurchaseOrderLine.list())[0].id;
    const response=await route(request(body),{params:Promise.resolve({name:'fieldOps'})});assert.equal(response.status,400);assert.match((await response.json()).error,/Reconcile the original supplier/);
    assert.deepEqual(await s.StockBalance.list(),before);assert.equal((await s.GoodsReceipt.list()).length,0);assert.equal((await s.Bill.list()).length,0);assert.equal((await s.JournalEntry.list()).length,1);assert.equal((await s.PaymentAllocation.list()).length,0);
  }finally{delete globalThis.__cashierClient;delete globalThis.__cashierTransaction;await db.close();}
});

test('supplier payable diagnostic proposes only source-verified historical mismatches without changing records',async()=>{
  const f=await setup(),s=f.entities,order=await approved(f),{bill}=await f.run(receipt(f,order));
  const wrong=await s.Account.create({name:'Other AP',account_number:'4000',account_type:'liability',normal_balance:'credit',is_active:true,balance:0});
  const payment=await s.Payment.create({payment_number:'OLD-PAYMENT',payment_type:'supplier_payment',party_type:'supplier',party_id:bill.supplier_id,po_id:order.id,bill_id:bill.id,treasury_account_id:'till',amount:200,status:'posted'});
  const tx=await s.TreasuryTransaction.create({treasury_account_id:'till',source:'supplier_payment',source_document_id:payment.id,amount:200,transaction_date:date});
  const {journal}=await postJournal({entities:s},{entryDate:date,description:'Legacy payment to wrong AP',sourceModule:'cashier',sourceDocumentType:'TreasuryTransaction',sourceDocumentId:tx.id,userId:user.id,lines:[{account_id:wrong.id,debit:200,party_type:'supplier',party_id:bill.supplier_id},{account_id:'till-gl',credit:200}]});
  await s.TreasuryTransaction.update(tx.id,{journal_id:journal.id});await s.Payment.update(payment.id,{journal_id:journal.id});
  await s.PaymentAllocation.create({payment_id:payment.id,document_type:'bill',document_id:bill.id,party_type:'supplier',party_id:bill.supplier_id,amount:200});
  await s.Bill.update(bill.id,{amount_paid:200,balance:240,status:'partially_paid'});
  await s.Payment.create({payment_number:'ADVANCE',payment_type:'supplier_payment',party_type:'supplier',party_id:bill.supplier_id,po_id:order.id,amount:100,status:'posted'});
  const before=structuredClone(f.rows),result=await supplierPayableMismatches(s);
  assert.equal(result.mismatches.length,1);assert.equal(result.blocked.length,0);assert.equal(result.excluded_advances,1);
  const row=result.mismatches[0];assert.equal(row.payment_id,payment.id);assert.equal(row.payment_journal_id,journal.id);assert.equal(row.receipt_journal_id,bill.journal_id);assert.equal(row.original_payable.id,'payable');assert.equal(row.payment_payable.id,wrong.id);assert.equal(row.review_required,true);
  assert.deepEqual(row.proposed_lines,[{account_id:'payable',debit:200,credit:0},{account_id:wrong.id,debit:0,credit:200}]);
  const integrity=await accountingIntegrity(s,{user:{id:'gm',role:'admin'},role:'admin',employee:null});assert.equal(integrity.counts.supplier_payment_account_mismatch,1);assert.deepEqual(integrity.supplier_payable_mismatches,result);assert.deepEqual(f.rows,before);
  // A plausible account label or balanced source alone never permits a proposal.
  const allocation=(await s.PaymentAllocation.list())[0];await s.PaymentAllocation.update(allocation.id,{amount:201});
  assert.equal((await supplierPayableMismatches(s)).mismatches.length,0);assert.equal((await supplierPayableMismatches(s)).blocked.length,1);
  await s.PaymentAllocation.update(allocation.id,{amount:200});await s.JournalEntry.update(journal.id,{total_debit:201});
  assert.equal((await supplierPayableMismatches(s)).mismatches.length,0);assert.equal((await supplierPayableMismatches(s)).blocked.length,1);
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
