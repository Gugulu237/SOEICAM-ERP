import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { fixture,functionRoute,request,date } from './helpers/cashier.mjs';
import { matches } from './helpers/commercial-supply.mjs';
import { invoiceAction } from '../src/server/domain/sales-invoices.js';
import { invoiceDefaults,invoiceHtml,invoiceText,invoiceEmail,invoiceCompany,cleanInvoiceOptions } from '../src/lib/invoice-documents.js';
import { companySalesRegister,salesOverview,salesChartBuckets } from '../src/lib/company-sales.js';
import { approveReceipt } from '../src/server/domain/customer-receipts.js';
import { guardMutation } from '../src/server/access.js';
import { companySalesAction } from '../src/server/domain/company-sales.js';

const admin={id:'gm',role:'admin',full_name:'General Manager'};
async function setup(db){const f=await fixture(db);f.client.auth.me=async()=>admin;await f.entities.CompanySettings.update('settings',{company_name:'SOEICAM',tax_id:'VERIFIED-TAX',registration_number:'VERIFIED-REG',next_invoice_number:1});await f.entities.StockBalance.update('stock',{warehouse_id:'factory'});return f;}
async function order(f,{cash=false}={}){const o=await f.entities.SalesOrder.create({order_number:'SO-1',customer_id:'customer-a',customer_name:'Customer A',warehouse_id:'factory',order_date:date,payment_type:cash?'cash':'credit',status:'draft',subtotal:1000,tax_total:0,total:1000});await f.entities.SalesOrderLine.create({order_id:o.id,product_id:'product-a',product_name:'YOLA',quantity:2,unit:'ea',unit_price:500,unit_cost:9999,tax_rate:0,tax_amount:0,total:1000});return o;}
async function field(f){const s=await f.entities.FieldSale.create({sale_number:'FS-1',customer_id:'customer-a',customer_name:'Customer A',transaction_date:date,status:'approved_posted',subtotal:1000,tax_total:0,total:1000,amount_collected:400,amount_due:600,payment_type:'cash',due_date:date,receipt_file_uris:['private/proof']});const journal=await f.entities.JournalEntry.create({status:'posted',source_document_id:s.id,source_document_type:'FieldSale',entry_date:date});await f.entities.FieldSale.update(s.id,{journal_id:journal.id});await f.entities.FieldSaleLine.create({field_sale_id:s.id,product_id:'product-a',product_name:'YOLA',quantity:2,unit:'ea',unit_price:500,line_total:1000,tax_amount:0,line_cost:400});await f.entities.Customer.update('customer-a',{balance:600});return await f.entities.FieldSale.get(s.id);}
const body=(source,type='order')=>({action:'createSalesInvoice',sourceType:type,sourceId:source.id,invoiceDate:date,dueDate:date,options:invoiceDefaults({business_name:'Customer A',email:'accounts@example.test'})});

test('warehouse invoice posts once using real FEFO cost, preserves quantities and client terms, and retries without another stock issue',async()=>{
  const f=await setup(),o=await order(f),b=body(o);b.options.terms='30 days by agreement';b.saveCustomerDefaults=true;
  const doc=await invoiceAction(f.client,admin,b);
  assert.equal(doc.invoice.total,1000);assert.equal(doc.invoice.customer_balance,1000);assert.equal(doc.lines[0].quantity,2);
  assert.equal(doc.invoice.subtotal,838.57);assert.equal(doc.invoice.tax_total,161.43);
  assert.equal(doc.invoice.price_includes_vat,true);assert.equal(doc.lines[0].tax_rate,19.25);
  assert.equal((await f.entities.InvoiceLine.list())[0].cogs_total,400,'actual stock cost, not stale order estimate');
  assert.equal((await f.entities.StockBalance.get('stock')).quantity,8);assert.equal((await f.entities.Customer.get('customer-a')).balance,1000);
  assert.equal((await f.entities.Customer.get('customer-a')).invoice_defaults.terms,'30 days by agreement');
  assert.equal((await f.entities.SalesOrder.get(o.id)).status,'invoiced');
  assert.equal((await f.entities.JournalEntry.list()).length,1);assert.equal((await f.entities.StockMovement.list()).length,1);
  const again=await invoiceAction(f.client,admin,b);assert.equal(again.reused,true);assert.equal(again.invoice.id,doc.invoice.id);assert.equal((await f.entities.JournalEntry.list()).length,1);assert.equal((await f.entities.InvoiceLine.list()).length,1);
});

