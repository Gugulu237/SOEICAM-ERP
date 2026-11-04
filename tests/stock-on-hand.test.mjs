import test from 'node:test';
import assert from 'node:assert/strict';
import {finishedStockForSale} from '../src/lib/sales-stock.js';
import {stockOnHandGroups} from '../src/lib/stock-on-hand.js';
import {canAdjustInventory} from '../src/lib/inventory-adjustment-access.js';
import {adjustmentAccess} from '../src/server/domain/inventory-adjustment-access.js';
import {FEATURE_AUTHORITY} from '../src/server/domain/roles.js';
const products=[{id:'milk',name:'Fresh milk',inventory_type:'assembly',unit_of_measure:'bottle'}, {id:'yogurt',name:'Yogurt',inventory_type:'assembly'}];
const warehouses=[{id:'cold',name:'Cold room',warehouse_type:'cold_room'}, {id:'truck',name:'CE 123 AB',warehouse_type:'vehicle'}, {id:'hold',name:'Quarantine',warehouse_type:'quarantine'}, {id:'closed',name:'Closed',warehouse_type:'general',is_active:false}];
const lot=(id,changes={})=>({id,product_id:'milk',warehouse_id:'cold',lot_number:id,batch_number:'B-'+id,quantity:10,expiry_date:'2026-11-15',qc_status:'approved',...changes});
const group=(balances,options={})=>stockOnHandGroups(products,balances,warehouses,{date:'2026-11-01',...options});

