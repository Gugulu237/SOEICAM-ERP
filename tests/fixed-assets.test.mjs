import { reportBalance } from '../src/lib/report-balances.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { postgresAdapter } from './helpers/postgres-adapter.mjs';
import { functionRoute, request } from './helpers/cashier.mjs';
import { assetMonths, assetDate, monthEnd, scheduleThrough, depreciationPlan } from '../src/lib/asset-schedule.js';
import { fixedAssetAction } from '../src/server/domain/fixed-assets.js';
import { guardMutation } from '../src/server/access.js';

const user={id:'asset-manager',role:'admin'},data={name:'Production machine',category:'machinery',acquisition_date:'2020-01-01',in_service_date:'2020-01-15',acquisition_cost:1000,salvage_value:100,useful_life_months:3,asset_account_id:'fixed',accum_dep_account_id:'accum',expense_account_id:'expense',replacement_fund_enabled:true};
const asset={...data,id:'asset',depreciation_method:'straight_line',status:'active',accumulated_depreciation:0};
test('straight-line uses per-asset months, residual value, full first month and a final rounding adjustment',()=>{
  assert.deepEqual(scheduleThrough(asset,'2020-04').map(r=>r.amount),[300,300,300]);
  const rounded={...asset,acquisition_cost:110,salvage_value:10};
  assert.deepEqual(scheduleThrough(rounded,'2020-03').map(r=>r.amount),[33.33,33.33,33.34]);
  assert.equal(scheduleThrough({...asset,useful_life_months:6},'2020-01')[0].amount,150);
  assert.deepEqual(scheduleThrough(asset,'2019-12'),[]);assert.equal(monthEnd('2020-02'),'2020-02-29');
  for(const months of [0,-1,2.5,1201,'bad',''])assert.throws(()=>assetMonths(months));
  for(const date of ['2020-02-30','2020-13-01','bad'])assert.throws(()=>assetDate(date));
  assert.throws(()=>scheduleThrough({...asset,salvage_value:1001},'2020-01'),/inconsistent/);
});
test('imported opening depreciation and later schedule revisions never recreate historic periods',()=>{
  const legacy={...asset,useful_life_months:12,accumulated_depreciation:150,last_depreciation_date:'2020-02-29'};
  const plan=depreciationPlan(legacy);assert.equal(plan.start,'2020-03');assert.equal(plan.months,10);assert.equal(plan.basis,750);
  assert.deepEqual(scheduleThrough(legacy,'2020-03').map(r=>[r.month,r.amount]),[['2020-03',75]]);
  assert.deepEqual(scheduleThrough({...asset,status:'disposed'},'2020-03'),[]);
});

let storeModule,route;
async function environment(){
  const db=new PGlite({parsers:{1700:Number}});await db.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;');
  await db.exec(await readFile(new URL('../supabase/migrations/202610170001_erp_schema.sql',import.meta.url),'utf8'));
  const adapter=postgresAdapter(db);let queryQueue=Promise.resolve();
  // PGlite describes parameters on one connection; serialize description/bind pairs.
  globalThis.__assetDB={unsafe:(sql,args)=>{const result=queryQueue.then(()=>adapter.unsafe(sql,args));queryQueue=result.catch(()=>{});return result}};let inside=false;
  const transaction=async fn=>{if(inside)return fn();await db.exec('BEGIN');inside=true;try{const result=await fn();await db.exec('COMMIT');return result}catch(e){await db.exec('ROLLBACK');throw e}finally{inside=false}};
  globalThis.__assetTransaction=transaction;
  if(!storeModule){const output=await build({entryPoints:['src/server/entities.js'],bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'asset-stores',setup(b){
    b.onResolve({filter:/^server-only$/},()=>({path:'empty',namespace:'fixture'}));b.onResolve({filter:/(?:^|\/)db\.js$/},()=>({path:'db',namespace:'fixture'}));
    b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='db'?'export const database=()=>globalThis.__assetDB;export const transaction=fn=>globalThis.__assetTransaction(fn);':''}));
  }}]});storeModule=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));}
  const names=['Account','FixedAsset','DepreciationEntry','JournalEntry','JournalLine','TreasuryAccount','TreasuryTransaction','CompanySettings','AccountingPeriod','AuditLog'];
  const entities=Object.fromEntries(names.map(n=>[n,storeModule.entityStore(n)]));
  await entities.CompanySettings.create({company_name:'Fixture',next_journal_number:1});
  for(const [id,type,normal,balance] of [['fixed','asset','debit',1000],['accum','asset','credit',0],['expense','expense','debit',0],['operating','asset','debit',10000],['reserve','asset','debit',0]])await entities.Account.create({id,account_number:id,name:id,account_type:type,normal_balance:normal,balance,is_active:true,is_posting:true});
  for(const [id,balance] of [['operating',10000],['reserve',0]])await entities.TreasuryAccount.create({id:'t-'+id,name:id,account_type:'bank',gl_account_id:id,balance,is_active:true});
  const client={auth:{me:async()=>user,staff:async()=>({id:'manager',role:'admin',status:'active'}),assertModule:()=>{}},asServiceRole:{entities}};
  globalThis.__cashierClient=client;globalThis.__cashierTransaction=transaction;route ||= await functionRoute();
  const call=async body=>{const response=await route(request(body),{params:Promise.resolve({name:'fieldOps'})});return {status:response.status,...await response.json()}};
  const ok=async body=>{const result=await call(body);assert.equal(result.status,200,result.error);return result};
  const register=async overrides=>(await ok({action:'assetRegister',requestKey:crypto.randomUUID(),data:{...data,...overrides}})).asset;
  const run=async month=>{const preview=await ok({action:'assetDepreciationPreview',month});return ok({action:'assetRunDepreciation',month,previewToken:preview.token,requestKey:crypto.randomUUID()})};
  return {db,entities,client,call,ok,register,run,close:async()=>{delete globalThis.__assetDB;delete globalThis.__assetTransaction;delete globalThis.__cashierClient;delete globalThis.__cashierTransaction;await db.close()}};
}

