import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {PGlite} from '@electric-sql/pglite';
import {fixture,date} from './helpers/cashier.mjs';
import {previewAccountConsolidation,postAccountConsolidation} from '../src/server/domain/account-consolidation.js';
import {postJournal} from '../src/server/domain/field-ops.js';
import {prepareAccountDefinition} from '../src/server/domain/account-definitions.js';
import {resolveAccountConsolidations} from '../src/lib/account-consolidation.js';
import {FEATURE_AUTHORITY} from '../src/server/domain/roles.js';
import {guardMutation} from '../src/server/access.js';
import {deleteUnusedAccount} from '../src/server/domain/account-lifecycle.js';

const context={user:{id:'gm',role:'admin',email:'gm@example.test'},role:'admin'};
async function setup(db,{sourceValue=30,targetValue=100}={}){
 const f=await fixture(db),s=f.entities;s.FixedAsset={filter:async()=>[]};
 const create=s.AuditLog.create;s.AuditLog.create=async value=>{
  value={...value,audit_source:'server_verified'};if(!value.id)return create(value);
  const row=structuredClone(value);if(db)await db.query('INSERT INTO fixture_entity VALUES($1,$2,$3)',['AuditLog',row.id,JSON.stringify(row)]);else f.rows.AuditLog.push(row);return row;
 };
 const source=await s.Account.create({account_number:'7000',name:'Direct Material COGS',account_type:'cogs',normal_balance:'debit',balance:0,is_active:true,is_posting:true,currency:'XAF'});
 const target=await s.Account.create({account_number:'5100',name:'Direct Material Cost of Goods Sold',account_type:'cogs',normal_balance:'debit',balance:0,is_active:true,is_posting:true,currency:'XAF',is_system:true});
 for(const [account,value] of [[source,sourceValue],[target,targetValue]])if(value)await postJournal({entities:s},{entryDate:date,description:'Fixture sales cost',sourceModule:'sales',sourceDocumentType:'Invoice',sourceDocumentId:account.id,userId:context.user.id,lines:[{account_id:account.id,debit:Math.max(0,value),credit:Math.max(0,-value)},{account_id:'inventory',debit:Math.max(0,-value),credit:Math.max(0,value)}]});
 await s.Product.update('product-a',{cogs_account_id:source.id});await s.PostingRule.update('direct_material_cogs',{account_id:source.id});
 const body={sourceAccountId:source.id,targetAccountId:target.id,date,reference:'Duplicate COGS consolidation'};
 return {...f,s,source,target,body,preview:()=>previewAccountConsolidation(s,context,body)};
}

test('reviewed COGS consolidation transfers balance once, remaps future postings and retains immutable original records',async()=>{
 const f=await setup(),before={journals:await f.s.JournalEntry.list(),lines:await f.s.JournalLine.list()},preview=await f.preview();
 assert.equal(preview.source_balance,30);assert.equal(preview.target_balance,100);assert.equal(preview.combined_balance,130);assert.equal(preview.profit_change,0);assert.deepEqual(preview.unsupported_references,[]);
 assert.deepEqual(preview.transfer_lines,[{account_id:f.target.id,debit:30,credit:0},{account_id:f.source.id,debit:0,credit:30}]);
 const body={...f.body,token:preview.token,requestKey:crypto.randomUUID(),confirmed:true},result=await postAccountConsolidation(f.s,context,body);
 assert.equal(result.product_count,1);assert.equal(result.rule_count,1);assert.ok(result.journal_id);
 const source=await f.s.Account.get(f.source.id),target=await f.s.Account.get(f.target.id);assert.equal(source.balance,0);assert.equal(source.is_active,false);assert.equal(source.is_hidden,true);assert.equal(source.consolidated_into_account_id,target.id);assert.equal(target.balance,130);assert.equal(target.name,'Cost of Goods Sold');
 assert.equal((await f.s.Product.get('product-a')).cogs_account_id,target.id);assert.equal((await f.s.PostingRule.get('direct_material_cogs')).account_id,target.id);
 const journals=await f.s.JournalEntry.list(),lines=await f.s.JournalLine.list();assert.deepEqual(journals.filter(row=>before.journals.some(old=>old.id===row.id)),before.journals);assert.deepEqual(lines.filter(row=>before.lines.some(old=>old.id===row.id)),before.lines);
 const state=structuredClone(f.rows);assert.equal((await postAccountConsolidation(f.s,context,body)).reused,true);assert.deepEqual(f.rows,state);
 await assert.rejects(postAccountConsolidation(f.s,context,{...body,reference:'Changed intent'}),/reference already belongs/);
 await assert.rejects(prepareAccountDefinition(f.s,{is_active:true,is_hidden:false},source),/account was consolidated/);
 const aliases=resolveAccountConsolidations(await f.s.Account.list());assert.equal(aliases.canonicalId(source.id),target.id);assert.deepEqual(new Set(aliases.members(target.id).map(row=>row.id)),new Set([source.id,target.id]));
 const event=(await f.s.AuditLog.list()).find(row=>row.action==='consolidate_cogs_accounts');assert.ok(event.accounting_control_consolidation_accounts.some(row=>row.id===source.id&&row.is_active));
 assert.throws(()=>guardMutation(context,'AuditLog','update',{},event),/Accounting control audit/);
});

