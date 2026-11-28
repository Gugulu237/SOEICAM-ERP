import test from 'node:test';
import assert from 'node:assert/strict';
import {finishedGoodsMargin,finishedGoodsMargins} from '../src/lib/finished-goods-margin.js';
import {inventoryOverview} from '../src/server/domain/inventory-overview.js';
import {FEATURE_AUTHORITY} from '../src/server/domain/roles.js';
import {fixture,user} from './helpers/cashier.mjs';

const item={id:'yola',inventory_type:'assembly',unit_of_measure:'ea',selling_price:1192.5,current_cost:800,tax_rate:0};
const warehouses=[{id:'factory',warehouse_type:'cold_room',is_active:true},{id:'van',warehouse_type:'vehicle',is_active:true},{id:'hold',warehouse_type:'quarantine',is_active:true}];
const lot=(quantity,total_value,extra={})=>({product_id:item.id,warehouse_id:'factory',quantity,total_value,...extra});

test('finished goods gross margin uses the entered selling price and weighted actual company carrying costs',()=>{
 const value=finishedGoodsMargin(item,[lot(2,1000),lot(3,1800)],warehouses);
 assert.equal(value.production_unit_cost,560);assert.equal(value.selling_price,1192.5);assert.equal(Object.hasOwn(value,'net_selling_price'),false);assert.equal(Object.hasOwn(value,'vat_rate'),false);
 assert.equal(value.gross_profit_per_unit,632.5);assert.equal(value.gross_margin_percent,632.5/1192.5*100);assert.equal(value.cost_basis,'company_stock');
});

test('tax and VAT settings cannot change finished-goods margins calculated from the entered sales price',()=>{
 const balances=[lot(2,1000),lot(3,1800)],expected=finishedGoodsMargin(item,balances,warehouses);
 for(const tax of [-1,0,5,19.25,100,'invalid',null,undefined,Infinity]){
  assert.deepEqual(finishedGoodsMargin({...item,tax_rate:tax,vat_rate:tax},balances,warehouses),expected);
 }
});
test('promotional, recovered, held-location and personal custody layers cannot dilute the company cost basis',()=>{
 const balances=[lot(2,1200),lot(100,0,{degustation_appropriation_id:'expensed'}),lot(100,0,{inventory_recovery_id:'recovered'}),lot(100,0,{inventory_recovery_disposition:'pending'}),lot(100,0,{warehouse_id:'van'}),lot(100,0,{warehouse_id:'hold'})];
 assert.equal(finishedGoodsMargin(item,balances,warehouses).production_unit_cost,600);
});
test('no company stock uses an explicitly labelled registered unit cost without substituting current component estimates',()=>{
 const value=finishedGoodsMargin({...item,current_cost:750,standard_cost:2},[lot(0,0)],warehouses);
 assert.equal(value.production_unit_cost,750);assert.equal(value.cost_basis,'registered_cost');assert.equal(value.gross_margin_percent,(1192.5-750)/1192.5*100);
});
test('missing, zero, invalid or unknown production costs never produce a misleading 100 percent margin',()=>{
 for(const cost of [undefined,null,'',0,'0',false,-2,NaN,Infinity]){
  const value=finishedGoodsMargin({...item,current_cost:cost},[],warehouses);
  assert.equal(value.status,'missing_cost');assert.equal(value.gross_margin_percent,null);assert.equal(value.production_unit_cost,null);
 }
 const stocked=finishedGoodsMargin(item,[lot(10,0)],warehouses);assert.equal(stocked.status,'missing_cost');assert.equal(stocked.gross_margin_percent,null);
});
test('incomplete or invalid current carrying values require review instead of falling back to a more favourable registered cost',()=>{
 for(const invalid of [lot(3,undefined),lot(3,-1),lot(-1,100),lot(0,100)]){
  const value=finishedGoodsMargin(item,[lot(2,1000),invalid],warehouses);assert.equal(value.status,'invalid_stock');assert.equal(value.gross_margin_percent,null);
 }
});
test('negative margins remain visible and missing or malformed prices remain unavailable',()=>{
 const loss=finishedGoodsMargin({...item,current_cost:1200},[],warehouses);assert.equal(loss.gross_profit_per_unit,-7.5);assert.equal(loss.gross_margin_percent,-7.5/1192.5*100);
 for(const selling_price of [0,undefined,'',false,-1,Infinity,Number.MAX_VALUE]){
  const value=finishedGoodsMargin({...item,selling_price},[],warehouses);assert.equal(value.status,'missing_price');assert.equal(value.gross_margin_percent,null);
 }
});
test('margins are a read-only projection restricted to finished goods and preserve the exact cost precision',()=>{
 const products=[{...item,inventory_type:'finished_product'},{id:'milk',inventory_type:'raw_material'}],balances=[lot(3,1000)],before=structuredClone([products,balances,warehouses]);
 const values=finishedGoodsMargins(products,balances,warehouses);assert.equal(values.size,1);assert.equal(values.get(item.id).production_unit_cost,1000/3);assert.deepEqual([products,balances,warehouses],before);
});

async function overviewFixture(){
 const f=await fixture();await f.entities.Product.update('product-a',{current_cost:100,selling_price:1192.5,finished_goods_margin:{status:'available',gross_margin_percent:100}});
 await f.entities.StockBalance.create({product_id:'product-a',warehouse_id:'factory',quantity:5,total_value:3000,unit_cost:600});
 return f;
}
test('inventory overview projects real margins for authorized management without changing products or stock',async()=>{
 const f=await overviewFixture(),before=structuredClone(f.rows);
 const value=await inventoryOverview({user:{id:'gm',role:'admin'},role:'admin'},f.entities,{compact:true});
 const margin=value.products.find(p=>p.id==='product-a').finished_goods_margin;
 assert.equal(margin.production_unit_cost,600);assert.equal(margin.gross_margin_percent,592.5/1192.5*100);assert.equal(margin.cost_basis,'company_stock');assert.deepEqual(f.rows,before);
});
test('inventory readers cannot infer costs from a margin even through a feature admin override or a forged stored margin',async()=>{
 for(const override of [false,true]){
  const f=await overviewFixture(),employee={...await f.entities.Employee.get('cashier'),role:'employee',allowed_modules:['inventory']},actor={...user};
  if(override)actor[FEATURE_AUTHORITY]={module:'inventory',role:'admin'};
  await f.entities.Product.create({inventory_type:'assembly',item_removed_at:'2026-01-01',finished_goods_margin:{production_unit_cost:999}});
  const result=await inventoryOverview({user:actor,employee,role:'employee'},f.entities,{compact:true,includeRemoved:true});
  assert.ok(result.products.length);assert.ok(result.products.every(p=>!Object.hasOwn(p,'finished_goods_margin')));
  assert.ok(result.removedProducts.every(p=>!Object.hasOwn(p,'finished_goods_margin')));
 }
});
