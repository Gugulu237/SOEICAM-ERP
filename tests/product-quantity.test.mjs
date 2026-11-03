import test from 'node:test';
import assert from 'node:assert/strict';
import {quantityAfterReplacements,validProductQuantity} from '../src/lib/product-quantity.js';

test('paid quantities reserve every replacement for the same product without changing the source stock',()=>{
 const stock={id:'a',available:10};
 const rows=[{product_id:'a',quantity:2},{product_id:'a',quantity:'1.125'},{product_id:'b',quantity:100}];
 assert.equal(quantityAfterReplacements(stock,rows),6.875);
 assert.equal(validProductQuantity(6.875,quantityAfterReplacements(stock,rows)),true);
 assert.equal(validProductQuantity(6.876,quantityAfterReplacements(stock,rows)),false);
 assert.deepEqual(stock,{id:'a',available:10});
 assert.equal(quantityAfterReplacements({id:'a',quantity:10},rows),6.875);
 assert.equal(quantityAfterReplacements(stock,[]),10);
 assert.equal(quantityAfterReplacements(stock,[{product_id:'a',quantity:20}]),0);
 assert.equal(quantityAfterReplacements(stock,[{product_id:'a',quantity:-5},{product_id:'a',quantity:3}]),7);
 assert.equal(quantityAfterReplacements(stock,[{product_id:'a',quantity:'bad'}]),0);
 assert.equal(quantityAfterReplacements({id:'a',available:NaN}),0);
});

