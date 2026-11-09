import test from 'node:test';
import assert from 'node:assert/strict';
import {commercialOrderSales} from '../src/server/domain/commercial-order-sales.js';
import {fixture as cashierFixture,user,date} from './helpers/cashier.mjs';
import {salesOrderAction} from '../src/server/domain/sales-orders.js';
import {saleReversalAction} from '../src/server/domain/sale-reversals.js';
import {commercialReport} from '../src/server/domain/commercial-rules.js';

const period={from:'2025-10-01',to:'2025-10-31'};
const matches=(row,query)=>Object.entries(query).every(([key,value])=>key==='$or'?value.some(part=>matches(row,part)):value&&typeof value==='object'
 ? Object.entries(value).every(([operator,arg])=>operator==='$in'?arg.includes(row[key]):operator==='$exists'?(row[key]!=null)===arg:operator==='$gte'?row[key]>=arg:operator==='$lte'?row[key]<=arg:false)
 : row[key]===value);
function source(suffix='',seller='agent'){
 const id='order'+suffix,invoiceId='invoice'+suffix,journalId='journal'+suffix,auditId='audit'+suffix;
 return {
  SalesOrder:[{id,order_number:'SO'+suffix,status:'invoiced',salesperson_id:seller,salesperson_name:'Agent',sales_supply_seller_id:seller,
   sales_supply_stockholder_id:'other-holder',sales_supply_recorded_by:'manager',sales_supply_recorded_at:'2025-11-05T10:00:00Z',sales_supply_request_id:auditId,
   invoice_id:invoiceId,sales_supply_journal_id:journalId,customer_id:'customer',customer_name:'Customer',order_date:'2025-10-03',
   subtotal:100,tax_total:20,total:120,payment_type:'cash',amount_collected:120,amount_due:0,supply_kind:'sale',receipt_reference:'RECEIPT'}],
  Invoice:[{id:invoiceId,invoice_number:'INV'+suffix,status:'posted',accounting_source:'sales_order',sales_order_id:id,salesperson_id:seller,salesperson_name:'Agent',
   customer_id:'customer',invoice_date:'2025-10-03',journal_id:journalId,subtotal:100,tax_total:20,total:120,payment_type:'cash',amount_paid:0,balance:120}],
  JournalEntry:[{id:journalId,status:'posted',entry_date:'2025-10-03',source_module:'sales',source_document_type:'Invoice',source_document_id:invoiceId,total_debit:160,total_credit:160}],
  InvoiceLine:[{id:'line'+suffix,invoice_id:invoiceId,product_id:'product',product_name:'Yoghurt',quantity:2,unit:'ea',total:120,tax_amount:20,unit_cost:20,cogs_total:40,unit_price:60}],
  AuditLog:[{id:auditId,action:'record_supplied_order',module:'sales_supply',audit_source:'server_verified',entity_type:'SalesOrder',entity_id:id,
   user_id:'manager',sales_supply_recorded_by:'manager',sales_supply_seller_id:seller,sales_supply_payload:'reviewed-payload',sales_supply_invoice_id:invoiceId}],
 };
}
function fixture(tables=source(),{ignoreScope=false}={}){
 const reads=[];
 const entities=Object.fromEntries(Object.entries(tables).map(([name,rows])=>[name,{filter:async(query,sort,limit,skip=0)=>{
  reads.push({name,query,limit,skip});return structuredClone(rows.filter(row=>ignoreScope&&name==='SalesOrder'||matches(row,query)).slice(skip,skip+limit));
 }}]));
 return {tables,reads,svc:{entities},report:options=>commercialOrderSales({entities},{...period,commercialId:'agent',...options})};
}
function merge(...tables){return Object.fromEntries(Object.keys(tables[0]).map(name=>[name,tables.flatMap(t=>t[name])]));}
function reverse(tables){
 const order=tables.SalesOrder[0],invoice=tables.Invoice[0],original=tables.JournalEntry[0];
 const correction={journal_id:'correction',journal_number:'REV',date:'2025-11-05',reason:'Correct wrong source',total:120,customer_credit:30,unpaid_cancelled:90,stock_disposition:'retain_stock',request_hash:'private-request-hash'};
 Object.assign(order,{payment_type:'credit',amount_collected:0,amount_due:0,sale_reversal:structuredClone(correction),sale_reversal_date:correction.date});
 Object.assign(invoice,{payment_type:'credit',status:'credited',amount_paid:30,balance:0,sale_reversal:structuredClone(correction),sale_reversal_date:correction.date});
 original.reversed_by_journal=correction.journal_id;
 tables.JournalEntry.push({id:'correction',status:'posted',entry_date:correction.date,source_module:'sales',source_document_type:'SaleReversal',source_document_id:original.id,
  reversal_of:original.id,total_debit:120,total_credit:120});
 return tables;
}

