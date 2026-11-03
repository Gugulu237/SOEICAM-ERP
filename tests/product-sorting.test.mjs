import test from 'node:test';
import assert from 'node:assert/strict';
import {sortProductRows,compareProductSizes} from '../src/lib/product-sorting.js';
import {setLanguage,getLanguage} from '../src/lib/i18n.js';
import {groupWarehouseCountRows} from '../src/lib/warehouse-count.js';

test('sizes use comparable units, keep mass separate from volume, and put missing values last in both directions',()=>{
  const sizes=['10 kg','500 g','1 kg','2,5 kg','250 g','1 l','330 ml','50 cl','', 'Box'];
  assert.deepEqual([...sizes].sort(compareProductSizes),['250 g','500 g','1 kg','2,5 kg','10 kg','330 ml','50 cl','1 l','Box','']);
  assert.deepEqual([...sizes].sort((a,b)=>compareProductSizes(a,b,true)),['10 kg','2,5 kg','1 kg','500 g','250 g','1 l','50 cl','330 ml','Box','']);
  assert.equal(compareProductSizes('1000 g','1 kg'),0);
});
test('flavour aliases group together and sizes break ties without changing the catalogue or selection objects',()=>{
  const language=getLanguage();setLanguage('en');
  try {
    const rows=[{id:'v2',name:'YOLA 1 kg',flavor:'Vanille',size:'1 kg',quantity:9},{id:'f1',name:'Fraise',flavor:'Strawberry',size:'500 g',quantity:4},{id:'c',name:'Chocolate',flavor:'Chocolat',size:'500 g'},{id:'v1',name:'Vanilla',flavor:'Vanilla',size:'500 g'},{id:'none',name:'A material'}],snapshot=structuredClone(rows);
    assert.deepEqual(sortProductRows(rows,'flavour').map(r=>r.id),['c','f1','v1','v2','none']);
    assert.equal(sortProductRows(rows,'size')[0],rows[2]);assert.deepEqual(rows,snapshot);
    setLanguage('fr');assert.deepEqual(sortProductRows(rows,'flavour').map(r=>r.id),['c','f1','v1','v2','none']);
  }finally{setLanguage(language);}
});
test('legacy names have safe variant fallbacks; explicit metadata wins and same names have a stable ID tie-breaker',()=>{
  const rows=[{id:'b',name:'YOLA Vanille 1 KG'},{id:'a',name:'YOLA Fraise 500G'},{id:'c',name:'YOLA Nature 10KG',size:'250 g',flavor:'Chocolat'}];
  assert.deepEqual(sortProductRows(rows,'size').map(r=>r.id),['c','a','b']);
  assert.deepEqual(sortProductRows([{id:'b',name:'Same'},{id:'a',name:'Same'}]).map(r=>r.id),['a','b']);
  assert.deepEqual(sortProductRows(rows.map(product=>({product,selected:true})),'size',row=>row.product).map(r=>r.product.id),['c','a','b']);
});
test('count totals combine real stock records once per item and location without merging identities, units, or batch evidence',()=>{
  const a={id:'one',product_id:'milk',product_name:'Milk',warehouse_id:'cold',unit:'ea',book_quantity:0.1,lot_number:'SAME',fingerprint:'original-one'};
  const b={...a,id:'two',book_quantity:0.2,fingerprint:'original-two'};
  const groups=groupWarehouseCountRows([a,b,{...a,id:'other-location',warehouse_id:'raw',book_quantity:9},{...a,id:'different-item',product_id:'milk-other',book_quantity:5},{...a,id:'different-unit',unit:'kg',book_quantity:3}]);
  assert.equal(groups.length,4);assert.equal(groups[0].book_quantity,0.3);assert.deepEqual(groups[0].rows,[a,b]);assert.equal(groups[0].rows[0],a);
  assert.equal(groupWarehouseCountRows([{...a,book_quantity:NaN}])[0].book_quantity,null);
});
