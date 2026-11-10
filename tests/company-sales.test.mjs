import test from 'node:test';
import assert from 'node:assert/strict';
import { companySalesRegister, saleReadMetadata } from '../src/lib/company-sales.js';
import { companySalesAction } from '../src/server/domain/company-sales.js';

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
