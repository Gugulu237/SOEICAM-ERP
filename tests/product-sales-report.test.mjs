import test from 'node:test';
import assert from 'node:assert/strict';
import {buildProductSalesReport,rankProductSales} from '../src/lib/product-sales-report.js';

const sale=(id,values={})=>({id:'invoice:'+id,document_id:id,document_number:'INV-'+id,source:'Invoice',date:'2026-10-15',journal_id:'j-'+id,journal_number:'JV-'+id,customer_id:'c',customer_name:'Customer',commercial_id:'seller',commercial_name:'Saved seller',subtotal:100,tax:0,total:100,...values});
const invoiceLine=(id,values={})=>({id:'line-'+id,invoice_id:id,product_id:'p',product_name:'Saved yoghurt',unit:'ea',quantity:1,unit_price:100,discount_amount:0,tax_amount:0,total:100,...values});
const product={id:'p',name:'Current yoghurt',image_url:'/products/yoghurt.png',unit_cost:999,private_note:'secret'};
const sum=(rows,key)=>Math.round(rows.reduce((n,row)=>n+Number(row[key]||0),0)*100)/100;

test('ranking reconciles exact Invoice and FieldSale lines, recorded monetary discounts and tax while preserving source proofs',()=>{
 const invoice=sale('i',{subtotal:900,total:900});
 const field=sale('f',{id:'field:f',source:'Commercial supply',document_number:'FS-f',subtotal:200,tax:38.5,total:238.5,journal_id:'j-field',invoice_id:'linked'});
 const report=buildProductSalesReport({rows:[invoice,field],invoices:[{id:'i',price_includes_vat:false}],fieldSales:[{id:'f',price_includes_vat:true,discount_total:20}],invoiceLines:[invoiceLine('i',{quantity:10,discount_amount:100,total:900,cogs_total:500})],fieldLines:[{id:'fl',field_sale_id:'f',product_id:'p',product_name:'Historical yoghurt',unit:'ea',quantity:2,unit_price:119.25,list_price:129.25,discount:20,tax_amount:38.5,line_total:200,unit_cost:200,line_cost:400,receipt_file_uris:['private/proof']}],products:[product]});
 assert.equal(report.coverage.complete,true);assert.equal(report.coverage.included_documents,2);assert.equal(report.products.length,1);
 const p=report.products[0];assert.equal(p.product_name,'Current yoghurt');assert.equal(p.rank,1);assert.equal(p.rank_unit,'ea');assert.equal(p.sold_quantity,12);assert.equal(p.net_quantity,12);assert.equal(p.discount,120);assert.equal(p.discount_basis,'mixed');assert.equal(p.net_revenue,1100);assert.equal(p.tax,38.5);assert.equal(p.total_revenue,1138.5);assert.equal(p.transaction_count,2);
 assert.equal(report.transactions[1].discount,20,'saved FieldSale discount is an amount, not a percent');assert.equal(report.transactions[1].journal_id,'j-field');assert.equal(report.transactions[1].invoice_id,'linked');assert.equal(report.transactions[1].product_name,'Historical yoghurt');
 for(const key of ['discount','net_revenue','tax','total_revenue'])assert.equal(sum(report.transactions,key),report.totals[key]);assert.equal(report.coverage.difference_total_revenue,0);
 assert.doesNotMatch(JSON.stringify(report),/cogs_total|line_cost|unit_cost|private_note|receipt_file_uris|private\/proof/);
});

test('a cross-period full reversal deducts exact original products and amounts on its own date without requiring the original sale row',()=>{
 const row=sale('old',{id:'reversal:old',document_number:'Reversal · INV-old',date:'2026-10-15',original_date:'2026-09-01',is_reversal:true,subtotal:-90,tax:-17.33,total:-107.33,journal_id:'reversal-j',journal_number:'JV-REV',original_journal_id:'original-j'});
 const report=buildProductSalesReport({rows:[row],invoices:[{id:'old',invoice_date:'2026-09-01',price_includes_vat:true}],invoiceLines:[invoiceLine('old',{quantity:2,unit_price:59.63,discount_amount:11.93,tax_amount:17.33,total:107.33})],products:[product]});
 const p=report.products[0];assert.equal(p.sold_quantity,0);assert.equal(p.reversed_quantity,2);assert.equal(p.net_quantity,-2);assert.equal(p.total_revenue,-107.33);assert.equal(p.discount,-11.93);assert.equal(p.reversal_count,1);assert.equal(report.transactions[0].date,'2026-10-15');assert.equal(report.transactions[0].journal_id,'reversal-j');assert.equal(report.transactions[0].original_journal_id,'original-j');assert.equal(report.coverage.complete,true);
});

