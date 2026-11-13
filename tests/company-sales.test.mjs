import test from 'node:test';
import assert from 'node:assert/strict';
import { companySalesRegister, saleReadMetadata } from '../src/lib/company-sales.js';
import { companySalesAction } from '../src/server/domain/company-sales.js';
import { salesTransactionsDocument, productSalesDocument } from '../src/lib/sales-report-drilldown.js';
import { salesAnalysisDocument } from '../src/lib/sales-report-documents.js';
import { journalPayload } from '../src/server/domain/journal-validation.js';

const from = '2026-10-01', to = '2026-10-18';
test('Supply Chain sales reporting is an explicit read-only grant and revoked or inactive staff cannot use it',async()=>{
  const reads=[],writes=[],staff={id:'supply',role:'supply_chain_manager',access_template:'warehouse_manager',status:'active',allowed_modules:['inventory','sales_reports']};
  const client={auth:{staff:async()=>staff,assertModule:module=>{assert.ok(staff.allowed_modules.includes(module));}},asServiceRole:{entities:new Proxy({},{get:(_,entity)=>({filter:async query=>{reads.push([entity,query]);return [];},create:async value=>writes.push(value),update:async value=>writes.push(value)})})}};
  const result=await companySalesAction(client,{id:'login',role:'user'},{from,to,employeeId:'forged',role:'admin'});
  assert.equal(result.totals.count,0);assert.equal(reads.length,2);assert.equal(writes.length,0);
  staff.allowed_modules=['inventory'];await assert.rejects(companySalesAction(client,{id:'login',role:'user'},{from,to}),/restricted/);assert.equal(reads.length,2);
  staff.allowed_modules=['sales_reports'];staff.status='inactive';await assert.rejects(companySalesAction(client,{id:'login',role:'user'},{from,to}),/active/);assert.equal(reads.length,2);
});
test('company Sales combines posted journal-backed documents and excludes drafts, review reports, exchanges and out-of-period records', () => {
  const invoice = { id: 'i', invoice_number: 'INV-1', invoice_date: to, status: 'posted', journal_id: 'journal-i', subtotal: 1000, tax_total: 192.5, total: 1192.5, balance: 1192.5 };
  const field = { id: 'f', sale_number: 'FS-1', transaction_date: to, status: 'approved_posted', journal_id: 'journal-f', commercial_name: 'Agent', customer_name: 'Customer', subtotal: 500, tax_total: 0, total: 500, receipt_file_uris: ['private/proof'] };
  const result = companySalesRegister({ from, to, invoices: [invoice, { ...invoice, id: 'draft', status: 'draft' }, { ...invoice, id: 'bad', journal_id: '' }], fieldSales: [field, { ...field, id: 'review', status: 'submitted' }, { ...field, id: 'draft', status: 'draft' }, { ...field, id: 'old', transaction_date: '2026-09-30' }, { ...field, id: 'future', transaction_date: '2026-10-19' }, { ...field, id: 'no-journal', journal_id: '' }, { ...field, id: 'return', status: 'replaced' }] });
  assert.equal(result.rows.length, 2); assert.deepEqual(result.totals, { count: 2, net: 1500, tax: 192.5, sales: 1692.5 });
  const supply = result.rows.find(row => row.source === 'Commercial supply');
  assert.equal(supply.receipt_count, 1); assert.equal(supply.receipt_file_uris, undefined); assert.equal(supply.journal_id, undefined);
});

test('company Sales is read-only and refuses field staff before any company table access', async () => {
  const reads = [];
  const stores = { Invoice: { filter: async query => { reads.push(['Invoice', query]); return []; } }, FieldSale: { filter: async query => { reads.push(['FieldSale', query]); return []; } } };
  const client = role => ({ entities: { Employee: { filter: async () => role === 'admin' ? [] : [{ id: 'staff', role, status: 'active' }] } }, asServiceRole: { entities: stores } });
  for (const role of ['commercial', 'driver', 'hotesse', 'cashier']) await assert.rejects(companySalesAction(client(role), { id: 'login', role: 'user' }, { from, to }), /restricted/);
  assert.equal(reads.length, 0);
  for (const role of ['admin', 'employee', 'production_manager']) {
    const result = await companySalesAction(client(role), { id: 'login', role: role === 'admin' ? 'admin' : 'user' }, { from, to });
    assert.equal(result.totals.count, 0);
  }
  assert.equal(reads.length, 6); assert.equal(reads[1][1].status, 'approved_posted');
  await assert.rejects(companySalesAction(client('admin'), { id: 'gm', role: 'admin' }, { from: '2025-01-01', to }), /one year/);
});


