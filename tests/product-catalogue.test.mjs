import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogueProduct,catalogueSections} from '../src/lib/product-catalogue.js';

test('catalogue groups Brassé and drinkable sizes without combining product identities or mass with volume',()=>{
 const products=[
  {id:'large',name:'Cup vanilla',product_family:'Yaourt brassé',size:'1 kg'},
  {id:'equivalent',name:'Cup strawberry',product_family:'Yaourt brassé',size:'1000 g'},
  {id:'small',name:'Cup plain',product_family:'Yaourt brassé',size:'250 g'},
  {id:'volume',name:'Drink plain',product_family:'Yaourt à boire',size:'33 cl'},
  {id:'mass',name:'Drink strawberry',product_family:'Yaourt à boire',size:'330 g'},
  {id:'other',name:'Unclassified product'},
 ];
 const original=structuredClone(products),sections=catalogueSections(products.map(catalogueProduct));
 assert.deepEqual(sections.map(s=>s.key),['brasse:250 g','brasse:1000 g','boire:330 g','boire:330 ml','other:']);
 assert.deepEqual(new Set(sections.find(s=>s.key==='brasse:1000 g').rows.map(r=>r.product.id)),new Set(['large','equivalent']));
 assert.deepEqual(products,original);
 assert.deepEqual(catalogueSections(products.map(catalogueProduct),'size-desc').slice(0,2).map(s=>s.size),['1000 g','250 g']);
});

