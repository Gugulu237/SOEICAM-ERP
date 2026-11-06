import { reportBalance } from '../src/lib/report-balances.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { postgresAdapter } from './helpers/postgres-adapter.mjs';
import { functionRoute, request } from './helpers/cashier.mjs';
import { flatDepreciationTerms, completedDepreciationMonth, monthlyDepreciation, assetMonths, assetDate, monthEnd, scheduleThrough, depreciationPlan } from '../src/lib/asset-schedule.js';
import {syncAutomaticDepreciation,automaticDepreciationStatus} from '../src/server/domain/automatic-depreciation.js';
import { fixedAssetAction } from '../src/server/domain/fixed-assets.js';
import { guardMutation } from '../src/server/access.js';
import { journalPayload } from '../src/server/domain/journal-validation.js';

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
  const names=['Account','FixedAsset','DepreciationEntry','JournalEntry','JournalLine','TreasuryAccount','TreasuryTransaction','CompanySettings','AccountingPeriod','AuditLog','PostingRule','Product'];
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
  return {db,entities,client,call,ok,register,run,transaction,close:async()=>{delete globalThis.__assetDB;delete globalThis.__assetTransaction;delete globalThis.__cashierClient;delete globalThis.__cashierTransaction;await db.close()}};
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


test('annual rates use a fixed basis with monthly charges, exact residual cap and fractional final month',()=>{
  const terms=flatDepreciationTerms({basis:1200000,annualRate:20,mode:'rate'});
  assert.equal(terms.monthly_amount,20000);assert.equal(terms.months,60);
  const a={...asset,acquisition_cost:1300000,salvage_value:100000,depreciation_plan:{...terms,start:'2020-01',basis:1200000,opening:0}};
  const rows=scheduleThrough(a,'2025-12');assert.equal(rows.length,60);assert.ok(rows.every(r=>r.amount===20000));assert.equal(rows.at(-1).net_book_value_after,100000);
  const irregular={...asset,acquisition_cost:110,salvage_value:10,depreciation_plan:{...flatDepreciationTerms({basis:100,annualRate:17,mode:'rate'}),start:'2020-01',basis:100,opening:0}};
  const fraction=scheduleThrough(irregular,'2029-12');assert.equal(fraction.length,71);assert.equal(Math.round(fraction.reduce((n,r)=>n+r.amount,0)*100),10000);assert.equal(fraction.at(-1).net_book_value_after,10);assert.equal(monthlyDepreciation(irregular),1.42);
  for(const rate of [0,-1,0.9,1201,'',true,NaN,Infinity])assert.throws(()=>flatDepreciationTerms({basis:100,annualRate:rate,mode:'rate'}));
  assert.equal(completedDepreciationMonth('2020-02-28'),'2020-01');assert.equal(completedDepreciationMonth('2020-02-29'),'2020-02');assert.equal(completedDepreciationMonth('2021-01-01'),'2020-12');
});