test('sales display metadata uses saved due dates and actual timestamp fields without inferring midnight or payment terms',()=>{
 assert.deepEqual(saleReadMetadata({due_date:'2026-11-02',created_date:'2026-10-18T10:34:00Z',receipt_reference:'REC-1'}),{due_date:'2026-11-02',recorded_at:'2026-10-18T10:34:00Z',receipt_reference:'REC-1'});
 assert.equal(saleReadMetadata({created_date:'2026-10-18',invoice_date:to,payment_terms_days:14}).recorded_at,'');
 assert.equal(saleReadMetadata({created_date:'2026-02-30T10:00:00Z',due_date:'2026-02-30'}).due_date,'');
 assert.equal(saleReadMetadata({created_date:'2026-02-30T10:00:00Z'}).recorded_at,'');
 assert.equal(saleReadMetadata({created_date:'2026-10-18T10:00:00'}).recorded_at,'');
 assert.equal(saleReadMetadata({sales_supply_recorded_at:'2026-10-18T09:00:00Z',created_date:'2026-10-18T08:00:00Z'}).recorded_at,'2026-10-18T09:00:00Z');
});

function matchesMetadata(row,query){return Object.entries(query||{}).every(([key,value])=>{
 if(key==='$or')return value.some(branch=>matchesMetadata(row,branch));
 if(value&&typeof value==='object')return Object.entries(value).every(([operator,limit])=>operator==='$in'?limit.includes(row[key]??null):operator==='$ne'?row[key]!==limit:operator==='$gte'?row[key]>=limit:operator==='$lte'?row[key]<=limit:operator==='$gt'?row[key]>limit:false);
 return row[key]===value;
});}
function metadataClient(rows,staff={id:'reader',role:'employee',status:'active',allowed_modules:['sales']}){
 const reads=[],entities=new Proxy({},{get:(_,entity)=>({filter:async(query,sort,limit=200,skip=0)=>{reads.push({entity,query});return (rows[entity]||[]).filter(row=>matchesMetadata(row,query)).slice(skip,skip+limit);},create:()=>{throw Error('Read-only test');},update:()=>{throw Error('Read-only test');}})});
 return {reads,staff,client:{auth:{staff:async()=>staff,assertModule:module=>assert.ok(staff.allowed_modules.includes(module))},asServiceRole:{entities}}};
}