test('real database route posts once, catches up missed months and keeps cash unchanged',async()=>{
  const env=await environment();try{
    const a=await env.register();const preview=await env.ok({action:'assetDepreciationPreview',month:'2020-03'});
    const body={action:'assetRunDepreciation',month:'2020-03',previewToken:preview.token,requestKey:crypto.randomUUID()};
    assert.equal((await env.ok(body)).total,900);assert.equal((await env.ok(body)).reused,true);
    const {entities:e}=env;assert.equal((await e.DepreciationEntry.list()).length,3);assert.equal((await e.JournalEntry.list()).length,3);assert.equal((await e.Account.get('expense')).balance,900);assert.equal((await e.Account.get('accum')).balance,900);
    assert.equal((await e.TreasuryTransaction.list()).length,0);assert.equal((await e.TreasuryAccount.get('t-operating')).balance,10000);assert.equal((await e.FixedAsset.get(a.id)).net_book_value,100);assert.equal((await e.FixedAsset.get(a.id)).status,'fully_depreciated');
    assert.equal((await env.run('2020-04')).posted,0);
    const workspace=await env.ok({action:'assetWorkspace'});assert.equal(workspace.entries.reduce((n,r)=>n+r.replacement_outstanding,0),900);
    assert.equal((await env.call({...body,month:'2020-02'})).status,400);
  }finally{await env.close()}
});

test('partial and complete replacement transfers debit reserve and credit operating cash, without another expense',async()=>{
  const env=await environment();try{
    await env.register();await env.run('2020-01');const {entities:e}=env,entry=(await e.DepreciationEntry.list())[0];
    const body={action:'assetFundReplacement',entryId:entry.id,fromId:'t-operating',toId:'t-reserve',amount:100,date:'2020-02-01',reference:'Bank transfer 001',requestKey:crypto.randomUUID()};
    await env.ok(body);assert.equal((await env.ok(body)).reused,true);
    assert.equal((await env.ok({action:'assetWorkspace'})).entries[0].replacement_outstanding,200);
    assert.equal((await e.Account.get('expense')).balance,300);assert.equal((await e.TreasuryAccount.get('t-operating')).balance,9900);assert.equal((await e.TreasuryAccount.get('t-reserve')).balance,100);
    assert.equal((await env.call({...body,amount:200})).status,400);
    for(const patch of [{amount:201},{toId:'t-operating'},{date:'2020-01-01'},{amount:-1}])assert.equal((await env.call({...body,...patch,requestKey:crypto.randomUUID()})).status,400);
    await env.ok({...body,amount:200,requestKey:crypto.randomUUID()});assert.equal((await env.ok({action:'assetWorkspace'})).entries[0].replacement_outstanding,0);
    assert.equal((await e.JournalEntry.list()).length,3);assert.equal((await e.TreasuryTransaction.list()).length,4);
    assert.equal((await e.Account.get('expense')).balance,300);assert.equal((await e.Account.get('operating')).balance,9700);assert.equal((await e.Account.get('reserve')).balance,300);
  }finally{await env.close()}
});