test('a genuine credit source retains its sign and a zero source does not create a journal',async()=>{
 for(const value of [-30,0]){
  const f=await setup(undefined,{sourceValue:value}),before=(await f.s.JournalEntry.list()).length,preview=await f.preview();
  assert.equal(preview.combined_balance,100+value);
  if(value<0)assert.deepEqual(preview.transfer_lines,[{account_id:f.target.id,debit:0,credit:30},{account_id:f.source.id,debit:30,credit:0}]);else assert.deepEqual(preview.transfer_lines,[]);
  const result=await postAccountConsolidation(f.s,context,{...f.body,token:preview.token,requestKey:crypto.randomUUID(),confirmed:true});
  assert.equal((await f.s.Account.get(f.source.id)).balance,0);assert.equal((await f.s.Account.get(f.target.id)).balance,100+value);assert.equal((await f.s.JournalEntry.list()).length,before+(value?1:0));assert.equal(Boolean(result.journal_id),Boolean(value));
 }
});

test('zero-history consolidated sources and retained destinations cannot be deleted or structurally invalidated',async()=>{
 const f=await setup(undefined,{sourceValue:0,targetValue:0});await f.s.Account.update(f.target.id,{is_system:false});
 const preview=await f.preview();await postAccountConsolidation(f.s,context,{...f.body,token:preview.token,requestKey:crypto.randomUUID(),confirmed:true});
 assert.equal((await f.s.JournalEntry.list()).length,0);
 for(const id of [f.source.id,f.target.id])await assert.rejects(deleteUnusedAccount(f.s,context,{accountId:id,requestKey:crypto.randomUUID()}),/reporting history/);
 const target=await f.s.Account.get(f.target.id);
 for(const change of [{account_type:'expense'},{normal_balance:'credit'},{is_active:false},{is_posting:false},{is_control_account:true},{is_treasury:true}])await assert.rejects(prepareAccountDefinition(f.s,change,target),/Retained COGS accounts/);
 assert.equal((await prepareAccountDefinition(f.s,{name:'Cost of Goods Sold',is_hidden:true},target)).is_active,true);
 const aliases=resolveAccountConsolidations(await f.s.Account.list());assert.equal(aliases.canonicalId(f.source.id),f.target.id);
});

test('preview tokens reject changed postings and configuration, and open periods and reconciled caches are required',async()=>{
 for(const change of ['period','cache','product','rule','posting']){
  const f=await setup(),preview=await f.preview(),body={...f.body,token:preview.token,requestKey:crypto.randomUUID(),confirmed:true};
  if(change==='period')await f.s.AccountingPeriod.update('period',{status:'closed'});
  if(change==='cache')await f.s.Account.update(f.source.id,{balance:31});
  if(change==='product')await f.s.Product.update('product-a',{name:'Changed product'});
  if(change==='rule')await f.s.PostingRule.update('direct_material_cogs',{label:'Changed configuration'});
  if(change==='posting')await postJournal({entities:f.s},{entryDate:date,description:'Later cost',sourceModule:'sales',sourceDocumentType:'Invoice',sourceDocumentId:'later',userId:'gm',lines:[{account_id:f.source.id,debit:1,credit:0},{account_id:'inventory',debit:0,credit:1}]});
  const before=structuredClone(f.rows);await assert.rejects(postAccountConsolidation(f.s,context,body),/open accounting period|balances with the posted ledger|changed/);assert.deepEqual(f.rows,before);
 }
});

test('only a principal administrator can consolidate compatible non-system source COGS accounts',async()=>{
 const f=await setup();
 const cashier={user:{id:'cashier',role:'user'},role:'admin',employee:{role:'cashier',status:'active',[FEATURE_AUTHORITY]:{module:'accounting',role:'admin'}}};
 await assert.rejects(previewAccountConsolidation(f.s,cashier,f.body),{status:403});
 const validSource={...await f.s.Account.get(f.source.id),is_system:false,is_control_account:false,opening_balance_recorded:false};
 for(const change of [{account_type:'expense'},{normal_balance:'credit'},{currency:'USD'},{is_system:true},{is_control_account:true},{opening_balance_recorded:true},{is_active:false}]){
  await f.s.Account.update(f.source.id,{...validSource,...change});await assert.rejects(f.preview());
 }
 await f.s.Account.update(f.source.id,validSource);
 await f.s.Account.create({account_number:'child',name:'Child',account_type:'cogs',normal_balance:'debit',parent_id:f.source.id});await assert.rejects(f.preview(),/sub-accounts/);
});

