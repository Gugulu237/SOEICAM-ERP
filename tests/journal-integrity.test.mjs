import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { PGlite } from '@electric-sql/pglite';
import { saveManualJournal } from '../src/server/domain/manual-journals.js';
import { journalLifecycle } from '../src/server/domain/journal-lifecycle.js';
import { payrollAction } from '../src/server/domain/payroll-workspace.js';
import { matches } from './helpers/commercial-supply.mjs';
import { businessDate } from '../src/lib/business-date.js';

const date=businessDate(), context={user:{id:'gm',role:'admin',email:'gm@example.test'},role:'admin',employee:null};
async function fixture(db) {
  const rows={
    Account:[{id:'cash',name:'Cash',account_number:'1000',normal_balance:'debit',balance:0,is_active:true,is_posting:true},{id:'capital',name:'Capital',account_number:'3000',normal_balance:'credit',balance:0,is_active:true,is_posting:true},
      {id:'wages',name:'Salary expense',account_type:'expense',account_number:'6100',normal_balance:'debit',balance:0,is_active:true,is_posting:true},{id:'payable',name:'Salaries payable',account_type:'liability',account_number:'4200',normal_balance:'credit',balance:0,is_active:true,is_posting:true}],
    PostingRule:[],CompanySettings:[{id:'settings',next_journal_number:1}],AccountingPeriod:[{id:'period',start_date:date.slice(0,4)+'-01-01',end_date:date.slice(0,4)+'-12-31',status:'open'}],
    Employee:[{id:'staff',full_name:'Employee',base_salary:100000,status:'active'}],JournalEntry:[],JournalLine:[],AuditLog:[],PayrollRun:[],PayrollLine:[],TreasuryAccount:[],Payment:[],TreasuryTransaction:[],
  };
  if (db) {
    await db.exec('CREATE TABLE journal_fixture(entity text,id text,data jsonb,PRIMARY KEY(entity,id))');
    for(const [name,records] of Object.entries(rows)) for(const record of records) await db.query('INSERT INTO journal_fixture VALUES($1,$2,$3)',[name,record.id,JSON.stringify(record)]);
  }
  const stores=Object.fromEntries(Object.entries(rows).map(([name,data])=>{
    const all=async()=>db?(await db.query('SELECT data FROM journal_fixture WHERE entity=$1 ORDER BY id',[name])).rows.map(row=>row.data):structuredClone(data);
    const get=async id=>(await all()).find(row=>row.id===id);
    const create=async input=>{
      const row={...structuredClone(input),id:crypto.randomUUID(),created_date:new Date().toISOString()};
      if(db)await db.query('INSERT INTO journal_fixture VALUES($1,$2,$3)',[name,row.id,JSON.stringify(row)]);else data.push(row);
      return structuredClone(row);
    };
    const update=async(id,input)=>{
      const row={...await get(id),...structuredClone(input)};
      if(db)await db.query('UPDATE journal_fixture SET data=$1 WHERE entity=$2 AND id=$3',[JSON.stringify(row),name,id]);else Object.assign(data.find(r=>r.id===id),row);
      return structuredClone(row);
    };
    const deleteMany=async query=>{for(const row of (await all()).filter(row=>matches(row,query))){if(db)await db.query('DELETE FROM journal_fixture WHERE entity=$1 AND id=$2',[name,row.id]);else data.splice(data.findIndex(record=>record.id===row.id),1);}};
    return [name,{list:all,get,create,update,deleteMany,filter:async(query,sort,limit,skip=0)=>(await all()).filter(row=>matches(row,query)).slice(skip,limit?skip+limit:undefined),bulkCreate:async input=>{const saved=[];for(const row of input)saved.push(await create(row));return saved;}}];
  }));
  return {stores,rows,db,context};
}
const journalBody=()=>({requestKey:crypto.randomUUID(),entryDate:date,description:'Opening capital',status:'posted',lines:[{account_id:'cash',debit:1000,credit:0},{account_id:'capital',debit:0,credit:1000}]});
const payrollBody=()=>({action:'create',month:Number(date.slice(5,7)),year:Number(date.slice(0,4)),requestKey:crypto.randomUUID()});
async function bundle(entryPoint) {
  const mocks={
    entities:'export const serviceEntities=new Proxy({},{get:(_,key)=>globalThis.__journalTest.stores[key]});export const entityStore=key=>globalThis.__journalTest.stores[key];',
    db:'export const database=()=>({unsafe:async()=>{}});export const transaction=async run=>{const db=globalThis.__journalTest.db;if(!db)return run();await db.exec("BEGIN");try{const value=await run();await db.exec("COMMIT");return value;}catch(error){await db.exec("ROLLBACK");throw error;}};',
    auth:'export const authenticateRequest=async()=>globalThis.__journalTest.context,checkOrigin=()=>{},apiError=error=>Response.json({error:error.message},{status:error.status||400});',
    empty:'',
  };
  const result=await build({entryPoints:[entryPoint],bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'journal-fixture',setup(b){
    b.onResolve({filter:/^(?:@\/server\/(?:entities|db|auth)|\.\/(?:entities|db)\.js|server-only)$/},args=>({path:args.path==='server-only'?'empty':args.path.split('/').at(-1).replace('.js',''),namespace:'journal-mock'}));
    b.onLoad({filter:/.*/,namespace:'journal-mock'},args=>({contents:mocks[args.path]}));
  }}]});
  return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
}
const post=(route,body)=>route.POST(new Request('http://localhost/api/accounting/test',{method:'POST',body:JSON.stringify(body)}));

