import test from 'node:test';
import assert from 'node:assert/strict';
import {guardMutation} from '../src/server/access.js';

const context={user:{id:'gm',role:'admin'},role:'admin'};
const marker={id:'cost-review',policy:'owner-confirmed-opening-lot-cost-v1',journal_id:'correction-journal',requires_corrected_basis_reversal:true};

test('generic mutations cannot forge, detach or delete protected opening-cost correction evidence',()=>{
 for(const entity of ['Invoice','SalesOrder','StockMovement','JournalEntry','AuditLog']){
  for(const [operation,payload,existing] of [
   ['create',{accounting_control_opening_cost_correction:marker},null],
   ['update',{accounting_control_opening_cost_correction:null},{id:'source',accounting_control_opening_cost_correction:marker}],
   ['update',{notes:'Overwrite provenance'},{id:'source',accounting_control_opening_cost_correction:marker}],
   ['delete',{}, {id:'source',accounting_control_opening_cost_correction:marker}],
   ['bulkCreate',{accounting_control_opening_cost_policy:'forged'},null],
  ])assert.throws(()=>guardMutation(context,entity,operation,payload,existing),{status:403},entity+' / '+operation);
 }
});
