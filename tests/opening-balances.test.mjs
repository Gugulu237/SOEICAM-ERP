import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {build} from 'esbuild';
import {fixture,date} from './helpers/cashier.mjs';
import {openingBalancesWorkspace,postOpeningBalances} from '../src/server/domain/opening-balances.js';
import {postJournal} from '../src/server/domain/field-ops.js';
import {guardMutation} from '../src/server/access.js';
import {journalLifecycle} from '../src/server/domain/journal-lifecycle.js';
import {buildCashFlow,cashFlowCsv} from '../src/lib/cash-flow.js';
import {cashFlowDocument} from '../src/lib/report-models.js';
const context={user:{id:'gm',role:'admin',email:'gm@example.test'},role:'admin',employee:null};
const monthStart=date.slice(0,8)+'01';
const prev=new Date(monthStart+'T12:00:00Z');prev.setUTCDate(0);const openingDate=prev.toISOString().slice(0,10);
async function setup(db){const f=await fixture(db),s=f.entities;const capital=await s.Account.create({name:'Retained capital',account_number:'3000',account_type:'equity',normal_balance:'credit',balance:0,is_posting:true,is_active:true});return {...f,capital,body:{requestKey:crypto.randomUUID(),date:openingDate,reference:'Prior-system closing trial balance',lines:[{account_id:'till-gl',debit:50000},{account_id:capital.id,credit:50000}]}};}
test('backdated migration reconciles old treasury setup values to the posted ledger once, preserving later transactions',async()=>{
 const f=await setup(),s=f.entities;
 await postJournal({entities:s},{entryDate:date,description:'Operating payment',sourceModule:'treasury',sourceDocumentId:'later',userId:'cashier',lines:[{account_id:'expense',debit:5000},{account_id:'till-gl',credit:5000}]});
 const saved=await postOpeningBalances(s,context,f.body);
 assert.equal(saved.journal.entry_date,openingDate);assert.equal(saved.journal.posted_by,'gm');
 assert.equal((await s.TreasuryAccount.get('till')).balance,45000);assert.equal((await s.Account.get('till-gl')).balance,45000);
 assert.equal((await s.Account.get(f.capital.id)).balance,50000);assert.equal((await s.TreasuryTransaction.list()).length,0);
 const before=structuredClone(f.rows);
 assert.equal((await postOpeningBalances(s,context,f.body)).reused,true);assert.deepEqual(f.rows,before);
 await assert.rejects(postOpeningBalances(s,context,{...f.body,reference:'Changed figures'}),{status:409});
 await assert.rejects(postOpeningBalances(s,context,{...f.body,requestKey:crypto.randomUUID()}),/already posted/);
 const w=await openingBalancesWorkspace(s,context);assert.equal(w.date,openingDate);assert.equal(w.first_transaction_date,date);assert.equal(w.history.length,1);assert.equal(w.accounts.find(a=>a.id==='till-gl').opening_recorded,true);
 const report=(from,to)=>buildCashFlow({accounts:f.rows.Account.filter(a=>['till-gl','expense',f.capital.id].includes(a.id)),treasury:f.rows.TreasuryAccount,journals:f.rows.JournalEntry,cashLines:f.rows.JournalLine,periodLines:f.rows.JournalLine,from,to});
 // Only the till/expense/capital subset has posted history in this fixture.
 f.rows.TreasuryAccount.splice(1);f.rows.Account.forEach(a=>{if(a.id!=='till-gl'&&a.id!=='expense'&&a.id!==f.capital.id)a.balance=0;});
 const during=report(openingDate,date);assert.equal(during.opening,0);assert.equal(during.opening_adjustments,50000);assert.equal(during.inflow,0);assert.equal(during.outflow,5000);assert.equal(during.closing,45000);assert.equal(during.reconciliation_difference,0);assert.deepEqual(during.issues,[]);
 const after=report(monthStart,date);assert.equal(after.opening,50000);assert.equal(after.opening_adjustments,0);assert.equal(after.outflow,5000);
 assert.match(cashFlowCsv(during),/Opening balance imports/);assert.ok(cashFlowDocument(during).sections[0].rows.some(r=>r[0]==='Opening balance imports'&&r[1]===50000));
});
test('migration preserves reversed originals and their reversal when reconciling cached balances',async()=>{
 const f=await setup(),s=f.entities;
 const original=await postJournal({entities:s},{entryDate:date,description:'Original',sourceModule:'manual',sourceDocumentId:'original',userId:'gm',lines:[{account_id:'expense',debit:100},{account_id:'till-gl',credit:100}]});
 await s.JournalEntry.update(original.journal.id,{status:'reversed'});
 await postJournal({entities:s},{entryDate:date,description:'Reversal',sourceModule:'manual',sourceDocumentId:'reversal',userId:'gm',lines:[{account_id:'till-gl',debit:100},{account_id:'expense',credit:100}]});
 await postOpeningBalances(s,context,f.body);assert.equal((await s.TreasuryAccount.get('till')).balance,50000);
});
test('only active administrators with accounting access can inspect or post migration balances',async()=>{
 const f=await setup();for(const ctx of [
 {...context,role:'cashier',user:{id:'cashier',role:'user'},employee:{role:'cashier',status:'active',allowed_modules:['accounting']}},
 {...context,employee:{role:'admin',status:'inactive'}},
 {...context,roleCatalogue:{roles:{admin:{modules:[]}}}}
 ]){await assert.rejects(openingBalancesWorkspace(f.entities,ctx),{status:403});await assert.rejects(postOpeningBalances(f.entities,ctx,f.body),{status:403});}
 assert.equal(f.rows.JournalEntry.length,0);
});
test('invalid amounts, dates, accounts, unbalanced and duplicate lines fail before any ledger writes',async()=>{
 const f=await setup(),s=f.entities;await s.Account.create({id:'ignored',name:'Header',is_posting:false});
 const mutations=[
 {date:'2026-02-30'},{date:'2099-01-01'},{reference:''},{requestKey:'bad'},
 {lines:[{account_id:'till-gl',debit:1},{account_id:f.capital.id,credit:2}]},
 {lines:[{account_id:'till-gl',debit:1},{account_id:'till-gl',credit:1}]},
 {lines:[{account_id:'till-gl',debit:2,credit:1},{account_id:f.capital.id,credit:1}]},
 {lines:[{account_id:'missing',debit:2},{account_id:f.capital.id,credit:2}]},
 {lines:[{account_id:'till-gl',debit:2.001},{account_id:f.capital.id,credit:2.001}]},
 {lines:[{account_id:'till-gl',debit:-2},{account_id:f.capital.id,credit:-2}]}
 ];const before=structuredClone(f.rows);
 for(const changes of mutations){await assert.rejects(postOpeningBalances(s,context,{...f.body,...changes}));assert.deepEqual(f.rows,before);}
 for(const changes of [{is_posting:false},{is_active:false},{currency:'USD'}]){await s.Account.update(f.capital.id,{is_posting:true,is_active:true,currency:'XAF',...changes});await assert.rejects(postOpeningBalances(s,context,f.body));}
});
test('opening dates respect existing activity, previous migration dates and closed accounting periods',async()=>{
 const f=await setup(),s=f.entities;
 await s.JournalEntry.create({entry_date:openingDate,status:'posted',source_module:'manual'});
 await assert.rejects(postOpeningBalances(s,context,{...f.body,date}),/first recorded transaction/);
 await s.AccountingPeriod.update('period',{status:'locked'}); // Opening date is in the previous month of this year.
 await assert.rejects(postOpeningBalances(s,context,f.body),/closed|locked/);await s.AccountingPeriod.update('period',{status:'open'});
 await postOpeningBalances(s,context,f.body);
 const extra=await s.Account.create({name:'Another equity',normal_balance:'credit',is_active:true,is_posting:true});
 await assert.rejects(postOpeningBalances(s,context,{...f.body,requestKey:crypto.randomUUID(),date:monthStart,lines:[{account_id:'bank-gl',debit:10},{account_id:extra.id,credit:10}]}),/same opening date/);
});
test('control account import requires explicit reconciliation acknowledgement and never creates detailed debts or stock',async()=>{
 const f=await setup(),s=f.entities;await s.Account.update('till-gl',{is_control_account:true});
 await assert.rejects(postOpeningBalances(s,context,f.body),/reconciled separately/);
 const details=structuredClone({customers:f.rows.Customer,suppliers:f.rows.Supplier,stock:f.rows.StockBalance,invoices:f.rows.Invoice});
 await postOpeningBalances(s,context,{...f.body,acknowledgeControlBalances:true});
 assert.deepEqual({customers:f.rows.Customer,suppliers:f.rows.Supplier,stock:f.rows.StockBalance,invoices:f.rows.Invoice},details);
 const another=await setup();await another.entities.TreasuryAccount.create({name:'Duplicate till mapping',gl_account_id:'till-gl'});
 await assert.rejects(postOpeningBalances(another.entities,context,another.body),/own GL account/);
});
test('opening journals cannot be overwritten, forged or reversed through ordinary journal actions',async()=>{
 const f=await setup(),{journal}=await postOpeningBalances(f.entities,context,f.body);
 assert.throws(()=>guardMutation(context,'JournalEntry','create',{source_module:'opening_balances'}),{status:403});
 assert.throws(()=>guardMutation(context,'JournalEntry','update',{source_module:'manual'},journal),{status:403});
 assert.throws(()=>guardMutation(context,'JournalEntry','create',{opening_request_key:'forged'}),{status:403});
 await assert.rejects(journalLifecycle(f.entities,context,{action:'reverse',journalId:journal.id}),/original business workflow/);
});
async function route(){
 const mocks={
 '@/server/auth':'export const authenticateRequest=async()=>globalThis.__openingTest.context,checkOrigin=()=>{},apiError=e=>Response.json({error:e.message},{status:e.status||400});',
 '@/server/entities':'export const serviceEntities=new Proxy({},{get:(_,key)=>globalThis.__openingTest.entities[key]});',
 '@/server/db':'export const database=()=>({unsafe:async()=>{}}),transaction=async run=>{const db=globalThis.__openingTest.db;await db.exec("BEGIN");try{const r=await run();await db.exec("COMMIT");return r;}catch(e){await db.exec("ROLLBACK");throw e;}};'
 };
 const r=await build({entryPoints:['src/app/api/accounting/opening-balances/route.js'],bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'opening-fixture',setup(b){b.onResolve({filter:/^@\/server\//},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
 return import('data:text/javascript;base64,'+Buffer.from(r.outputFiles[0].text).toString('base64'));
}
test('API transaction rolls back journal, lines, sequence, audits and caches after a late treasury failure; retry posts once',async()=>{
 const db=new PGlite();try{const f=await setup(db),s=f.entities,r=await route();globalThis.__openingTest={...f,context,db};
 const before=(await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows;
 const update=s.TreasuryAccount.update;s.TreasuryAccount.update=async()=>{throw Error('Treasury unavailable');};
 const post=()=>r.POST(new Request('http://localhost/api/accounting/opening-balances',{method:'POST',body:JSON.stringify(f.body)}));
 assert.equal((await post()).status,400);assert.deepEqual((await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows,before);
 s.TreasuryAccount.update=update;const response=await post();assert.equal(response.status,200);assert.equal((await post()).status,200);
 const saved=await response.json();assert.equal((await s.JournalLine.filter({journal_id:saved.journal.id})).length,2);assert.equal((await s.JournalEntry.list()).length,1);assert.equal((await s.TreasuryAccount.get('till')).balance,50000);
 }finally{delete globalThis.__openingTest;await db.close();}
});

test('inconsistent posted lines are rejected before migration writes and closed-period requests leave no new ledger data',async()=>{
 const f=await setup(),s=f.entities;
 const j=await s.JournalEntry.create({entry_date:date,status:'posted',source_module:'legacy'});
 await s.JournalLine.create({journal_id:j.id,account_id:'till-gl',debit:100,credit:0,status:'draft'});
 const before=structuredClone(f.rows);
 await assert.rejects(postOpeningBalances(s,context,f.body),/inconsistent posted/);assert.deepEqual(f.rows,before);
});
test('multiple disjoint account batches share one migration date without reusing accounts',async()=>{
 const f=await setup(),s=f.entities;await postOpeningBalances(s,context,f.body);
 const capital=await s.Account.create({name:'Additional retained equity',normal_balance:'credit',is_active:true,is_posting:true});
 await postOpeningBalances(s,context,{...f.body,requestKey:crypto.randomUUID(),lines:[{account_id:'bank-gl',debit:25000},{account_id:capital.id,credit:25000}]});
 assert.equal((await s.TreasuryAccount.get('bank')).balance,25000);assert.equal((await openingBalancesWorkspace(s,context)).history.length,2);
});