test('generic API blocks every journal and payroll write, including bulk, flags, deletion and unsupported upsert',async()=>{
  const f=await fixture();globalThis.__journalTest=f;
  try {
    const {entityOperation}=await bundle('src/server/entity-api.js');
    for(const name of ['JournalEntry','JournalLine','PayrollRun','PayrollLine']) for(const operation of ['create','bulkCreate','update','updateMany','delete','deleteMany','upsert']) {
      const args=operation==='bulkCreate'?[[{status:'draft',is_immutable:false}]]:operation==='create'?[{status:'posted',is_immutable:false}]:['record',{status:'draft',is_immutable:false,source_module:'manual'}];
      await assert.rejects(entityOperation(context,name,operation,args),{status:403},name+' '+operation);
    }
    assert.equal((await f.stores.JournalEntry.list()).length,0);assert.equal((await f.stores.JournalLine.list()).length,0);
    const journal=await saveManualJournal(f.stores,context,journalBody());
    assert.equal((await entityOperation(context,'JournalEntry','get',[journal.id])).id,journal.id);
    assert.equal((await entityOperation(context,'JournalLine','filter',[{journal_id:journal.id}])).length,2);
  } finally {delete globalThis.__journalTest;}
});

test('checked manual drafts post balances once and manual reversal keeps both original and mirror in posted ledger',async()=>{
  const {stores:s}=await fixture(),body={...journalBody(),status:'draft'};
  const draft=await saveManualJournal(s,context,body);assert.equal((await s.Account.get('cash')).balance,0);
  const journal=await journalLifecycle(s,context,{action:'postDraft',journalId:draft.id});
  assert.equal(journal.status,'posted');assert.equal((await s.Account.get('cash')).balance,1000);
  await journalLifecycle(s,context,{action:'postDraft',journalId:draft.id});assert.equal((await s.Account.get('cash')).balance,1000);
  const reversal=await journalLifecycle(s,context,{action:'reverse',journalId:journal.id,reason:'Correct a mistaken entry',reversalDate:date});
  assert.equal(reversal.reversal_of,journal.id);assert.equal((await s.Account.get('cash')).balance,0);assert.equal((await s.Account.get('capital')).balance,0);
  const posted=await s.JournalEntry.filter({status:'posted'});assert.equal(posted.length,2);
  const lines=await s.JournalLine.filter({journal_id:{$in:posted.map(row=>row.id)}});
  assert.equal(lines.filter(row=>row.account_id==='cash').reduce((sum,row)=>sum+row.debit-row.credit,0),0);
  assert.equal((await journalLifecycle(s,context,{action:'reverse',journalId:journal.id,reason:'Correct a mistaken entry',reversalDate:date})).id,reversal.id);assert.equal((await s.JournalEntry.list()).length,2);
});

