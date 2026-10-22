import test from 'node:test';
import assert from 'node:assert/strict';
import {finishedStorageAllowed,finishedStockOutsideColdRoom} from '../src/lib/finished-product-storage.js';
import {warehouseItemStock} from '../src/lib/warehouse-stock.js';
import {assemblyRecipeDraft} from '../src/lib/assembly-recipe.js';
import {warehouseTransfer} from '../src/server/domain/warehouse-transfer.js';
import {fixture,date,user} from './helpers/cashier.mjs';

test('Cold Room shows all active assemblies with true local stock, including zero stock; unrelated warehouses never inflate its quantities',()=>{
  const products=[{id:'a',name:'Yoghurt',inventory_type:'assembly',is_active:true,unit_of_measure:'ea'},{id:'b',name:'Ice cream',inventory_type:'finished_product',is_active:true,unit_of_measure:'ea'},{id:'c',name:'Milk',inventory_type:'raw_material'}];
  const warehouses=[{id:'cold',warehouse_type:'cold_room'},{id:'dry',warehouse_type:'finished_goods'},{id:'van',warehouse_type:'vehicle'}];
  const stock=[{product_id:'a',warehouse_id:'cold',quantity:5,total_value:50,qc_status:'quarantine'},{product_id:'a',warehouse_id:'dry',quantity:7,total_value:70},{product_id:'b',warehouse_id:'van',quantity:3,total_value:30}];
  const rows=warehouseItemStock(warehouses[0],products,stock);
  assert.deepEqual(rows.map(r=>[r.id,r.quantity,r.usable]).sort((a,b)=>a[0].localeCompare(b[0])),[['a',5,0],['b',0,0]]);
  assert.deepEqual(finishedStockOutsideColdRoom(products,warehouses,stock).map(b=>b.warehouse_id),['dry']);
  assert.equal(finishedStorageAllowed(products[0],warehouses[1]),false);assert.equal(finishedStorageAllowed(products[0],warehouses[0]),true);assert.equal(finishedStorageAllowed(products[2],warehouses[1]),true);
});
test('assembly BOM draft uses per-unit stock components and excludes labour, assets and overhead from physical material issues',()=>{
  const products=[{id:'milk',name:'Milk',inventory_type:'raw_material',unit_of_measure:'kg',is_active:true},{id:'cup',name:'Cups',inventory_type:'packaging',unit_of_measure:'ea',is_active:true},{id:'labour',name:'Filling',inventory_type:'service'}];
  const output={id:'yoghurt',name:'Yoghurt',inventory_type:'assembly',unit_of_measure:'ea',components:[{component_type:'inventory_part',product_id:'milk',quantity:50,unit:'g'},{component_type:'inventory_part',product_id:'cup',quantity:1,unit:'ea'},{component_type:'service',product_id:'labour',quantity:1},{component_type:'fixed_asset',asset_id:'machine',quantity:1},{component_type:'other',quantity:1}]};
  const draft=assemblyRecipeDraft(output,products);assert.equal(draft.form.batch_output,1);assert.deepEqual(draft.lines.map(r=>[r.material_id,r.quantity,r.unit]),[['milk',50,'g'],['cup',1,'ea']]);assert.equal(draft.excluded.length,3);
});
test('finished stock transfers enforce Cold Room or quality isolation and preserve lots, cost and dispatch custody restrictions',async()=>{
  const f=await fixture(),s=f.entities,context={user,role:'warehouse_manager',employee:{role:'warehouse_manager',status:'active',allowed_modules:['inventory']}};
  const from=await s.Warehouse.create({name:'Legacy finished store',warehouse_type:'finished_goods',is_active:true}),cold=await s.Warehouse.create({name:'Cold Room',warehouse_type:'cold_room',is_active:true}),dry=await s.Warehouse.create({name:'Dry store',warehouse_type:'general',is_active:true}),isolation=await s.Warehouse.create({name:'Quarantine',warehouse_type:'quarantine',is_active:true});
  await s.StockBalance.create({product_id:'product-a',warehouse_id:from.id,lot_number:'FG-1',quantity:10,unit_cost:2,total_value:20,qc_status:'approved',expiry_date:'2027-01-01'});
  const input={requestKey:crypto.randomUUID(),productId:'product-a',fromWarehouseId:from.id,toWarehouseId:dry.id,quantity:4,movementDate:date};
  await assert.rejects(warehouseTransfer(context,s,input),/Cold Room/);
  await warehouseTransfer(context,s,{...input,toWarehouseId:cold.id});assert.equal((await s.StockBalance.filter({warehouse_id:cold.id,product_id:'product-a'}))[0].quantity,4);
  await warehouseTransfer(context,s,{...input,requestKey:crypto.randomUUID(),fromWarehouseId:cold.id,toWarehouseId:isolation.id,quantity:1});
  const held=(await s.StockBalance.filter({warehouse_id:isolation.id,product_id:'product-a'}))[0];assert.equal(held.qc_status,'quarantine');assert.equal(held.lot_number,'FG-1');
});
