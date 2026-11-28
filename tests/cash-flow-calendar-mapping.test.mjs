import test from 'node:test';
import assert from 'node:assert/strict';
import {getCashFlowPeriod, priorYearPeriod} from '../src/lib/cash-flow-period.js';
import {businessDate} from '../src/lib/business-date.js';
import {saveAccountDefinition} from '../src/server/domain/account-definitions.js';
import {fixture} from './helpers/cashier.mjs';

test('Douala day, calendar weeks, months, quarters and year ends are inclusive',()=>{
  assert.equal(businessDate(new Date('2026-11-30T23:10:00Z')),'2026-12-01');
  const periods = {
    today:['2026-11-01','2026-11-01'], week:['2026-10-26','2026-11-01'],
    month:['2026-11-01','2026-11-30'], previousMonth:['2026-10-01','2026-10-31'],
    quarter:['2026-10-01','2026-12-31'], year:['2026-01-01','2026-12-31'],
    previousYear:['2025-01-01','2025-12-31'],
  };
  for(const [key,[from,to]] of Object.entries(periods)) assert.deepEqual(getCashFlowPeriod(key,'2026-11-01'),{from,to});
  assert.deepEqual(getCashFlowPeriod('previousMonth','2026-01-01'),{from:'2025-12-01',to:'2025-12-31'});
  assert.deepEqual(priorYearPeriod('2025-02-01','2025-02-28'),{from:'2024-02-01',to:'2024-02-29'});
  assert.deepEqual(priorYearPeriod('2024-02-29','2024-02-29'),{from:'2023-02-28',to:'2023-02-28'});
  assert.throws(()=>priorYearPeriod('2026-02-29','2026-03-01'),/valid/);
  assert.throws(()=>priorYearPeriod('2026-12-03','2026-11-05'),/before/);
});

test('cash mapping changes are authorized, type-checked and auditable without posting journals',async()=>{
  const {entities:s}=await fixture(),context={role:'admin',user:{id:'gm',role:'admin'}};
  const account={account_number:'TEST-OD',name:'Overdraft',account_type:'liability',normal_balance:'credit',cash_flow_role:'treasury'};
  const before=(await s.JournalEntry.list()).length;
  await assert.rejects(saveAccountDefinition(s,{role:'commercial',user:{id:'agent'}},{account}),/authorized|permission|active|account/i);
  for(const change of [{cash_flow_role:'not_a_role'},{cash_flow_role:'inventory'},{normal_balance:'debit'}])
    await assert.rejects(saveAccountDefinition(s,context,{account:{...account,...change}}),/mapping/);
  const saved=await saveAccountDefinition(s,context,{account});
  const audits=await s.AuditLog.filter({action:'configure_cash_flow_mapping'});
  assert.equal(saved.cash_flow_role,'treasury'); assert.equal(audits.length,1);
  assert.equal(audits[0].entity_id,saved.id); assert.equal(audits[0].new_value.role,'treasury');
  assert.equal((await s.JournalEntry.list()).length,before);
});