test('quantities rank within exact saved units, two lines count one document, and no current unit conversion is inferred',()=>{
 const rows=[sale('a',{subtotal:50,total:50}),sale('b',{subtotal:20,total:20}),sale('c',{subtotal:10,total:10})];
 const report=buildProductSalesReport({rows,invoiceLines:[invoiceLine('a',{id:'a1',quantity:2,total:20}),invoiceLine('a',{id:'a2',quantity:3,total:30}),invoiceLine('b',{product_id:'q',product_name:'Another',quantity:2,unit:'carton',total:20}),invoiceLine('c',{product_id:'r',product_name:'Powder',quantity:10,unit:'kg',total:10})],products:[{...product,storage_unit:'carton',sales_unit:'case'}]});
 const p=report.products.find(item=>item.product_id==='p');assert.equal(p.net_quantity,5);assert.equal(p.transaction_count,1);assert.equal(p.transaction_ids.length,2);assert.equal(p.unit,'ea');assert.equal(p.rank,1);assert.deepEqual(report.unit_totals.map(item=>[item.unit,item.net_quantity]),[['carton',2],['ea',5],['kg',10]]);
 assert.ok(report.products.every(item=>item.rank===1),'each different saved unit has its own rank');
 assert.equal(rankProductSales(report.products,{metric:'revenue'})[0].product_id,'p');assert.deepEqual(rankProductSales(report.products,{unit:'kg'}).map(item=>item.product_id),['r']);
});

test('missing product IDs and unknown units remain isolated rather than merging names or guessing identity',()=>{
 const report=buildProductSalesReport({rows:[sale('a'),sale('b'),sale('c'),sale('d')],invoiceLines:[invoiceLine('a',{product_id:'',product_name:'Same name'}),invoiceLine('b',{product_id:'',product_name:'Same name'}),invoiceLine('c',{unit:''}),invoiceLine('d',{unit:''})],products:[product,{id:'other',name:'Same name',image_url:'/unrelated.png'}]});
 assert.equal(report.products.length,4);assert.ok(report.products.every(item=>item.rank===null));assert.equal(report.coverage.unranked_product_groups,4);assert.deepEqual(report.unit_totals,[{unit:'ea',sold_quantity:2,reversed_quantity:0,net_quantity:2}]);assert.equal(report.products.filter(item=>item.identity_unknown).every(item=>item.image_url===''),true);assert.equal(report.coverage.complete,true);
});

test('legacy name changes preserve saved transaction names while grouping actual product IDs and offsets',()=>{
 const original=sale('a'),reversal=sale('a',{id:'reversal:a',is_reversal:true,subtotal:-100,tax:0,total:-100,journal_id:'rev-a'});
 const report=buildProductSalesReport({rows:[original,reversal],invoiceLines:[invoiceLine('a',{product_name:'Old name'})],products:[product]});assert.equal(report.products.length,1);assert.equal(report.products[0].net_quantity,0);assert.equal(report.products[0].total_revenue,0);assert.equal(report.products[0].sold_total_revenue,100);assert.equal(report.products[0].reversed_total_revenue,100);assert.equal(report.transactions[0].product_name,'Old name');
});

test('linked invoice and Commercial supply with the same posting cannot count twice',()=>{
 const invoice=sale('i',{journal_id:'same-j'}),field=sale('f',{id:'field:f',source:'Commercial supply',journal_id:'same-j'});
 const report=buildProductSalesReport({rows:[invoice,field],invoiceLines:[invoiceLine('i',{quantity:99})],fieldLines:[{id:'fl',field_sale_id:'f',product_id:'p',product_name:'Yoghurt',unit:'ea',quantity:1,discount:0,line_total:100,tax_amount:0}]});assert.equal(report.products[0].net_quantity,1);assert.equal(report.totals.total_revenue,100);assert.equal(report.coverage.included_documents,1);assert.equal(report.coverage.excluded_documents,1);assert.ok(report.issues.some(issue=>issue.code==='duplicate_posting'));
});

test('orphan, missing and mismatched lines cannot silently populate or inflate product totals',()=>{
 const report=buildProductSalesReport({rows:[sale('tax',{subtotal:100,tax:19.25,total:119.25}),sale('missing')],invoiceLines:[invoiceLine('tax',{total:119.25,tax_amount:undefined}),invoiceLine('orphan',{product_id:'private',product_name:'Not in register',total:999})]});assert.equal(report.products.length,0);assert.equal(report.transactions.length,0);assert.equal(report.coverage.excluded_documents,2);assert.equal(report.coverage.expected_total_revenue,219.25);assert.equal(report.coverage.difference_total_revenue,219.25);assert.equal(report.issues.length,2);assert.doesNotMatch(JSON.stringify(report),/Not in register/);
});