test('a saved tax-exclusive quote keeps the original unit price and gross while preview and invoice extract current VAT',async()=>{
  const f=await setup(),s=f.entities,orderRecord=await order(f),[line]=await s.SalesOrderLine.list();
  await s.SalesOrder.update(orderRecord.id,{subtotal:1000,tax_total:50,total:1050,price_includes_vat:false});
  await s.SalesOrderLine.update(line.id,{tax_rate:5,tax_amount:50,total:1050,price_includes_vat:false});
  const originalLine=await s.SalesOrderLine.get(line.id);
  const preview=await invoiceAction(f.client,admin,{action:'invoiceSource',sourceType:'order',sourceId:orderRecord.id});
  const result=await invoiceAction(f.client,admin,body(orderRecord));
  assert.equal(preview.source.total,1050);assert.equal(preview.source.tax_total,169.5);assert.equal(preview.source.subtotal,880.5);
  assert.equal(result.invoice.total,preview.source.total);assert.equal(result.invoice.subtotal,preview.source.subtotal);assert.equal(result.invoice.tax_total,preview.source.tax_total);
  for(const saved of [preview.lines[0],result.lines[0]]){
    assert.equal(saved.tax_rate,19.25);assert.equal(saved.tax_amount,169.5);assert.equal(saved.unit_price,500);
    assert.equal(saved.price_includes_vat,false);assert.equal(saved.total,1050);
  }
  assert.equal(result.invoice.price_includes_vat,false);
  assert.deepEqual(await s.SalesOrderLine.get(line.id),originalLine);
  assert.equal((await s.SalesOrder.get(orderRecord.id)).tax_total,50);
  assert.equal((await s.Account.get('tax')).balance,169.5);
  assert.equal((await s.Account.get('revenue')).balance,880.5);
  assert.equal((await s.Customer.get('customer-a')).balance,1050);
  assert.equal((await s.StockMovement.list()).length,1);
});

test('Commercial invoice reuses the source accounting and counts once in sales, including mixed cash and credit',async()=>{
  const f=await setup(),sale=await field(f),doc=await invoiceAction(f.client,admin,body(sale,'field'));
  assert.equal(doc.invoice.field_sale_id,sale.id);assert.equal(doc.invoice.customer_paid,400);assert.equal(doc.invoice.customer_balance,600);
  assert.equal(doc.invoice.tax_total,0);assert.equal(doc.lines[0].tax_rate,undefined);
  assert.equal((await f.entities.JournalEntry.list()).length,1);assert.equal((await f.entities.StockMovement.list()).length,0);assert.equal((await f.entities.Customer.get('customer-a')).balance,600);
  const input={invoices:await f.entities.Invoice.list(),fieldSales:await f.entities.FieldSale.list(),from:date,to:date,today:date};
  assert.equal(companySalesRegister(input).totals.sales,1000);assert.equal(companySalesRegister(input).rows.length,1);
  const overview=salesOverview(input);assert.equal(overview.cash_sales,400);assert.equal(overview.credit_sales,600);assert.equal(overview.pending_amount,600);assert.equal(overview.pending.length,1);assert.equal(overview.pending[0].invoice_id,doc.invoice.id);
});

test('delayed decentralized invoices preserve the original archived delivery branch or outlet without redirecting it',async()=>{
  for(const kind of ['Customer','CustomerLocation']){
    const f=await setup(),s=f.entities,sale=await field(f);
    await s.Customer.update('customer-a',{financial_centralization_mode:'decentralized'});
    const point=await s[kind].create(kind==='Customer'?{business_name:'Original branch',parent_id:'customer-a',address:'Original entrance',is_active:true}:{name:'Original outlet',customer_id:'customer-a',address:'Original entrance',is_active:true});
    await s.FieldSale.update(sale.id,{location_id:point.id,location_name:'Name at delivery'});
    await s[kind].update(point.id,{is_active:false,customer_removed_at:new Date().toISOString(),...(kind==='Customer'?{business_name:'Renamed branch'}:{name:'Renamed outlet'})});
    await s.CustomerLocation.create({customer_id:'customer-a',name:'Different active outlet',address:'New entrance',is_active:true});
    const preview=await invoiceAction(f.client,admin,{action:'invoiceSource',sourceType:'field',sourceId:sale.id});assert.equal(preview.options.bill_to_address,'Original entrance');
    const doc=await invoiceAction(f.client,admin,body(sale,'field')),invoice=await s.Invoice.get(doc.invoice.id);
    assert.equal(invoice.location_id,point.id);assert.equal(invoice.bill_to_location_id,point.id);assert.equal(invoice.bill_to_location_name,'Name at delivery');
    assert.equal((await s.JournalEntry.list()).length,1);assert.equal((await s.StockMovement.list()).length,0);assert.equal((await s.Customer.get('customer-a')).balance,600);
    assert.equal((await invoiceAction(f.client,admin,body(sale,'field'))).reused,true);
  }
});

