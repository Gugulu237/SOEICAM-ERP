import test from 'node:test';
import assert from 'node:assert/strict';
import { PRODUCT_FLAVOURS, PRODUCT_SIZES, canonicalFlavour, canonicalSize, productSizeChoices, validateFinishedVariantChanges } from '../src/lib/product-variants.js';
import { inventoryVariants } from '../src/lib/inventory-groups.js';
import { buildQuickItemChanges } from '../src/lib/item-quick-edit.js';
import { validateItemDefinition } from '../src/server/domain/item-settings.js';

const brasse={inventory_type:'assembly',product_family:'Yaourt brassé',flavor:'Fraise',size:'500 g',unit_of_measure:'ea'};
const boire={...brasse,product_family:'Yaourt à boire',size:'330 ml'};

test('the five official flavours recognize English and existing French labels without creating duplicate variants',()=>{
  assert.deepEqual(PRODUCT_FLAVOURS.map(f=>f.label),['Strawberry','Vanilla','Unsweetened','Nature','Chocolate']);
  for(const [input,expected] of [['Strawberr','Fraise'],['strawberry','Fraise'],['Fraise','Fraise'],['Vanilla','Vanille'],['Vanille','Vanille'],['Unsweetened','Non sucré'],['Non-sucre','Non sucré'],['Nature','Nature'],['Chocolate','Chocolat']])assert.equal(canonicalFlavour(input),expected);
  assert.deepEqual(inventoryVariants({...brasse,flavor:'Vanilla',size:'1 kg'}),{flavor:'Vanille',size:'1000 g'});
});
test('gram sizes follow each product family and equivalent kilogram labels normalize without converting volume to mass',()=>{
  assert.deepEqual(productSizeChoices(brasse),['250 g','500 g','1000 g','2500 g','10000 g']);assert.deepEqual(productSizeChoices(boire),['250 g','330 g','500 g']);
  assert.equal(canonicalSize('2.5 kg'),'2500 g');assert.equal(canonicalSize('2,5kg'),'2500 g');assert.equal(canonicalSize('10000g'),'10000 g');assert.equal(canonicalSize('330 ml'),'330 ml');assert.equal(canonicalSize('-250g'),'-250g');
  assert.deepEqual(PRODUCT_SIZES.boire,['250 g','330 g','500 g']);
});
test('checked variant edits reject unsupported flavours and wrong-family sizes while retaining untouched historical labels',async()=>{
  const stores={};
  assert.deepEqual(await validateItemDefinition(stores,{flavor:'Vanilla',size:'250g'},boire,{partialUnitAccounts:true}),{flavor:'Vanille',size:'250 g'});
  assert.deepEqual(validateFinishedVariantChanges({flavor:'Chocolate'},boire),{flavor:'Chocolat'});
  for(const patch of [{flavor:'Banana'},{size:'1000 g'},{size:'330 ml-new'},{size:'-250g'}])assert.throws(()=>validateFinishedVariantChanges(patch,boire));
  assert.deepEqual(validateFinishedVariantChanges({size:'330 ml'},boire),{size:'330 ml'});
  assert.throws(()=>buildQuickItemChanges({...brasse,size:'2500 g'},{product_family:'Yaourt à boire'}),/size available/);
  assert.deepEqual(buildQuickItemChanges({...brasse,size:'2500 g'},{product_family:'Yaourt à boire',size:'330 g'}),{product_family:'Yaourt à boire',size:'330 g'});
  assert.deepEqual(validateFinishedVariantChanges({size:'20 L',flavor:'Culture'},{inventory_type:'raw_material'}),{});
});
test('all official sizes save through the same server definition rules for finished-product aliases',async()=>{
  for(const [family,sizes] of Object.entries(PRODUCT_SIZES))for(const size of sizes){const item={...brasse,inventory_type:'finished_product',product_family:family==='brasse'?'Yaourt brassé':'Yaourt à boire'};assert.equal((await validateItemDefinition({}, {size},item,{partialUnitAccounts:true})).size,size);}
  await assert.rejects(validateItemDefinition({}, {size:'10000 g'},boire,{partialUnitAccounts:true}),/size available/);
  assert.deepEqual(validateFinishedVariantChanges({attributes:[{name:'Brand',value:'YOLA'}]},boire),{});
});
