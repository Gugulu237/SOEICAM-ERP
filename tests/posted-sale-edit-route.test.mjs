import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {functionRoute,request} from './helpers/cashier.mjs';
import {postedSaleFixture} from './helpers/posted-sale-edit-fixture.mjs';

test('a mid-save accounting failure rolls every sale, stock, treasury and customer write back at the API boundary',async()=>{
 const f=postedSaleFixture({cash:true}),post=await functionRoute();
 globalThis.__cashierClient=f.client;
 globalThis.__cashierTransaction=async fn=>{const before=structuredClone(f.rows);try{return await fn();}catch(error){for(const key of Object.keys(f.rows))f.rows[key]=before[key];throw error;}};
 try{
  const body={invoiceId:'invoice',paymentType:'credit',customerId:'c1',locationId:'',reference:'R-1',reason:'Verified correction against physical receipt',lines:[{line_id:'invoice-line',quantity:3}]};
  const previewResponse=await post(request({...body,action:'previewPostedSaleEdit'}),{params:Promise.resolve({name:'fieldOps'})});
  assert.equal(previewResponse.status,200);const preview=await previewResponse.json();
  const before=structuredClone(f.rows);f.stores.JournalEntry.update=async()=>{throw Error('Injected journal persistence failure');};
  const result=await post(request({...body,action:'savePostedSaleEdit',requestKey:randomUUID(),fingerprint:preview.fingerprint,confirmed:true}),{params:Promise.resolve({name:'fieldOps'})});
  assert.equal(result.status,400);assert.deepEqual(f.rows,before);
 }finally{delete globalThis.__cashierClient;delete globalThis.__cashierTransaction;}
});