test('unknown or invalid discounts remain nullable without discarding reconciled demand and revenue',()=>{
 const report=buildProductSalesReport({rows:[sale('a',{subtotal:100,tax:19.25,total:119.25}),sale('b')],invoiceLines:[invoiceLine('a',{discount_amount:undefined,total:119.25,tax_amount:19.25}),invoiceLine('b',{discount_amount:-1})]});assert.equal(report.coverage.complete,true);assert.equal(report.coverage.discount_complete,false);assert.equal(report.coverage.unknown_discount_count,2);assert.equal(report.totals.discount,null);assert.equal(report.products[0].discount,null);assert.equal(report.products[0].net_quantity,2);assert.equal(report.totals.total_revenue,219.25);assert.equal(report.transactions[0].discount,null);assert.equal(report.transactions[1].discount,null);
});

test('saved list-price discounts and inconsistent document discounts are reported honestly',()=>{
 const field=sale('f',{id:'field:f',source:'Commercial supply',subtotal:180,total:180});
 const line={id:'fl',field_sale_id:'f',product_id:'p',product_name:'Yoghurt',unit:'ea',quantity:2,unit_price:90,list_price:100,line_total:180,tax_amount:0};
 const known=buildProductSalesReport({rows:[field],fieldLines:[line],fieldSales:[{id:'f',discount_total:20,price_includes_vat:true}]});assert.equal(known.totals.discount,20);
 const mismatch=buildProductSalesReport({rows:[field],fieldLines:[{...line,discount:20}],fieldSales:[{id:'f',discount_total:25}]});assert.equal(mismatch.totals.discount,null);assert.equal(mismatch.coverage.complete,true);assert.match(mismatch.issues[0].reason,/discounts do not reconcile/);
});

test('fractional quantities and cent amounts aggregate exactly, while sub-cent and quantity precision errors are excluded',()=>{
 const rows=[sale('a',{subtotal:.1,total:.1}),sale('b',{subtotal:.2,total:.2})];const valid=buildProductSalesReport({rows,invoiceLines:[invoiceLine('a',{quantity:.1,unit:'kg',unit_price:1,total:.1}),invoiceLine('b',{quantity:.2,unit:'kg',unit_price:1,total:.2})]});assert.equal(valid.products[0].net_quantity,.3);assert.equal(valid.totals.total_revenue,.3);
 for(const invalid of [{quantity:1.0001},{tax_amount:.001},{total:100.001},{quantity:Infinity}]){const result=buildProductSalesReport({rows:[sale('x')],invoiceLines:[invoiceLine('x',invalid)]});assert.equal(result.coverage.excluded_documents,1);assert.equal(result.transactions.length,0);}
});

test('unsafe aggregate totals stop the report instead of emitting imprecise money',()=>{
 const rows=['a','b','c'].map(id=>sale(id,{subtotal:40000000000000,total:40000000000000}));const lines=['a','b','c'].map(id=>invoiceLine(id,{unit_price:40000000000000,total:40000000000000}));assert.throws(()=>buildProductSalesReport({rows,invoiceLines:lines}),/supported precision/);
});

test('duplicate saved lines and missing journal proof are visibly excluded without partial attribution',()=>{
 const duplicate=invoiceLine('a');const report=buildProductSalesReport({rows:[sale('a'),sale('b',{journal_id:''})],invoiceLines:[duplicate,{...duplicate},invoiceLine('b')]});assert.equal(report.products.length,0);assert.equal(report.coverage.excluded_documents,2);assert.equal(report.coverage.complete,false);assert.ok(report.issues.some(issue=>issue.code==='missing_proof'));
 const row=sale('c');const repeated=buildProductSalesReport({rows:[row,row],invoiceLines:[invoiceLine('c')]});assert.equal(repeated.coverage.included_documents,1);assert.equal(repeated.coverage.excluded_documents,1);assert.equal(repeated.transactions.length,1);
});


test('a taxable document with any missing saved line tax stays unallocated even if another line appears to cover its tax',()=>{
 const row=sale('tax',{subtotal:200,tax:19.25,total:219.25});const report=buildProductSalesReport({rows:[row],invoiceLines:[invoiceLine('tax',{id:'taxable',total:119.25,tax_amount:19.25}),invoiceLine('tax',{id:'unknown-tax',total:100,tax_amount:undefined})]});assert.equal(report.products.length,0);assert.equal(report.coverage.excluded_documents,1);assert.match(report.issues[0].reason,/tax is unavailable/);
});

test('whitelisted metadata cannot carry nested private values through malformed historical labels',()=>{
 const row=sale('a',{commercial_name:{private_salary:100},customer_name:{private_balance:50}}),line=invoiceLine('a',{unit:' ',product_id:' '});const report=buildProductSalesReport({rows:[row],invoiceLines:[line]});assert.equal(report.products[0].rank,null);assert.equal(report.products[0].identity_unknown,true);assert.equal(report.products[0].unit_unknown,true);assert.equal(report.transactions[0].unit,'');assert.doesNotMatch(JSON.stringify(report),/private_salary|private_balance/);
});
