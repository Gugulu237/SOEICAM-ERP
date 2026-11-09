import test from 'node:test';
import assert from 'node:assert/strict';
import {guardMutation} from '../src/server/access.js';

const context={user:{id:'gm',role:'admin'},role:'admin'};
test('generic mutations cannot forge, change or remove additional-load stock evidence',()=>{
 for(const entity of ['AuditLog','StockMovement']){
  for(const [operation,payload,existing] of [
   ['create',{dispatch_load_addition_id:'forged'},null],
   ['create',{action:'add_dispatch_load'},null],
   ['create',{action:'add_dispatch_stock'},null],
   ['create',{id:'DLA-forged'},null],
   ['update',{dispatch_load_addition_id:null},{id:'source',dispatch_load_addition_id:'addition'}],
   ['update',{notes:'Alter evidence'},{id:'source',dispatch_load_addition:{id:'addition'}}],
   ['delete',{}, {id:'source',dispatch_load_addition_id:'addition'}],
  ])assert.throws(()=>guardMutation(context,entity,operation,payload,existing),{status:403},entity+' / '+operation);
 }
});