test('remaining batch quantities preserve separate locations, lots, quality and expiry while excluding exhausted records',()=>{
 const rows=[lot('late'),lot('first',{quantity:4,expiry_date:'2026-11-02'}),lot('truck',{warehouse_id:'truck',quantity:7,lot_number:'first',expiry_date:'2026-11-02'}),lot('held',{qc_status:'quarantine',quantity:2}),lot('expired',{expiry_date:'2026-10-31',quantity:3}),lot('empty',{quantity:0,total_value:0})];
 const [milk]=group(rows);assert.equal(milk.quantity,26);assert.equal(milk.available,14);assert.equal(milk.rows.length,5);assert.equal(milk.nextExpiry,'2026-11-02');assert.equal(milk.rows[0].status,'Expired');
 assert.equal(milk.rows.find(r=>r.id==='truck').status,'Out for delivery');assert.equal(milk.rows.find(r=>r.id==='truck').priorityQuantity,0);
 assert.deepEqual(group(rows,{warehouseId:'truck'}).map(g=>[g.quantity,g.available,g.nextExpiry]),[[7,0,null]]);
 assert.deepEqual(rows[0],lot('late'),'projection must not mutate source records');
});
test('expiry windows use business-date boundaries and show matching lot subtotals',()=>{
 const rows=[lot('today',{expiry_date:'2026-11-01'}),lot('seven',{expiry_date:'2026-11-08'}),lot('eight',{expiry_date:'2026-11-09'}),lot('thirty',{expiry_date:'2026-12-01'}),lot('expired',{expiry_date:'2026-10-31'})];
 assert.equal(group(rows,{expiry:'7'})[0].quantity,20);assert.equal(group(rows,{expiry:'30'})[0].quantity,40);assert.equal(group(rows,{expiry:'expired'})[0].quantity,10);
 assert.equal(group(rows)[0].rows.find(r=>r.id==='today').daysLeft,0);assert.equal(group(rows)[0].rows.find(r=>r.id==='expired').available,0);
 assert.equal(group(rows,{search:'B-seven'})[0].quantity,10);assert.equal(group(rows,{search:'no match'}).length,0);
});
test('undated and malformed perishable expiry remain visible but are not dispatch priorities',()=>{
 const [milk]=group([lot('undated',{expiry_date:''}),lot('invalid',{expiry_date:'2026-02-31'}),lot('held',{qc_status:'quarantine',expiry_date:'2026-11-01'}),lot('eligible',{expiry_date:'2026-11-05'})]);
 assert.equal(milk.nextExpiry,'2026-11-05');assert.equal(milk.priorityQuantity,10);assert.equal(milk.available,20);
 assert.equal(milk.rows.find(r=>r.id==='invalid').status,'Verify expiry');assert.equal(group(milk.rows,{expiry:'undated'})[0].quantity,20);
 const raw=stockOnHandGroups([{id:'flour',name:'Flour',inventory_type:'raw_material'}],[lot('raw',{product_id:'flour',expiry_date:''})],warehouses,{date:'2026-11-01',expiry:'undated'});assert.equal(raw.length,0);
});
test('invalid counts, residual values and unavailable stock cannot become dispatch suggestions',()=>{
 for(const row of [lot('negative',{quantity:-3}),lot('nan',{quantity:'bad'}),lot('residual',{quantity:0,total_value:25}),lot('hold-location',{warehouse_id:'hold'}),lot('closed',{warehouse_id:'closed'}),lot('missing',{warehouse_id:'unknown'})]){
  const [g]=group([row]);assert.equal(g.available,0);assert.equal(g.nextExpiry,null);
 }
 assert.equal(group([lot('retired',{product_id:'missing-product'})])[0].available,0);
 assert.equal(stockOnHandGroups([{...products[0],is_active:false}],[lot('inactive')],warehouses,{date:'2026-11-01'})[0].available,0);
});
test('the earliest usable expiry controls product order and decimal quantities remain exact',()=>{
 const groups=group([lot('milk',{quantity:0.1}),lot('milk2',{quantity:0.2}),lot('yogurt',{product_id:'yogurt',expiry_date:'2026-11-02'})]);
 assert.equal(groups[0].product.id,'yogurt');assert.equal(groups[1].quantity,0.3);assert.equal(groups[1].available,0.3);
});
test('searching a later batch cannot mark it Send first while an earlier available lot is hidden',()=>{
 const balances=[lot('later',{expiry_date:'2026-11-15'}),lot('first',{expiry_date:'2026-11-02'}),lot('vehicle',{warehouse_id:'truck',expiry_date:'2026-11-01'})];
 const [filtered]=group(balances,{search:'B-later'});assert.equal(filtered.quantity,10);assert.equal(filtered.nextExpiry,null);
 assert.equal(group(balances,{search:'B-first'})[0].nextExpiry,'2026-11-02');
});
test('only native active top administrators with adjustment access may adjust quantities',async()=>{
 const modules=['inventory','inventory_adjustments'],user={id:'person',role:'user'};
 for(const role of ['warehouse_manager','cashier','production_manager','driver','commercial','employee']){
  const employee={role,status:'active',allowed_modules:modules,[FEATURE_AUTHORITY]:{role:'admin'}};
  assert.equal(canAdjustInventory(role,employee,modules),false);
  await assert.rejects(adjustmentAccess({auth:{}},'admin',employee,{user}),/top administrators/);
 }
 const client={auth:{assertModule:()=>{},roleCatalogue:async()=>({roles:{admin:{modules}}})}},employee={role:'admin',status:'active'};
 assert.equal((await adjustmentAccess(client,'admin',employee,{user})).can_adjust,true);
 assert.equal(canAdjustInventory('admin',{status:'inactive'},modules),false);
 assert.equal(canAdjustInventory('admin',employee,['inventory']),false);
 await assert.rejects(adjustmentAccess(client,'admin',{...employee,access_template:'warehouse_manager'},{user}),/top administrators/);
 await assert.rejects(adjustmentAccess(client,'admin',employee),/top administrators/,'missing authenticated user must fail closed');
});

test('finished stock on hand and new-sale availability agree even when assembly setup is incomplete',()=>{
 const items=products.map(p=>({...p,is_active:true,configuration_status:'draft',components:[]}));
 const balances=[lot('one',{quantity:12}),lot('two',{quantity:8})],date='2026-11-01';
 const [inventory]=stockOnHandGroups(items,balances,warehouses,{date});
 const [sale]=finishedStockForSale(items,balances,'cold',date);
 assert.equal(inventory.quantity,20);assert.equal(inventory.available,inventory.quantity);assert.equal(sale.available,inventory.quantity);
 const held=[...balances,lot('damaged',{quantity:3,qc_status:'quarantine'}),lot('expired',{quantity:4,expiry_date:'2026-10-31'})];
 assert.equal(stockOnHandGroups(items,held,warehouses,{date})[0].available,20);assert.equal(finishedStockForSale(items,held,'cold',date)[0].available,20);
});
