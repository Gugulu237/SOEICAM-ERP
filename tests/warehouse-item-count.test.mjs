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
test('multi-lot shortages allocate existing stock FEFO and retain each layer carrying value and quality status',()=>{
 const before=structuredClone(rows),automatic=physicalItemCount(item,rows,4);
 assert.equal(automatic.needs_batches,undefined);assert.equal(automatic.allocation_method,'fefo');
 assert.deepEqual(automatic.batch_counts,{a:0,b:4});assert.equal(automatic.value_difference,-120);
 assert.deepEqual(automatic.rows.map(row=>[row.balance_id,row.counted_quantity,row.value_after,row.qc_status,row.expiry_date]),[['a',0,0,'approved','2027-01-01'],['b',4,80,'quarantine','2027-02-01']]);
 assert.deepEqual(automatic.batch_rows.map(row=>[row.balance_id,row.counted_quantity]),[['a',0],['b',4]]);
 const journal=itemCountJournal([automatic],[item],loss,gain);
 assert.equal(journal.find(row=>row.id==='loss').debit,120);assert.equal(journal.find(row=>row.id==='stock').credit,120);
 assert.equal(journal.reduce((sum,row)=>sum+row.debit-row.credit,0),0);
 assert.deepEqual(rows,before);
});

test('packaging and raw material shortages use recorded storage quantities and costs exactly like finished goods without new lot or expiry requirements',()=>{
 const variants=[
  {inventory_type:'packaging',count_group:'packaging',unit:'ea'},
  {inventory_type:'raw_material',material_group:'Packaging',count_group:'packaging',unit:'ea'},
  {inventory_type:'raw_material',count_group:'ingredients',unit:'kg',purchase_to_storage_factor:25},
  {inventory_type:'assembly',count_group:'finished',unit:'ea'},
 ];
 for(const variant of variants){
  const product={...item,...variant,unit_cost:999},layers=[
   {...rows[0],lot_number:'',expiry_date:'',book_quantity:10.125,book_value:25.5,unit_cost:999},
   {...rows[1],lot_number:'',expiry_date:'',book_quantity:5.125,book_value:51.25,unit_cost:999},
  ];
  const plan=physicalItemCount(product,layers,8.125);
  assert.equal(plan.needs_batches,undefined);assert.equal(plan.needs_lot,undefined);assert.equal(plan.allocation_method,'fefo');
  assert.deepEqual(plan.batch_counts,{a:3,b:5.125});assert.equal(plan.value_difference,-17.94);
  assert.equal(plan.rows[0].value_after,7.56);assert.equal(plan.rows[0].lot_number,'');assert.equal(plan.rows[0].expiry_date,'');
  assert.equal(plan.rows[0].qc_status,'approved');assert.equal(layers[1].qc_status,'quarantine');
  const journal=itemCountJournal([plan],[product],loss,undefined);
  assert.equal(journal.find(line=>line.id==='loss').debit,17.94);assert.equal(journal.find(line=>line.id==='stock').credit,17.94);
  assert.equal(journal.reduce((sum,line)=>sum+line.debit-line.credit,0),0);
 }
});

test('imported material quantities with binary noise support shortages without mutating stock evidence or unchanged layers',()=>{
 for(const fixture of [
  {inventory_type:'raw_material',count_group:'ingredients',unit:'kg',quantities:[0.3-0.1,49.99999999999999],values:[100,500],count:50.1,after:[0.1,50],loss:50},
  {inventory_type:'packaging',count_group:'packaging',unit:'ea',quantities:[49.99999999999999,24.999999999999996],values:[1000,250],count:70,after:[45,25],loss:100},
 ]){
  const product={...item,...fixture},layers=rows.map((row,index)=>({...row,book_quantity:fixture.quantities[index],book_value:fixture.values[index],lot_number:'',expiry_date:'',unit_cost:999})),before=structuredClone(layers);
  const plan=physicalItemCount(product,layers,fixture.count);
  assert.equal(plan.allocation_method,'fefo');assert.equal(plan.needs_batches,undefined);assert.equal(plan.needs_lot,undefined);
  assert.deepEqual(plan.batch_counts,{a:fixture.after[0],b:fixture.after[1]});assert.equal(plan.rows.length,1);assert.equal(plan.rows[0].fingerprint,'A');
  assert.equal(plan.rows[0].value_after,fixture.values[0]-fixture.loss);assert.equal(plan.value_difference,-fixture.loss);assert.deepEqual(layers,before);
  const manual=physicalItemCount(product,layers,fixture.count,{a:fixture.after[0]});
  assert.deepEqual(manual.batch_counts,plan.batch_counts);assert.equal(manual.value_difference,plan.value_difference);assert.equal(manual.allocation_method,undefined);
  const balances=layers.map(row=>({id:row.balance_id,product_id:item.id,quantity:row.book_quantity})),saved=structuredClone(balances);
  const counts=[{product_id:item.id,counted_quantity:fixture.count,allocation_method:'fefo',snapshots:layers.map(row=>({balance_id:row.balance_id,fingerprint:row.fingerprint}))}],inputs=plan.rows.map(row=>({balance_id:row.balance_id,counted_quantity:row.counted_quantity}));
  const snapshot=balance=>layers.find(row=>row.balance_id===balance.id);
  const summary=verifyItemCountTotals(counts,inputs,balances,snapshot)[0];
  assert.equal(summary.counted_quantity,fixture.count);assert.equal(summary.allocation_method,'fefo');assert.equal(summary.book_quantity,Math.round(fixture.quantities.reduce((sum,q)=>sum+q,0)*1000)/1000);assert.deepEqual(balances,saved);
  assert.throws(()=>verifyItemCountTotals(counts,inputs,balances,balance=>({...snapshot(balance),fingerprint:balance.id==='b'?'changed':snapshot(balance).fingerprint})),/Stock changed/);
  const journal=itemCountJournal([plan],[product],loss,undefined);assert.equal(journal.find(line=>line.id==='loss').debit,fixture.loss);assert.equal(journal.find(line=>line.id==='stock').credit,fixture.loss);
 }
});

