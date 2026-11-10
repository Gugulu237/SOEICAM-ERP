import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {buildCashFlow} from '../src/lib/cash-flow.js';
const require=createRequire(import.meta.url);
let compiled;
async function model(){
 if(compiled)return compiled;
 const out=await build({stdin:{contents:"export * from './src/lib/statement-drilldown.js';export {computeActivity,sectionRows,PL_TYPES} from './src/lib/statements.js';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'pure-ledger-fixture',setup(b){b.onResolve({filter:/^@\/lib\/posting$/},()=>({path:'rounding',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const round2=n=>Math.round(Number(n)*100)/100;'}));}}]});const m={exports:{}};new Function('require','module','exports',out.outputFiles[0].text)(require,m,m.exports);compiled=m.exports;return compiled;
}
function ledgerFixture(){
 const accounts=[
  {id:'cash',account_number:'1000',name:'Cash',account_type:'asset',normal_balance:'debit',is_treasury:true,balance:1060},
  {id:'equity',account_number:'3000',name:'Opening equity',account_type:'equity',normal_balance:'credit'},
  {id:'loan',account_number:'4000',name:'Loan',account_type:'liability',normal_balance:'credit'},
  {id:'contra',account_number:'2800',name:'Accumulated depreciation',account_type:'asset',normal_balance:'credit'},
  {id:'fuel',account_number:'6260',name:'Vehicle fuel',account_type:'expense',normal_balance:'debit'},
  {id:'child',account_number:'6261',name:'Fuel truck B',parent_id:'fuel',account_type:'expense',normal_balance:'debit'},
  {id:'sales',account_number:'7010',name:'Sales',account_type:'revenue',normal_balance:'credit'},
  {id:'cost',account_number:'5100',name:'Cost of sales',account_type:'cogs',normal_balance:'debit'},
  {id:'old-cost',account_number:'7000',name:'Prior cost account',account_type:'cogs',normal_balance:'debit',consolidated_into_account_id:'cost'},
 ];
 const journalsById={},lines=[];
 const add=(id,date,debitAccount,creditAccount,value,status='posted',extra={})=>{
  journalsById[id]={id,entry_date:date,journal_number:'JV-'+id,status,description:'Journal '+id,total_debit:value,total_credit:value,private_notes:'SECRET-HEADER',...extra};
  lines.push({id:id+'-d',journal_id:id,account_id:debitAccount,debit:value,credit:0,description:'Line '+id,private_cost:'SECRET-LINE'},{id:id+'-c',journal_id:id,account_id:creditAccount,debit:0,credit:value});
 };
 add('opening','2026-09-01','cash','equity',1000,'posted',{source_module:'opening_balances'});
 add('old-fuel','2026-09-05','fuel','cash',20);
 add('fuel','2026-10-03','fuel','cash',120);
 add('child','2026-10-04','child','cash',40);
 add('sales','2026-10-05','cash','sales',200,'posted',{source_module:'sales',source_document_type:'Invoice'});
 add('cost','2026-10-06','old-cost','cash',60);
 add('transfer','2026-10-07','cost','old-cost',10);
 add('draft','2026-10-08','fuel','cash',999,'draft');
 add('reversed-original','2026-10-15','fuel','cash',30,'reversed',{reversed_by_journal:'reversal'});
 add('reversal','2026-11-05','cash','fuel',30,'posted',{reversal_of:'reversed-original'});
 add('loan','2026-10-20','cash','loan',100);
 add('noncash','2026-10-22','fuel','contra',10);
 return {accounts,journalsById,lines,fromDate:'2026-10-01',toDate:'2026-10-31'};
}

test('account drill-down matches period amounts, exact account families, reversals and private-field projection',async()=>{
 const m=await model(),f=ledgerFixture(),activity=m.computeActivity(f),fuel=m.sectionRows(f.accounts,activity,['expense'],1).find(a=>a.id==='fuel');
 assert.equal(fuel.amount,160);assert.deepEqual(m.statementAccountMembers(f.accounts,'fuel',['expense']),['fuel'],'ordinary children are separately displayed and cannot be silently double-counted');
 const detail=m.buildStatementAccountDrilldown({...f,accountIds:['fuel'],sign:1,basis:'period',expectedAmount:fuel.amount});
 assert.equal(detail.openingBalance,20);assert.equal(detail.periodTotal,160);assert.equal(detail.closingBalance,180);assert.deepEqual(detail.rows.map(r=>r.journalId),['fuel','reversed-original','noncash']);assert.equal(detail.rows.at(-1).running,160);
 assert.doesNotMatch(JSON.stringify(detail),/SECRET|private_cost|private_notes/);assert.equal(detail.rows[0].description,'Journal fuel');
 const mobile=m.buildStatementAccountDrilldown({...f,accountIds:['fuel'],sign:-1,expectedAmount:-160});assert.equal(mobile.rows.reduce((n,r)=>n+r.effect,0),-160);
 const children=m.buildStatementAccountDrilldown({...f,accountIds:['fuel','child','fuel'],expectedAmount:200});assert.equal(children.rows.reduce((n,r)=>n+r.effect,0),200,'explicit aggregate members are counted once');
 const later=m.buildStatementAccountDrilldown({...f,fromDate:'2026-11-01',toDate:'2026-11-30',accountIds:['fuel'],expectedAmount:-30});assert.deepEqual(later.rows.map(r=>r.journalId),['reversal']);assert.equal(later.openingBalance,180);assert.equal(later.closingBalance,150);
});

test('consolidated children and transfers reconcile once without changing the report total',async()=>{
 const m=await model(),f=ledgerFixture(),activity=m.computeActivity(f),cost=m.sectionRows(f.accounts,activity,['cogs'],1)[0];
 assert.equal(cost.id,'cost');assert.equal(cost.amount,60);assert.deepEqual(m.statementAccountMembers(f.accounts,cost.id,['cogs']),['cost','old-cost']);
 const detail=m.buildStatementAccountDrilldown({...f,accountIds:m.statementAccountMembers(f.accounts,cost.id,['cogs']),expectedAmount:cost.amount});assert.equal(detail.rows.length,2);assert.equal(detail.rows.find(r=>r.journalId==='transfer').effect,0);assert.equal(detail.periodTotal,60);assert.equal(detail.rows.at(-1).running,60);
});

test('closing-balance drill-down includes opening imports, contra signs and cumulative earnings',async()=>{
 const m=await model(),f=ledgerFixture();
 const cash=m.buildStatementAccountDrilldown({...f,accountIds:['cash'],basis:'closing',expectedAmount:1030});assert.equal(cash.openingBalance,980);assert.equal(cash.periodTotal,50);assert.equal(cash.rows.at(-1).running,1030);assert.equal(cash.allRows[0].journalId,'opening');assert.equal(cash.allRows.at(-1).running,1030);
 const contra=m.buildStatementAccountDrilldown({...f,accountIds:['contra'],basis:'closing',sign:1,expectedAmount:-10});assert.equal(contra.closingBalance,-10,'contra assets remain negative regardless of normal balance');
 const loan=m.buildStatementAccountDrilldown({...f,accountIds:['loan'],basis:'closing',sign:-1,expectedAmount:100});assert.equal(loan.closingBalance,100);
 const earnings=m.buildStatementAccountDrilldown({...f,accountIds:f.accounts.filter(a=>m.PL_TYPES.includes(a.account_type)).map(a=>a.id),basis:'closing',sign:-1,expectedAmount:-80});assert.equal(earnings.openingBalance,-20);assert.equal(earnings.periodTotal,-60);assert.equal(earnings.closingBalance,-80);
 const openingOnly=m.buildStatementAccountDrilldown({...f,fromDate:'2026-10-23',toDate:'2026-10-31',accountIds:['cash'],basis:'closing',expectedAmount:1030});assert.equal(openingOnly.rows.length,0);assert.equal(openingOnly.openingBalance,1030);assert.equal(openingOnly.allRows.at(-1).running,1030);
});

test('drill-down refuses unreconciled totals, partial ledgers, missing accounts and invalid dates',async()=>{
 const m=await model(),f=ledgerFixture(),request={...f,accountIds:['fuel'],expectedAmount:160};
 assert.throws(()=>m.buildStatementAccountDrilldown({...request,expectedAmount:161}),/does not reconcile/);
 assert.throws(()=>m.buildStatementAccountDrilldown({...request,lines:f.lines.filter(l=>l.id!=='fuel-c')}),/incomplete|balance/);
 assert.throws(()=>m.buildStatementAccountDrilldown({...request,accountIds:['missing']}),/missing/);
 assert.throws(()=>m.buildStatementAccountDrilldown({...request,fromDate:'2026-11-31'}),/date range/);
});

test('cash-flow detail uses the loaded classification and captured dates rather than ordinary GL totals',async()=>{
 const m=await model(),f=ledgerFixture(),report=buildCashFlow({accounts:f.accounts,journals:Object.values(f.journalsById),cashLines:f.lines.filter(l=>l.account_id==='cash'),periodLines:f.lines,from:f.fromDate,to:f.toDate}),activity=report.activities.find(a=>a.rows.some(r=>r.account_id==='fuel')),row=activity.rows.find(r=>r.account_id==='fuel');
 assert.equal(row.outflow,150,'non-cash depreciation does not enter the cash allocation');
 const detail=m.buildCashAllocationDrilldown(report,{activity:activity.key,label:row.label,accountId:'fuel',expectedInflow:row.inflow,expectedOutflow:row.outflow});assert.equal(detail.periodTotal,-150);assert.deepEqual(detail.rows.map(r=>r.journalId),['fuel','reversed-original']);assert.equal(detail.fromDate,'2026-10-01');assert.equal(detail.toDate,'2026-10-31');assert.equal(detail.rows.at(-1).running,-150);
 assert.throws(()=>m.buildCashAllocationDrilldown(report,{activity:activity.key,label:row.label,accountId:'fuel',expectedInflow:0,expectedOutflow:160}),/does not reconcile/);
 const source=report.activities.flatMap(a=>a.rows.map(r=>({...r,activity:a.key}))).find(r=>r.account_id==='');assert.ok(source);const sale=m.buildCashAllocationDrilldown(report,{activity:source.activity,label:source.label,accountId:'',expectedInflow:source.inflow,expectedOutflow:source.outflow});assert.equal(sale.rows[0].journalId,'sales');assert.equal(sale.periodTotal,200);
});
