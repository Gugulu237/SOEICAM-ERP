import test from 'node:test';
import assert from 'node:assert/strict';
import { componentCatalog } from '../src/server/domain/assembly-components.js';
import { matchesItemSearch } from '../src/lib/item-attributes.js';

function pagedStore(rows,calls,entity){
  return {filter:async(query,sort,limit,skip)=>{calls.push({entity,query,sort,limit,skip});return rows.slice(skip,skip+limit);}};
}

test('assembly catalogue supplies grouping metadata and attribute search without exposing private item or asset fields',async()=>{
  const product={id:'sticker',name:'YOLA label',sku:'LABEL-500-F',inventory_type:'packaging',is_active:true,configuration_status:'ready',material_group:'Stickers',category:'Etiquettes',product_family:'Yaourt brassé',flavor:'Fraise',size:'500 g',attributes:[{name:'Printing',value:'Strawberry cup',internal_account_id:'private'},{name:42,value:'invalid'}],unit_of_measure:'ea',current_cost:3,inventory_account_id:'private-inventory',revenue_account_id:'private-income',internal_notes:'private-note'};
  const asset={id:'mixer',name:'Mixer',status:'active',category:'Production equipment',acquisition_cost:2500000,net_book_value:2000000,asset_account_id:'private-asset-account'};
  const calls=[],catalogue=await componentCatalog({Product:pagedStore([product],calls,'Product'),FixedAsset:pagedStore([asset],calls,'FixedAsset')});
  const selected=catalogue.products[0];
  assert.equal(selected.material_group,'Stickers');assert.equal(selected.category,'Etiquettes');assert.equal(selected.product_family,'Yaourt brassé');assert.equal(selected.flavor,'Fraise');assert.equal(selected.size,'500 g');assert.equal(selected.configuration_status,'ready');
  assert.deepEqual(selected.attributes,[{name:'Printing',value:'Strawberry cup'}]);assert.ok(matchesItemSearch(selected,'strawberry printing'));assert.ok(matchesItemSearch(selected,'stickers 500'));
  assert.equal(selected.unit_of_measure,'ea');assert.equal(selected.current_cost,3);
  for(const field of ['inventory_account_id','revenue_account_id','internal_notes'])assert.equal(Object.hasOwn(selected,field),false);
  for(const field of ['acquisition_cost','net_book_value','asset_account_id'])assert.equal(Object.hasOwn(catalogue.assets[0],field),false);
  assert.equal(catalogue.assets[0].category,'Production equipment');
});

test('grouping metadata remains available beyond the first catalogue page without hiding inactive historical references',async()=>{
  const products=Array.from({length:435},(_,index)=>({id:'part-'+index,name:'Part '+index,inventory_type:'packaging',material_group:index<400?'Packaging':'Stickers',flavor:index<400?'':'Vanille',size:'500 g',is_active:index!==434,configuration_status:index===433?'draft':'ready',attributes:[{name:'Series',value:'Batch '+index}]}));
  const assets=Array.from({length:201},(_,index)=>({id:'asset-'+index,name:'Asset '+index,status:'active'}));
  const calls=[],catalogue=await componentCatalog({Product:pagedStore(products,calls,'Product'),FixedAsset:pagedStore(assets,calls,'FixedAsset')});
  assert.equal(catalogue.products.length,435);assert.equal(catalogue.assets.length,201);assert.equal(catalogue.products[434].material_group,'Stickers');assert.equal(catalogue.products[434].is_active,false);assert.equal(catalogue.products[433].configuration_status,'draft');assert.deepEqual(catalogue.products[434].attributes,[{name:'Series',value:'Batch 434'}]);
  assert.deepEqual(calls.filter(c=>c.entity==='Product').map(c=>c.skip),[0,200,400]);assert.deepEqual(calls.filter(c=>c.entity==='FixedAsset').map(c=>c.skip),[0,200]);assert.ok(calls.every(c=>c.limit===200&&c.sort==='id'));
});
