import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {build} from 'esbuild';
import {fixture,date} from './helpers/cashier.mjs';
import {saveAccountDefinition} from '../src/server/domain/account-definitions.js';
import {openingBalancesWorkspace,postOpeningBalances,saveAccountOpening} from '../src/server/domain/opening-balances.js';
import {customerOpeningWorkspace} from '../src/server/domain/customer-opening-balance.js';
import {deleteUnusedAccount} from '../src/server/domain/account-lifecycle.js';
import {postJournal} from '../src/server/domain/field-ops.js';
import {guardMutation} from '../src/server/access.js';

const context={user:{id:'gm',role:'admin',email:'gm@example.test'},role:'admin'};
const openingDate=date.slice(0,8)+'01';
async function setup(db){
  const f=await fixture(db),s=f.entities,create=s.AuditLog.create;
  s.AuditLog.create=async value=>{
    if(!value.id)return create(value);
    if(db)await db.query('INSERT INTO fixture_entity VALUES($1,$2,$3)',['AuditLog',value.id,JSON.stringify(value)]);
    else {if(f.rows.AuditLog.some(a=>a.id===value.id))throw Error('Duplicate audit id');f.rows.AuditLog.push(structuredClone(value));}
    return value;
  };
  const equity=await s.Account.create({name:'Opening equity',account_number:'3001',account_type:'equity',normal_balance:'credit',is_active:true,is_posting:true,balance:0});
  const body={requestKey:crypto.randomUUID(),account:{name:'Supplier advances',account_number:'1501',account_type:'asset',normal_balance:'debit'},opening:{amount:12500,side:'debit',date:openingDate,reference:'Previous ledger',offset_account_id:equity.id,confirmed:true}};
  return {...f,equity,body};
}

test('new debit asset and credit rent payable share equity and preserve commercial documents and stock',async()=>{
  const f=await setup(),s=f.entities;
  const untouched=structuredClone(Object.fromEntries(['Invoice','Bill','Payment','TreasuryTransaction','StockMovement','StockBalance','Supplier','Customer'].map(k=>[k,f.rows[k]])));
  const advance=await saveAccountDefinition(s,context,f.body);
  assert.equal(advance.balance,12500);assert.equal(advance.opening_balance_recorded,true);
  const rent=await saveAccountDefinition(s,context,{...f.body,requestKey:crypto.randomUUID(),account:{name:'Rent payable',account_number:'2101',account_type:'liability',normal_balance:'credit'},opening:{...f.body.opening,side:'credit',amount:75000}});
  assert.equal(rent.balance,75000);assert.equal((await s.Account.get(f.equity.id)).balance,-62500);
  const rentLines=await s.JournalLine.filter({journal_id:rent.opening_balance_journal_id});
  assert.equal(rentLines.find(l=>l.account_id===rent.id).credit,75000);assert.equal(rentLines.find(l=>l.account_id===f.equity.id).debit,75000);
  assert.deepEqual(Object.fromEntries(Object.keys(untouched).map(k=>[k,f.rows[k]])),untouched);
  const ws=await openingBalancesWorkspace(s,context);assert.equal(ws.date_locked,true);assert.equal(ws.accounts.find(a=>a.id===rent.id).opening_credit,75000);
});

test('editing an account adds opening to later posted activity, and durable retries survive later edits',async()=>{
  const f=await setup(),s=f.entities;
  const account=await saveAccountDefinition(s,context,{account:f.body.account});
  await postJournal({entities:s},{entryDate:date,description:'Later transaction',sourceModule:'manual',sourceDocumentId:'later',userId:'gm',lines:[{account_id:account.id,debit:250},{account_id:f.equity.id,credit:250}]});
  const body={...f.body,accountId:account.id,account:{name:'Supplier deposits'}};
  const saved=await saveAccountDefinition(s,context,body);assert.equal(saved.balance,12750);
  await saveAccountDefinition(s,context,{accountId:account.id,requestKey:crypto.randomUUID(),account:{name:'Supplier advances and deposits'}});
  const before=structuredClone(f.rows);assert.equal((await saveAccountDefinition(s,context,body)).id,account.id);assert.deepEqual(f.rows,before);
  await assert.rejects(saveAccountDefinition(s,context,{...body,opening:{...body.opening,amount:200}}),{status:409});
  await assert.rejects(saveAccountOpening(s,context,saved,body.opening,crypto.randomUUID()),/already posted/);
  const ws=await openingBalancesWorkspace(s,context);assert.equal(ws.accounts.find(a=>a.id===account.id).opening_debit,12500);
});