test('cashier cannot reverse, business-source journals cannot be detached from source workflows, disabled modules reject edits',async()=>{
  const {stores:s}=await fixture(),journal=await saveManualJournal(s,context,journalBody());
  const cashier={user:{id:'accountant',role:'user'},role:'cashier',employee:{role:'cashier',status:'active',allowed_modules:['accounting']}};
  await assert.rejects(journalLifecycle(s,cashier,{action:'reverse',journalId:journal.id,reason:'Correct a mistaken entry',reversalDate:date}),{status:403});
  await assert.rejects(journalLifecycle(s,{...cashier,employee:{...cashier.employee,allowed_modules:[]}},{action:'postDraft',journalId:journal.id}),{status:403});
  await s.JournalEntry.update(journal.id,{source_module:'inventory_adjustment',source_document_type:'WarehouseAdjustment'});
  await assert.rejects(journalLifecycle(s,context,{action:'reverse',journalId:journal.id,reason:'Correct a mistaken entry',reversalDate:date}),/original business workflow/);
  assert.equal((await s.JournalEntry.list()).length,1);assert.equal((await s.Account.get('cash')).balance,1000);
});

test('manual reversal API rolls back mirror, account balances and source metadata on late audit failure',async()=>{
  const db=new PGlite();try {
    const f=await fixture(db);globalThis.__journalTest=f;const route=await bundle('src/app/api/accounting/journals/route.js');
    const journal=await saveManualJournal(f.stores,context,journalBody());
    const before=(await db.query('SELECT * FROM journal_fixture ORDER BY entity,id')).rows,create=f.stores.AuditLog.create;
    f.stores.AuditLog.create=async input=>{if(input.action==='reverse_journal')throw Error('Audit unavailable');return create(input);};
    assert.equal((await post(route,{action:'reverse',journalId:journal.id,reason:'Correct a mistaken entry',reversalDate:date})).status,400);
    assert.deepEqual((await db.query('SELECT * FROM journal_fixture ORDER BY entity,id')).rows,before);
    f.stores.AuditLog.create=create;assert.equal((await post(route,{action:'reverse',journalId:journal.id,reason:'Correct a mistaken entry',reversalDate:date})).status,200);
    assert.equal((await post(route,{action:'reverse',journalId:journal.id,reason:'Correct a mistaken entry',reversalDate:date})).status,200);assert.equal((await f.stores.JournalEntry.list()).length,2);
  } finally {delete globalThis.__journalTest;await db.close();}
});

