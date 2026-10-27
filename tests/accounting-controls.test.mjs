import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import {build} from 'esbuild';
import {fixture,date,user} from './helpers/cashier.mjs';
import {validateAccount,suggestAccountNumber} from '../src/lib/account-hierarchy.js';
import {balancingAmount} from '../src/lib/journal-balancing.js';
import {saveAccountDefinition,prepareAccountDefinition} from '../src/server/domain/account-definitions.js';
import {saveManualJournal} from '../src/server/domain/manual-journals.js';

const context={user,role:'cashier',employee:{id:'cashier',role:'cashier',status:'active',allowed_modules:['accounting']}};
const equity=(number='3990')=>({account_number:number,name:'Investor capital',account_type:'equity',normal_balance:'credit',is_posting:true,parent_id:''});
test('new posting accounts are not mistaken for parents of existing top-level accounts',()=>{
  const rows=[{id:'cash',account_number:'1000',parent_id:'',account_type:'asset',is_posting:true}];
  assert.deepEqual(validateAccount({id:'',...equity()},rows,{}),[]);
  assert.equal(suggestAccountNumber([{id:'p',account_number:'3000'},{id:'other',account_number:'3001'}],'equity','p'),'3002');
});
test('accountant creates capital and loan accounts, selects headers, preserves history and cannot forge protected fields',async()=>{
  const f=await fixture(),s=f.entities;
  const capital=await saveAccountDefinition(s,context,{account:equity(),newParent:{account_number:'3900',name:'Capital and reserves'}});
  const header=await s.Account.get(capital.parent_id);assert.equal(header.is_posting,false);assert.equal(header.account_type,'equity');
  const loan=await saveAccountDefinition(s,context,{account:{...equity('2990'),name:'Investor loan',account_type:'liability'}});assert.equal(loan.account_type,'liability');
  await assert.rejects(saveAccountDefinition(s,context,{account:equity()}),/already used/);
  await assert.rejects(prepareAccountDefinition(s,{...equity('3992'),parent_id:loan.id}),/cannot sit under|posting account/);
  await assert.rejects(saveAccountDefinition(s,context,{account:{...equity('3993'),balance:100}}),/editable account fields/);
  await s.JournalLine.create({account_id:capital.id,debit:0,credit:0,status:'reversed'});
  await assert.rejects(prepareAccountDefinition(s,{is_posting:false},capital),/already has postings/);
  for(const employee of [{role:'commercial',status:'active'},{role:'cashier',status:'inactive'},{role:'cashier',status:'active',allowed_modules:[]}])await assert.rejects(saveAccountDefinition(s,{user,employee},{account:equity('3994')}),{status:403});
  await assert.rejects(prepareAccountDefinition(s,{parent_id:header.id},header),/own parent/);
});
test('journal suggestions handle debit/credit, decimals and splits without overwriting or hiding invalid amounts',()=>{
  const a={account_id:'a',debit:120.35,credit:0},blank={account_id:'b',debit:0,credit:0};
  assert.deepEqual(balancingAmount([a,blank],1),{debit:0,credit:120.35});
  assert.deepEqual(balancingAmount([{...a,debit:0,credit:100},blank],1),{debit:100,credit:0});
  assert.deepEqual(balancingAmount([a,{account_id:'c',credit:20,debit:0},blank],2),{debit:0,credit:100.35});
  assert.equal(balancingAmount([a,{...blank,credit:10}],1),null);
  assert.equal(balancingAmount([{...a,debit:-1},blank],1),null);
  assert.equal(balancingAmount([{...a,account_id:''},blank],1),null);
});
async function journalFixture(db){const f=await fixture(db),s=f.entities;await s.Account.update('till-gl',{allow_manual_journal:true,balance:0});await s.TreasuryAccount.update('till',{balance:0});const capital=await s.Account.create(equity());return {...f,body:{requestKey:crypto.randomUUID(),entryDate:date,description:'Capital received',status:'posted',lines:[{account_id:'till-gl',debit:1500,credit:0},{account_id:capital.id,debit:0,credit:1500}]},capital};}
test('manual journal uses verified accounts, balances once on retry and leaves draft amounts unposted',async()=>{
  const f=await journalFixture(),s=f.entities,opening=(await s.Account.get('till-gl')).balance;
  const j=await saveManualJournal(s,context,{...f.body,userId:'forged',lines:f.body.lines.map(l=>({...l,account_name:'forged'}))});
  assert.equal(j.posted_by,user.id);assert.equal((await s.Account.get('till-gl')).balance,opening+1500);
  assert.equal((await saveManualJournal(s,context,f.body)).id,j.id);assert.equal((await s.Account.get('till-gl')).balance,opening+1500);
  assert.equal((await s.JournalLine.filter({journal_id:j.id}))[1].account_name,'Investor capital');
  const draft=await saveManualJournal(s,context,{...f.body,requestKey:crypto.randomUUID(),status:'draft'});assert.equal((await s.Account.get('till-gl')).balance,opening+1500);
  await saveManualJournal(s,context,{journalId:draft.id});assert.equal((await s.Account.get('till-gl')).balance,opening+3000);
  await saveManualJournal(s,context,{journalId:draft.id});assert.equal((await s.Account.get('till-gl')).balance,opening+3000);
  await assert.rejects(saveManualJournal(s,context,{...f.body,description:'different'}),{status:409});
  for(const lines of [[{account_id:'till-gl',debit:2},{account_id:f.capital.id,credit:1}],[{account_id:'till-gl',debit:-2},{account_id:f.capital.id,credit:-2}],[{account_id:'till-gl',debit:2,credit:1},{account_id:f.capital.id,credit:1}]])await assert.rejects(saveManualJournal(s,context,{...f.body,requestKey:crypto.randomUUID(),lines}));
  await s.Account.update(f.capital.id,{allow_manual_journal:false});await assert.rejects(saveManualJournal(s,context,{...f.body,requestKey:crypto.randomUUID()}),/active posting/);
});
async function accountRoute(name='accounts'){const r=await build({entryPoints:[`src/app/api/accounting/${name}/route.js`],bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'account-transaction',setup(b){const mocks={
  '@/server/auth':'export const authenticateRequest=async()=>globalThis.__accountTest.context,checkOrigin=()=>{},apiError=e=>Response.json({error:e.message},{status:e.status||400});',
  '@/server/entities':'export const serviceEntities=new Proxy({},{get:(_,key)=>globalThis.__accountTest.entities[key]});',
  '@/server/db':'export const database=()=>({unsafe:async()=>{}}),transaction=async run=>{const db=globalThis.__accountTest.db;await db.exec("BEGIN");try{const result=await run();await db.exec("COMMIT");return result;}catch(e){await db.exec("ROLLBACK");throw e;}};'};
  b.onResolve({filter:/^@\/server\//},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});return import('data:text/javascript;base64,'+Buffer.from(r.outputFiles[0].text).toString('base64'));}
test('account route rolls back new parent and audit if the child fails validation',async()=>{
  const db=new PGlite();try{const f=await fixture(db),route=await accountRoute();globalThis.__accountTest={...f,context,db};
    const before=(await f.entities.Account.list()).length,logs=(await f.entities.AuditLog.list()).length;
    const response=await route.POST(new Request('http://localhost/api/accounting/accounts',{method:'POST',body:JSON.stringify({account:{...equity('3991'),name:''},newParent:{account_number:'3901',name:'New capital header'}})}));
    assert.equal(response.status,400);assert.equal((await f.entities.Account.list()).length,before);assert.equal((await f.entities.AuditLog.list()).length,logs);
  }finally{delete globalThis.__accountTest;await db.close();}
});
test('journal route rolls back header, lines, balances and numbering when the audit write fails, then retries once',async()=>{
  const db=new PGlite();try{const f=await journalFixture(db),route=await accountRoute('journals');globalThis.__accountTest={...f,context,db};const s=f.entities;
    const opening=(await s.Account.get('till-gl')).balance,settings=await s.CompanySettings.list(),before=(await s.JournalEntry.list()).length;
    const create=s.AuditLog.create;s.AuditLog.create=async()=>{throw Error('Audit unavailable');};
    const post=()=>route.POST(new Request('http://localhost/api/accounting/journals',{method:'POST',body:JSON.stringify(f.body)}));
    assert.equal((await post()).status,400);assert.equal((await s.JournalEntry.list()).length,before);assert.equal((await s.Account.get('till-gl')).balance,opening);assert.deepEqual(await s.CompanySettings.list(),settings);
    s.AuditLog.create=create;const first=await post();assert.equal(first.status,200);const saved=await first.json();assert.equal((await post()).status,200);assert.equal((await s.JournalEntry.filter({manual_request_key:f.body.requestKey})).length,1);assert.equal((await s.JournalLine.filter({journal_id:saved.id})).length,2);assert.equal((await s.Account.get('till-gl')).balance,opening+1500);
  }finally{delete globalThis.__accountTest;await db.close();}
});