test('zero opening is explicit, audited and permanent across account, bulk and customer workflows',async()=>{
  const f=await setup(),s=f.entities;
  await s.Account.update('receivable',{account_type:'asset',is_control_account:true});
  const body={...f.body,accountId:'receivable',account:{name:'Receivables'},opening:{...f.body.opening,amount:0,offset_account_id:'',acknowledgeControlBalances:true}};
  const saved=await saveAccountDefinition(s,context,body);assert.equal(saved.opening_balance_amount,0);assert.equal(f.rows.JournalEntry.length,0);
  assert.equal((await saveAccountDefinition(s,context,body)).id,'receivable');
  assert.equal((await openingBalancesWorkspace(s,context)).date_locked,true);
  assert.equal((await customerOpeningWorkspace(s,context,'customer-a')).can_enter,false);
  await assert.rejects(deleteUnusedAccount(s,context,{accountId:saved.id,requestKey:crypto.randomUUID()}),/recorded opening/);
  await assert.rejects(postOpeningBalances(s,context,{requestKey:crypto.randomUUID(),date:openingDate,reference:'Bulk',acknowledgeControlBalances:true,lines:[{account_id:saved.id,debit:10},{account_id:f.equity.id,credit:10}]}),/already posted/);
  await assert.rejects(saveAccountOpening(s,context,await s.Account.get('bank-gl'),{...body.opening,date:'2025-01-01'},crypto.randomUUID()),/same opening date/);
  await assert.rejects(saveAccountDefinition(s,context,{accountId:saved.id,account:{is_posting:false}}),/cannot become a header/);
});

test('existing bulk openings block editor entry; opposite-side balances remain supported',async()=>{
  const f=await setup(),s=f.entities;
  await postOpeningBalances(s,context,{requestKey:crypto.randomUUID(),date:openingDate,reference:'Bulk',lines:[{account_id:'till-gl',debit:500},{account_id:f.equity.id,credit:500}]});
  await assert.rejects(saveAccountOpening(s,context,await s.Account.get('till-gl'),f.body.opening,crypto.randomUUID()),/already posted/);
  const overdraft=await saveAccountOpening(s,context,await s.Account.get('bank-gl'),{...f.body.opening,amount:500,side:'credit'},crypto.randomUUID());
  assert.equal(overdraft.balance,-500);assert.equal((await s.TreasuryAccount.get('bank')).balance,-500);
});

test('zero opening rebuilds legacy cash caches from actual later ledger activity without a new cash movement',async()=>{
  const f=await setup(),s=f.entities;
  await postJournal({entities:s},{entryDate:date,description:'Later receipt',sourceModule:'manual',sourceDocumentId:'receipt',userId:'gm',lines:[{account_id:'till-gl',debit:250},{account_id:f.equity.id,credit:250}]});
  const saved=await saveAccountDefinition(s,context,{...f.body,accountId:'till-gl',account:{name:'Till'},opening:{...f.body.opening,amount:0,offset_account_id:''}});
  assert.equal(saved.balance,250);assert.equal((await s.TreasuryAccount.get('till')).balance,250);assert.equal(f.rows.JournalEntry.length,1);assert.equal(f.rows.TreasuryTransaction.length,0);
  await saveAccountOpening(s,context,await s.Account.get('bank-gl'),{...f.body.opening,amount:0},crypto.randomUUID());
  assert.equal((await s.Account.get('bank-gl')).balance,0);assert.equal((await s.TreasuryAccount.get('bank')).balance,0);
});