async function reviewPayroll(stores,run) {
  for(const l of await stores.PayrollLine.filter({payroll_id:run.id}))await payrollAction(stores,context,{action:'reviewLine',runId:run.id,lineId:l.id,revision:(await stores.PayrollRun.get(run.id)).payroll_revision,changes:{base_salary:l.base_salary,allowances:0,variable_pay:0,unpaid_time_amount:0,statutory_deductions:0,other_deductions:0,statutory_reviewed:true,adjustment_reason:'Contract and payroll checked',adjustment_reference:'PAYROLL-SHEET-001'}});
}
const version=async(s,id)=>(await s.PayrollRun.get(id)).payroll_revision;
test('payroll calculation, individual review and approval record employee payables once without an unverified flat statutory deduction',async()=>{
  const {stores:s}=await fixture(),body=payrollBody();
  const run=await payrollAction(s,context,body);assert.equal(run.total_gross,100000);assert.equal(run.total_deductions,0);assert.equal(run.total_net,100000);
  assert.equal((await payrollAction(s,context,body)).id,run.id);assert.equal((await s.PayrollLine.list()).length,1);
  await assert.rejects(payrollAction(s,context,{action:'post',runId:run.id,revision:await version(s,run.id)}),/review and save every/);
  await reviewPayroll(s,run);
  const approved=await payrollAction(s,context,{action:'approve',runId:run.id,revision:await version(s,run.id)});assert.equal(approved.approved_by,context.user.id);assert.equal(approved.status,'posted');
  await payrollAction(s,context,{action:'post',runId:run.id});assert.equal((await s.JournalEntry.list()).length,1);assert.equal((await s.JournalLine.list()).length,2);
  assert.equal((await s.Account.get('wages')).balance,100000);assert.equal((await s.Account.get('payable')).balance,100000);
  await assert.rejects(payrollAction(s,context,{...body,requestKey:crypto.randomUUID()}),{status:409});
  await assert.rejects(payrollAction(s,context,{...body,month:body.month===1?2:1}),{status:409});
});
test('payroll rejects unauthorized actors, invalid periods, changed totals and missing posting accounts',async()=>{
  const {stores:s}=await fixture(),body=payrollBody();
  for(const employee of [{role:'cashier',status:'active'},{role:'admin',status:'inactive'}])await assert.rejects(payrollAction(s,{user:{id:'staff',role:'user'},employee},body),{status:403});
  await assert.rejects(payrollAction(s,{...context,roleCatalogue:{roles:{admin:{modules:['accounting']}}}},body),{status:403});
  for(const month of [0,13,1.5])await assert.rejects(payrollAction(s,context,{...body,month}),/valid payroll/);
  const run=await payrollAction(s,context,body);await reviewPayroll(s,run);
  await s.PayrollRun.update(run.id,{total_gross:1});await assert.rejects(payrollAction(s,context,{action:'approve',runId:run.id,revision:await version(s,run.id)}),/totals changed/);
  await s.PayrollRun.update(run.id,{total_gross:100000});await s.Account.update('wages',{is_active:false});await assert.rejects(payrollAction(s,context,{action:'approve',runId:run.id,revision:await version(s,run.id)}),/Configure active posting accounts/);
  assert.equal((await s.JournalEntry.list()).length,0);assert.equal((await s.PayrollRun.get(run.id)).status,'calculated');
});
test('rejected unreviewed payroll can be recalculated from current salaries and still requires individual review and GM approval',async()=>{
  const {stores:s}=await fixture(),run=await payrollAction(s,context,payrollBody());
  await assert.rejects(payrollAction(s,context,{action:'reject',runId:run.id,revision:await version(s,run.id),reason:''}),/rejection reason/);
  await payrollAction(s,context,{action:'reject',runId:run.id,revision:await version(s,run.id),reason:'Correct salary'});
  await s.Employee.update('staff',{base_salary:200000});
  const recalculated=await payrollAction(s,context,{action:'recalculate',runId:run.id,revision:await version(s,run.id)});
  assert.equal(recalculated.total_gross,200000);assert.equal(recalculated.approved_by,'');assert.equal((await s.PayrollLine.list()).length,1);
  await reviewPayroll(s,run);await payrollAction(s,context,{action:'approve',runId:run.id,revision:await version(s,run.id)});
  await assert.rejects(payrollAction(s,context,{action:'recalculate',runId:run.id}),/Only an unapproved/);
  assert.equal((await s.Account.get('wages')).balance,200000);
});
test('payroll API rolls back incomplete creation and late approval failures including balances, payable, reviews and numbering',async()=>{
  const db=new PGlite();try {
    const f=await fixture(db);globalThis.__journalTest=f;const route=await bundle('src/app/api/accounting/payroll/route.js'),body=payrollBody();
    const create=f.stores.AuditLog.create;f.stores.AuditLog.create=async()=>{throw Error('Audit unavailable');};
    const before=(await db.query('SELECT * FROM journal_fixture ORDER BY entity,id')).rows;
    assert.equal((await post(route,body)).status,400);assert.deepEqual((await db.query('SELECT * FROM journal_fixture ORDER BY entity,id')).rows,before);
    f.stores.AuditLog.create=create;const response=await post(route,body);assert.equal(response.status,200);const run=await response.json();await reviewPayroll(f.stores,run);
    const reviewed=(await db.query('SELECT * FROM journal_fixture ORDER BY entity,id')).rows;
    f.stores.AuditLog.create=async input=>{if(input.action==='approve_payroll')throw Error('Audit unavailable');return create(input);};
    const approve={action:'approve',runId:run.id,revision:await version(f.stores,run.id)};
    assert.equal((await post(route,approve)).status,400);assert.deepEqual((await db.query('SELECT * FROM journal_fixture ORDER BY entity,id')).rows,reviewed);
    f.stores.AuditLog.create=create;assert.equal((await post(route,approve)).status,200);assert.equal((await post(route,approve)).status,200);
    assert.equal((await f.stores.JournalEntry.list()).length,1);assert.equal((await f.stores.Account.get('wages')).balance,100000);
  } finally {delete globalThis.__journalTest;await db.close();}
});

