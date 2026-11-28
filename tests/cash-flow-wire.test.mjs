import test from 'node:test';
import assert from 'node:assert/strict';
import {packCashFlowReport,unpackCashFlowReport} from '../src/lib/cash-flow-wire.js';
test('comparative disclosures share identical ledger evidence and preserve split signed amounts',()=>{
  const paid={journalId:'split',date:'2026-11-12',amount:-100}, interest={...paid,amount:-3};
  const section={openingTraces:[paid],issues:[{traces:[paid,interest]}],lines:[{traces:[interest]}]};
  const report={current:section,comparison:section,currency:'XAF'};
  const wire=JSON.parse(JSON.stringify(packCashFlowReport(report)));
  assert.equal(wire.traces.length,2);
  assert.deepEqual(unpackCashFlowReport(wire),report);
  wire.data.current.openingTraces[0]=9000;
  assert.throws(()=>unpackCashFlowReport(wire),/missing/);
});
