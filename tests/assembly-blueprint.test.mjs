import test from 'node:test';
import assert from 'node:assert/strict';
import {copyAssemblyBlueprint} from '../src/lib/assembly-blueprint.js';
import {matchingProductPhoto} from '../src/lib/product-images.js';

const source={
  id:'nature',name:'YOLA Brassé Nature 500g',sku:'NATURE',inventory_type:'assembly',product_family:'Yaourt brassé',
  size:'500 g',flavor:'Nature',unit_of_measure:'ea',storage_unit:'ea',purchase_unit:'carton',purchase_to_storage_factor:12,
  yogurt_units_per_bucket:52,selling_price:500,cogs_account_id:'cogs',inventory_account_id:'stock',revenue_account_id:'sales',
  image_url:'/nature.jpg',current_stock:200,current_cost:123,created_date:'old',production_order_id:'historic',
  components:[{component_type:'inventory_part',product_id:'milk',quantity:0.5,unit:'kg',unit_cost:1000,cost_source:'manual',recover_on_exchange:false}],
};

test('blueprint copies editable definition and unit settings without product identity, stock or production history',()=>{
  const before=structuredClone(source),draft=copyAssemblyBlueprint(source);
  assert.equal(draft.changes.yogurt_units_per_bucket,52);
  assert.equal(draft.changes.purchase_to_storage_factor,12);
  assert.equal(draft.changes.inventory_account_id,'stock');
  for(const key of ['id','name','sku','flavor','image_url','current_stock','current_cost','created_date','production_order_id']) assert.equal(Object.hasOwn(draft.changes,key),false,key);
  assert.deepEqual(draft.components,source.components);
  draft.components[0].quantity=0.45;
  draft.components.push({product_id:'lemon',quantity:0.001,unit:'kg'});
  assert.deepEqual(source,before);
});

test('copying into an existing flavor preserves its identity while requiring the same output basis',()=>{
  const target={...source,id:'lemon',name:'YOLA Brassé Citron 500g',flavor:'Citron',sku:'LEMON',selling_price:650,yogurt_units_per_bucket:40};
  const draft=copyAssemblyBlueprint(source,target),combined={...target,...draft.changes};
  assert.equal(combined.id,'lemon');assert.equal(combined.flavor,'Citron');assert.equal(combined.name,target.name);
  assert.equal(combined.selling_price,650);assert.equal(combined.yogurt_units_per_bucket,52);
  assert.equal(draft.components[0].cost_source,'manual');
  assert.throws(()=>copyAssemblyBlueprint(source,{...target,size:'1000 g'}),/same product family and size/);
  assert.throws(()=>copyAssemblyBlueprint(source,{...target,product_family:'Yaourt à boire'}),/same product family and size/);
  assert.throws(()=>copyAssemblyBlueprint(source,{...target,unit_of_measure:'kg'}),/compatible|same output unit/);
  assert.throws(()=>copyAssemblyBlueprint({...source,components:[]}),/saved components/);
});

test('new flavors never inherit a Nature packshot automatically',()=>{
  for(const flavor of ['Lemon','Citron','Pineapple','Ananas','Coconut','Coco']){
    assert.equal(matchingProductPhoto({...source,flavor,image_url:''}),null,flavor);
    assert.equal(matchingProductPhoto({...source,name:'YOLA Brassé '+flavor+' 500g',flavor,image_url:''}),null,flavor);
  }
});