test('automatic monthly charges persist rate settings, reach P&L and never move treasury cash',async()=>{
  const env=await environment();try{
    const a=await env.register({acquisition_cost:1300000,salvage_value:100000,depreciation_rate_mode:'rate',annual_depreciation_rate:20,automatic_depreciation_enabled:true});
    const reload=await env.entities.FixedAsset.get(a.id);assert.equal(reload.depreciation_plan.annual_rate,20);assert.equal(reload.automatic_depreciation.authorized_by,user.id);
    const sync=()=>syncAutomaticDepreciation(env.entities,env.transaction,{date:'2020-03-01'});
    const stale=await env.ok({action:'assetDepreciationPreview',month:'2020-02'});
    const result=await sync();assert.equal(result.posted,2);assert.equal(result.total,40000);assert.equal(result.pending_count,0);assert.equal((await sync()).posted,0);
    assert.equal((await env.call({action:'assetRunDepreciation',month:'2020-02',previewToken:stale.token,requestKey:crypto.randomUUID()})).status,400);
    assert.equal((await env.run('2020-02')).posted,0);
    const entries=await env.entities.DepreciationEntry.list();assert.deepEqual(entries.map(e=>e.amount),[20000,20000]);assert.ok(entries.every(e=>e.posting_mode==='automatic'&&e.schedule_authorized_by===user.id));
    assert.equal((await env.entities.Account.get('expense')).balance,40000);assert.equal((await env.entities.Account.get('accum')).balance,40000);assert.equal((await env.entities.FixedAsset.get(a.id)).net_book_value,1260000);
    assert.equal((await env.entities.TreasuryTransaction.list()).length,0);assert.equal((await env.entities.TreasuryAccount.get('t-operating')).balance,10000);
    const output=await build({stdin:{contents:"export {computeActivity,netProfit,sectionRows} from './src/lib/statements.js';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'statement-math',setup(b){b.onResolve({filter:/^@\/lib\/posting$/},()=>({path:'math',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const round2=n=>Math.round(Number(n||0)*100)/100;'}));}}]});
    const statements=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
    const journals=await env.entities.JournalEntry.list(),lines=await env.entities.JournalLine.list(),accounts=await env.entities.Account.list();
    const activity=statements.computeActivity({journalsById:Object.fromEntries(journals.map(j=>[j.id,j])),lines,fromDate:'2020-02-01',toDate:'2020-02-29'});
    assert.equal(statements.netProfit(accounts,activity),-20000);assert.equal(statements.sectionRows(accounts,activity,['expense'],1)[0].amount,20000);
  }finally{await env.close()}
});

test('existing schedules require explicit opt-in, and toggling automation retains the exact flat charge',async()=>{
  const env=await environment();try{
    const a=await env.register({depreciation_rate_mode:'rate',annual_depreciation_rate:20});
    const sync=()=>syncAutomaticDepreciation(env.entities,env.transaction,{date:'2020-03-01'});
    assert.equal((await sync()).posted,0);assert.equal((await automaticDepreciationStatus(env.entities,{date:'2020-03-01'})).manual_count,2);
    await env.run('2020-01');const before=await env.entities.FixedAsset.get(a.id),oldCharge=monthlyDepreciation(before);
    await env.ok({action:'assetUpdatePlan',assetId:a.id,revision:before.asset_revision,changeSchedule:false,automaticDepreciationEnabled:true});
    const after=await env.entities.FixedAsset.get(a.id);assert.equal(monthlyDepreciation(after),oldCharge);assert.deepEqual({...after.depreciation_plan,nextMonth:undefined},{...before.depreciation_plan,nextMonth:undefined});
    assert.equal((await sync()).total,oldCharge);
    const saved=await env.entities.FixedAsset.get(a.id);
    await env.ok({action:'assetUpdatePlan',assetId:a.id,revision:saved.asset_revision,changeSchedule:false,automaticDepreciationEnabled:false});
    assert.equal((await syncAutomaticDepreciation(env.entities,env.transaction,{date:'2020-04-01'})).posted,0);
  }finally{await env.close()}
});

test('automatic catch-up respects closed months and continues unaffected assets',async()=>{
  const env=await environment();try{
    const a=await env.register({automatic_depreciation_enabled:true});
    await env.register({name:'New freezer',acquisition_date:'2020-03-01',in_service_date:'2020-03-01',automatic_depreciation_enabled:true});
    await env.entities.AccountingPeriod.create({name:'Closed February',fiscal_year:2020,period_number:2,start_date:'2020-02-01',end_date:'2020-02-29',status:'locked'});
    const r=await syncAutomaticDepreciation(env.entities,env.transaction,{date:'2020-04-01'});
    assert.equal(r.posted,2);assert.equal(r.issues.length,1);assert.match(r.issues[0].message,/locked/);assert.equal(r.pending_count,2);
    const entries=await env.entities.DepreciationEntry.list();assert.deepEqual(entries.filter(e=>e.asset_id===a.id).map(e=>e.period_label),['2020-01']);
    assert.equal((await env.entities.FixedAsset.get(a.id)).last_depreciation_date,'2020-01-31');
    assert.equal((await env.entities.Account.get('expense')).balance,600);
  }finally{await env.close()}
});

test('late failures roll back automatic source entries and journals; retries post exactly once',async()=>{
  const env=await environment();try{
    const a=await env.register({automatic_depreciation_enabled:true}),update=env.entities.FixedAsset.update;
    env.entities.FixedAsset.update=async()=>{throw Error('Asset update failed')};
    const sync=()=>syncAutomaticDepreciation(env.entities,env.transaction,{date:'2020-02-01'});
    const failed=await sync();assert.equal(failed.posted,0);assert.equal(failed.issues.length,1);
    assert.equal((await env.entities.JournalEntry.list()).length,0);assert.equal((await env.entities.DepreciationEntry.list()).length,0);assert.equal((await env.entities.Account.get('expense')).balance,0);
    env.entities.FixedAsset.update=update;assert.equal((await sync()).posted,1);assert.equal((await sync()).posted,0);assert.equal((await env.entities.FixedAsset.get(a.id)).net_book_value,700);
  }finally{await env.close()}
});

test('bounded catch-up resumes, caps residual value and ignores disposed or future assets',async()=>{
  const env=await environment();try{
    await env.register({automatic_depreciation_enabled:true});
    const disposed=await env.register({automatic_depreciation_enabled:true});await env.entities.FixedAsset.update(disposed.id,{status:'disposed'});
    await env.register({automatic_depreciation_enabled:true,in_service_date:'2099-01-01'});
    const sync=()=>syncAutomaticDepreciation(env.entities,env.transaction,{date:'2020-04-01',limit:1});
    assert.equal((await sync()).pending_count,2);assert.equal((await sync()).pending_count,1);assert.equal((await sync()).pending_count,0);assert.equal((await sync()).posted,0);
    assert.equal((await env.entities.Account.get('expense')).balance,900);assert.equal((await env.entities.DepreciationEntry.list()).length,3);
  }finally{await env.close()}
});

test('rate changes apply to remaining value and keep previously posted charges immutable',async()=>{
  const env=await environment();try{
    const a=await env.register();await env.run('2020-01');const saved=await env.entities.FixedAsset.get(a.id);
    await env.ok({action:'assetUpdatePlan',assetId:a.id,revision:saved.asset_revision,changeSchedule:true,rateMode:'rate',annualRate:100,salvageValue:100,automaticDepreciationEnabled:true});
    const result=await syncAutomaticDepreciation(env.entities,env.transaction,{date:'2020-03-01'});assert.equal(result.total,50);
    assert.deepEqual((await env.entities.DepreciationEntry.list('depreciation_date')).map(e=>e.amount),[300,50]);
    assert.equal((await env.entities.FixedAsset.get(a.id)).depreciation_plan.annual_rate,100);
    const invalid=await env.call({action:'assetRegister',data:{...data,depreciation_rate_mode:'rate',annual_depreciation_rate:0},requestKey:crypto.randomUUID()});assert.equal(invalid.status,400);
  }finally{await env.close()}
});

async function seedExistingAssetCost(env, amount = 1000) {
  const e = env.entities;
  await e.Account.update('fixed', { balance: amount });
  await e.Account.create({ id:'opening-equity', account_number:'101', name:'Opening equity', account_type:'equity', normal_balance:'credit', balance:amount, is_active:true, is_posting:true });
  const journal = await e.JournalEntry.create({ id:'existing-cost', journal_number:'OPEN-001', description:'Opening asset cost', entry_date:'2020-01-01', status:'posted', total_debit:amount, total_credit:amount, source_module:'opening_balances' });
  await e.JournalLine.create({ id:'existing-cost-debit', journal_id:journal.id, account_id:'fixed', debit:amount, credit:0, status:'posted' });
  await e.JournalLine.create({ id:'existing-cost-credit', journal_id:journal.id, account_id:'opening-equity', debit:0, credit:amount, status:'posted' });
}
async function accountLinkBody(env, overrides = {}) {
  const workspace = await env.ok({ action:'assetAccountWorkspace', accountId:'fixed' });
  return { action:'assetLinkAccount', accountId:'fixed', workspaceToken:workspace.token, requestKey:crypto.randomUUID(), confirmExistingCost:true, reference:'Opening asset list 001', data:{...data, automatic_depreciation_enabled:true, ...overrides} };
}

test('linking an existing capitalized balance creates no acquisition and report sync charges each month exactly once',async()=>{
  const env=await environment();try{
    await seedExistingAssetCost(env);
    await env.entities.FixedAsset.create({ ...data, id:'legacy-empty-asset', name:'Legacy empty asset', asset_account_id:'fixed', acquisition_cost:0, accumulated_depreciation:0, status:'fully_depreciated' });
    const workspace=await env.ok({action:'assetAccountWorkspace',accountId:'fixed'});
    assert.equal(workspace.eligible,true);assert.equal(workspace.ledger_cost,1000);assert.equal(workspace.registered_cost,0);assert.equal(workspace.unassigned_cost,1000);assert.equal(workspace.assets.length,1);
    const body=await accountLinkBody(env), result=await env.ok(body), e=env.entities;
    assert.equal(result.asset.registration_source,'existing_account_cost');assert.equal(result.asset.existing_cost_reference,body.reference);assert.equal(result.asset.automatic_depreciation.authorized_by,user.id);
    assert.equal((await env.ok(body)).reused,true);assert.equal((await e.JournalEntry.list()).length,1);assert.equal((await e.Account.get('fixed')).balance,1000);assert.equal((await e.TreasuryTransaction.list()).length,0);
    assert.equal((await e.FixedAsset.get('legacy-empty-asset')).acquisition_cost,0);
    const sync=()=>syncAutomaticDepreciation(e,env.transaction,{date:'2020-03-01'});
    assert.equal((await sync()).total,600);assert.equal((await sync()).posted,0);assert.equal((await e.Account.get('expense')).balance,600);assert.equal((await e.Account.get('accum')).balance,600);assert.equal((await e.Account.get('fixed')).balance,1000);assert.equal((await e.FixedAsset.get(result.asset.id)).net_book_value,400);
    assert.equal((await env.ok(body)).reused,true);
    const filled=await env.ok({action:'assetAccountWorkspace',accountId:'fixed'});assert.equal(filled.eligible,false);assert.equal(filled.unassigned_cost,0);
    const duplicate=await env.call({...body,workspaceToken:filled.token,requestKey:crypto.randomUUID()});assert.equal(duplicate.status,400);assert.match(duplicate.error,/already assigned/);
    assert.equal((await e.DepreciationEntry.list()).length,2);assert.equal((await e.TreasuryTransaction.list()).length,0);
  }finally{await env.close()}
});

test('account linking reserves partial gross cost, checks stale evidence and accepts a reconciled shared contra account',async()=>{
  const env=await environment();try{
    await seedExistingAssetCost(env);
    const first=await accountLinkBody(env,{acquisition_cost:400,salvage_value:100});
    await env.ok(first);await syncAutomaticDepreciation(env.entities,env.transaction,{date:'2020-02-01'});
    const stale=await env.call({...first,requestKey:crypto.randomUUID()});assert.equal(stale.status,400);assert.match(stale.error,/changed/);
    const workspace=await env.ok({action:'assetAccountWorkspace',accountId:'fixed'});assert.equal(workspace.registered_cost,400);assert.equal(workspace.unassigned_cost,600);
    const over=await env.call(await accountLinkBody(env,{acquisition_cost:601}));assert.equal(over.status,400);assert.match(over.error,/unassigned/);
    await env.ok(await accountLinkBody(env,{name:'Second machine',acquisition_cost:600}));
    assert.equal((await env.entities.FixedAsset.list()).length,2);assert.equal((await env.entities.Account.get('fixed')).balance,1000);assert.equal((await env.entities.Account.get('accum')).balance,100);
    assert.equal((await env.entities.JournalEntry.list()).length,2);
  }finally{await env.close()}
});

test('existing-cost links refuse missing evidence, prior depreciation, invalid certification and acquisition funding',async()=>{
  const env=await environment();try{
    const missing=await env.ok({action:'assetAccountWorkspace',accountId:'fixed'});assert.equal(missing.eligible,false);assert.match(missing.blocked_reasons.join(' '),/does not match/);
    await seedExistingAssetCost(env);const body=await accountLinkBody(env);
    for(const patch of [{confirmExistingCost:false},{reference:''},{fundingAccountId:'operating'},{data:{...body.data,in_service_date:''}},{data:{...body.data,useful_life_months:''}},{data:{...body.data,salvage_value:undefined}},{data:{...body.data,accumulated_depreciation:100}}])assert.equal((await env.call({...body,...patch})).status,400);
    await env.entities.Account.update('accum',{balance:100});await env.entities.Account.update('expense',{balance:100});
    const journal=await env.entities.JournalEntry.create({id:'old-depreciation',journal_number:'DEP-OLD',description:'Historic depreciation',entry_date:'2020-01-31',status:'posted',total_debit:100,total_credit:100});
    await env.entities.JournalLine.create({journal_id:journal.id,account_id:'expense',debit:100,credit:0,status:'posted'});await env.entities.JournalLine.create({journal_id:journal.id,account_id:'accum',debit:0,credit:100,status:'posted'});
    const result=await env.call(body);assert.equal(result.status,400);assert.match(result.error,/unassigned or inconsistent balance/);assert.equal((await env.entities.FixedAsset.list()).length,0);assert.equal((await env.entities.DepreciationEntry.list()).length,0);
    const treasury=await env.ok({action:'assetAccountWorkspace',accountId:'operating'});assert.equal(treasury.eligible,false);assert.match(treasury.blocked_reasons.join(' '),/Treasury/);
  }finally{await env.close()}
});

test('asset link evidence includes reversed source journals and refuses unbalanced headers or lines',async()=>{
  const env=await environment();try{
    await seedExistingAssetCost(env);const e=env.entities;
    await e.JournalEntry.update('existing-cost',{status:'reversed'});
    await e.JournalEntry.create({id:'partial-reversal',journal_number:'REV-001',description:'Asset cost correction',entry_date:'2020-01-02',status:'posted',total_debit:500,total_credit:500});
    await e.JournalLine.create({journal_id:'partial-reversal',account_id:'fixed',debit:0,credit:500,status:'posted'});await e.JournalLine.create({journal_id:'partial-reversal',account_id:'opening-equity',debit:500,credit:0,status:'posted'});await e.Account.update('fixed',{balance:500});await e.Account.update('opening-equity',{balance:500});
    const workspace=await env.ok({action:'assetAccountWorkspace',accountId:'fixed'});assert.equal(workspace.eligible,true);assert.equal(workspace.ledger_cost,500);
    await e.JournalEntry.update('existing-cost',{total_credit:999});
    const badHeader=await env.ok({action:'assetAccountWorkspace',accountId:'fixed'});assert.equal(badHeader.eligible,false);assert.match(badHeader.blocked_reasons.join(' '),/unbalanced/);
    await e.JournalEntry.update('existing-cost',{total_credit:1000});await e.JournalLine.update('existing-cost-credit',{status:'draft'});
    const badLine=await env.ok({action:'assetAccountWorkspace',accountId:'fixed'});assert.equal(badLine.eligible,false);assert.match(badLine.blocked_reasons.join(' '),/inconsistent/);
  }finally{await env.close()}
});

test('linked schedules honor closed periods and never post an incomplete or future month',async()=>{
  const env=await environment();try{
    await seedExistingAssetCost(env);await env.ok(await accountLinkBody(env));
    const e=env.entities;await e.AccountingPeriod.create({id:'closed-first',name:'Closed January',fiscal_year:2020,period_number:1,start_date:'2020-01-01',end_date:'2020-01-31',status:'closed'});
    const blocked=await syncAutomaticDepreciation(e,env.transaction,{date:'2020-02-01'});assert.equal(blocked.posted,0);assert.match(blocked.issues[0].message,/closed/);assert.equal((await e.DepreciationEntry.list()).length,0);
    await e.AccountingPeriod.update('closed-first',{status:'open'});
    const run=await syncAutomaticDepreciation(e,env.transaction,{date:'2020-02-15'});assert.equal(run.posted,1);assert.deepEqual((await e.DepreciationEntry.list()).map(row=>row.period_label),['2020-01']);
    assert.equal((await syncAutomaticDepreciation(e,env.transaction,{date:'2020-02-15'})).posted,0);
  }finally{await env.close()}
});

test('account linking excludes mapped circulating assets and foreign currency and verifies original journal payloads',async()=>{
  const env=await environment();try{
    await seedExistingAssetCost(env);const e=env.entities;
    await e.PostingRule.create({id:'stock-rule',rule_key:'inventory_raw_material',account_id:'fixed',is_active:true});
    let result=await env.ok({action:'assetAccountWorkspace',accountId:'fixed'});assert.equal(result.eligible,false);assert.match(result.blocked_reasons.join(' '),/mapped/);
    await e.PostingRule.delete('stock-rule');await e.Product.create({id:'stock-product',sku:'SKU-TEST',name:'Inventory product',inventory_type:'raw_material',inventory_account_id:'fixed'});
    result=await env.ok({action:'assetAccountWorkspace',accountId:'fixed'});assert.equal(result.eligible,false);assert.match(result.blocked_reasons.join(' '),/mapped/);
    await e.Product.delete('stock-product');await e.Account.update('fixed',{currency:'USD'});
    result=await env.ok({action:'assetAccountWorkspace',accountId:'fixed'});assert.equal(result.eligible,false);assert.match(result.blocked_reasons.join(' '),/XAF/);
    await e.Account.update('fixed',{currency:'XAF'});await e.Account.update('accum',{currency:'USD'});
    let failure=await env.call(await accountLinkBody(env));assert.equal(failure.status,400);assert.match(failure.error,/XAF/);
    await e.Account.update('accum',{currency:'XAF'});await e.Account.update('expense',{currency:'USD'});
    failure=await env.call(await accountLinkBody(env));assert.equal(failure.status,400);assert.match(failure.error,/XAF/);
    await e.Account.update('expense',{currency:'XAF'});
    const journal=await e.JournalEntry.get('existing-cost'),lines=await e.JournalLine.filter({journal_id:journal.id});
    await e.JournalEntry.update(journal.id,{posting_payload:journalPayload({entryDate:journal.entry_date,description:journal.description,sourceModule:journal.source_module,sourceDocumentType:journal.source_document_type,lines})});
    result=await env.ok({action:'assetAccountWorkspace',accountId:'fixed'});assert.equal(result.eligible,true);
    await e.JournalEntry.update(journal.id,{description:'Changed original description'});
    result=await env.ok({action:'assetAccountWorkspace',accountId:'fixed'});assert.equal(result.eligible,false);assert.match(result.blocked_reasons.join(' '),/original posting/);
    assert.equal((await e.FixedAsset.list()).length,0);
  }finally{await env.close()}
});
