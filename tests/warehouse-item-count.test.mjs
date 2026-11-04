import test from 'node:test';
import assert from 'node:assert/strict';
import {physicalItemCount,itemCountJournal,verifyItemCountTotals} from '../src/lib/warehouse-item-count.js';
import {warehouseAdjustmentDocument} from '../src/lib/report-models.js';
const item={id:'milk',name:'Milk',unit:'kg',unit_cost:10,inventory_account:{id:'stock',name:'Stock',account_number:'1310'}};
const rows=[{balance_id:'a',product_id:'milk',book_quantity:10,book_value:100,unit_cost:10,fingerprint:'A',lot_number:'A',expiry_date:'2027-01-01',qc_status:'approved'},{balance_id:'b',product_id:'milk',book_quantity:5,book_value:100,unit_cost:20,fingerprint:'B',lot_number:'B',expiry_date:'2027-02-01',qc_status:'quarantine'}];
const loss={id:'loss',name:'Losses',account_number:'6590'},gain={id:'gain',name:'Surplus',account_number:'7580'};

test('new packaging counts need quantity and carrying cost but no supplier batch or expiry',()=>{
 for(const packaging of [{inventory_type:'packaging'},{count_group:'packaging',inventory_type:'raw_material'},{material_group:'Packaging',inventory_type:'raw_material'}]){
  const plan=physicalItemCount({...item,...packaging},[],100);
  assert.equal(plan.needs_lot,undefined);assert.equal(plan.rows[0].lot_number,'');assert.equal(plan.rows[0].expiry_date,'');assert.equal(plan.value_difference,1000);assert.equal(plan.rows[0].qc_status,'quarantine');
 }
 assert.equal(physicalItemCount({...item,inventory_type:'finished_product'},[],100).needs_lot,true);
});
test('an item count never invents a batch allocation; explicit batch counts use their individual carrying values',()=>{
 const before=structuredClone(rows),pending=physicalItemCount(item,rows,13);
 assert.equal(pending.needs_batches,true);assert.deepEqual(pending.rows,[]);
 const plan=physicalItemCount(item,rows,13,{a:8});
 assert.equal(plan.value_difference,-20);assert.equal(plan.rows.length,1);assert.equal(plan.rows[0].balance_id,'a');assert.equal(plan.rows[0].qc_status,'approved');
 assert.deepEqual(rows,before);assert.throws(()=>physicalItemCount(item,rows,13,{a:-1}),/non-negative/);
});
test('zero counts clear all known quantities while historical empty lots do not complicate an unambiguous shortage',()=>{
 const zero=physicalItemCount(item,rows,0);
 assert.equal(zero.needs_batches,undefined);assert.equal(zero.value_difference,-200);assert.ok(zero.rows.every(row=>row.counted_quantity===0));
 const old={...rows[1],book_quantity:0,book_value:0},plan=physicalItemCount(item,[rows[0],old],8);
 assert.equal(plan.needs_batches,undefined);assert.deepEqual(plan.rows.map(row=>row.balance_id),['a']);assert.equal(plan.rows[0].counted_quantity,8);
 assert.equal(physicalItemCount(item,rows,15).rows.length,0);
});
test('surplus evidence and balanced account preview never manufacture a cost or quality release',()=>{
 assert.equal(physicalItemCount(item,[],3).needs_lot,true);
 const plan=physicalItemCount(item,[],3,{}, {lot_number:'FOUND',expiry_date:'2027-03-01'});
 assert.equal(plan.rows[0].qc_status,'quarantine');
 const lines=itemCountJournal([plan],[item],loss,gain);assert.equal(lines.find(row=>row.id==='stock').debit,30);assert.equal(lines.find(row=>row.id==='gain').credit,30);
 assert.equal(lines.reduce((sum,row)=>sum+row.debit-row.credit,0),0);
 assert.throws(()=>physicalItemCount({...item,unit_cost:0},[],3,{}, {lot_number:'FOUND'}),/carrying cost/);
});
test('count proof includes unchanged and empty stock records, and rejects hidden changes outside its item scope',()=>{
 const balances=rows.map(row=>({id:row.balance_id,product_id:'milk',quantity:row.book_quantity}));
 const counts=[{product_id:'milk',counted_quantity:13,snapshots:rows.map(row=>({balance_id:row.balance_id,fingerprint:row.fingerprint}))}];
 const inputs=[{balance_id:'a',counted_quantity:8}],snapshot=balance=>rows.find(row=>row.balance_id===balance.id);
 assert.equal(verifyItemCountTotals(counts,inputs,balances,snapshot)[0].difference,-2);
 assert.throws(()=>verifyItemCountTotals(counts,[...inputs,{product_id:'other',counted_quantity:5}],balances,snapshot),/belong to a counted item/);
 assert.throws(()=>verifyItemCountTotals(counts,inputs,[...balances,{id:'new',product_id:'milk',quantity:0}],snapshot),/changed/);
});
test('posted count receipts show the item total, batch audit and actual debit-credit accounts together',()=>{
 const result={id:'WA-1',reference:'PHYSICAL-COUNT',date:'2026-11-03',warehouse_id:'cold',journal_number:'JV-1',value_difference:-20,item_counts:[{product_name:'Milk',unit:'kg',book_quantity:15,counted_quantity:13,difference:-2}],rows:[{...rows[0],product_name:'Milk',unit:'kg',counted_quantity:8,difference:-2,value_after:80,value_difference:-20}],loss_account:loss,gain_account:null,posting_lines:[{account_number:'6590',account_name:'Losses',debit:20,credit:0},{account_number:'1310',account_name:'Stock',debit:0,credit:20}]};
 const report=warehouseAdjustmentDocument(result);assert.deepEqual(report.sections[0].rows[0],['Milk','kg',15,13,-2]);
 assert.equal(report.sections.length,3);assert.equal(report.sections[2].rows[1][3],20);
});