test('permission, amount, confirmation, counterpart and closed-period checks protect openings',async()=>{
  const f=await setup(),s=f.entities,account=await s.Account.get('till-gl');
  for(const opening of [{amount:''},{amount:-1},{amount:0.001},{amount:null},{amount:true},{confirmed:false},{side:'other'},{date:'2026-02-30'},{offset_account_id:'expense'},{offset_account_id:account.id},{reference:''}]){
    const before=structuredClone(f.rows);
    await assert.rejects(saveAccountOpening(s,context,account,{...f.body.opening,...opening},crypto.randomUUID()));assert.deepEqual(f.rows,before);
  }
  const cashier={user:{id:'cashier',role:'user'},role:'cashier',employee:{role:'cashier',status:'active',allowed_modules:['accounting']}};
  await assert.rejects(saveAccountDefinition(s,cashier,f.body),{status:403});
  await s.Account.update('till-gl',{is_control_account:true});
  await assert.rejects(saveAccountOpening(s,context,await s.Account.get('till-gl'),f.body.opening,crypto.randomUUID()),/reconciled separately/);
  await s.AccountingPeriod.update('period',{status:'closed'});
  for(const amount of [0,100])await assert.rejects(saveAccountOpening(s,context,account,{...f.body.opening,amount,acknowledgeControlBalances:true},crypto.randomUUID()),/closed|locked/);
  for(const operation of ['create','update','delete','deleteMany'])assert.throws(()=>guardMutation(context,'AuditLog',operation,operation==='create'?{action:'import_account_opening_balance'}:{},{id:'AOB-example'}),{status:403});
  assert.throws(()=>guardMutation(context,'Account','update',{opening_balance_recorded:false},account),{status:403});
});

async function route(){
  const mocks={
    '@/server/auth':'export const authenticateRequest=async()=>globalThis.__accountOpening.context,checkOrigin=()=>{},apiError=e=>Response.json({error:e.message},{status:e.status||400});',
    '@/server/entities':'export const serviceEntities=new Proxy({},{get:(_,key)=>globalThis.__accountOpening.entities[key]});',
    '@/server/db':'export const database=()=>({unsafe:async(sql,args)=>globalThis.__accountOpening.locks.push(args[0])}),transaction=async run=>{const db=globalThis.__accountOpening.db;await db.exec("BEGIN");try{const r=await run();await db.exec("COMMIT");return r;}catch(e){await db.exec("ROLLBACK");throw e;}};'
  };
  const output=await build({entryPoints:['src/app/api/accounting/accounts/route.js'],bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'account-opening',setup(b){b.onResolve({filter:/^@\/server\//},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
  return import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
}

test('HTTP save rolls back account, parent, journal, caches and audits together; retry posts once',async()=>{
  const db=new PGlite();
  try{
    const f=await setup(db),s=f.entities,r=await route();globalThis.__accountOpening={...f,db,context,locks:[]};
    const body={...f.body,newParent:{name:'Advances group',account_number:'1500'}};
    const post=value=>r.POST(new Request('http://localhost/api/accounting/accounts',{method:'POST',body:JSON.stringify(value)}));
    const snapshot=async()=>(await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows;
    const before=await snapshot(),create=s.AuditLog.create;
    s.AuditLog.create=async value=>{if(value.action==='import_account_opening_balance')throw Error('Audit unavailable');return create(value);};
    assert.equal((await post(body)).status,400);assert.deepEqual(await snapshot(),before);
    s.AuditLog.create=create;
    for(const changes of [{confirmed:false},{amount:''},{offset_account_id:'expense'}]){assert.equal((await post({...body,opening:{...body.opening,...changes}})).status,400);assert.deepEqual(await snapshot(),before);}
    const response=await post(body);assert.equal(response.status,200);const saved=await response.json();assert.ok(saved.parent_id);assert.equal(saved.balance,12500);
    const after=await snapshot();assert.equal((await post(body)).status,200);assert.deepEqual(await snapshot(),after);
    assert.equal((await s.JournalEntry.list()).length,1);assert.ok(globalThis.__accountOpening.locks.includes('opening-balances'));
    assert.equal((await post({...body,accountId:saved.id,updatedDate:'stale',requestKey:crypto.randomUUID(),opening:undefined,newParent:undefined})).status,409);
  }finally{delete globalThis.__accountOpening;await db.close();}
});