test('register metadata enriches only verified displayed sales, preserves reversal totals, and never exposes costs or staff records',async()=>{
 const invoice={id:'i',invoice_number:'INV-1',customer_id:'c',invoice_date:to,status:'credited',journal_id:'ji',subtotal:1000,total:1000,payment_type:'credit',balance:0,due_date:'2026-11-02',created_date:'2026-10-18T10:34:00Z',sale_reversal:{date:to,journal_id:'jr',created_at:'2026-10-18T12:00:00Z'}};
 const field={id:'f',sale_number:'FS-1',customer_id:'c',transaction_date:to,status:'approved_posted',journal_id:'jf',subtotal:600,total:600,amount_due:600,payment_type:'credit',invoice_id:'linked',due_date:'2026-10-25'};
 const rows={Invoice:[invoice,{id:'linked',field_sale_id:'f',customer_id:'c',invoice_date:to,status:'posted',journal_id:'jf',due_date:'2026-11-09',total:600,payment_type:'credit',balance:600},{...invoice,id:'unverified',journal_id:'missing',sale_reversal:null},{...invoice,id:'old',invoice_date:'2026-01-01',balance:1,sale_reversal:null}],FieldSale:[field],JournalEntry:[{id:'ji',status:'posted',source_document_type:'Invoice',source_document_id:'i'},{id:'jr',status:'posted',source_document_type:'SaleReversal',source_document_id:'ji',reversal_of:'ji'},{id:'jf',status:'posted',source_document_type:'FieldSale',source_document_id:'f'}],InvoiceLine:[{id:'li',invoice_id:'i',product_id:'p',product_name:'Saved product name',quantity:2,cogs_total:900},{id:'bad',invoice_id:'unverified',product_id:'private',product_name:'Not shown',quantity:1}],FieldSaleLine:[{id:'lf',field_sale_id:'f',product_id:'p',product_name:'Field product name',quantity:1,line_cost:900}],Product:[{id:'p',name:'Current name',image_url:'/products/p.png',unit_cost:900,private_note:'hidden'},{id:'private',image_url:'/private.png'}]};
 const f=metadataClient(rows),result=await companySalesAction(f.client,{id:'reader-login',role:'user'},{from,to,includeDetails:true});
 assert.deepEqual(result.totals,{count:2,net:600,tax:0,sales:600});assert.equal(result.unverified_documents,2);
 const normal=result.rows.find(row=>row.id==='invoice:i'),reversal=result.rows.find(row=>row.id==='reversal:i'),supply=result.rows.find(row=>row.id==='field:f');
 assert.deepEqual(normal.product,{id:'p',name:'Saved product name',image_url:'/products/p.png'});assert.equal(normal.due_date,'2026-11-02');assert.equal(normal.recorded_at,'2026-10-18T10:34:00Z');
 assert.equal(supply.due_date,'2026-11-09');assert.equal(supply.recorded_at,'');assert.equal(supply.invoice_id,'linked');assert.equal(reversal.recorded_at,'2026-10-18T12:00:00Z');assert.equal(reversal.due_date,'');
 assert.equal(f.reads.some(read=>read.entity==='Employee'),false);assert.deepEqual(f.reads.find(read=>read.entity==='InvoiceLine').query,{invoice_id:{$in:['i']}});assert.deepEqual(f.reads.find(read=>read.entity==='Product').query,{id:{$in:['p']}});
 assert.doesNotMatch(JSON.stringify(result),/cogs_total|line_cost|unit_cost|private_note|Not shown/);
 const count=f.reads.length;f.staff.role='commercial';await assert.rejects(companySalesAction(f.client,{id:'reader-login',role:'user'},{from,to}),/restricted/);assert.equal(f.reads.length,count);
});

test('register line and product metadata reads use bounded ID batches rather than full catalogue scans',async()=>{
 const rows={Invoice:[],JournalEntry:[],InvoiceLine:[],Product:[]};
 for(let i=0;i<205;i++){rows.Invoice.push({id:'i'+i,invoice_number:'INV-'+i,customer_id:'c',invoice_date:to,status:'posted',journal_id:'j'+i,total:1});rows.JournalEntry.push({id:'j'+i,status:'posted',source_document_type:'Invoice',source_document_id:'i'+i});rows.InvoiceLine.push({id:'l'+i,invoice_id:'i'+i,product_id:'p'+i,quantity:1,product_name:'Product '+i});rows.Product.push({id:'p'+i,image_url:'/p'+i+'.png'});}
 const f=metadataClient(rows),result=await companySalesAction(f.client,{id:'reader-login',role:'user'},{from,to,includeDetails:true});assert.equal(result.rows.length,205);
 for(const entity of ['InvoiceLine','Product']){const reads=f.reads.filter(read=>read.entity===entity);assert.equal(reads.length,3);assert.ok(reads.every(read=>{const values=Object.values(read.query)[0].$in;return values.length>0&&values.length<=100;}));}
});


test('numeric sales readers do not load line or product metadata without a strict mobile detail opt-in',async()=>{
 const rows={Invoice:[{id:'i',invoice_number:'INV',invoice_date:to,status:'posted',journal_id:'j',total:10}],JournalEntry:[{id:'j',status:'posted',source_document_type:'Invoice',source_document_id:'i'}]};
 for(const includeDetails of [undefined,false,'true']){const f=metadataClient(rows),result=await companySalesAction(f.client,{id:'reader-login',role:'user'},{from,to,includeDetails});assert.equal(result.totals.sales,10);assert.equal(f.reads.some(read=>['InvoiceLine','FieldSaleLine','Product'].includes(read.entity)),false);}
});