test('browser posting and payroll controls call checked endpoints rather than editing journals directly',async()=>{
  const posting=await readFile('src/lib/posting.js','utf8'),payroll=await readFile('src/components/payroll/PayrollWorkspace.jsx','utf8'),approvals=await readFile('src/lib/approvals.js','utf8');
  assert.doesNotMatch(posting,/entities\.(?:JournalEntry|JournalLine|Account)\.(?:create|update|delete|bulkCreate)/);
  assert.doesNotMatch(payroll,/entities\.(?:JournalEntry|JournalLine|PayrollRun|PayrollLine)\.(?:create|update|delete|bulkCreate)/);
  assert.match(posting,/saveJournal/);assert.match(payroll,/accounting\.payroll/);assert.match(payroll,/createKey\.current/);
  assert.doesNotMatch(approvals,/entities\.PayrollRun\.(create|update|delete)/);assert.match(approvals,/accounting\.payroll\(\{action:'reject'/);
});

test('manual journals reject sub-cent amounts, unbalanced entries and unsafe totals before any writes',async()=>{
 const {stores:s,rows}=await fixture(),base=journalBody(),before=structuredClone(rows);
 for(const lines of [
 [{account_id:'cash',debit:1.001},{account_id:'capital',credit:1.001}],
 [{account_id:'cash',debit:1},{account_id:'capital',credit:.99}],
 [{debit:10},{account_id:'capital',credit:10}],
 Array.from({length:200},(_,i)=>({account_id:i%2?'cash':'capital',debit:i%2?1e12:0,credit:i%2?0:1e12}))
 ]){await assert.rejects(saveManualJournal(s,context,{...base,lines}));assert.deepEqual(rows,before);}
});

test('manual cash journals keep Treasury and GL in sync, block stale cash caches and reject bank access or source-control accounts',async()=>{
 const f=await fixture(),s=f.stores,body=journalBody();
 await s.Account.update('cash',{account_type:'asset'});await s.TreasuryAccount.create({name:'Till',account_type:'cash',gl_account_id:'cash',is_active:true,balance:0});
 const journal=await saveManualJournal(s,context,body);assert.equal((await s.TreasuryAccount.list())[0].balance,1000);assert.equal((await s.Account.get('cash')).balance,1000);
 await saveManualJournal(s,context,body);assert.equal((await s.TreasuryAccount.list())[0].balance,1000);
 const t=(await s.TreasuryAccount.list())[0];await s.TreasuryAccount.update(t.id,{balance:999});const before=structuredClone(f.rows);
 await assert.rejects(saveManualJournal(s,context,{...body,requestKey:crypto.randomUUID()}),/Reconcile treasury/);assert.deepEqual(f.rows,before);
 await s.TreasuryAccount.update(t.id,{balance:1000,account_type:'bank'});
 const cashier={user:{id:'cashier',role:'user'},role:'cashier',employee:{role:'cashier',status:'active',allowed_modules:['accounting']}};
 await assert.rejects(saveManualJournal(s,cashier,{...body,requestKey:crypto.randomUUID()}),/Bank accounts/);
 await s.TreasuryAccount.update(t.id,{account_type:'cash'});await s.PostingRule.create({rule_key:'customer_receivable',account_id:'cash',is_active:true});
 await assert.rejects(saveManualJournal(s,context,{...body,requestKey:crypto.randomUUID()}),/control accounts/);
 assert.ok(journal.is_immutable);
});

test('manual reversal accepts an open correction date, preserves the original and rejects invalid or changed confirmations',async()=>{
 const {stores:s}=await fixture(),originalDate=date.slice(0,8)+'01';
 const journal=await saveManualJournal(s,context,{...journalBody(),entryDate:originalDate});
 await s.AccountingPeriod.update('period',{status:'closed',end_date:originalDate});
 const reason='Correct the capital recorded twice',reverse={action:'reverse',journalId:journal.id,reason,reversalDate:date};
 // Ensure today is available even when the original date is locked.
 if(date===originalDate){await s.AccountingPeriod.update('period',{status:'open'});}
 const before=structuredClone(await s.JournalEntry.list());
 await assert.rejects(journalLifecycle(s,context,{...reverse,reason:''}),/reason/);
 await assert.rejects(journalLifecycle(s,context,{...reverse,reversalDate:'2099-01-01'}),/no later than today/);
 await assert.rejects(journalLifecycle(s,context,{...reverse,reversalDate:'2020-01-01'}),/on or after/);
 await assert.rejects(journalLifecycle(s,context,{...reverse,reversalDate:'2026-02-30'}),/valid journal date/);
 assert.deepEqual(await s.JournalEntry.list(),before);
 if(date!==originalDate)await assert.rejects(journalLifecycle(s,context,{...reverse,reversalDate:originalDate}),/closed or locked/);
 const reversed=await journalLifecycle(s,context,reverse);
 assert.equal(reversed.entry_date,date);assert.equal(reversed.reversal_reason,reason);
 assert.equal((await s.JournalEntry.get(journal.id)).status,'posted');
 assert.equal((await journalLifecycle(s,context,reverse)).id,reversed.id);
 await assert.rejects(journalLifecycle(s,context,{...reverse,reason:'Different explanation'}),{status:409});
 assert.equal((await s.JournalEntry.list()).length,2);
 assert.match((await s.AuditLog.list()).find(a=>a.action==='reverse_journal').description,/Correct the capital/);
});

test('legacy source-free manual journals can reverse and an exact historical control-account correction cannot be forged by new journals',async()=>{
 const {stores:s}=await fixture(),journal=await saveManualJournal(s,context,journalBody());
 await s.JournalEntry.update(journal.id,{source_module:'',source_document_type:'',source_document_id:''});
 await s.Account.update('capital',{is_control_account:true,allow_manual_journal:false});
 await assert.rejects(saveManualJournal(s,context,{...journalBody(),reversingManual:true}),/allow manual journals/);
 const reversal=await journalLifecycle(s,context,{action:'reverse',journalId:journal.id,reason:'Correct the original manual capital entry',reversalDate:date});
 assert.equal(reversal.reversal_of,journal.id);assert.equal((await s.Account.get('capital')).balance,0);
});

test('reversal refuses mismatched original ledger evidence and never creates a partial inverse',async()=>{
 const f=await fixture(),s=f.stores,journal=await saveManualJournal(s,context,journalBody());
 await s.JournalEntry.update(journal.id,{total_credit:999});
 const before=structuredClone(f.rows);
 await assert.rejects(journalLifecycle(s,context,{action:'reverse',journalId:journal.id,reason:'Correct an error',reversalDate:date}),/original journal totals/);
 assert.deepEqual(f.rows,before);
});
