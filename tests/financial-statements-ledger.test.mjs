import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {financialPosition} from '../src/lib/financial-position.js';

const bundle=await build({entryPoints:['src/lib/statements.js'],bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'statement-fixture',setup(b){
  b.onResolve({filter:/^@\/lib\/posting$/},()=>({path:'rounding',namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const round2=n=>Math.round(Number(n||0)*100)/100;'}));
}}]});
const {computeActivity,computeGeneralLedger,computeTrialBalance,netProfit,validStatementRange}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const accounts=[{id:'cash',account_type:'asset',normal_balance:'debit'},{id:'ap',account_type:'liability',normal_balance:'credit'},{id:'expense',account_type:'expense',normal_balance:'debit'}];
const journalsById={
  original:{id:'original',status:'reversed',entry_date:'2026-10-01',reversed_by_journal:'reversal'},
  reversal:{id:'reversal',status:'posted',entry_date:'2026-11-01',reversal_of:'original'},
};
const lines=[
  {journal_id:'original',account_id:'expense',debit:300,credit:0,status:'reversed'},
  {journal_id:'original',account_id:'ap',debit:0,credit:300,status:'reversed'},
  {journal_id:'reversal',account_id:'expense',debit:0,credit:300,status:'posted'},
  {journal_id:'reversal',account_id:'ap',debit:300,credit:0,status:'posted'},
];
const position=activity=>financialPosition(accounts,Object.fromEntries(Object.entries(activity).map(([id,r])=>[id,{debit:Math.max(r.closing,0),credit:Math.max(-r.closing,0)}])));

test('original and reversal journals preserve historical liabilities and cancel on the reversal date',()=>{
  const october=computeActivity({journalsById,lines,fromDate:'2026-10-01',toDate:'2026-10-31'});
  assert.equal(netProfit(accounts,october),-300);
  assert.equal(position(october).totalLiabilities,300);
  assert.equal(position(october).difference,0);
  const combined=computeActivity({journalsById,lines,fromDate:'2026-10-01',toDate:'2026-11-30'});
  assert.equal(netProfit(accounts,combined),0);
  assert.equal(position(combined).totalLiabilities,0);
  assert.equal(position(combined).difference,0);
  const november=computeActivity({journalsById,lines,fromDate:'2026-11-01',toDate:'2026-11-30'});
  assert.deepEqual(november.ap,{opening:-300,period:300,closing:0});
  assert.equal(netProfit(accounts,november),300);
});

test('drafts, cancelled headers, orphan lines and future reversals do not enter the statement',()=>{
  const headers={...journalsById,draft:{status:'draft',entry_date:'2026-10-01'},cancelled:{status:'cancelled',entry_date:'2026-10-01'}};
  const noise=['draft','cancelled','missing'].map(journal_id=>({journal_id,account_id:'ap',debit:900,credit:0}));
  const activity=computeActivity({journalsById:headers,lines:[...lines,...noise],fromDate:'2026-10-01',toDate:'2026-10-31'});
  assert.deepEqual(activity.ap,{opening:0,period:-300,closing:-300});
});

test('invalid dates and amounts block financial statements instead of silently changing totals',()=>{
  const input={journalsById,lines,fromDate:'2026-10-01',toDate:'2026-10-31'};
  for(const range of [['2026-02-30','2026-03-01'],['','2026-10-31'],['2026-11-01','2026-10-31']]){
    assert.equal(validStatementRange(...range),false);
    assert.throws(()=>computeActivity({...input,fromDate:range[0],toDate:range[1]}),/valid date range/);
  }
  assert.equal(validStatementRange('2028-02-29','2028-03-01'),true);
  assert.throws(()=>computeActivity({...input,journalsById:{...journalsById,original:{...journalsById.original,entry_date:'2026-02-30'}}}),/invalid date/);
  for(const bad of [{debit:1.001},{credit:-1},{debit:Infinity},{debit:1,credit:1},{account_id:''}]){
    assert.throws(()=>computeActivity({...input,lines:[{journal_id:'original',account_id:'ap',debit:0,credit:0,...bad}]}),/invalid amounts|no account/);
  }
});

test('cent totals are stable through repeated fractional postings',()=>{
  const activity=computeActivity({journalsById:{payment:{status:'posted',entry_date:'2026-10-05'}},fromDate:'2026-10-01',toDate:'2026-10-31',lines:[...Array.from({length:1001},()=>({journal_id:'payment',account_id:'cash',debit:0.1,credit:0})),{journal_id:'payment',account_id:'ap',debit:0,credit:100.1}]});
  assert.deepEqual(activity.cash,{opening:0,period:100.1,closing:100.1});
});

test('ledger drilldown and trial balance match statements before and after a dated reversal',()=>{
  const input={accounts,journalsById,lines,fromDate:'2026-10-01',toDate:'2026-10-31'},account=accounts.find(a=>a.id==='ap');
  const ledger=computeGeneralLedger({...input,account}),trial=computeTrialBalance(input);
  assert.equal(ledger.openingBalance,0);assert.equal(ledger.closingBalance,300);assert.equal(ledger.rows[0].journal.status,'reversed');assert.equal(ledger.rows[0].credit,300);
  assert.equal(trial.rows.find(a=>a.id==='ap').closingCredit,300);assert.equal(trial.totals.periodDebit,300);assert.equal(trial.totals.periodCredit,300);
  const next={...input,fromDate:'2026-11-01',toDate:'2026-11-30'},reversedLedger=computeGeneralLedger({...next,account}),reversedTrial=computeTrialBalance(next);
  assert.equal(reversedLedger.openingBalance,300);assert.equal(reversedLedger.rows.length,1);assert.equal(reversedLedger.rows[0].journal.reversal_of,'original');assert.equal(reversedLedger.rows[0].running,0);assert.equal(reversedLedger.closingBalance,0);
  assert.equal(reversedTrial.rows.find(a=>a.id==='ap').openingCredit,300);assert.equal(reversedTrial.totals.closingDebit,0);assert.equal(reversedTrial.totals.closingCredit,0);
  const complete=computeGeneralLedger({...input,toDate:'2026-11-30',account});assert.deepEqual(complete.rows.map(l=>l.running),[300,0]);
});

test('every report fails closed on partial journals, draft lines under posted headers and mismatched header totals',()=>{
  const input={accounts,account:accounts[1],journalsById,lines,fromDate:'2026-10-01',toDate:'2026-10-31'};
  for(const report of [computeActivity,computeGeneralLedger,computeTrialBalance]){
    assert.throws(()=>report({...input,lines:lines.filter(l=>l.account_id==='ap')}),/incomplete|balance/);
    assert.throws(()=>report({...input,lines:lines.map((l,i)=>i===0?{...l,status:'draft'}:l)}),/non-posted lines/);
    assert.throws(()=>report({...input,journalsById:{...journalsById,original:{...journalsById.original,total_debit:400,total_credit:400}}}),/incomplete/);
    assert.throws(()=>report({...input,lines:[]}),/incomplete/);
    assert.throws(()=>report({...input,fromDate:'2026-02-30'}),/valid date range/);
    const legacy=report(input);assert.ok(legacy);
  }
  assert.throws(()=>computeTrialBalance({...input,accounts:accounts.filter(a=>a.id!=='ap')}),/missing account/);
});
