import test from 'node:test';
import assert from 'node:assert/strict';
import {inclusiveSaleLine,splitIncludedVat} from '../src/lib/sale-vat.js';
test('configured unit prices are the final amounts, with VAT extracted from the listed price',()=>{
 assert.deepEqual(splitIncludedVat(1192.5,19.25),{total:1192.5,tax:192.5,net:1000});
 assert.deepEqual(inclusiveSaleLine(2,500,19.25),{total:1000,tax:161.43,net:838.57,gross:1000,discount:0});
 assert.deepEqual(inclusiveSaleLine(2,500,19.25,10),{total:900,tax:145.28,net:754.72,gross:1000,discount:100});
 assert.deepEqual(splitIncludedVat(500,0),{total:500,tax:0,net:500});
});
test('rounding preserves gross = net + VAT across mixed quantities and discounts',()=>{
 for(const q of [.001,1,1.333,3,100])for(const p of [.01,.34,333.33,1192.5])for(const rate of [0,5,19.25,100])for(const discount of [0,10,100]){
  const line=inclusiveSaleLine(q,p,rate,discount);assert.equal(Math.round(line.net*100)+Math.round(line.tax*100),Math.round(line.total*100));assert.equal(Math.round(line.total*100),Math.round(line.gross*100)-Math.round(line.discount*100));
 }
});
test('invalid VAT and amounts are rejected instead of changing totals silently',()=>{
 for(const rate of [-1,101,Infinity,NaN])assert.throws(()=>splitIncludedVat(1000,rate));
 assert.throws(()=>inclusiveSaleLine(1,500,19.25,101));assert.throws(()=>inclusiveSaleLine(-1,500,19.25));
});
