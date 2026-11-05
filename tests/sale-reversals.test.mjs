import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {fixture,functionRoute,request,date} from './helpers/cashier.mjs';
import {invoiceAction} from '../src/server/domain/sales-invoices.js';
import {saleReversalAction} from '../src/server/domain/sale-reversals.js';
import {approveReceipt} from '../src/server/domain/customer-receipts.js';
import {postJournal,stockIssue} from '../src/server/domain/field-ops.js';
import {invoiceDefaults} from '../src/lib/invoice-documents.js';
import {companySalesRegister} from '../src/lib/company-sales.js';
import {commercialReport} from '../src/server/domain/commercial-rules.js';
import {dailySupplySummary} from '../src/lib/commercial-daily.js';
import {commercialSnapshot} from '../src/lib/employee-dashboard.js';
import {companySalesAction} from '../src/server/domain/company-sales.js';

const gm={id:'gm',role:'admin',full_name:'GM'};
async function setup(db,{cash=false}={}){
 const f=await fixture(db),s=f.entities;f.client.auth.me=async()=>gm;
 for(const entity of Object.values(s)){
  const filter=entity.filter;
  entity.filter=async(q,options,limit,skip)=>{if(!options||typeof options!=='object')return filter(q,options,limit,skip);return {items:await filter(q,options.sort,options.limit,Number(options.cursor||options.skip||0)),has_more:false};};
  entity.updateMany=async(q,v)=>{for(const row of await filter(q))await entity.update(row.id,v.$set||v);};
 }
 await s.CompanySettings.update('settings',{company_name:'SOEICAM',next_invoice_number:1});
 await s.StockBalance.update('stock',{warehouse_id:'factory'});
 const order=await s.SalesOrder.create({order_number:'SO-1',customer_id:'customer-a',customer_name:'Customer A',warehouse_id:'factory',order_date:date,payment_type:cash?'cash':'credit',status:'draft',subtotal:1000,tax_total:0,total:1000,sales_supply_recorded_by:'seller-user'});
 await s.SalesOrderLine.create({order_id:order.id,product_id:'product-a',product_name:'YOLA',quantity:2,unit:'ea',unit_price:500,tax_rate:0,tax_amount:0,total:1000});
 const document=await invoiceAction(f.client,gm,{action:'createSalesInvoice',sourceType:'order',sourceId:order.id,invoiceDate:date,dueDate:date,options:invoiceDefaults({business_name:'Customer A'})});
 const input={invoiceId:document.invoice.id};
 return {...f,s,order,document,input,preview:()=>saleReversalAction(f.client,gm,{action:'previewSaleReversal',...input}),reverse:async(patch={})=>saleReversalAction(f.client,gm,{action:'reverseSale',...input,reviewToken:(await saleReversalAction(f.client,gm,{action:'previewSaleReversal',...input})).reviewToken,reason:'Incorrect sale during audit',stockDisposition:'retain_stock',confirmed:true,...patch})};
}
async function receipt(f,amount){const inv=await f.s.Invoice.get(f.document.invoice.id);const payment=await f.s.Payment.create({payment_number:'RCP-1',payment_type:'customer_payment',party_id:'customer-a',party_name:'Customer A',payment_date:date,amount,status:'pending_approval',cashier_confirmed_by:gm.id,treasury_account_id:'till',allocated_to_invoices:inv.id,invoice_numbers:inv.invoice_number,receipt_allocations:[{invoice_id:inv.id,amount}],receipt_posting_token:''});await approveReceipt(f.client.asServiceRole,payment,gm,{topAdmin:true});return payment;}