test('checked orders become read-only attributed sale projections with original invoice dates and canonical product lines',async()=>{
 const f=fixture(),before=structuredClone(f.tables),result=await f.report();
 assert.equal(result.sales.length,1);assert.equal(result.lines.length,1);
 const sale=result.sales[0],line=result.lines[0];
 assert.deepEqual([sale.id,sale.source_type,sale.source_id,sale.source_status,sale.status],['SalesOrder:order','SalesOrder','order','invoiced','approved_posted']);
 assert.deepEqual([sale.commercial_id,sale.recorded_by,sale.transaction_date,sale.sale_number,sale.invoice_number],['agent','manager','2025-10-03','SO','INV']);
 assert.deepEqual([sale.subtotal,sale.total,sale.amount_collected,sale.amount_due],[100,120,120,0]);
 assert.deepEqual(line,{id:'InvoiceLine:line',sale_id:sale.id,source_type:'SalesOrder',source_id:'order',product_id:'product',product_name:'Yoghurt',quantity:2,unit:'ea'});
 assert.equal(line.field_sale_id,undefined);assert.equal(line.unit_cost,undefined);assert.equal(sale.field_sale_id,undefined);
 assert.deepEqual(f.tables,before);
 assert.deepEqual((await f.report({from:'2025-11-05',to:'2025-11-05'})).sales,[],'recording timestamp does not move a backdated supply into the later period');
 assert.deepEqual((await f.report({commercialId:'manager'})).sales,[],'recording manager does not own the Commercial sale');
 assert.deepEqual((await f.report({commercialId:'other-holder'})).sales,[],'stock holder does not replace the selected seller');
 // Depositing a cash receipt or collecting a credit invoice is not another sale.
 Object.assign(f.tables.Invoice[0],{status:'paid',amount_paid:120,balance:0});
 assert.deepEqual((await f.report()).sales,result.sales);
 Object.assign(f.tables.SalesOrder[0],{payment_type:'credit',amount_collected:0,amount_due:120});f.tables.Invoice[0].payment_type='credit';
 const credit=(await f.report()).sales[0];assert.equal(credit.amount_collected,0);assert.equal(credit.amount_due,120);
});

test('only explicit seller scopes are readable, including all-agent lists and defensive post-filtering',async()=>{
 const f=fixture(merge(source(),source('-b','agent-b'),source('-staff','staff')),{ignoreScope:true});
 assert.deepEqual((await f.report()).sales.map(s=>s.commercial_id),['agent']);
 assert.deepEqual((await f.report({commercialId:'',commercialIds:['agent-b']})).sales.map(s=>s.commercial_id),['agent-b']);
 assert.deepEqual((await f.report({commercialId:'agent',commercialIds:['staff']})).sales.map(s=>s.commercial_id),['agent']);
 const empty=fixture();assert.deepEqual(await empty.report({commercialId:undefined}),{sales:[],lines:[]});assert.equal(empty.reads.length,0);
 assert.deepEqual(await empty.report({commercialId:'',commercialIds:[]}),{sales:[],lines:[]});
 await assert.rejects(empty.report({commercialId:3}),/scope/);await assert.rejects(empty.report({commercialId:'',commercialIds:[null]}),/scope/);
 for(const dates of [{from:'2025-02-30',to:'2025-03-01'},{from:'2025-10-04',to:'2025-10-03'}])await assert.rejects(empty.report(dates),/start and end date/);
});

