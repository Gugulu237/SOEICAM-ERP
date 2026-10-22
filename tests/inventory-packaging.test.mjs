import test from 'node:test';
import assert from 'node:assert/strict';
import {isPackagingItem,packagingGroup,packagingVariants} from '../src/lib/inventory-packaging.js';
import {inventoryItemCounts,matchesItemFilter,inventoryWorkspaceState} from '../src/lib/inventory-workspace.js';
import {attributeFacets,matchesAttributes} from '../src/lib/item-attributes.js';
const items=[
 {id:'cups',name:'Yogurt cups 500g',inventory_type:'packaging',size:'500g',attributes:[{name:'Packaging type',value:'Yogurt cups'},{name:'Material',value:'PP'}]},
 {id:'sticker',name:'Sticker vanilla 500g',inventory_type:'packaging',flavor:'Vanille',size:'500g',attributes:[{name:'Packaging type',value:'Stickers'},{name:'Material',value:'Paper'}]},
 {id:'legacy',name:'Nature label',inventory_type:'inventory_part',material_group:'Stickers'},
 {id:'milk',name:'Milk powder bag',inventory_type:'raw_material'},
 {id:'flavor',name:'Vanilla flavour bottle',inventory_type:'raw_material',material_group:'Raw Material'},
 {id:'sugar',name:'Sugar',inventory_type:'raw_material'},
 {id:'yogurt',name:'Finished yogurt cup',inventory_type:'assembly'},
 {id:'service',name:'Label delivery service',inventory_type:'service',material_group:'Packaging'},
];
test('packaging is a distinct physical category, including saved legacy sticker groups',()=>{
 assert.deepEqual(inventoryItemCounts(items),{finished:1,ingredients:3,packaging:3,all:7});
 assert.deepEqual(items.filter(item=>matchesItemFilter(item,'packaging')).map(item=>item.id),['cups','sticker','legacy']);
 assert.deepEqual(items.filter(item=>matchesItemFilter(item,'ingredients')).map(item=>item.id),['milk','flavor','sugar']);
 for(const item of items.slice(3))assert.equal(isPackagingItem(item),false,item.id);
});
test('packaging groups prefer saved attributes and recognize common containers, stickers and seals',()=>{
 assert.equal(packagingGroup(items[0]),'Yogurt cups');assert.equal(packagingGroup(items[1]),'Stickers');
 assert.equal(packagingGroup({name:'Container',inventory_type:'packaging',attributes:[{name:'Packaging type',value:'Returnable cups'}]}),'Returnable cups');
 for(const [name,group] of [['Bottle 330g','Bottles'],['Sticker chocolate 500g','Stickers'],['Yogurt cup','Yogurt cups'],['Carton','Cartons & boxes'],['Bottle cap','Lids & seals'],['Unclassified item','Other packaging']])assert.equal(packagingGroup({name,inventory_type:'packaging'}),group);
 const variant=packagingVariants(items[1]);assert.equal(variant.flavor,'Vanille');assert.equal(variant.size,'500 g');
});
test('custom packaging attributes remain available for intersecting filters without changing source metadata',()=>{
 const before=structuredClone(items),packages=items.filter(isPackagingItem),facets=attributeFacets(packages);
 assert.deepEqual(facets.find(row=>row.key==='material').values.map(v=>v.key),['paper','pp']);
 assert.deepEqual(packages.filter(item=>matchesAttributes(item,{'packaging type':'stickers',material:'paper'})).map(item=>item.id),['sticker']);
 assert.deepEqual(items,before);
});
test('old packaging bookmarks enter Packaging, while raw material and other ingredient links retain their scope',()=>{
 for(const query of ['tab=packaging','section=items&filter=materials&type=packaging','filter=ingredients&type=packaging','filter=packaging'])assert.equal(inventoryWorkspaceState(new URLSearchParams(query)).filter,'packaging');
 assert.equal(inventoryWorkspaceState(new URLSearchParams('tab=raw')).filter,'ingredients');
 assert.equal(inventoryWorkspaceState(new URLSearchParams('filter=ingredients&type=additive')).subtype,'additive');
});