test('unpaid sale reversal cancels the debt while retaining original stock and costs when goods have not returned',async()=>{
 const f=await setup(),p=await f.preview();assert.equal(p.unpaid_cancelled,1000);assert.equal(p.customer_credit,0);
 const result=await f.reverse();assert.equal(result.reversal.total,1000);
 assert.equal((await f.s.Customer.get('customer-a')).balance,0);assert.equal((await f.s.Invoice.get(f.input.invoiceId)).status,'credited');
 assert.equal((await f.s.StockBalance.get('stock')).quantity,8);assert.equal((await f.s.Account.get('cogs')).balance,400);assert.equal((await f.s.Account.get('revenue')).balance,0);
 assert.equal((await f.s.JournalEntry.list()).length,2);assert.ok((await f.s.JournalEntry.get(f.document.invoice.journal_id|| (await f.s.Invoice.get(f.input.invoiceId)).journal_id)).reversed_by_journal);
 const data=await invoiceAction(f.client,gm,{action:'invoiceDetail',invoiceId:f.input.invoiceId});assert.equal(data.invoice.sale_reversal.total,1000);
 const again=await invoiceAction(f.client,gm,{action:'createSalesInvoice',sourceType:'order',sourceId:f.order.id,invoiceDate:date,dueDate:date,options:invoiceDefaults({business_name:'Customer A'})});assert.equal(again.invoice.status,'credited');assert.equal((await f.s.Invoice.list()).length,1);
});

test('returned goods restore exact carrying value in quarantine and retries cannot duplicate credit, stock or journals',async()=>{
 const f=await setup(),p=await f.preview(),body={action:'reverseSale',...f.input,reviewToken:p.reviewToken,reason:'Customer returned all goods',stockDisposition:'return_stock',warehouseId:'factory',confirmed:true};
 const first=await saleReversalAction(f.client,gm,body),again=await saleReversalAction(f.client,gm,body);assert.equal(again.reused,true);assert.equal(again.reversal.journal_id,first.reversal.journal_id);
 const restored=(await f.s.StockBalance.list()).filter(s=>s.stock_origin==='sale_reversal');assert.equal(restored.length,1);assert.equal(restored[0].quantity,2);assert.equal(restored[0].total_value,400);assert.equal(restored[0].qc_status,'pending');assert.equal(restored[0].lot_number,'LOT');
 assert.equal((await f.s.StockBalance.get('stock')).quantity,8);assert.equal((await f.s.Account.get('cogs')).balance,0);assert.equal((await f.s.StockMovement.list()).length,2);
 await assert.rejects(saleReversalAction(f.client,gm,{...body,reason:'Changed reason'}),/different details/);
});

test('partly paid credit sale creates customer credit without refunding cash or editing the original receipt',async()=>{
 const f=await setup(),payment=await receipt(f,400),before=await f.s.Payment.get(payment.id);const p=await f.preview();assert.equal(p.customer_credit,400);assert.equal(p.unpaid_cancelled,600);
 await f.reverse();assert.equal((await f.s.Customer.get('customer-a')).balance,-400);assert.equal((await f.s.Account.get('receivable')).balance,-400);
 assert.equal((await f.s.TreasuryAccount.get('till')).balance,100400);assert.deepEqual(await f.s.Payment.get(payment.id),before);assert.equal((await f.s.PaymentAllocation.list()).length,1);
});

test('cash invoice must be deposited first, then cash remains in company funds and cash-in-transit stays cleared',async()=>{
 const f=await setup(undefined,{cash:true});await assert.rejects(f.preview(),/Deposit and approve/);await receipt(f,1000);
 assert.equal((await f.s.Account.get('clearing')).balance,0);await f.reverse();assert.equal((await f.s.Account.get('clearing')).balance,0);assert.equal((await f.s.Account.get('receivable')).balance,-1000);assert.equal((await f.s.Customer.get('customer-a')).balance,-1000);assert.equal((await f.s.TreasuryAccount.get('till')).balance,101000);
});