test('authorized all-Commercial reports retain verified Commercial role snapshots after later staff changes',async()=>{
 const former=source('-former','former'),newcomer=source('-new','current'),forged=source('-forged','forged');
 former.SalesOrder[0].sales_supply_seller_role='commercial';former.AuditLog[0].sales_supply_seller_role='commercial';
 newcomer.SalesOrder[0].sales_supply_seller_role='employee';newcomer.AuditLog[0].sales_supply_seller_role='employee';
 forged.SalesOrder[0].sales_supply_seller_role='commercial';forged.AuditLog[0].sales_supply_seller_role='employee';
 const f=fixture(merge(source(),former,newcomer,forged));
 const report=await f.report({commercialId:'',commercialIds:['agent','current'],allCommercial:true});
 assert.deepEqual(new Set(report.sales.map(row=>row.commercial_id)),new Set(['agent','former']));
 assert.deepEqual((await f.report({commercialId:'agent',allCommercial:true})).sales.map(row=>row.commercial_id),['agent'],'all-Commercial cannot widen an exact seller scope');
 assert.deepEqual((await f.report({commercialId:'',allCommercial:true})).sales.map(row=>row.commercial_id),['former'],'historical inclusion needs matching immutable order/audit role');
 assert.deepEqual((await f.report({commercialId:'forged'})).sales,[],'mismatched role evidence is invalid even for exact seller');
 assert.equal((await f.report({commercialId:'current'})).sales.length,1,'explicit seller reporting retains their attributed earlier sales');
});

test('drafts, orphaned links, wrong audit evidence, forged source metadata and duplicate invoices are excluded',async()=>{
 const changes=[
  t=>{t.SalesOrder[0].status='draft';},t=>{delete t.SalesOrder[0].sales_supply_recorded_at;},t=>{t.SalesOrder[0].sales_supply_recorded_at='bad';},
  t=>{t.SalesOrder[0].invoice_id='wrong';},t=>{t.SalesOrder[0].sales_supply_journal_id='wrong';},t=>{t.SalesOrder[0].sales_supply_seller_id='manager';},
  t=>{t.SalesOrder[0].supply_kind='exchange';},t=>{t.Invoice=[];},t=>{t.Invoice[0].sales_order_id='other';},t=>{t.Invoice[0].salesperson_id='other';},
  t=>{t.Invoice[0].customer_id='other';},t=>{t.Invoice[0].status='draft';},t=>{t.Invoice[0].accounting_source='import';},t=>{t.Invoice[0].opening_batch_id='opening';},
  t=>{t.JournalEntry=[];},t=>{t.JournalEntry[0].status='draft';},t=>{t.JournalEntry[0].status='reversed';},t=>{t.JournalEntry[0].source_document_type='FieldSale';},
  t=>{t.JournalEntry[0].source_document_id='other';},t=>{t.JournalEntry[0].source_module='manual';},t=>{t.JournalEntry[0].entry_date='2025-10-04';},
  t=>{t.JournalEntry[0].total_credit=99;},t=>{t.AuditLog=[];},t=>{t.AuditLog[0].action='create_invoice';},t=>{t.AuditLog[0].module='commercial';},
  t=>{t.AuditLog[0].audit_source='client';},t=>{t.AuditLog[0].entity_id='other';},t=>{t.AuditLog[0].entity_type='FieldSale';},
  t=>{t.AuditLog[0].user_id='spoof';},t=>{t.AuditLog[0].sales_supply_recorded_by='spoof';},t=>{t.AuditLog[0].sales_supply_seller_id='other';},
  t=>{t.AuditLog[0].sales_supply_invoice_id='other';},t=>{t.AuditLog[0].sales_supply_payload='';},
  t=>{t.Invoice.push({...t.Invoice[0],id:'duplicate'});},t=>{t.InvoiceLine=[];},t=>{t.InvoiceLine[0].invoice_id='other';},
  t=>{t.InvoiceLine[0].quantity=0;},t=>{t.InvoiceLine[0].quantity=0.0001;},t=>{t.InvoiceLine[0].total=119;},t=>{t.InvoiceLine[0].tax_amount=19;},
  t=>{t.InvoiceLine[0].unit='';},t=>{t.Invoice[0].invoice_date='2025-02-30';},t=>{t.SalesOrder[0].order_date='2025-10-02';},t=>{t.SalesOrder[0].total=119;},t=>{t.SalesOrder[0].amount_collected=5;},
 ];
 for(const [index,change] of changes.entries()){const tables=source();change(tables);assert.deepEqual(await fixture(tables).report(),{sales:[],lines:[]},'unsafe source mutation '+index);}
 for(const table of ['SalesOrder','Invoice'])for(const alias of ['field_sale_id','source_field_sale_id','origin_field_sale_id','fieldSaleId','sourceFieldSaleId']){
  const tables=source();tables[table][0][alias]='already-counted-field-sale';assert.deepEqual(await fixture(tables).report(),{sales:[],lines:[]},table+'.'+alias);
 }
});