test('historical invoice destinations must still belong to the source customer and never default to another outlet',async()=>{
  for(const kind of ['Customer','CustomerLocation']){
    const f=await setup(),s=f.entities,sale=await field(f);
    await s.Customer.update('customer-a',{financial_centralization_mode:'decentralized',address:'Customer address'});
    const foreign=await s[kind].create(kind==='Customer'?{business_name:'Foreign branch',parent_id:'customer-b',address:'Foreign address',is_active:false}:{name:'Foreign outlet',customer_id:'customer-b',address:'Foreign address',is_active:false});
    await s.FieldSale.update(sale.id,{location_id:foreign.id,location_name:'Unverified destination'});
    await s.CustomerLocation.create({customer_id:'customer-a',name:'Other active outlet',address:'Another address',is_active:true});
    const preview=await invoiceAction(f.client,admin,{action:'invoiceSource',sourceType:'field',sourceId:sale.id});assert.equal(preview.options.bill_to_address,'Customer address');
    const doc=await invoiceAction(f.client,admin,body(sale,'field')),invoice=await s.Invoice.get(doc.invoice.id);assert.equal(invoice.bill_to_location_id,'');assert.equal(invoice.bill_to_location_name,'');
  }
});

test('cash invoices post straight to cash in hand and are settled once',async()=>{
  const f=await setup(),s=f.entities,o=await order(f,{cash:true}),doc=await invoiceAction(f.client,admin,body(o));
  const invoice=await s.Invoice.get(doc.invoice.id);
  assert.equal(doc.invoice.customer_balance,0);assert.equal(doc.invoice.customer_paid,1000);assert.equal((await s.Customer.get('customer-a')).balance,0);
  assert.equal(invoice.status,'paid');assert.equal(invoice.balance,0);assert.equal(invoice.amount_paid,1000);assert.equal(invoice.cash_deposited,true);
  const lines=await s.JournalLine.list();assert.equal(lines.find(l=>l.account_id==='till-gl').debit,1000);
  assert.ok(!lines.some(l=>l.account_id==='clearing'));assert.equal((await s.TreasuryAccount.get('till')).balance,101000);
  const [movement]=await s.TreasuryTransaction.list();assert.equal(movement.source,'cash_sale');assert.equal(movement.source_document_id,invoice.id);assert.equal(movement.journal_id,invoice.journal_id);
  assert.equal((await s.Payment.list()).length,0);assert.equal((await s.CashCollection.list()).length,1);
  assert.equal((await invoiceAction(f.client,admin,body(o))).reused,true);
  assert.equal((await s.TreasuryTransaction.list()).length,1);
  await assert.rejects(invoiceAction(f.client,admin,{...body(o),treasuryAccountId:'bank'}),/already issued/);
  const overview=salesOverview({invoices:await s.Invoice.list(),from:date,to:date,today:date});assert.equal(overview.pending_count,0);assert.equal(overview.cash_sales,1000);
});

test('sales staff can deposit a cash sale to a bank without seeing bank balances',async()=>{
  const f=await setup(),s=f.entities,o=await order(f,{cash:true}),employee={id:'cashier-login',role:'user'};
  await s.Employee.update('cashier',{role:'employee'});
  const preview={action:'invoiceSource',sourceType:'order',sourceId:o.id};
  const bank=(await invoiceAction(f.client,employee,preview)).cashAccounts.find(a=>a.id==='bank');
  assert.deepEqual(Object.keys(bank).sort(),['account_type','id','name']);
  await assert.rejects(invoiceAction(f.client,employee,{...body(o),treasuryAccountId:'unknown'}),/active treasury deposit account/);
  const {invoice}=await invoiceAction(f.client,employee,{...body(o),treasuryAccountId:'bank'});
  const saved=await s.Invoice.get(invoice.id);
  assert.equal(saved.deposit_treasury_account_id,'bank');
  assert.equal((await s.TreasuryAccount.get('bank')).balance,101000);
  assert.equal((await s.TreasuryAccount.get('till')).balance,100000);
});