test('pending receipts, stale review, closed periods, missing stock evidence and another user block unsafe reversals',async()=>{
 const f=await setup(),p=await f.preview();await f.s.Customer.update('customer-a',{balance:1100});
 await assert.rejects(f.reverse({reviewToken:p.reviewToken}),/changed/);
 const pending=await f.s.Payment.create({payment_type:'customer_payment',party_id:'customer-a',status:'pending_approval',receipt_allocations:[{invoice_id:f.input.invoiceId,amount:100}]});await assert.rejects(f.preview(),/pending receipt/);await f.s.Payment.update(pending.id,{status:'rejected'});
 await f.s.AccountingPeriod.update('period',{status:'closed'});await assert.rejects(f.preview(),/closed or locked/);await f.s.AccountingPeriod.update('period',{status:'open'});
 await f.s.StockMovement.deleteMany({document_id:f.order.id});assert.equal((await f.preview()).can_restore_stock,false);await assert.rejects(f.reverse({stockDisposition:'return_stock',warehouseId:'factory'}),/stock issue layers/);
 const actor={id:'other-user',role:'user'};f.client.auth.staff=async()=>({id:'other-employee',user_id:actor.id,role:'employee',status:'active'});await assert.rejects(saleReversalAction(f.client,actor,{action:'previewSaleReversal',...f.input}),/only your own/);
 assert.equal((await f.s.JournalEntry.list()).length,1);
});

test('the sale author can reverse their own sale without selecting a different salesperson or requiring GM impersonation',async()=>{
 const f=await setup(),actor={id:'seller-user',role:'user'};f.client.auth.staff=async()=>({id:'seller',user_id:actor.id,role:'employee',status:'active'});
 const p=await saleReversalAction(f.client,actor,{action:'previewSaleReversal',...f.input});const result=await saleReversalAction(f.client,actor,{action:'reverseSale',...f.input,reviewToken:p.reviewToken,reason:'Duplicate entry',stockDisposition:'retain_stock',confirmed:true});assert.equal(result.reversal.reversed_by,actor.id);
});

test('reversal reports retain the historical sale and recognize a negative correction on its own date',async()=>{
 const f=await setup(),past=new Date(Date.parse(date+'T12:00:00Z')-86400000).toISOString().slice(0,10);await f.s.Invoice.update(f.input.invoiceId,{invoice_date:past});await f.reverse();
 const invoices=await f.s.Invoice.list();assert.equal(companySalesRegister({invoices,from:past,to:past}).totals.sales,1000);assert.equal(companySalesRegister({invoices,from:date,to:date}).totals.sales,-1000);assert.equal(companySalesRegister({invoices,from:past,to:date}).totals.sales,0);
 const report=await companySalesAction(f.client,gm,{from:date,to:date});assert.equal(report.totals.sales,-1000);assert.equal(report.rows[0].is_reversal,true);
});

test('field sale reversal keeps paid cash custody history, cancels credit and cannot be invoiced again',async()=>{
 const f=await setup(),s=f.s;
 const field=await s.FieldSale.create({sale_number:'FS-1',customer_id:'customer-a',customer_name:'Customer A',commercial_id:'agent',recorded_by:'agent-login',transaction_date:date,status:'approved_posted',payment_type:'cash',subtotal:1000,tax_total:0,total:1000,amount_collected:400,amount_due:600});
 await stockIssue(f.client.asServiceRole,{productId:'product-a',productName:'YOLA',warehouseId:'factory',quantity:2,documentType:'FieldSale',documentId:field.id,movementType:'customer_delivery'});
 await s.FieldSaleLine.create({field_sale_id:field.id,product_id:'product-a',product_name:'YOLA',quantity:2,unit:'ea',unit_price:500,line_total:1000,line_cost:400});
 const {journal}=await postJournal(f.client.asServiceRole,{entryDate:date,sourceModule:'field_sales',sourceDocumentType:'FieldSale',sourceDocumentId:field.id,userId:'agent-login',description:'Field sale',lines:[{account_id:'clearing',debit:400,credit:0},{account_id:'receivable',debit:600,credit:0},{account_id:'revenue',debit:0,credit:1000,description:'Sales revenue'},{account_id:'cogs',debit:400,credit:0,description:'Cost of goods sold'},{account_id:'inventory',debit:0,credit:400,description:'Inventory released'}]});await s.FieldSale.update(field.id,{journal_id:journal.id});await s.Customer.update('customer-a',{balance:1600});
 const input={fieldSaleId:field.id};await assert.rejects(saleReversalAction(f.client,gm,{action:'previewSaleReversal',...input}),/handover/);
 await s.CashCollection.create({field_sale_id:field.id,amount_collected:400,received_amount:400,outstanding_amount:0,status:'received'});
 const preview=await saleReversalAction(f.client,gm,{action:'previewSaleReversal',...input});await saleReversalAction(f.client,gm,{action:'reverseSale',...input,reviewToken:preview.reviewToken,reason:'Duplicate field supply',stockDisposition:'retain_stock',confirmed:true});
 assert.equal((await s.Customer.get('customer-a')).balance,600);assert.equal((await s.FieldSale.get(field.id)).amount_due,0);assert.equal((await s.CashCollection.filter({field_sale_id:field.id})).length,1);
 await assert.rejects(invoiceAction(f.client,gm,{action:'createSalesInvoice',sourceType:'field',sourceId:field.id,invoiceDate:date,dueDate:date,options:invoiceDefaults({business_name:'Customer A'})}),/reversed/);
 const report=companySalesRegister({fieldSales:await s.FieldSale.list(),from:date,to:date});assert.equal(report.totals.sales,0);
});

