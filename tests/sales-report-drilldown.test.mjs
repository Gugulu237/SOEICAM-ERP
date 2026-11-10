import test from 'node:test';
import assert from 'node:assert/strict';
import {salesReportGroups,salesDrillRows,salesMetricTotal,salesSourcePath,salesTransactionsDocument,productSalesDocument} from '../src/lib/sales-report-drilldown.js';
const period={from:'2026-10-01',to:'2026-10-31'};
const rows=[
 {id:'a',document_id:'i1',document_number:'INV-1',source:'Invoice',date:'2026-10-01',customer_id:'a',customer_name:'Same name',commercial_id:'seller',commercial_name:'Saved seller',subtotal:100,tax:10,total:110,collected:40,journal_id:'j1',journal_number:'JV-1'},
 {id:'b',document_id:'i2',document_number:'INV-2',source:'Invoice',date:'2026-10-01',customer_id:'a',customer_name:'Same name',commercial_id:'seller',commercial_name:'Saved seller',subtotal:200,tax:20,total:220,collected:220,journal_id:'j2',journal_number:'JV-2'},
 {id:'c',document_id:'i3',document_number:'INV-3',source:'Invoice',date:'2026-10-02',customer_id:'b',customer_name:'Same name',subtotal:50,tax:0,total:50,collected:0,journal_id:'j3',journal_number:'JV-3'},
 {id:'r',document_id:'i4',document_number:'Reversal INV-4',source:'Invoice',date:'2026-10-03',customer_id:'a',customer_name:'Same name',commercial_id:'seller',commercial_name:'Saved seller',subtotal:-10,tax:-1,total:-11,collected:-4,is_reversal:true,journal_id:'jr',journal_number:'JV-REV',original_journal_id:'j4'},
];
test('customer, salesperson and day totals drill to exact identity-preserving source rows and signed journal totals',()=>{
 const customers=salesReportGroups(rows,'customers');assert.equal(customers.length,2);assert.equal(customers.find(row=>row.id==='a').total,319);assert.equal(customers.find(row=>row.id==='a').sales_count,2);assert.equal(customers.find(row=>row.id==='a').reversal_count,1);
 for(const kind of ['customers','commercials','daily'])for(const group of salesReportGroups(rows,kind)){const matching=salesDrillRows({rows},{kind,key:group.id});assert.equal(salesMetricTotal(matching),group.total);assert.equal(salesMetricTotal(matching,'subtotal'),group.subtotal);assert.equal(salesMetricTotal(matching,'tax'),group.tax);}
 assert.deepEqual(salesDrillRows({rows},{kind:'customers',key:'a'}).map(row=>row.id),['a','b','r']);assert.equal(salesMetricTotal(salesDrillRows({rows},{kind:'collected'}),'collected'),256);assert.equal(salesMetricTotal(salesDrillRows({rows},{kind:'credit'}),'credit'),113);assert.equal(salesDrillRows({rows},{kind:'sales'}).length,3);
 const report=salesTransactionsDocument(salesDrillRows({rows},{kind:'customers',key:'a'}),period,{title:'Customer A'});assert.equal(report.sections[1].rows[0][1],319);assert.ok(report.sections[0].rows.flat().includes('JV-REV'));assert.equal(report.sections[0].rows.flat().includes('JV-3'),false);
});
test('cash/credit sums preserve cents and current balances drill across all dates independently from selected sales period',()=>{
 assert.equal(salesMetricTotal([{total:0.1},{total:0.2},{total:-0.1}]),0.2);assert.equal(salesMetricTotal([{total:0.3,collected:0.1}],'credit'),0.2);
 const data={rows,overview:{pending:[{id:'old',date:'2025-01-01',due_date:'2025-01-30',balance:100},{id:'future',date:'2026-10-31',due_date:'2026-12-01',balance:50}]}};const all=salesDrillRows(data,{kind:'balances'},'2026-11-10'),overdue=salesDrillRows(data,{kind:'overdue'},'2026-11-10');assert.equal(salesMetricTotal(all,'balance'),150);assert.equal(salesMetricTotal(overdue,'balance'),100);assert.equal(salesTransactionsDocument(all,period,{metric:'balance',currentBalances:true}).metadata[0][1],'Current unpaid balances · all dates');
});
test('source paths remain role-gated and product exports keep exact saved units without an overall quantity sum',()=>{
 assert.equal(salesSourcePath(rows[0],{}),'');assert.equal(salesSourcePath({...rows[0],document_id:'i/1'},{open_invoices:true}),'/sales/invoices/i%2F1?from=sales');assert.equal(salesSourcePath({source:'Commercial supply',document_id:'field'},{open_field_sales:true}),'/field-review/field');
 const report={products:[{rank:1,product_name:'Yoghurt',unit:'ea',sold_quantity:10,reversed_quantity:2,net_quantity:8,discount:5,discount_basis:'including_tax',net_revenue:100,tax:19.25,total_revenue:119.25,sale_count:1,reversal_count:1},{rank:1,product_name:'Milk',unit:'kg',sold_quantity:4,reversed_quantity:0,net_quantity:4,discount:null,discount_basis:'unknown',net_revenue:200,tax:0,total_revenue:200,sale_count:1,reversal_count:0}],issues:[]};const exported=productSalesDocument(report,period,'ea');assert.equal(exported.sections[0].rows.length,1);assert.equal(exported.sections[0].rows[0][2],'ea');assert.equal(exported.sections[0].rows[0][5],8);assert.equal(exported.sections[0].totals,undefined);assert.match(exported.notes.join(' '),/Do not add quantities/);
});