test('supply invoice preserves the saved line discount and tax instead of recomputing a different sale',async()=>{
  const f=await setup(),sale=await field(f),line=(await f.entities.FieldSaleLine.list())[0];
  await f.entities.FieldSaleLine.update(line.id,{quantity:2,unit_price:500,line_total:900,tax_amount:173.25,discount:10});await f.entities.FieldSale.update(sale.id,{subtotal:900,tax_total:173.25,total:1073.25,amount_due:673.25});
  const doc=await invoiceAction(f.client,admin,body(sale,'field'));assert.equal(doc.lines[0].discount_amount,100);assert.equal(doc.lines[0].tax_amount,173.25);assert.equal(doc.lines[0].total,1073.25);assert.equal(doc.invoice.customer_balance,673.25);
});

test('customization saves a letterhead snapshot and client defaults, rejects stale edits and leaves accounting immutable',async()=>{
  const f=await setup(),sale=await field(f),doc=await invoiceAction(f.client,admin,body(sale,'field'));
  await f.entities.CompanySettings.update('settings',{company_name:'Changed later'});
  const changed=await invoiceAction(f.client,admin,{action:'customizeSalesInvoice',invoiceId:doc.invoice.id,revision:doc.revision,dueDate:date,options:{...doc.options,terms:'Client-specific terms',reference:'CLIENT-PO'},saveCustomerDefaults:true,total:1});
  assert.equal(changed.company.company_name,'SOEICAM');assert.equal(changed.invoice.total,1000);assert.equal(changed.options.reference,'CLIENT-PO');assert.equal((await f.entities.Customer.get('customer-a')).invoice_defaults.terms,'Client-specific terms');
  await assert.rejects(invoiceAction(f.client,admin,{action:'customizeSalesInvoice',invoiceId:doc.invoice.id,revision:doc.revision,dueDate:date,options:doc.options}),/another window/);
  assert.equal((await f.entities.JournalEntry.list()).length,1);assert.equal((await f.entities.StockMovement.list()).length,0);
});

test('stock shortages, issued historical orders, vehicle stock, malformed totals and missing source journals block invoice issuance',async()=>{
  for(const scenario of ['short','delivered','vehicle','bad-total','unit']){
    const f=await setup(),o=await order(f);
    if(scenario==='short')await f.entities.StockBalance.update('stock',{quantity:1});
    if(scenario==='delivered')await f.entities.StockMovement.create({document_id:o.id,status:'approved',quantity:2,source_warehouse_id:'factory'});
    if(scenario==='vehicle')await f.entities.SalesOrder.update(o.id,{warehouse_id:'van-stock'});
    if(scenario==='bad-total')await f.entities.SalesOrder.update(o.id,{total:999});
    if(scenario==='unit')await f.entities.SalesOrderLine.update((await f.entities.SalesOrderLine.list())[0].id,{unit:'cartons'});
    await assert.rejects(invoiceAction(f.client,admin,body(o)),/stock|issued|warehouse|totals|unit of measure/i);
  }
  const f=await setup(),s=await field(f);await f.entities.FieldSale.update(s.id,{journal_id:'missing'});await assert.rejects(invoiceAction(f.client,admin,body(s,'field')),/posted journal/);
});

test('invoice operations enforce role and active staff permissions before reading company records; General Manager alone changes letterhead',async()=>{
  const f=await setup();for(const role of ['production_manager','commercial','driver','hotesse','warehouse_manager']){await f.entities.Employee.update('cashier',{role});await assert.rejects(invoiceAction(f.client,{id:'cashier-login',role:'user'},{action:'invoiceWorkspace'}),/restricted/);}
  await f.entities.Employee.update('cashier',{role:'employee',status:'active'});const employee={id:'cashier-login',role:'user'};assert.ok(await invoiceAction(f.client,employee,{action:'invoiceWorkspace'}));
  await assert.rejects(invoiceAction(f.client,employee,{action:'saveInvoiceCompany',company:invoiceCompany({company_name:'Tampered'})}),/restricted/);
  await f.entities.Employee.update('cashier',{status:'inactive'});await assert.rejects(invoiceAction(f.client,employee,{action:'invoiceWorkspace'}),/active/);
  const before=await f.entities.CompanySettings.get('settings');await invoiceAction(f.client,admin,{action:'saveInvoiceCompany',company:{...invoiceCompany(before),registration_number:'Verified registration'},next_invoice_number:999});assert.equal((await f.entities.CompanySettings.get('settings')).next_invoice_number,1);
});