test('a late reversal failure rolls back stock, ledger, customer credit and documents in the actual API transaction',async()=>{
 const db=new PGlite();try{const f=await setup(db),p=await f.preview(),route=await functionRoute(),before=(await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows;
 const create=f.s.AuditLog.create;f.s.AuditLog.create=async row=>{if(row.action==='reverse_sale')throw Error('Simulated late audit failure');return create(row);};
 globalThis.__cashierClient=f.client;globalThis.__cashierTransaction=async fn=>{await db.exec('BEGIN');try{const result=await fn();await db.exec('COMMIT');return result;}catch(e){await db.exec('ROLLBACK');throw e;}};
 const body={action:'reverseSale',...f.input,reviewToken:p.reviewToken,reason:'Wrong product sale',stockDisposition:'return_stock',warehouseId:'factory',confirmed:true};
 const failed=await route(request(body),{params:Promise.resolve({name:'fieldOps'})});assert.equal(failed.status,400);assert.match((await failed.json()).error,/Simulated/);assert.deepEqual((await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows,before);
 f.s.AuditLog.create=create;const ok=await route(request(body),{params:Promise.resolve({name:'fieldOps'})});assert.equal(ok.status,200,JSON.stringify(await ok.json()));assert.equal((await f.s.StockMovement.list()).length,2);
 }finally{delete globalThis.__cashierClient;delete globalThis.__cashierTransaction;await db.close();}
});

test('Commercial sales, product quantities and commission estimates recognize corrections on the reversal date',()=>{
 const past='2026-10-01',correction='2026-11-05',sale={id:'s',sale_number:'FS',commercial_id:'agent',customer_id:'customer',customer_name:'Customer',status:'approved_posted',transaction_date:past,total:1000,subtotal:1000,amount_collected:0,amount_due:0,payment_type:'credit',sale_reversal:{date:correction,journal_id:'reverse',total:1000}};
 const input={agents:[{id:'agent'}],customers:[{id:'customer'}],sales:[sale],lines:[{field_sale_id:'s',product_id:'p',quantity:2,unit:'ea'}],from:correction,to:correction};
 const report=commercialReport(input);assert.equal(report.agents[0].total,-1000);assert.equal(report.supplies[0].products[0].quantity,-2);assert.equal(report.agents[0].deliveries,0);
 assert.equal(commercialReport({...input,from:past,to:past}).agents[0].total,1000);
 assert.equal(dailySupplySummary([sale],correction).approved,-1000);assert.equal(dailySupplySummary([sale],correction).credit,-1000);
 const dashboard=commercialSnapshot({sales:[sale],customers:[{id:'customer'}],date:correction,monthStart:'2026-11-01'});assert.equal(dashboard.month,-1000);assert.equal(dashboard.commission.eligibleNet,-1000);
});

test('the sales report flags missing reversal journals instead of accepting an unproven negative sale',async()=>{
 const f=await setup(),result=await f.reverse();await f.s.JournalEntry.deleteMany({id:result.reversal.journal_id});const report=await companySalesAction(f.client,gm,{from:date,to:date});assert.equal(report.unverified_documents,1);assert.equal(report.rows.length,0);
});
