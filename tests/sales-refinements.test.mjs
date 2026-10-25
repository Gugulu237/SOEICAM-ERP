import test from 'node:test';
import assert from 'node:assert/strict';
import {salesAnalysisDocument,salesStatusDocument} from '../src/lib/sales-report-documents.js';
import {finishedStockForSale,factorySalesLocations} from '../src/lib/sales-stock.js';
import {reportPrintHtml,reportWorkbook} from '../src/lib/report-document.js';

const period={from:'2026-10-01',to:'2026-10-25'};
const rows=[
  {document_number:'PRIVATE-OP-1',customer_id:'a',customer_name:'Same name',commercial_id:'agent',commercial_name:'Agent',date:'2026-10-01',subtotal:100,tax:10,total:110,collected:40},
  {document_number:'PRIVATE-OP-2',customer_id:'a',customer_name:'Same name',commercial_id:'agent',commercial_name:'Agent',date:'2026-10-01',subtotal:200,tax:20,total:220,collected:220},
  {document_number:'PRIVATE-OP-3',customer_id:'b',customer_name:'Same name',date:'2026-10-02',subtotal:50,tax:0,total:50,collected:0},
];
test('selected Sales reports aggregate the complete scope and never export the operations list',()=>{
  const data={rows,unverified_documents:2};
  const daily=salesAnalysisDocument(data,period,'daily');
  assert.equal(daily.title,'Daily sales report');
  assert.deepEqual(daily.sections[1].rows,[['2026-10-01',2,300,30,330,260,70],['2026-10-02',1,50,0,50,0,50]]);
  assert.deepEqual(daily.sections[1].totals,[['Total',3,350,30,380,260,120]]);
  const customers=salesAnalysisDocument(data,period,'customers');
  assert.equal(customers.sections[1].rows.length,2,'distinct customers retain their identity even when names match');
  const commercial=salesAnalysisDocument(data,period,'commercials');
  assert.equal(commercial.sections[1].rows[0][0],'Agent');
  assert.equal(commercial.sections[1].rows[1][0],'Factory / company');
  const html=reportPrintHtml(daily);assert.match(html,/Daily sales report/);assert.doesNotMatch(html,/PRIVATE-OP/);
  assert.ok(reportWorkbook(daily).length>1000);
  assert.throws(()=>salesAnalysisDocument(data,period,'unknown'),/Choose a sales report/);
});

test('Field reports separate drafts and accounting-review items from recognized Commercial totals',()=>{
  const report=salesStatusDocument('field',[
    {status:'draft',total:9000,commercial_name:'Agent'},
    {status:'approved_posted',total:5000,subtotal:5000,amount_collected:5000,commercial_name:'Agent',accounting_verified:false},
    {status:'approved_posted',total:200,subtotal:200,amount_collected:50,commercial_name:'Agent',accounting_verified:true},
  ],period);
  assert.equal(report.sections[0].rows.find(r=>r[0]==='Accounting review')[2],5000);
  assert.deepEqual(report.sections[1].rows,[['Agent',1,200,0,200,50,150]]);
  const invoices=salesStatusDocument('invoices',[{status:'draft',total:500,customer_balance:500},{status:'posted',total:200,customer_balance:25,accounting_verified:true}]);
  assert.deepEqual(invoices.sections[0].rows,[['draft',1,500,0],['posted',1,200,25]]);
});

test('factory sale options offer only configured finished goods in usable locations, excluding raw, packaging, expired, held and vehicle stock',()=>{
  const products=[{id:'y',inventory_type:'assembly',is_active:true},{id:'milk',inventory_type:'raw_material'},{id:'cup',inventory_type:'packaging'},{id:'draft',inventory_type:'assembly',configuration_status:'draft'}];
  const warehouses=['cold_room','raw_material','packaging','wip','vehicle','quarantine','general'].map(type=>({id:type,warehouse_type:type,is_active:true}));
  const balances=[
    {warehouse_id:'cold_room',product_id:'y',quantity:'2.5',qc_status:'approved',expiry_date:'2026-11-01'},
    {warehouse_id:'cold_room',product_id:'y',quantity:'1.5',qc_status:'approved',expiry_date:'2026-11-02'},
    {warehouse_id:'cold_room',product_id:'y',quantity:50,qc_status:'quarantine'},
    {warehouse_id:'cold_room',product_id:'y',quantity:30,expiry_date:'2020-01-01'},
    {warehouse_id:'cold_room',product_id:'draft',quantity:5},
    {warehouse_id:'cold_room',product_id:'milk',quantity:10},
    {warehouse_id:'raw_material',product_id:'y',quantity:5},
    {warehouse_id:'vehicle',product_id:'y',quantity:5},
    {warehouse_id:'general',product_id:'cup',quantity:10},
  ];
  assert.deepEqual(factorySalesLocations(warehouses,products,balances,'2026-10-25').map(w=>w.id),['cold_room']);
  assert.deepEqual(finishedStockForSale(products,balances,'cold_room','2026-10-25').map(p=>[p.id,p.available]),[['y',4]]);
  assert.deepEqual(finishedStockForSale(products,balances,'','2026-10-25'),[]);
});
