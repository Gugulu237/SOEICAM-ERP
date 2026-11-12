import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,date} from './helpers/cashier.mjs';
import {postJournal,nextSequence} from '../src/server/domain/field-ops.js';
import {checkedJournalLines} from '../src/server/domain/journal-validation.js';
import {saveAccountingPeriod} from '../src/server/domain/accounting-periods.js';
import {prepareTreasuryAccount} from '../src/server/domain/treasury-definition.js';
import {preparePostingRule} from '../src/server/domain/posting-rule-definition.js';
import {accountingIntegrity} from '../src/server/domain/accounting-integrity.js';
import {guardMutation} from '../src/server/access.js';
const context={user:{id:'gm',role:'admin',email:'gm@example.test'},role:'admin',employee:null};
const body=()=>({entryDate:date,description:'Controlled test posting',sourceModule:'test',sourceDocumentType:'Expense',sourceDocumentId:'same-source',userId:'gm',lines:[{account_id:'expense',debit:100},{account_id:'till-gl',credit:100}]});
function ids(f){const create=f.entities.AuditLog.create;f.entities.AuditLog.create=async value=>{const row=await create(value);if(value.id){Object.assign(f.rows.AuditLog.find(r=>r.id===row.id),{id:value.id});return {...row,id:value.id};}return row;};}
test('shared posting rejects orphan, negative, non-finite, sub-cent, invalid dates and inactive accounts before writing',async()=>{
 const f=await fixture(),s=f.entities,request=body();
 for(const lines of [
 [{account_id:'expense',debit:100},{credit:100}],
 [{account_id:'expense',debit:100,credit:-50},{account_id:'till-gl',credit:150}],
 [{account_id:'expense',debit:1.001},{account_id:'till-gl',credit:1.001}],
 [{account_id:'expense',debit:Infinity},{account_id:'till-gl',credit:100}],
 [{account_id:'expense',debit:100},{account_id:'till-gl',credit:99.99}]
 ]){const before=structuredClone(f.rows);await assert.rejects(postJournal({entities:s},{...request,lines}));assert.deepEqual(f.rows,before);}
 await assert.rejects(postJournal({entities:s},{...request,entryDate:'2026-02-30'}));
 await s.Account.update('expense',{is_active:false});const before=structuredClone(f.rows);await assert.rejects(postJournal({entities:s},request),/active posting/);assert.deepEqual(f.rows,before);
 assert.equal(checkedJournalLines([{account_id:'expense',debit:.1+.2},{account_id:'till-gl',credit:.3}]).debit,.3);
});
test('source retries compare full ledger evidence and distinguish source types and modules',async()=>{
 const f=await fixture(),s=f.entities,request=body(),first=await postJournal({entities:s},request),before=structuredClone(f.rows);
 assert.equal((await postJournal({entities:s},request)).reused,true);assert.deepEqual(f.rows,before);
 await assert.rejects(postJournal({entities:s},{...request,lines:[{account_id:'expense',debit:101},{account_id:'till-gl',credit:101}]}),{status:409});assert.deepEqual(f.rows,before);
 await s.AccountingPeriod.update('period',{status:'closed'});assert.equal((await postJournal({entities:s},request)).reused,true);
 await s.AccountingPeriod.update('period',{status:'open'});
 const another=await postJournal({entities:s},{...request,sourceModule:'another-module'});assert.notEqual(another.journal.id,first.journal.id);
 const third=await postJournal({entities:s},{...request,sourceDocumentType:'AnotherDocument'});assert.notEqual(third.journal.id,first.journal.id);
});
test('any closed overlapping period blocks shared postings and journal numbers skip existing references',async()=>{
 const f=await fixture(),s=f.entities;
 await s.AccountingPeriod.create({name:'Closed month',start_date:date.slice(0,8)+'01',end_date:date,status:'locked'});
 await assert.rejects(postJournal({entities:s},body()),/posting blocked/);assert.equal((await s.JournalEntry.list()).length,0);
 await s.JournalEntry.create({journal_number:'JV-000001',status:'draft'});
 assert.equal(await nextSequence({entities:s},'next_journal_number','JV',6),'JV-000002');
});
test('period transitions require GM, a reason, matching revision, stable retry identity and a server audit',async()=>{
 const f=await fixture(),s=f.entities;ids(f);
 const request={action:'transition',periodId:'period',revision:0,status:'closed',reason:'Monthly review complete',requestKey:crypto.randomUUID()};
 await assert.rejects(saveAccountingPeriod(s,{...context,user:{id:'cashier',role:'user'},role:'cashier',employee:{role:'cashier',status:'active'}},request),{status:403});
 await assert.rejects(saveAccountingPeriod(s,context,{...request,reason:''}),/reason/);
 const first=await saveAccountingPeriod(s,context,request);assert.equal(first.period.status,'closed');assert.equal((await saveAccountingPeriod(s,context,request)).reused,true);
 await assert.rejects(saveAccountingPeriod(s,context,{...request,requestKey:crypto.randomUUID()}),{status:409});
 await assert.rejects(saveAccountingPeriod(s,context,{...request,status:'open'}),{status:409});
 assert.equal((await s.AuditLog.list()).filter(r=>r.action==='period_closed').length,1);
});
test('generic financial record changes cannot bypass journals, allocations, period audits, cash or document sequences',()=>{
 for(const [entity,operation,input,existing]of [
 ['Account','update',{balance:999},{balance:0}],['AccountingPeriod','update',{status:'open'},{status:'locked'}],
 ['TreasuryTransaction','create',{amount:50}],['PaymentAllocation','create',{amount:50}],['Bill','update',{balance:0},{balance:100}],
 ['TreasuryAccount','create',{balance:100}],['TreasuryAccount','update',{balance:999},{balance:100,account_type:'cash'}],
 ['Customer','update',{balance:0},{balance:100}],['Supplier','update',{balance:0},{balance:100}],
 ['CompanySettings','update',{next_journal_number:1},{}],['Payment','delete',{}, {status:'posted'}],
 ['ExpenseRequest','update',{amount:1},{status:'paid',amount:100}],['ExpenseRequest','update',{amount:1},{status:'approved',amount:100}]
 ])assert.throws(()=>guardMutation(context,entity,operation,input,existing),{status:403},entity+' '+operation);
});
test('treasury setup derives cash from posted GL, blocks duplicate mappings and wrong account classes',async()=>{
 const f=await fixture(),s=f.entities;
 await postJournal({entities:s},{...body(),lines:[{account_id:'float-gl',debit:100},{account_id:'expense',credit:100}]});
 // A new register may attach to existing GL evidence without creating new money.
 f.rows.TreasuryAccount.splice(f.rows.TreasuryAccount.findIndex(t=>t.id==='float'),1);
 const prepared=await prepareTreasuryAccount(s,context,{name:'Reviewed float',account_type:'cash',gl_account_id:'float-gl',balance:0,is_active:true});
 assert.equal(prepared.balance,100);
 await assert.rejects(prepareTreasuryAccount(s,context,{name:'Duplicate',account_type:'cash',gl_account_id:'till-gl',is_active:true}),/own GL/);
 await assert.rejects(prepareTreasuryAccount(s,context,{name:'Wrong account',account_type:'cash',gl_account_id:'expense',is_active:true}),/cash asset/);
 await s.Account.update('receivable',{account_type:'asset',is_posting:true,is_active:true,normal_balance:'debit'});
 await assert.rejects(preparePostingRule(s,context,{account_id:'receivable'},await s.PostingRule.get('sales_revenue')),/correct type/);
});
test('physical count posting rules accept only an eligible expense offset',async()=>{
 const {entities:s}=await fixture(),rule_key='stock_count_offset_expense';
 const body={rule_key,account_id:'expense'};
 assert.equal((await preparePostingRule(s,context,body)).account_id,'expense');
 for(const [id,patch] of [
  ['income',{account_type:'other_income',normal_balance:'credit'}],['cogs',{account_type:'cogs'}],
  ['foreign',{currency:'EUR'}],['control',{is_control_account:true}],['treasury',{is_treasury:true}],
 ]){
  const account=await s.Account.create({account_number:id,account_type:'expense',normal_balance:'debit',is_active:true,is_posting:true,...patch});
  await assert.rejects(preparePostingRule(s,context,{...body,account_id:account.id}),/correct type/);
 }
 await s.TreasuryAccount.create({account_type:'cash',gl_account_id:'expense'});
 await assert.rejects(preparePostingRule(s,context,body),/non-treasury expense/);
 assert.ok(!(await s.PostingRule.list()).some(rule=>rule.rule_key===rule_key));
});