test('invoice documents escape client terms, use verified legal details and omit unsafe logo protocols',()=>{
  const options=invoiceDefaults({business_name:'<script>attack</script>',email:'billing@example.test'});options.terms='<img src=x onerror=alert(1)> & credit';
  const doc={invoice:{invoice_number:'INV-1',invoice_date:date,due_date:date,total:1192.5,subtotal:1000,tax_total:192.5,customer_balance:1192.5},lines:[{product_name:'Product & more',quantity:2,unit:'ea',unit_price:500,tax_amount:192.5,total:1192.5}],company:invoiceCompany({company_name:'SOEICAM',tax_id:'TEST-TAX',registration_number:'TEST-REG',logo_url:'javascript:alert(1)'}),options};
  const html=invoiceHtml(doc);assert.ok(html.includes('TEST-TAX')&&html.includes('TEST-REG'));assert.ok(html.includes('&lt;script&gt;')&&html.includes('&lt;img'));assert.ok(!html.includes('javascript:')&&!html.includes('<script>'));
  assert.match(html,/@page\{size:A4/);assert.match(html,/thead\{display:table-header-group/);assert.match(invoiceText(doc),/Tax: 192.5 XAF/);assert.match(invoiceEmail(doc),/^mailto:billing%40example.test\?subject=/);
  assert.throws(()=>cleanInvoiceOptions({...options,contact_email:'bad\nBcc:attacker@example.test'}),/email/);
});

test('sales series includes empty days, groups weeks / months and excludes cash deposits, cancelled and linked duplicate invoices',()=>{
  const base={id:'i',invoice_number:'INV',invoice_date:'2026-10-02',due_date:'2026-10-01',journal_id:'j',status:'posted',payment_type:'credit',total:1000,subtotal:1000,tax_total:0,balance:400,amount_paid:600};
  const summary=salesOverview({invoices:[base,{...base,id:'cancelled',status:'cancelled'},{...base,id:'draft',status:'draft'}],from:'2026-10-01',to:'2026-10-03',today:'2026-10-18'});
  assert.deepEqual(summary.daily.map(d=>d.total),[0,1000,0]);assert.equal(summary.cash_sales,0);assert.equal(summary.credit_sales,1000);assert.equal(summary.overdue_amount,400);assert.equal(summary.pending_count,1);
  assert.deepEqual(salesChartBuckets(summary.daily,'week').map(r=>r.total),[1000]);assert.equal(salesChartBuckets(summary.daily,'month')[0].count,1);
});

test('company overview verifies posted journal sources and flags orphan or draft accounting instead of inflating totals',async()=>{
  const f=await setup(),sale=await field(f);await invoiceAction(f.client,admin,body(sale,'field'));
  await f.entities.Invoice.create({invoice_number:'BROKEN',invoice_date:date,status:'posted',payment_type:'credit',total:9000,balance:9000,journal_id:'orphan'});
  const result=await companySalesAction(f.client,admin,{from:date,to:date});assert.equal(result.totals.sales,1000);assert.equal(result.overview.pending_amount,600);assert.equal(result.unverified_documents,1);
});

test('generic invoice edits and invoiced order changes cannot bypass checked financial workflows, including for admin',()=>{
  const ctx={user:admin};for(const entity of ['Invoice','InvoiceLine'])for(const action of ['create','update','delete'])assert.throws(()=>guardMutation(ctx,entity,action,{total:1},{status:'posted'}),/checked Sales/);
  assert.throws(()=>guardMutation(ctx,'SalesOrder','update',{total:1},{status:'invoiced'}),/read-only/);
});

test('late invoice failure rolls back invoice number, all stock, journal and customer records through the real API transaction',async()=>{
  const db=new PGlite();try{const f=await setup(db),o=await order(f),route=await functionRoute();globalThis.__cashierClient=f.client;globalThis.__cashierTransaction=async fn=>{await db.exec('BEGIN');try{const out=await fn();await db.exec('COMMIT');return out;}catch(e){await db.exec('ROLLBACK');throw e;}};
    const original=f.entities.AuditLog.create;f.entities.AuditLog.create=async value=>{if(value.action==='create_invoice')throw Error('Fixture late audit failure');return original(value);};
    const result=await route(request(body(o)),{params:Promise.resolve({name:'fieldOps'})});assert.equal(result.status,400);assert.match((await result.json()).error,/late audit/);
    assert.equal((await f.entities.Invoice.list()).length,0);assert.equal((await f.entities.InvoiceLine.list()).length,0);assert.equal((await f.entities.StockMovement.list()).length,0);assert.equal((await f.entities.JournalEntry.list()).length,0);assert.equal((await f.entities.StockBalance.get('stock')).quantity,10);assert.equal((await f.entities.CompanySettings.get('settings')).next_invoice_number,1);assert.equal((await f.entities.Customer.get('customer-a')).balance,0);
    f.entities.AuditLog.create=original;const success=await route(request(body(o)),{params:Promise.resolve({name:'fieldOps'})});assert.equal(success.status,200);const repeat=await route(request(body(o)),{params:Promise.resolve({name:'fieldOps'})});assert.equal(repeat.status,200);assert.equal((await f.entities.Invoice.list()).length,1);
  }finally{delete globalThis.__cashierClient;delete globalThis.__cashierTransaction;await db.close();}
});

test('approved receipt on a supply invoice reduces both debts once without creating another sale or stock movement',async()=>{
  const f=await setup(),sale=await field(f),doc=await invoiceAction(f.client,admin,body(sale,'field'));
  // Match the real service store's positional-array / options-page contract.
  for(const store of Object.values(f.entities)){const original=store.filter;store.filter=async(q,options,...rest)=>options&&typeof options==='object'?{items:await original(q,'id',options.limit),has_more:false}:original(q,options,...rest);store.updateMany=async(q,changes)=>{let count=0;for(const row of await store.list())if(matches(row,q)){await store.update(row.id,changes.$set || changes);count++;}return {modifiedCount:count};};}
  const p=await f.entities.Payment.create({payment_number:'RCP',payment_type:'customer_payment',party_id:'customer-a',party_name:'Customer A',amount:200,payment_date:date,status:'pending_approval',cashier_confirmed_by:'cashier-login',receipt_posting_token:'',treasury_account_id:'till',treasury_account_name:'Till',allocated_to_invoices:doc.invoice.id,receipt_allocations:[{invoice_id:doc.invoice.id,amount:200}]});
  const paid=await approveReceipt(f.client.asServiceRole,p,admin);assert.equal(paid.status,'posted');assert.equal((await f.entities.Invoice.get(doc.invoice.id)).balance,400);assert.equal((await f.entities.FieldSale.get(sale.id)).amount_due,400);assert.equal((await f.entities.FieldSale.get(sale.id)).amount_collected,400,'initial field cash stays separate from later cashier receipt');assert.equal((await f.entities.Customer.get('customer-a')).balance,400);assert.equal((await f.entities.StockMovement.list()).length,0);assert.equal((await f.entities.JournalEntry.list()).length,2);assert.equal((await f.entities.PaymentAllocation.list()).length,1);
  await approveReceipt(f.client.asServiceRole,paid,admin);assert.equal((await f.entities.JournalEntry.list()).length,2);assert.equal((await f.entities.Customer.get('customer-a')).balance,400);
  const overview=salesOverview({invoices:await f.entities.Invoice.list(),fieldSales:await f.entities.FieldSale.list(),from:date,to:date,today:date});assert.equal(overview.pending_amount,400);assert.equal(overview.cash_sales,400);assert.equal(overview.credit_sales,600);
});

test('Cashier can customize an existing customer invoice but cannot issue sales or change company letterhead',async()=>{
 const f=await setup(),o=await order(f),doc=await invoiceAction(f.client,admin,body(o)),cashier={id:'cashier-login',role:'user'};
 const checks=[];f.client.auth.assertModule=module=>checks.push(module);
 const workspace=await invoiceAction(f.client,cashier,{action:'invoiceWorkspace'});
 assert.equal(workspace.permissions.can_create,false);assert.deepEqual(workspace.sources,[]);
 const before=structuredClone(await f.entities.JournalEntry.list()),stock=await f.entities.StockBalance.get('stock');
 const changed=await invoiceAction(f.client,cashier,{action:'customizeSalesInvoice',invoiceId:doc.invoice.id,revision:doc.revision,dueDate:date,options:{...doc.options,title:'Custom client invoice',reference:'CLIENT-REF',layout:'classic',terms:'Agreed terms'},total:1,saveCustomerDefaults:true});
 assert.equal(changed.options.title,'Custom client invoice');assert.equal(changed.invoice.total,1000);assert.deepEqual(await f.entities.JournalEntry.list(),before);assert.deepEqual(await f.entities.StockBalance.get('stock'),stock);assert.ok(checks.every(module=>module==='cashier'));
 await assert.rejects(invoiceAction(f.client,cashier,body(o)),/restricted/);
 await assert.rejects(invoiceAction(f.client,cashier,{action:'saveInvoiceCompany',company:invoiceCompany({company_name:'Tampered'})}),/restricted/);
 await f.entities.Employee.update('cashier',{status:'inactive'});await assert.rejects(invoiceAction(f.client,cashier,{action:'invoiceWorkspace'}),/active/);
});


test('VAT-inclusive supplies retain the listed price and never present VAT as an extra discount',async()=>{
 const f=await setup(),sale=await field(f),line=(await f.entities.FieldSaleLine.list())[0];
 await f.entities.FieldSale.update(sale.id,{price_includes_vat:true,subtotal:838.57,tax_total:161.43,total:1000,amount_due:600});
 await f.entities.FieldSaleLine.update(line.id,{price_includes_vat:true,line_total:838.57,tax_amount:161.43,tax_rate:19.25});
 const result=await invoiceAction(f.client,admin,body(sale,'field'));assert.equal(result.invoice.total,1000);assert.equal(result.invoice.subtotal,838.57);assert.equal(result.invoice.tax_total,161.43);assert.equal(result.lines[0].discount_amount,0);assert.equal(result.lines[0].total,1000);assert.equal(result.invoice.price_includes_vat,true);
 assert.match(invoiceHtml(result),/VAT included \(19\.25%\)/);assert.match(invoiceText(result),/VAT included \(19\.25%\):/);
 assert.equal((await f.entities.StockMovement.list()).length,0);
});


test('invoice receipt projection uses only its linked customer source, keeps product identity and excludes replacement costs',async()=>{
 const f=await setup(),o=await order(f),doc=await invoiceAction(f.client,admin,body(o));
 await f.entities.Product.update('product-a',{image_url:'/products/real-yoghurt.png',private_note:'not public'});
 await f.entities.Invoice.update(doc.invoice.id,{created_date:'2026-10-18T10:34:00Z'});
 await f.entities.SalesOrder.update(o.id,{receipt_reference:'REC-123',salesperson_name:'Saved seller',recorded_by_name:'Saved recorder',stock_replacements:[{product_id:'product-a',product_name:'YOLA',quantity:1,unit:'ea',reason:'damaged',expiry_date:'',lot_number:'LOT-1',unit_cost:123,private_note:'internal'}]});
 const detail=await invoiceAction(f.client,admin,{action:'invoiceDetail',invoiceId:doc.invoice.id});
 assert.equal(detail.invoice.receipt_reference,'REC-123');assert.equal(detail.invoice.salesperson_name,'Saved seller');assert.equal(detail.invoice.recorded_by_name,'Saved recorder');assert.equal(detail.lines[0].product_id,'product-a');assert.equal(detail.lines[0].image_url,'/products/real-yoghurt.png');assert.equal(detail.invoice.recorded_at,'2026-10-18T10:34:00Z');assert.doesNotMatch(JSON.stringify(detail),/private_note/);
 assert.deepEqual(detail.replacements,[{product_id:'product-a',product_name:'YOLA',quantity:1,unit:'ea',reason:'damaged',expiry_date:'',lot_number:'LOT-1'}]);assert.equal(detail.invoice.recorded_by,undefined);assert.equal(detail.lines[0].cogs_total,undefined);
 await f.entities.Employee.update('cashier',{role:'production_manager',status:'active'});await assert.rejects(invoiceAction(f.client,{id:'cashier-login',role:'user'},{action:'invoiceDetail',invoiceId:doc.invoice.id}),/restricted/);
 await f.entities.SalesOrder.update(o.id,{customer_id:'customer-b'});await assert.rejects(invoiceAction(f.client,admin,{action:'invoiceDetail',invoiceId:doc.invoice.id}),/source sale needs reconciliation/);
});
