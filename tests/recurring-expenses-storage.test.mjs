import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {build} from 'esbuild';
import catalog from '../src/server/generated/schema.json' with {type:'json'};
import {postgresAdapter} from './helpers/postgres-adapter.mjs';
import {saveAccountDefinition} from '../src/server/domain/account-definitions.js';
import {recurringExpenseWorkspace} from '../src/server/domain/recurring-expenses.js';
import {postJournal} from '../src/server/domain/field-ops.js';
import {businessDate} from '../src/lib/business-date.js';

const context={user:{id:'gm',role:'admin',email:'gm@example.test'},role:'admin',employee:null};
test('real entity stores preserve recurring schedule JSON, deterministic IDs, posted journals and atomic retry evidence',async()=>{
  const db=new PGlite();
  try{
    await db.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;');
    await db.exec(await readFile(new URL('../supabase/migrations/202610170001_erp_schema.sql',import.meta.url),'utf8'));
    const adapter=postgresAdapter(db);let queue=Promise.resolve();
    // PGlite shares unnamed prepared statements: serialize describe + bind.
    globalThis.__recurringStoreDB={unsafe:(q,p)=>{if(q.includes('pg_advisory_xact_lock'))return Promise.resolve([]);const result=queue.then(()=>adapter.unsafe(q,p));queue=result.catch(()=>{});return result;}};
    globalThis.__recurringStoreTx=async run=>{await db.exec('BEGIN');try{const value=await run();await db.exec('COMMIT');return value;}catch(e){await db.exec('ROLLBACK');throw e;}};
    const output=await build({stdin:{contents:"export {entityStore} from './src/server/entities.js';export {GET,POST} from './src/app/api/accounting/recurring-expenses/route.js';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'real-recurring-storage',setup(b){
      b.onResolve({filter:/^server-only$/},()=>({path:'empty',namespace:'mock'}));
      b.onResolve({filter:/(?:^@\/server\/db$|(?:^|\/)db\.js$)/},()=>({path:'db',namespace:'mock'}));
      b.onResolve({filter:/^@\/server\/auth$/},()=>({path:'auth',namespace:'mock'}));
      b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='db'?'export const database=()=>globalThis.__recurringStoreDB,transaction=fn=>globalThis.__recurringStoreTx(fn);':a.path==='auth'?'export const checkOrigin=()=>{},authenticateRequest=async()=>globalThis.__recurringStoreContext,apiError=e=>Response.json({error:e.message},{status:e.status||400});':''}));
    }}]});
    const api=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
    const s=Object.fromEntries(Object.keys(catalog).map(n=>[n,api.entityStore(n)]));globalThis.__recurringStoreContext=context;
    for(const [id,type,normal]of [['expense','expense','debit'],['payable','liability','credit'],['cash','asset','debit'],['equity','equity','credit']])await s.Account.create({id,account_number:id,name:id,account_type:type,normal_balance:normal,balance:0,is_active:true,is_posting:true,is_control_account:false,is_system:false,allow_manual_journal:true,is_treasury:false,is_hidden:false,parent_id:'',description:'',cash_flow_category:'none',currency:'XAF'});
    await s.CompanySettings.create({id:'company',company_name:'SOEICAM',next_journal_number:1});
    await s.Supplier.create({id:'landlord',name:'Landlord',is_active:true,balance:0});
    await s.PostingRule.create({rule_key:'supplier_payable',account_id:'payable',is_active:true});
    await s.TreasuryAccount.create({id:'till',name:'Till',account_type:'cash',gl_account_id:'cash',is_active:true,balance:0});
    const date=businessDate();await s.AccountingPeriod.create({name:'Test open period',fiscal_year:2026,period_number:1,start_date:'2000-01-01',end_date:'2099-12-31',status:'open'});
    await globalThis.__recurringStoreTx(()=>postJournal({entities:s},{entryDate:date,description:'Opening funds',sourceModule:'opening_balances',sourceDocumentType:'Fixture',sourceDocumentId:'initial',userId:'gm',lines:[{account_id:'cash',debit:100000,credit:0},{account_id:'equity',debit:0,credit:100000}]}));
    await s.TreasuryAccount.update('till',{balance:100000});
    const original=await s.Account.get('expense');
    await globalThis.__recurringStoreTx(()=>saveAccountDefinition(s,context,{requestKey:crypto.randomUUID(),accountId:'expense',updatedDate:original.updated_date,account:{name:'Internet'},recurring:{enabled:true,amount:20000.73,due_day:31,effective_month:date.slice(0,7),supplier_id:'landlord'}}));
    const [row]=(await recurringExpenseWorkspace(s,context)).rows;
    const body={action:'pay',requestKey:crypto.randomUUID(),accountId:'expense',period:row.period,token:row.token,amount:20000.73,date,treasuryAccountId:'till',reference:'ISP-001'};
    const post=()=>api.POST(new Request('http://localhost/api/accounting/recurring-expenses',{method:'POST',body:JSON.stringify(body)}));
    const response=await post();assert.equal(response.status,200,await response.text());
    const bills=await s.Bill.list();assert.equal(bills.length,1);assert.equal(bills[0].id,row.id);assert.equal(Number(bills[0].balance),0);assert.equal(bills[0].recurring_period,row.period);
    assert.equal(Number((await s.Account.get('expense')).balance),20000.73);assert.equal(Number((await s.TreasuryAccount.get('till')).balance),79999.27);assert.equal(Number((await s.Supplier.get('landlord')).balance),0);
    assert.equal((await s.Account.get('expense')).recurring_expense.versions[0].amount,20000.73);
    const counts=await Promise.all(['JournalEntry','JournalLine','AuditLog','Payment','PaymentAllocation'].map(n=>s[n].count({})));
    const retry=await post();assert.equal(retry.status,200);assert.equal((await retry.json()).reused,true);
    assert.deepEqual(await Promise.all(['JournalEntry','JournalLine','AuditLog','Payment','PaymentAllocation'].map(n=>s[n].count({}))),counts);
    const financialBefore=await Promise.all(['Bill','JournalEntry','JournalLine','Payment','TreasuryTransaction'].map(name=>s[name].count({})));
    const configure={action:'configure',requestKey:crypto.randomUUID(),newAccount:{name:'Fixture monthly service',account_number:'TEST-CONFIG-SERVICE'},expectedRevision:0,settings:{enabled:true,amount:37.25,due_day:1,effective_month:date.slice(0,7),supplier_id:'landlord',payable_account_id:'payable'}};
    const saveSetup=()=>api.POST(new Request('http://localhost/api/accounting/recurring-expenses',{method:'POST',body:JSON.stringify(configure)}));
    const configured=await saveSetup();assert.equal(configured.status,200);const savedSetup=await configured.json(),createdAccount=await s.Account.get(savedSetup.account.id);
    assert.equal(createdAccount.account_type,'expense');assert.equal(createdAccount.recurring_expense.versions[0].amount,37.25);assert.equal(createdAccount.recurring_expense.versions[0].payable_account_id,'payable');
    assert.deepEqual(await Promise.all(['Bill','JournalEntry','JournalLine','Payment','TreasuryTransaction'].map(name=>s[name].count({}))),financialBefore);
    assert.equal((await (await saveSetup()).json()).reused,true);assert.equal((await s.Account.filter({account_number:'TEST-CONFIG-SERVICE'})).length,1);

  }finally{delete globalThis.__recurringStoreDB;delete globalThis.__recurringStoreTx;delete globalThis.__recurringStoreContext;await db.close();}
});