test('read-only integrity scan finds ledger/header/cash/mapping and allocation discrepancies without repairing data',async()=>{
 const f=await fixture(),s=f.entities;
 const saved=await postJournal({entities:s},body());await s.JournalEntry.update(saved.journal.id,{total_debit:999});
 await s.JournalLine.create({journal_id:'missing',account_id:'expense',debit:100,credit:0});
 await s.Payment.create({payment_type:'customer_payment',payment_number:'BAD',status:'posted',amount:100,party_id:'customer-a'});
 await s.Account.update('receivable',{account_type:'asset'});
 const before=structuredClone(f.rows),report=await accountingIntegrity(s,context);
 assert.ok(report.counts.header_line_mismatch);assert.ok(report.counts.treasury_gl_mismatch);assert.ok(report.counts.orphan_line);assert.ok(report.counts.payment_without_posted_journal);assert.deepEqual(f.rows,before);
 await assert.rejects(accountingIntegrity(s,{...context,role:'cashier',user:{id:'cashier',role:'user'},employee:{role:'cashier',status:'active'}}),{status:403});
});

test('integrity exposes balanced duplicate source postings with different journal numbers without changing their ledger effect',async()=>{
 const f=await fixture(),s=f.entities,first=await postJournal({entities:s},body());
 const second=await postJournal({entities:s},{...body(),sourceDocumentId:'another-source'});
 // Model historical/imported duplication that predates checked source retries.
 await s.JournalEntry.update(second.journal.id,{source_document_id:body().sourceDocumentId});
 const before=structuredClone(f.rows),report=await accountingIntegrity(s,context);
 assert.equal(report.counts.duplicate_source_journal,1);assert.equal(report.counts.duplicate_journal_number,undefined);
 assert.equal(report.duplicate_source_journals.length,1);
 assert.deepEqual(report.duplicate_source_journals[0],{source_module:'test',source_document_type:'Expense',source_document_id:'same-source',journal_count:2,journals:[first.journal,second.journal].sort((a,b)=>a.id.localeCompare(b.id)).map(j=>({id:j.id,journal_number:j.journal_number,date,status:'posted',reversal_of:'',reversed_by_journal:''})),truncated:false});
 assert.match(report.issues.find(issue=>issue.code==='duplicate_source_journal').reference,/JV-000001.*JV-000002|JV-000002.*JV-000001/);
 assert.equal((await s.Account.get('expense')).balance,200);assert.deepEqual(f.rows,before);
});