test('binary-noise handling does not accept actual excess precision, negative books or residual values on empty stock',()=>{
 for(const patch of [{book_quantity:0.2004},{book_quantity:49.9999999},{book_quantity:-Number.EPSILON},{book_quantity:Number.EPSILON},{book_quantity:0,book_value:0.01}]){
  assert.throws(()=>physicalItemCount({...item,count_group:'ingredients'},[{...rows[0],...patch},rows[1]],1),/accounting correction/);
 }
 assert.throws(()=>physicalItemCount(item,rows,13.0004),/three decimal places/);
});

test('explicit batch counts replace automatic allocation and must reconcile to the physical total',()=>{
 const before=structuredClone(rows);
 const plan=physicalItemCount(item,rows,13,{a:8});
 assert.equal(plan.value_difference,-20);assert.equal(plan.rows.length,1);assert.equal(plan.rows[0].balance_id,'a');assert.equal(plan.rows[0].qc_status,'approved');
 assert.equal(plan.allocation_method,undefined);assert.deepEqual(plan.batch_counts,{a:8,b:5});
 const differentLot=physicalItemCount(item,rows,13,{b:3});
 assert.equal(differentLot.value_difference,-40);assert.equal(differentLot.rows[0].balance_id,'b');
 for(const overrides of [{a:9},{b:4}]){
  const incomplete=physicalItemCount(item,rows,13,overrides);
  assert.equal(incomplete.needs_batches,true);assert.deepEqual(incomplete.rows,[]);assert.equal(incomplete.allocation_method,undefined);
 }
 assert.equal(physicalItemCount(item,rows,0,{a:0}).needs_batches,true);
 assert.equal(physicalItemCount(item,[rows[0]],8,{a:9}).needs_batches,true);
 assert.throws(()=>physicalItemCount(item,rows,13,{a:''}),/explicit physical count/);
 assert.throws(()=>physicalItemCount(item,rows,13,{a:8,b:''}),/explicit physical count/);
 assert.deepEqual(physicalItemCount(item,rows,13,{a:8,b:undefined}).batch_counts,{a:8,b:5});
 assert.throws(()=>physicalItemCount(item,rows,13,{missing:8}),/Stock changed/);
 assert.deepEqual(rows,before);assert.throws(()=>physicalItemCount(item,rows,13,{a:-1}),/non-negative/);
});

test('FEFO shortages are stable across input order, with balance ID tie-breaks and undated stock last',()=>{
 const dated=[{...rows[0],balance_id:'z',expiry_date:'2027-01-01'},{...rows[1],balance_id:'b',expiry_date:'2027-01-01'},{...rows[0],balance_id:'a',expiry_date:''}];
 for(const input of [dated,[...dated].reverse(),[dated[2],dated[0],dated[1]]]){
  const plan=physicalItemCount(item,input,17);
  assert.equal(plan.needs_batches,undefined);assert.equal(plan.batch_counts.b,0);assert.equal(plan.batch_counts.z,7);assert.equal(plan.batch_counts.a,10);assert.equal(plan.value_difference,-130);
 }
});

