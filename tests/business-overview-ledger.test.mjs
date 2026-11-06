import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,user} from './helpers/cashier.mjs';
import {businessOverview} from '../src/server/domain/business-overview.js';

const admin={...user,role:'admin'};
const october={from:'2025-10-01',to:'2025-10-31'};
async function reportFixture(){
 const f=await fixture();
 for(const store of Object.values(f.entities))store.aggregate=async()=>({rows:[]});
 const accounts={};
 for(const type of ['revenue','cogs','expense','other_expense','other_income'])accounts[type]=await f.entities.Account.create({name:type,account_type:type});
 return {...f,accounts,report:(period=october)=>businessOverview(f.client,admin,period)};
}
async function addLine(f,journal,type,debit,credit,status){
 return f.entities.JournalLine.create({journal_id:journal.id,account_id:f.accounts[type].id,debit,credit,...(status?{status}:{})});
}

test('business profit, costs and revenue retain a reversed original through its original date',async()=>{
 const f=await reportFixture(),s=f.entities;
 const original=await s.JournalEntry.create({status:'reversed',entry_date:'2025-10-04',reversed_by_journal:'reversal',total_debit:105,total_credit:105});
 const reversal=await s.JournalEntry.create({status:'posted',entry_date:'2025-11-03',reversal_of:original.id});
 for(const [type,debit,credit] of [['revenue',0,100],['cogs',30,0],['expense',12,0],['other_expense',8,0],['other_income',0,5]]){
  await addLine(f,original,type,debit,credit,'reversed');
  await addLine(f,reversal,type,credit,debit,'posted');
 }
 await s.JournalLine.create({journal_id:original.id,account_id:'till-gl',debit:55,credit:0,status:'reversed'});
 await s.JournalLine.create({journal_id:reversal.id,account_id:'till-gl',debit:0,credit:55,status:'posted'});
 const before=structuredClone(f.rows),first=await f.report();
 assert.deepEqual([first.sales,first.cogs,first.expenses,first.other_income,first.profit,first.posted_journals],[100,30,20,5,55,1]);
 assert.deepEqual(first.sales_trend,[{date:'2025-10-04',amount:100}]);
 assert.deepEqual(first.expense_breakdown,[{name:'expense',amount:12},{name:'other_expense',amount:8}]);
 const second=await f.report({from:'2025-11-01',to:'2025-11-30'});
 assert.deepEqual([second.sales,second.cogs,second.expenses,second.other_income,second.profit,second.posted_journals],[-100,-30,-20,-5,-55,1]);
 const both=await f.report({from:'2025-10-01',to:'2025-11-30'});
 assert.deepEqual([both.sales,both.cogs,both.expenses,both.other_income,both.profit,both.posted_journals],[0,0,0,0,0,2]);
 assert.deepEqual(f.rows,before,'report reads must not change any source records');
});

test('draft headers, orphan lines and future journals cannot inflate overview; mixed posted/draft lines block it',async()=>{
 const f=await reportFixture(),s=f.entities;
 const active=await s.JournalEntry.create({status:'posted',entry_date:'2025-10-02'});
 await addLine(f,active,'revenue',0,10);
 await s.JournalLine.create({journal_id:active.id,account_id:'till-gl',debit:10,credit:0});
 for(const status of ['draft','cancelled']){
  const header=await s.JournalEntry.create({status,entry_date:'2025-10-02'});
  await addLine(f,header,'revenue',0,999,'posted');
 }
 await addLine(f,{id:'missing'},'revenue',0,999,'posted');
 const future=await s.JournalEntry.create({status:'posted',entry_date:'2025-11-01'});
 await addLine(f,future,'revenue',0,999,'posted');
 const report=await f.report();
 assert.equal(report.sales,10);assert.equal(report.profit,10);assert.equal(report.posted_journals,1);
 for(const status of ['draft','cancelled','pending']){
  const bad=await addLine(f,active,'revenue',0,999,status);
  await assert.rejects(f.report(),/non-posted line/);
  await s.JournalLine.deleteMany({id:bad.id});
 }
});

test('invalid ledger dates, missing accounts and amounts block overview instead of presenting partial figures',async()=>{
 const f=await reportFixture(),s=f.entities;
 const header=await s.JournalEntry.create({status:'posted',entry_date:'2025-10-02'});
 const line=await addLine(f,header,'revenue',0,10);
 await s.JournalLine.create({journal_id:header.id,account_id:'till-gl',debit:10,credit:0});
 for(const entry_date of ['2025-02-30','not-a-date','',null]){
  await s.JournalEntry.update(header.id,{entry_date});
  await assert.rejects(f.report(),/invalid date/);
 }
 await s.JournalEntry.update(header.id,{entry_date:'2025-10-02'});
 for(const values of [{debit:-1,credit:0},{debit:0,credit:0.001},{debit:1,credit:1},{debit:NaN,credit:0},{debit:0,credit:'invalid'}]){
  await s.JournalLine.update(line.id,values);
  await assert.rejects(f.report(),/invalid amounts/);
 }
 await s.JournalLine.update(line.id,{account_id:'missing-account',debit:0,credit:10});
 await assert.rejects(f.report(),/missing account/);
 for(const period of [{from:'2025-02-30',to:'2025-03-01'},{from:'2025-10-03',to:'2025-10-02'},{from:'9999-01-01',to:'9999-01-02'}])await assert.rejects(f.report(period),/valid report date|report period/);
});

test('overview preserves cents across paginated lines and refuses unsafe totals',async()=>{
 const f=await reportFixture(),s=f.entities;
 const journal=await s.JournalEntry.create({status:'posted',entry_date:'2025-10-02'});
 for(let i=0;i<1001;i++)await addLine(f,journal,'revenue',0,0.1,'posted');
 await s.JournalLine.create({journal_id:journal.id,account_id:'till-gl',debit:100.1,credit:0});
 const report=await f.report();
 assert.equal(report.sales,100.1);assert.equal(report.profit,100.1);assert.deepEqual(report.sales_trend,[{date:'2025-10-02',amount:100.1}]);
 for(let i=0;i<91;i++)await addLine(f,journal,'revenue',0,1e12,'posted');
 await assert.rejects(f.report(),/supported precision/);
});

test('overview rejects incomplete journals and mismatched headers, including opening history',async()=>{
 const f=await reportFixture(),s=f.entities;
 const header=await s.JournalEntry.create({status:'posted',entry_date:'2025-09-02'});
 await assert.rejects(f.report(),/incomplete or unbalanced/);
 await addLine(f,header,'revenue',0,10);
 await assert.rejects(f.report(),/incomplete or unbalanced/);
 const counter=await s.JournalLine.create({journal_id:header.id,account_id:'till-gl',debit:9,credit:0});
 await assert.rejects(f.report(),/incomplete or unbalanced/);
 await s.JournalLine.update(counter.id,{debit:10});
 const legacy=await f.report();assert.equal(legacy.profit,0);assert.equal(legacy.posted_journals,0);
 for(const totals of [{total_debit:11,total_credit:10},{total_debit:10,total_credit:11}]){
  await s.JournalEntry.update(header.id,totals);
  await assert.rejects(f.report(),/inconsistent totals/);
 }
 await s.JournalEntry.update(header.id,{total_debit:10,total_credit:10});
 const valid=await f.report();assert.equal(valid.profit,0);
});