test('source integrity keeps modules, document types, staged issues and separate settlement documents distinct',async()=>{
 const f=await fixture(),s=f.entities;
 for(const source of [
  {sourceModule:'sales',sourceDocumentType:'Invoice',sourceDocumentId:'shared'},
  {sourceModule:'procurement',sourceDocumentType:'Invoice',sourceDocumentId:'shared'},
  {sourceModule:'sales',sourceDocumentType:'Payment',sourceDocumentId:'shared'},
  {sourceModule:'payments',sourceDocumentType:'Payment',sourceDocumentId:'payment-one'},
  {sourceModule:'payments',sourceDocumentType:'Payment',sourceDocumentId:'payment-two'},
  {sourceModule:'manufacturing',sourceDocumentType:'ProductionMaterialIssue',sourceDocumentId:'yogurt:order:issue:base'},
  {sourceModule:'manufacturing',sourceDocumentType:'ProductionMaterialIssue',sourceDocumentId:'yogurt:order:issue:packaging'},
  {sourceModule:'assets',sourceDocumentType:'DepreciationEntry',sourceDocumentId:'asset:2026-10'},
  {sourceModule:'assets',sourceDocumentType:'DepreciationEntry',sourceDocumentId:'asset:2026-11'},
 ])await postJournal({entities:s},{...body(),...source});
 const before=structuredClone(f.rows),report=await accountingIntegrity(s,context);
 assert.equal(report.counts.duplicate_source_journal,undefined);assert.deepEqual(report.duplicate_source_journals,[]);assert.deepEqual(f.rows,before);
});