test('properly linked reversals retain original sale and product identities for either reporting window',async()=>{
 const f=fixture(reverse(source()));
 const october=await f.report(),november=await f.report({from:'2025-11-01',to:'2025-11-30'});
 assert.deepEqual(november,october);
 const sale=november.sales[0];assert.equal(sale.transaction_date,'2025-10-03');assert.equal(sale.total,120);assert.equal(sale.amount_due,120);
 assert.equal(sale.sale_reversal.date,'2025-11-05');assert.equal(sale.sale_reversal.total,120);assert.equal(sale.sale_reversal.request_hash,undefined);
 assert.equal(november.lines[0].sale_id,'SalesOrder:order');assert.equal(november.lines[0].quantity,2);
 const view=dates=>commercialReport({agents:[{id:'agent',full_name:'Agent'}],customers:[],...november,...dates});
 const original=view(period),correction=view({from:'2025-11-01',to:'2025-11-30'}),combined=view({from:'2025-10-01',to:'2025-11-30'});
 assert.deepEqual([original.agents[0].total,original.supplies[0].products[0].quantity],[120,2]);
 assert.deepEqual([correction.agents[0].total,correction.supplies[0].products[0].quantity],[-120,-2]);
 assert.deepEqual([combined.agents[0].total,combined.supplies[0].products[0].quantity],[0,0]);
 f.tables.JournalEntry[0].status='reversed';assert.deepEqual(await f.report(),october,'legacy reversed originals remain reportable only with exact correction proof');
 assert.deepEqual(await f.report({from:'2025-12-01',to:'2025-12-31'}),{sales:[],lines:[]});
});

test('credited invoices and reversal metadata cannot create negative sales without the exact posted correction',async()=>{
 const changes=[t=>{t.JournalEntry.pop();},t=>{t.JournalEntry[1].status='draft';},t=>{t.JournalEntry[1].reversal_of='other';},
  t=>{t.JournalEntry[1].source_document_id='other';},t=>{t.JournalEntry[1].source_document_type='manual';},t=>{t.JournalEntry[1].entry_date='2025-11-06';},
  t=>{t.JournalEntry[0].reversed_by_journal='other';},t=>{t.Invoice[0].sale_reversal.journal_id='other';},t=>{t.Invoice[0].sale_reversal.total=119;},
  t=>{t.Invoice[0].sale_reversal.customer_credit=10;},t=>{delete t.SalesOrder[0].sale_reversal;},t=>{t.Invoice[0].status='posted';},
  t=>{t.SalesOrder[0].sale_reversal_date='2025-11-06';},t=>{t.JournalEntry[1].reversed_by_journal='another';}];
 for(const [index,change] of changes.entries()){const tables=reverse(source());change(tables);assert.deepEqual(await fixture(tables).report(),{sales:[],lines:[]},'unsafe reversal '+index);}
});