test('unexpected budget or other posting references are exposed for review and prevent a partial consolidation',async()=>{
 const f=await setup();await f.s.Budget.update('budget',{account_id:f.source.id});
 const preview=await f.preview();assert.deepEqual(preview.unsupported_references.map(row=>row.entity),['Budget']);
 const before=structuredClone(f.rows);await assert.rejects(postAccountConsolidation(f.s,context,{...f.body,token:preview.token,requestKey:crypto.randomUUID(),confirmed:true}),/other account references/);assert.deepEqual(f.rows,before);
});

test('unposted source drafts block consolidation and complete original journal evidence and dates must reconcile',async()=>{
 const f=await setup(),draft=await f.s.JournalEntry.create({journal_number:'JV-DRAFT',entry_date:date,status:'draft'});await f.s.JournalLine.create({journal_id:draft.id,account_id:f.source.id,status:'draft',debit:2,credit:0});
 assert.deepEqual((await f.preview()).unsupported_references,[{entity:'JournalEntry',id:draft.id,name:'JV-DRAFT'}]);
 for(const change of ['counterpart','header','payload','future']){
  const g=await setup(),journal=(await g.s.JournalEntry.list())[0],line=(await g.s.JournalLine.list()).find(row=>row.journal_id===journal.id&&row.account_id==='inventory');
  if(change==='counterpart')await g.s.JournalLine.update(line.id,{credit:29});
  if(change==='header')await g.s.JournalEntry.update(journal.id,{total_debit:31});
  if(change==='payload')await g.s.JournalEntry.update(journal.id,{posting_payload:'changed'});
  if(change==='future'){const future=new Date(Date.parse(date+'T12:00:00Z')+86400000).toISOString().slice(0,10);await g.s.JournalEntry.update(journal.id,{entry_date:future,posting_payload:''});}
  await assert.rejects(g.preview(),/balance|complete posted journals|latest posted entry/);
 }
});

test('aliases reject missing targets, cycles, non-COGS types and incompatible currencies',()=>{
 const base=[{id:'a',account_type:'cogs',normal_balance:'debit',consolidated_into_account_id:'b'},{id:'b',account_type:'cogs',normal_balance:'debit'}];
 assert.equal(resolveAccountConsolidations(base).canonicalId('a'),'b');
 for(const rows of [[base[0]],[base[0],{...base[1],consolidated_into_account_id:'a'}],[base[0],{...base[1],account_type:'expense'}],[base[0],{...base[1],currency:'USD'}]])assert.throws(()=>resolveAccountConsolidations(rows));
});

test('the real account API rolls back a late consolidation audit failure and an identical retry commits once',async()=>{
 const db=new PGlite();try{
  const f=await setup(db),output=await build({entryPoints:['src/app/api/accounting/accounts/route.js'],bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'account-consolidation-fixture',setup(builder){
   builder.onResolve({filter:/^@\/server\/(auth|db|entities)$/},args=>({path:args.path.split('/').at(-1),namespace:'fixture'}));
   builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:{auth:'export const checkOrigin=()=>{},authenticateRequest=async()=>globalThis.__consolidationContext,apiError=error=>Response.json({error:error.message},{status:error.status||400});',db:'export const database=()=>({unsafe:async()=>[]}),transaction=fn=>globalThis.__consolidationTx(fn);',entities:'export const serviceEntities=new Proxy({},{get:(_,key)=>globalThis.__consolidationStores[key]});'}[args.path]}));
  }}]}),route=(await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'))).POST;
  globalThis.__consolidationContext=context;globalThis.__consolidationStores=f.s;globalThis.__consolidationTx=async fn=>{await db.exec('BEGIN');try{const result=await fn();await db.exec('COMMIT');return result;}catch(error){await db.exec('ROLLBACK');throw error;}};
  const preview=await f.preview(),body={action:'consolidate',...f.body,token:preview.token,requestKey:crypto.randomUUID(),confirmed:true},call=()=>route(new Request('http://localhost/api/accounting/accounts',{method:'POST',body:JSON.stringify(body)}));
  const before=Object.fromEntries(await Promise.all(['Account','Product','PostingRule','JournalEntry','JournalLine','AuditLog'].map(async name=>[name,await f.s[name].list()]))),create=f.s.AuditLog.create;let failed=true;
  f.s.AuditLog.create=async value=>{if(failed&&value.action==='consolidate_cogs_accounts')throw Error('Simulated audit failure');return create(value);};
  let response=await call();assert.equal(response.status,400);assert.match((await response.json()).error,/Simulated audit failure/);
  for(const [name,rows] of Object.entries(before))assert.deepEqual(await f.s[name].list(),rows,name+' must roll back');
  failed=false;response=await call();assert.equal(response.status,200,JSON.stringify(await response.clone().json()));assert.equal((await f.s.Account.get(f.source.id)).balance,0);
  assert.equal((await (await call()).json()).reused,true);assert.equal((await f.s.JournalEntry.filter({source_document_type:'AccountConsolidation'})).length,1);
 }finally{delete globalThis.__consolidationContext;delete globalThis.__consolidationStores;delete globalThis.__consolidationTx;await db.close();}
});