test('source integrity retains reversed originals and ignores drafts, cancelled headers and missing source identities',async()=>{
 const f=await fixture(),s=f.entities,first=await postJournal({entities:s},body());
 await s.JournalEntry.update(first.journal.id,{status:'reversed',reversed_by_journal:'mirror'});
 // Correct dated reversal uses its own documentary type and original journal ID.
 await postJournal({entities:s},{...body(),sourceDocumentType:'reversal',sourceDocumentId:first.journal.id,lines:body().lines.map(l=>({account_id:l.account_id,debit:l.credit||0,credit:l.debit||0}))});
 for(const status of ['draft','cancelled'])await s.JournalEntry.create({journal_number:'IGNORED-'+status,entry_date:date,status,source_module:'test',source_document_type:'Expense',source_document_id:'same-source'});
 for(const field of ['source_module','source_document_type','source_document_id'])for(let n=0;n<2;n++)await s.JournalEntry.create({journal_number:'LEGACY-'+field+n,entry_date:date,status:'posted',source_module:'legacy',source_document_type:'LegacyEntry',source_document_id:'legacy-source',[field]:''});
 const clean=await accountingIntegrity(s,context);assert.equal(clean.counts.duplicate_source_journal,undefined);assert.deepEqual(clean.duplicate_source_journals,[]);
 const duplicate=await postJournal({entities:s},{...body(),sourceDocumentId:'historical-copy'});await s.JournalEntry.update(duplicate.journal.id,{source_document_id:'same-source'});
 const report=await accountingIntegrity(s,context);assert.equal(report.counts.duplicate_source_journal,1);assert.deepEqual(new Set(report.duplicate_source_journals[0].journals.map(j=>j.status)),new Set(['posted','reversed']));
});

async function periodRoute(){
 const {build}=await import('esbuild');
 const mocks={
 '@/server/auth':'export const authenticateRequest=async()=>globalThis.__integrityTest.context,checkOrigin=()=>{},apiError=e=>Response.json({error:e.message},{status:e.status||400});',
 '@/server/entities':'export const serviceEntities=new Proxy({},{get:(_,key)=>globalThis.__integrityTest.entities[key]});',
 '@/server/db':'export const database=()=>({unsafe:async()=>{}}),transaction=async run=>{const db=globalThis.__integrityTest.db;await db.exec("BEGIN");try{const value=await run();await db.exec("COMMIT");return value;}catch(e){await db.exec("ROLLBACK");throw e;}};'
 };
 const out=await build({entryPoints:['src/app/api/accounting/periods/route.js'],bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'period-api',setup(b){b.onResolve({filter:new RegExp('^@/server/')},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
 return import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));
}
test('period API rolls back the close and revision when its audit fails, and a successful retry changes the period once',async()=>{
 const {PGlite}=await import('@electric-sql/pglite'),db=new PGlite();
 try{const f=await fixture(db),s=f.entities,create=s.AuditLog.create;globalThis.__integrityTest={...f,context,db};const route=await periodRoute();
 const request={action:'transition',periodId:'period',revision:0,status:'closed',reason:'Monthly close reviewed',requestKey:crypto.randomUUID()},post=()=>route.POST(new Request('http://localhost/api/accounting/periods',{method:'POST',body:JSON.stringify(request)}));
 const before=(await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows;
 s.AuditLog.create=async()=>{throw Error('Audit unavailable');};assert.equal((await post()).status,400);assert.deepEqual((await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows,before);
 s.AuditLog.create=async value=>{if(value.id){await db.query('INSERT INTO fixture_entity VALUES($1,$2,$3)',['AuditLog',value.id,JSON.stringify(value)]);return value;}return create(value);};
 assert.equal((await post()).status,200);assert.equal((await post()).status,200);assert.equal((await s.AccountingPeriod.get('period')).accounting_period_revision,1);assert.equal((await s.AuditLog.list()).length,1);
 }finally{delete globalThis.__integrityTest;await db.close();}
});