test('batched source reads preserve each proven sale once beyond the first page',async()=>{
 const tables=merge(...Array.from({length:205},(_,i)=>source('-'+i)));
 const f=fixture(tables),result=await f.report();
 assert.equal(result.sales.length,205);assert.equal(result.lines.length,205);assert.equal(new Set(result.sales.map(s=>s.id)).size,205);
 assert.ok(f.reads.some(r=>r.name==='SalesOrder'&&r.skip===200));
 assert.ok(f.reads.filter(r=>r.name==='Invoice').length>=3);
 assert.ok(f.reads.filter(r=>r.name==='SalesOrder').every(r=>r.query.$or?.some(part=>part.order_date)&&r.query.$or.some(part=>part.sale_reversal_date)),'source reads stay bounded to the sale or correction period');
});

test('the checked sale posting workflow supplies the exact proof expected by the report without extra writes',async()=>{
 const f=await cashierFixture(),s=f.entities,admin={...user,role:'admin'};
 await s.CompanySettings.update('settings',{company_name:'SOEICAM',next_invoice_number:1});
 await s.StockBalance.update('stock',{warehouse_id:'factory'});
 const seller=await s.Employee.create({role:'commercial',status:'active',full_name:'Selected commercial'});
 const create=s.AuditLog.create;s.AuditLog.create=async row=>{if(!row.id)return create(row);f.rows.AuditLog.push(structuredClone(row));return structuredClone(row);};
 const body={action:'recordSuppliedOrder',requestKey:crypto.randomUUID(),sourceType:'company',sellerId:seller.id,customerId:'customer-a',date,paymentType:'cash',receiptReference:'REC-1',expectedTotal:1000,lines:[{product_id:'product-a',quantity:2,unit_price:500,discount_pct:0}]};
 const result=await salesOrderAction(f.client,admin,body),before=structuredClone(f.rows);
 const report=await commercialOrderSales(f.client.asServiceRole,{commercialId:seller.id,from:date,to:date});
 assert.equal(report.sales.length,1);assert.equal(report.sales[0].source_id,result.order.id);assert.equal(report.sales[0].commercial_id,seller.id);
 assert.equal(report.sales[0].recorded_by,user.id);assert.equal(report.sales[0].total,1000);assert.equal(report.lines[0].quantity,2);
 assert.deepEqual(f.rows,before);assert.equal(f.rows.FieldSale.length,0);assert.equal(f.rows.CashCollection.filter(r=>r.field_sale_id===report.sales[0].id).length,0);
 const credit=await salesOrderAction(f.client,admin,{...body,requestKey:crypto.randomUUID(),paymentType:'credit'});
 const preview=await saleReversalAction(f.client,admin,{action:'previewSaleReversal',invoiceId:credit.invoiceId});
 await saleReversalAction(f.client,admin,{action:'reverseSale',invoiceId:credit.invoiceId,reviewToken:preview.reviewToken,reason:'Correct recorded supply',stockDisposition:'retain_stock',costTreatmentPolicy:preview.retained_cost_review.policy,confirmed:true});
 const afterCorrection=structuredClone(f.rows),corrected=await commercialOrderSales(f.client.asServiceRole,{commercialId:seller.id,from:date,to:date});
 const reversed=corrected.sales.find(sale=>sale.source_id===credit.order.id);
 assert.equal(corrected.sales.length,2);assert.equal(reversed.sale_reversal.total,1000);assert.equal(reversed.amount_due,1000);
 assert.deepEqual(f.rows,afterCorrection);
});