test('product report opt-in carries exact original/reversal journals, deduplicates supply invoice and keeps grants read-only',async()=>{
 const invoice={id:'i',invoice_number:'INV-OLD',customer_id:'c',customer_name:'Customer',invoice_date:'2026-09-30',status:'credited',journal_id:'ji',subtotal:120,tax_total:12,total:132,payment_type:'credit',balance:0,price_includes_vat:false,sale_reversal_date:'2026-10-17',sale_reversal:{date:'2026-10-17',journal_id:'jr'}};
 const field={id:'f',sale_number:'FS-1',customer_id:'c',customer_name:'Customer',transaction_date:to,status:'approved_posted',journal_id:'jf',subtotal:150,tax_total:0,total:150,amount_due:150,amount_collected:0,payment_type:'credit',invoice_id:'linked',price_includes_vat:false};
 const rows={Invoice:[invoice,{id:'linked',field_sale_id:'f',customer_id:'c',invoice_date:to,status:'posted',journal_id:'jf',due_date:'2026-11-09',total:150,subtotal:150,tax_total:0,payment_type:'credit',balance:150},{...invoice,id:'bad',journal_id:'missing',invoice_date:to,sale_reversal:null}],FieldSale:[field],JournalEntry:[{id:'ji',journal_number:'JV-ORIGINAL',status:'posted',source_document_type:'Invoice',source_document_id:'i'},{id:'jr',journal_number:'JV-REVERSAL',status:'posted',source_document_type:'SaleReversal',source_document_id:'ji',reversal_of:'ji'},{id:'jf',journal_number:'JV-FIELD',status:'posted',source_document_type:'FieldSale',source_document_id:'f'}],InvoiceLine:[{id:'li',invoice_id:'i',product_id:'p',product_name:'Saved name',unit:'ea',quantity:2,unit_price:60,discount_amount:0,tax_amount:12,total:132,cogs_total:999},{id:'duplicate',invoice_id:'linked',product_id:'p',unit:'ea',quantity:3,total:150,tax_amount:0},{id:'bad-line',invoice_id:'bad',product_id:'secret',quantity:10,total:99}],FieldSaleLine:[{id:'lf',field_sale_id:'f',product_id:'p',product_name:'Saved name',unit:'ea',quantity:3,list_price:55,unit_price:50,discount:15,tax_amount:0,line_total:150,line_cost:999}],Product:[{id:'p',name:'Current name',image_url:'/actual.png',purchase_price:999,unit_cost:999,private_note:'hidden'}]};
 const f=metadataClient(rows,{id:'reader',role:'supply_chain_manager',access_template:'warehouse_manager',status:'active',allowed_modules:['sales_reports']}),result=await companySalesAction(f.client,{id:'login',role:'user'},{from,to,includeDetails:true,includeReport:true,includeProducts:true,employeeId:'forged',customerId:'forged'});
 assert.deepEqual(result.totals,{count:1,net:30,tax:-12,sales:18});assert.equal(result.product_report.coverage.complete,true);assert.equal(result.product_report.products.length,1);assert.equal(result.product_report.products[0].net_quantity,1);assert.equal(result.product_report.totals.total_revenue,18);
 const reversal=result.product_report.transactions.find(row=>row.is_reversal),supply=result.product_report.transactions.find(row=>!row.is_reversal);assert.equal(reversal.journal_id,'jr');assert.equal(reversal.journal_number,'JV-REVERSAL');assert.equal(reversal.original_journal_id,'ji');assert.equal(reversal.date,'2026-10-17');assert.equal(reversal.quantity,-2);assert.equal(supply.journal_id,'jf');assert.equal(supply.invoice_id,'linked');
 assert.deepEqual(result.report_access,{open_journals:false,open_invoices:false,open_orders:false,open_field_sales:false});assert.equal(result.overview.pending[0].journal_id,'jf');
 assert.equal(f.reads.filter(read=>read.entity==='InvoiceLine').length,1);assert.equal(f.reads.filter(read=>read.entity==='FieldSaleLine').length,1);assert.equal(f.reads.filter(read=>read.entity==='Product').length,1);assert.deepEqual(f.reads.find(read=>read.entity==='InvoiceLine').query,{invoice_id:{$in:['i']}});assert.doesNotMatch(JSON.stringify(result),/cogs_total|line_cost|purchase_price|unit_cost|private_note|bad-line/);
 field.invoice_id='wrong-invoice';const conflicted=await companySalesAction(f.client,{id:'login',role:'user'},{from,to,includeReport:true,includeProducts:true});assert.equal(conflicted.rows.find(row=>row.source==='Commercial supply').invoice_id,'');assert.equal(conflicted.rows.find(row=>row.source==='Commercial supply').invoice_link_invalid,true);assert.equal(conflicted.product_report.transactions.find(row=>!row.is_reversal).invoice_id,undefined);
 f.staff.allowed_modules=[];const count=f.reads.length;await assert.rejects(companySalesAction(f.client,{id:'login',role:'user'},{from,to,includeReport:true,includeProducts:true}),/restricted/);assert.equal(f.reads.length,count);
});

