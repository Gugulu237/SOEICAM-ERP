import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeRecordedQuantity,warehouseCountState,warehouseCountVariance} from '../src/lib/warehouse-count.js';

test('recorded quantity normalization accepts only machine-level noise near supported positive quantities',()=>{
 for(const [recorded,expected] of [[49.99999999999999,50],[0.3-0.1,0.2],[1.0010000000000001,1.001],[50,50],[0,0]])assert.equal(normalizeRecordedQuantity(recorded),expected);
 for(const value of [1.0001,1.000000001,0.0004,Number.EPSILON,-Number.EPSILON,-49.99999999999999])assert.equal(normalizeRecordedQuantity(value),value);
 assert.ok(Number.isNaN(normalizeRecordedQuantity(NaN)));assert.equal(normalizeRecordedQuantity(Infinity),Infinity);
});

test('counting a noisy opening quantity retains exact recorded money and uses its carrying cost',()=>{
 const row={book_quantity:49.99999999999999,book_value:500,unit_cost:999};
 assert.equal(warehouseCountState(row).count_issue,'');assert.equal(warehouseCountState(row).requires_reconciliation,false);
 const variance=warehouseCountVariance(row,48);
 assert.equal(variance.difference,-2);assert.equal(variance.applied_unit_cost,10);assert.equal(variance.value_after,480);assert.equal(variance.value_difference,-20);
 assert.equal(warehouseCountVariance(row,0).value_difference,-500);
 assert.equal(row.book_quantity,49.99999999999999);assert.equal(row.book_value,500);
});

test('true quantity precision, money precision and zero-quantity residuals still require correction',()=>{
 for(const book_quantity of [1.0001,1.000000001,0.0004,Number.EPSILON,-Number.EPSILON])assert.match(warehouseCountState({book_quantity,book_value:10,unit_cost:10}).count_issue,/precision/);
 for(const book_value of [0.004,10.000000000000002])assert.match(warehouseCountState({book_quantity:1,book_value,unit_cost:10}).count_issue,/precision/);
 assert.equal(warehouseCountState({book_quantity:0,book_value:10,unit_cost:10}).requires_reconciliation,true);
 assert.equal(warehouseCountState({book_quantity:-2,book_value:-20,unit_cost:10}).requires_reconciliation,true);
 assert.throws(()=>warehouseCountVariance({book_quantity:0,book_value:10,unit_cost:10},0),/Confirm the accounting correction/);
 assert.throws(()=>warehouseCountVariance({book_quantity:1.0001,book_value:10,unit_cost:10},0),/precision/);
});