test('closed months and late treasury failures roll back all asset entries, balances and journals',async()=>{
  const env=await environment();try{
    await env.register();const {entities:e}=env;
    await e.AccountingPeriod.create({name:'Closed February',fiscal_year:2020,period_number:2,start_date:'2020-02-01',end_date:'2020-02-29',status:'closed'});
    const preview=await env.ok({action:'assetDepreciationPreview',month:'2020-02'});
    const result=await env.call({action:'assetRunDepreciation',month:'2020-02',previewToken:preview.token,requestKey:crypto.randomUUID()});assert.equal(result.status,400);assert.match(result.error,/closed/);
    assert.equal((await e.DepreciationEntry.list()).length,0);assert.equal((await e.Account.get('expense')).balance,0);
    await env.run('2020-01');const entry=(await e.DepreciationEntry.list())[0],original=e.TreasuryAccount.update;
    e.TreasuryAccount.update=async(id,values)=>{if(id==='t-reserve')throw Error('Late bank write failure');return original(id,values)};
    const body={action:'assetFundReplacement',entryId:entry.id,fromId:'t-operating',toId:'t-reserve',amount:100,date:'2020-03-01',reference:'TRANSFER',requestKey:crypto.randomUUID()};
    const failure=await env.call(body);assert.equal(failure.status,400);assert.match(failure.error,/Late bank/);
    assert.equal((await e.TreasuryTransaction.list()).length,0);assert.equal((await e.JournalEntry.list()).length,1);assert.equal((await e.Account.get('reserve')).balance,0);assert.equal((await e.TreasuryAccount.get('t-operating')).balance,10000);
    e.TreasuryAccount.update=original;await env.ok(body);assert.equal((await e.TreasuryAccount.get('t-operating')).balance,9900);
  }finally{await env.close()}
});

test('schedule changes are prospective, revision checked and preserve existing funding targets',async()=>{
  const env=await environment();try{
    const a=await env.register();await env.run('2020-01');const saved=await env.entities.FixedAsset.get(a.id);
    const body={action:'assetUpdatePlan',assetId:a.id,revision:saved.asset_revision,months:6,salvageValue:100,replacementFundEnabled:false};
    await env.ok(body);assert.equal((await env.call(body)).status,400);
    await env.run('2020-02');const entries=await env.entities.DepreciationEntry.list('depreciation_date');
    assert.deepEqual(entries.map(e=>[e.amount,e.replacement_target]),[[300,300],[100,0]]);assert.equal((await env.entities.FixedAsset.get(a.id)).net_book_value,600);
    const future=await env.call({action:'assetDepreciationPreview',month:'2099-01'});assert.equal(future.status,400);
  }finally{await env.close()}
});

test('authorization and generic-write guards protect asset records and funding metadata even for administrators',async()=>{
  const denied={auth:{staff:async()=>({role:'commercial',status:'active'})},get asServiceRole(){throw Error('Private data read')}};
  await assert.rejects(fixedAssetAction(denied,{id:'agent',role:'user'},{action:'assetWorkspace'}),/Not permitted/);
  const context={user,employee:null,role:'admin'};
  for(const entity of ['FixedAsset','DepreciationEntry'])for(const operation of ['create','update','delete','bulkCreate','updateMany'])assert.throws(()=>guardMutation(context,entity,operation,{name:'forged'}),/checked fixed asset/);
  assert.throws(()=>guardMutation(context,'TreasuryTransaction','create',{source:'asset_replacement'}),/immutable/);
  assert.throws(()=>guardMutation(context,'AuditLog','create',{asset_result:{posted:1}}),/managed/);
  assert.throws(()=>guardMutation(context,'JournalEntry','create',{source_module:'assets'}),/only through/);
});


test('accumulated depreciation subtracts from asset carrying values in financial reports',()=>{
  const cost={account_type:'asset',normal_balance:'debit',balance:1000},accum={account_type:'asset',normal_balance:'credit',balance:300};
  assert.equal(reportBalance(cost)+reportBalance(accum),700);
  assert.equal(reportBalance({normal_balance:'credit',balance:500},'credit'),500);
});


test('asset acquisition and disposal keep linked treasury and ledger balances together and refuse duplicate changes',async()=>{
  const env=await environment();try{
    const body={action:'assetRegister',data,requestKey:crypto.randomUUID(),fundingAccountId:'operating'};
    const a=(await env.ok(body)).asset;assert.equal((await env.ok(body)).reused,true);
    assert.equal((await env.entities.TreasuryAccount.get('t-operating')).balance,9000);
    assert.equal((await env.entities.Account.get('operating')).balance,9000);
    const disposal={action:'assetDispose',assetId:a.id,date:'2020-01-20',proceeds:1000,proceedsAccountId:'operating'};
    await env.ok(disposal);assert.equal((await env.ok(disposal)).reused,true);
    assert.equal((await env.entities.TreasuryAccount.get('t-operating')).balance,10000);
    assert.equal((await env.entities.Account.get('operating')).balance,10000);
    assert.equal((await env.entities.TreasuryTransaction.list()).length,2);
    assert.equal((await env.call({...disposal,proceeds:100})).status,400);
    assert.equal((await env.entities.FixedAsset.get(a.id)).status,'disposed');
  }finally{await env.close()}
});
