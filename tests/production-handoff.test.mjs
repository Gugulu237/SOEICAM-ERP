import test from 'node:test';
import assert from 'node:assert/strict';
import { productionReadyForIssue } from '../src/lib/production-handoff.js';

const approved={approved_by:'gm',approved_at:'2026-10-22T10:00:00Z'};
const yogurt=(status,yogurt_phase,yogurt_issued_stages={})=>({...approved,recipe_kind:'yogurt_phased_v1',status,yogurt_phase,yogurt_issued_stages});

test('yogurt warehouse queue retains initial ingredients and the unissued flavouring phase',()=>{
  assert.equal(productionReadyForIssue(yogurt('approved','fermentation')),true);
  assert.equal(productionReadyForIssue(yogurt('in_production','flavouring')),true);
  assert.equal(productionReadyForIssue(yogurt('in_production','flavouring',{flavouring:{at:'issued'}})),false);
  assert.equal(productionReadyForIssue(yogurt('in_production','fermentation',{fermentation:{at:'issued'}})),false);
});

test('packaging is handled with actual output and never requests a warehouse pre-issue',()=>{
  for(const status of ['approved','in_production']){
    assert.equal(productionReadyForIssue(yogurt(status,'packaging')),false);
    assert.equal(productionReadyForIssue(yogurt(status,'packaging',{packaging:{at:'legacy issue'}})),false);
  }
});

test('other production and approval requirements retain their existing queue behavior',()=>{
  assert.equal(productionReadyForIssue({...approved,status:'approved'}),true);
  assert.equal(productionReadyForIssue({...approved,status:'in_production'}),false);
  assert.equal(productionReadyForIssue({...yogurt('in_production','flavouring'),approved_by:''}),false);
  assert.equal(productionReadyForIssue({...yogurt('approved','fermentation'),approved_at:''}),false);
  assert.equal(productionReadyForIssue(yogurt('awaiting_approval','fermentation')),false);
  assert.equal(productionReadyForIssue(null),false);
});