test('fractional shortages preserve total quantities, carrying-value cents and exhausted snapshots',()=>{
 const layers=[{...rows[0],book_quantity:0.333,book_value:1,unit_cost:3},{...rows[1],book_quantity:0.667,book_value:2,unit_cost:3},{...rows[0],balance_id:'old',book_quantity:0,book_value:0}];
 const partial=physicalItemCount(item,layers,0.666);
 assert.deepEqual(partial.batch_counts,{a:0,b:0.666,old:0});assert.equal(partial.rows.reduce((sum,row)=>sum+row.difference,0),-0.334);
 assert.equal(partial.rows[1].value_after,2);assert.equal(partial.value_difference,-1);assert.equal(partial.rows.some(row=>row.balance_id==='old'),false);
 const zero=physicalItemCount(item,layers,0);assert.equal(zero.value_difference,-3);assert.ok(zero.rows.every(row=>row.value_after===0));
 assert.throws(()=>physicalItemCount(item,[{...rows[0],book_value:0},rows[1]],13),/accounting correction/);
 assert.throws(()=>physicalItemCount(item,[{...rows[0],book_quantity:-1},rows[1]],3),/accounting correction/);
});

test('ambiguous multi-lot surpluses still require explicit lot counts',()=>{
 const pending=physicalItemCount(item,rows,17);assert.equal(pending.needs_batches,true);assert.deepEqual(pending.rows,[]);assert.equal(pending.allocation_method,undefined);
 const explicit=physicalItemCount(item,rows,17,{a:12});assert.equal(explicit.needs_batches,undefined);assert.equal(explicit.value_difference,20);
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

test('automatic shortage audit evidence is verified against current FEFO allocation, not trusted from the client',()=>{
 const layers=[...rows,{...rows[0],balance_id:'old',book_quantity:0,book_value:0,fingerprint:'OLD'}];
 const balances=layers.map(row=>({id:row.balance_id,product_id:'milk',quantity:row.book_quantity}));
 const counts=[{product_id:'milk',counted_quantity:13,allocation_method:'fefo',snapshots:layers.map(row=>({balance_id:row.balance_id,fingerprint:row.fingerprint}))}];
 const snapshot=balance=>layers.find(row=>row.balance_id===balance.id),inputs=[{balance_id:'a',counted_quantity:8}];
 const result=verifyItemCountTotals(counts,inputs,balances,snapshot)[0];
 assert.equal(result.allocation_method,'fefo');assert.equal(result.difference,-2);
 assert.equal(verifyItemCountTotals(counts,[...inputs,{balance_id:'b',counted_quantity:5},{balance_id:'old',counted_quantity:0}],balances,snapshot)[0].allocation_method,'fefo');
 assert.throws(()=>verifyItemCountTotals(counts,[{balance_id:'b',counted_quantity:3}],balances,snapshot),/Automatic shortage allocation changed/);
 assert.throws(()=>verifyItemCountTotals(counts,[{balance_id:'a',counted_quantity:7},{product_id:'milk',counted_quantity:1}],balances,snapshot),/each existing stock record/);
 assert.throws(()=>verifyItemCountTotals([{...counts[0],allocation_method:'anything'}],inputs,balances,snapshot),/supported stock count allocation/);
 const manual=[{...counts[0]}];delete manual[0].allocation_method;
 assert.equal(Object.hasOwn(verifyItemCountTotals(manual,[{balance_id:'b',counted_quantity:3}],balances,snapshot)[0],'allocation_method'),false);
 assert.throws(()=>verifyItemCountTotals([{...counts[0],snapshots:counts[0].snapshots.slice(0,2)}],inputs,balances,snapshot),/Stock changed/);
 assert.throws(()=>verifyItemCountTotals(counts,inputs,balances,balance=>({...snapshot(balance),fingerprint:balance.id==='b'?'changed':snapshot(balance).fingerprint})),/Stock changed/);
 const zero=[{...counts[0],counted_quantity:0}];assert.throws(()=>verifyItemCountTotals(zero,[{balance_id:'a',counted_quantity:0},{balance_id:'b',counted_quantity:0}],balances,snapshot),/requires a lower item count across multiple/);
});
test('posted count receipts show the item total, batch audit and actual debit-credit accounts together',()=>{
 const result={id:'WA-1',reference:'PHYSICAL-COUNT',date:'2026-11-03',warehouse_id:'cold',journal_number:'JV-1',value_difference:-20,item_counts:[{product_name:'Milk',unit:'kg',book_quantity:15,counted_quantity:13,difference:-2}],rows:[{...rows[0],product_name:'Milk',unit:'kg',counted_quantity:8,difference:-2,value_after:80,value_difference:-20}],loss_account:loss,gain_account:null,posting_lines:[{account_number:'6590',account_name:'Losses',debit:20,credit:0},{account_number:'1310',account_name:'Stock',debit:0,credit:20}]};
 const report=warehouseAdjustmentDocument(result);assert.deepEqual(report.sections[0].rows[0],['Milk','kg',15,13,-2]);
 assert.equal(report.sections.length,3);assert.equal(report.sections[2].rows[1][3],20);
});

