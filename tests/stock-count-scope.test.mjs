import test from 'node:test';
import assert from 'node:assert/strict';
import {stockCountGroup,warehouseCountGroup,changedCountItems} from '../src/lib/stock-count-scope.js';

test('stock count groups match legacy packaging attributes and finished assembly types',()=>{
 assert.equal(stockCountGroup({inventory_type:'inventory_item',material_group:'Packaging'}),'packaging');
 assert.equal(stockCountGroup({inventory_type:'raw_material',name:'YOLA sticker 500g'}),'packaging');
 assert.equal(stockCountGroup({inventory_type:'inventory_item',category:'Labels'}),'packaging');
 assert.equal(stockCountGroup({inventory_type:'assembly',material_group:'Packaging'}),'finished');
 assert.equal(stockCountGroup({inventory_type:'finished_product'}),'finished');
 assert.equal(stockCountGroup({inventory_type:'additive'}),'ingredients');
 for(const [warehouse_type,group] of [['raw_material','ingredients'],['packaging','packaging'],['cold_room','finished'],['finished_goods','finished'],['general','all']])assert.equal(warehouseCountGroup({warehouse_type}),group);
});

test('refresh proofs ignore time and uncounted products but detect changed, missing or new counted lots',()=>{
 const before={warehouse:{id:'a'},date:'2026-11-03',item_group:'packaging',as_of:'old',items:[{id:'cup',unit:'ea',count_fingerprint:'item',count_group:'packaging'},{id:'lid'}],rows:[{product_id:'cup',balance_id:'1',fingerprint:'a',book_quantity:10},{product_id:'cup',balance_id:'2',fingerprint:'b',book_quantity:0},{product_id:'lid',balance_id:'3',fingerprint:'c',book_quantity:5}]};
 const after=structuredClone(before);after.as_of='now';after.rows.reverse();after.rows.find(row=>row.product_id==='lid').book_quantity=500;
 assert.deepEqual(changedCountItems(before,after,['cup']),[]);
 assert.deepEqual(changedCountItems(before,after,[]),[]);
 for(const change of [
  data=>data.rows.find(row=>row.balance_id==='2').fingerprint='received',
  data=>data.rows.push({product_id:'cup',balance_id:'new',fingerprint:'new'}),
  data=>data.rows.splice(data.rows.findIndex(row=>row.balance_id==='1'),1),
  data=>data.items[0].count_group='ingredients',
  data=>data.items[0].count_fingerprint='new-cost',
  data=>data.items.shift(),
  data=>data.warehouse.id='b',
  data=>data.date='2026-11-04',
 ]){
  const changed=structuredClone(after);change(changed);assert.deepEqual(changedCountItems(before,changed,['cup']),['cup']);
 }
});