test('proof-only reports and forged product flags never add line joins to numeric/dashboard reads',async()=>{
 const rows={Invoice:[{id:'i',invoice_number:'INV',invoice_date:to,status:'posted',journal_id:'j',subtotal:10,tax_total:0,total:10}],JournalEntry:[{id:'j',journal_number:'JV',status:'posted',source_document_type:'Invoice',source_document_id:'i'}]};
 for(const flags of [{includeReport:true},{includeProducts:true},{includeReport:'true',includeProducts:true},{includeReport:true,includeProducts:'true'}]){const f=metadataClient(rows),result=await companySalesAction(f.client,{id:'login',role:'user'},{from,to,...flags});assert.equal(result.totals.sales,10);assert.equal(f.reads.some(read=>['InvoiceLine','FieldSaleLine','Product'].includes(read.entity)),false);assert.equal(result.product_report,undefined);assert.equal(result.rows[0].journal_id,flags.includeReport===true?'j':undefined);}
});

test('historical VAT correction reconciles report totals and product lines to the posted journal without modifying the original invoice',async()=>{
 const invoiceDate='2026-10-16',reversalDate='2026-10-17';
 const marker={version:1,journal_id:'vat',journal_number:'JV-VAT',date:invoiceDate,original_journal_id:'original',subtotal:200,tax_total:38.5,original_subtotal:219.25,original_tax_total:19.25,tax_account_id:'vat-account',lines:[{id:'nature-line',tax_amount:19.25},{id:'fruit-line',tax_amount:19.25}]};
 const invoice={id:'invoice',invoice_number:'INV-HISTORICAL',invoice_date:invoiceDate,status:'posted',customer_id:'customer',sales_order_id:'order',payment_type:'credit',journal_id:'original',subtotal:219.25,tax_total:19.25,total:238.5,balance:238.5,price_includes_vat:true,invoice_vat_correction:marker};
 const journalLine=(id,journal_id,account_id,debit,credit)=>({id,journal_id,account_id,debit,credit,status:'posted'});
 const originalLines=[journalLine('ar','original','receivable',238.5,0),journalLine('rev','original','revenue',0,219.25),journalLine('tax','original','vat-account',0,19.25)];
 const correctionLines=[journalLine('rev-correction','vat','revenue',19.25,0),journalLine('vat-correction','vat','vat-account',0,19.25)];
 const journal=(id,journal_number,source_document_type,total,lines)=>({id,journal_number,entry_date:invoiceDate,status:'posted',source_module:'sales',source_document_type,source_document_id:invoice.id,is_immutable:true,total_debit:total,total_credit:total,posting_payload:journalPayload({entryDate:invoiceDate,sourceModule:'sales',sourceDocumentType:source_document_type,lines})});
 const savedLine=(id,product_id,tax_amount)=>({id,invoice_id:invoice.id,product_id,product_name:product_id,quantity:1,unit:'ea',unit_price:119.25,discount_amount:0,tax_amount,total:119.25});
 const savedRows={Invoice:[invoice],JournalEntry:[journal('original','JV-ORIGINAL','Invoice',238.5,originalLines),journal('vat','JV-VAT','InvoiceVatCorrection',19.25,correctionLines)],JournalLine:[...originalLines,...correctionLines],InvoiceLine:[savedLine('nature-line','Nature',19.25),savedLine('fruit-line','Fruit',0)],Account:[{id:'receivable',account_type:'asset',normal_balance:'debit'},{id:'revenue',account_type:'revenue',normal_balance:'credit'},{id:'vat-account',account_type:'liability',normal_balance:'credit'}]};
 const fixture=metadataClient(savedRows),period={from,to},flags={...period,includeReport:true,includeProducts:true};
 const report=body=>companySalesAction(fixture.client,{id:'login',role:'user'},body);
 const original=structuredClone(savedRows),valid=await report(flags);
 assert.deepEqual(valid.totals,{count:1,net:200,tax:38.5,sales:238.5});
 assert.equal(valid.overview.credit_sales,238.5);
 assert.equal(valid.overview.pending_amount,238.5);
 assert.equal(valid.unverified_vat_corrections,undefined);
 assert.equal(valid.rows[0].journal_id,'original');
 assert.equal(valid.rows[0].vat_correction_journal_id,'vat');
 assert.equal(valid.product_report.coverage.complete,true);
 assert.deepEqual(valid.product_report.products.map(row=>[row.net_quantity,row.net_revenue,row.tax,row.total_revenue]),[[1,100,19.25,119.25],[1,100,19.25,119.25]]);
 assert.equal(valid.product_report.transactions[0].vat_correction_journal_number,'JV-VAT');
 const exportSheet=salesTransactionsDocument(valid.product_report.transactions,period,{product:true}).sections[0];
 const vatColumn=exportSheet.columns.findIndex(column=>column.label==='VAT correction journal');
 assert.equal(exportSheet.rows[0][vatColumn],'JV-VAT');
 assert.equal(fixture.reads.filter(read=>read.entity==='InvoiceLine').length,1);
 assert.deepEqual(savedRows,original);

 invoice.payment_type='cash';
 invoice.balance=0;
 const cash=await report(period);
 assert.equal(cash.totals.tax,38.5);
 assert.equal(cash.overview.cash_sales,238.5);
 assert.equal(cash.rows[0].vat_correction_journal_id,undefined);

 invoice.status='credited';
 invoice.sale_reversal_date=reversalDate;
 invoice.sale_reversal={date:reversalDate,journal_id:'reversal',vat_correction_journal_id:'vat'};
 savedRows.JournalEntry.push({id:'reversal',journal_number:'JV-REVERSAL',status:'posted',source_document_type:'SaleReversal',source_document_id:'original',reversal_of:'original'});
 const reversal=await report({...flags,from:reversalDate,to:reversalDate});
 assert.deepEqual(reversal.totals,{count:0,net:-200,tax:-38.5,sales:-238.5});
 assert.equal(reversal.overview.cash_sales,-238.5);
 assert.equal(reversal.product_report.coverage.complete,true);
 assert.equal(reversal.product_report.transactions[0].quantity,-1);
 assert.equal(reversal.product_report.transactions[0].journal_id,'reversal');
 assert.equal(reversal.product_report.transactions[0].original_journal_id,'original');
 assert.equal(reversal.product_report.transactions[0].vat_correction_journal_id,'vat');
 const combined=await report(flags);
 assert.deepEqual(combined.totals,{count:1,net:0,tax:0,sales:0});

 delete invoice.sale_reversal.vat_correction_journal_id;
 const unmatchedReversal=await report({...flags,from:reversalDate,to:reversalDate});
 assert.equal(unmatchedReversal.unverified_vat_corrections,1);
 assert.equal(unmatchedReversal.totals.tax,-19.25);
 invoice.sale_reversal.vat_correction_journal_id='vat';
 marker.lines[0].tax_amount=0;
 marker.lines[1].tax_amount=38.5;
 const mismatchedLines=await report({...flags,to:invoiceDate});
 assert.deepEqual(mismatchedLines.totals,{count:1,net:219.25,tax:19.25,sales:238.5});
 assert.equal(mismatchedLines.unverified_vat_corrections,1);
 assert.equal(mismatchedLines.rows[0].vat_correction_journal_id,undefined);
 assert.match(salesAnalysisDocument(mismatchedLines,period).notes.join('\n'),/1 VAT corrections that need review/);
 assert.match(productSalesDocument(mismatchedLines.product_report,period).notes.join('\n'),/1 VAT corrections that need review/);
});
