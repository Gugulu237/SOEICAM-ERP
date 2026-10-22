import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import catalog from '../src/server/generated/schema.json' with {type:'json'};
import {postgresAdapter} from './helpers/postgres-adapter.mjs';
import {eligibleAccountParents,validateAccount,buildAccountTree,visibleAccounts} from '../src/lib/account-hierarchy.js';
import {deleteUnusedAccount} from '../src/server/domain/account-lifecycle.js';
import {guardMutation} from '../src/server/access.js';
import {saveAccountDefinition} from '../src/server/domain/account-definitions.js';

const context={user:{id:'accountant',email:'accountant@example.test'},role:'cashier',employee:{role:'cashier',status:'active',allowed_modules:['accounting']}};
let compiled;
async function environment(){
  const db=new PGlite();await db.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;');
  await db.exec(await readFile(new URL('../supabase/migrations/202610170001_erp_schema.sql',import.meta.url),'utf8'));
  const adapter=postgresAdapter(db);let queue=Promise.resolve();globalThis.__lifecycleDB={unsafe:(sql,args)=>{const p=queue.then(()=>adapter.unsafe(sql,args));queue=p.catch(()=>{});return p;}};
  globalThis.__lifecycleTx=async fn=>{await db.exec('BEGIN');try{const out=await fn();await db.exec('COMMIT');return out;}catch(e){await db.exec('ROLLBACK');throw e;}};
  if(!compiled){const out=await build({stdin:{contents:"export {entityOperation} from './src/server/entity-api.js';export {entityStore} from './src/server/entities.js';export {POST} from './src/app/api/accounting/accounts/route.js';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'lifecycle-db',setup(b){
    b.onResolve({filter:/^server-only$/},()=>({path:'empty',namespace:'mock'}));
    b.onResolve({filter:/(?:^@\/server\/db$|(?:^|\/)db\.js$)/},()=>({path:'db',namespace:'mock'}));
    b.onResolve({filter:/^@\/server\/auth$/},()=>({path:'auth',namespace:'mock'}));
    b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='db'?'export const database=()=>globalThis.__lifecycleDB,transaction=fn=>globalThis.__lifecycleTx(fn);':a.path==='auth'?'export const checkOrigin=()=>{},authenticateRequest=async()=>globalThis.__lifecycleContext,apiError=e=>Response.json({error:e.message},{status:e.status || 400});':''}));
  }}]});compiled=await import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));}
  const stores=Object.fromEntries(Object.keys(catalog).map(n=>[n,compiled.entityStore(n)]));globalThis.__lifecycleContext=context;
  const create=async(name='Spare equity')=>stores.Account.create({account_number:crypto.randomUUID(),name,account_type:'equity',normal_balance:'credit',is_active:true,is_posting:true});
  return {db,stores,create,operation:compiled.entityOperation,post:body=>compiled.POST(new Request('http://localhost/api/accounting/accounts',{method:'POST',body:JSON.stringify(body)}))};
}
test('posting parents preserve own balances, prevent descendant cycles, and offer active parents of the selected type',()=>{
  const rows=[{id:'p',account_number:'3000',name:'Capital',account_type:'equity',is_posting:true},{id:'c',account_number:'3001',name:'Investor',account_type:'equity',parent_id:'p',is_posting:true},{id:'g',account_number:'3002',name:'Detail',account_type:'equity',parent_id:'c'},{id:'a',account_number:'1000',account_type:'asset'},{id:'off',account_type:'equity',is_active:false}];
  assert.deepEqual(eligibleAccountParents(rows,{id:'c',account_type:'equity'}).map(a=>a.id),['p']);
  assert.deepEqual(validateAccount(rows[1],rows,{}),[]);assert.match(validateAccount({...rows[0],parent_id:'g'},rows,{})[0],/own sub-accounts/);
  const balances={p:{credit:100,entries:1},c:{credit:50,entries:1},g:{credit:20,entries:1}};
  assert.equal(buildAccountTree(rows,balances).rollups.get('p'),-170);
  assert.deepEqual(visibleAccounts(rows.map(r=>({...r,is_hidden:r.id==='c'})),balances).map(a=>a.id),['p','g','a']);
  assert.deepEqual(visibleAccounts(rows,balances,{status:'used'}).map(a=>a.id),['p','c','g']);
});
test('hide preserves history and posting controls; only wholly unused accounts can be deleted and retries reuse their audit',async()=>{
  const f=await environment();try{
    const a=await f.create(),s=f.stores;
    const hidden=await saveAccountDefinition(s,context,{accountId:a.id,updatedDate:a.updated_date,account:{is_hidden:true}});
    assert.equal(hidden.is_hidden,true);assert.equal(hidden.is_active,true);assert.equal(hidden.is_posting,true);
    const request={action:'delete',accountId:a.id,updatedDate:hidden.updated_date,requestKey:crypto.randomUUID()};
    let response=await f.post(request);assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
    assert.equal(await s.Account.get(a.id),null);assert.equal((await (await f.post(request)).json()).reused,true);
    assert.equal((await s.AuditLog.filter({action:'delete_unused_account'})).length,1);
  }finally{await f.db.close();}
});
test('net-zero historical lines, child accounts, inactive mappings and product references prevent deletion; hidden system accounts remain posting',async()=>{
  const f=await environment();try{
    const s=f.stores;
    for(const kind of ['draft','reversed','posted','child','rule','product','treasury','audit','opening','system','control']){
      const a=await f.create(kind);
      if(['draft','reversed','posted'].includes(kind))await s.JournalLine.create({journal_id:'journal-'+kind,account_id:a.id,debit:0,credit:0,status:kind});
      if(kind==='child')await s.Account.create({account_number:'child',name:'Child',account_type:'equity',normal_balance:'credit',parent_id:a.id});
      if(kind==='rule')await s.PostingRule.create({rule_key:'test',description:'Fixture rule',account_id:a.id,is_active:false});
      if(kind==='product')await s.Product.create({name:'Product',sku:'TEST',inventory_type:'raw_material',inventory_account_id:a.id});
      if(kind==='treasury')await s.TreasuryAccount.create({name:'Till',account_type:'cash',gl_account_id:a.id});
      if(kind==='audit')await s.AuditLog.create({action:'inventoryAuditSave',description:'Saved count',module:'inventory_audit',inventory_audit_state:{loss_account_id:a.id}});
      if(['system','control','opening'].includes(kind))await s.Account.update(a.id,{[kind==='system'?'is_system':kind==='control'?'is_control_account':'opening_balance']:kind==='opening'?1:true});
      const current=await s.Account.get(a.id);
      await assert.rejects(deleteUnusedAccount(s,context,{accountId:a.id,updatedDate:current.updated_date,requestKey:crypto.randomUUID()}),/Hide|hide/);
      assert.ok(await s.Account.get(a.id));
      const hidden=await saveAccountDefinition(s,context,{accountId:a.id,updatedDate:current.updated_date,account:{is_hidden:true}});assert.equal(hidden.is_hidden,true);assert.equal(hidden.is_active,true);
    }
    const fresh=await f.create();await assert.rejects(deleteUnusedAccount(s,{...context,role:'commercial',employee:{role:'commercial',status:'active'}},{accountId:fresh.id,requestKey:crypto.randomUUID()}),{status:403});
    await assert.rejects(deleteUnusedAccount(s,context,{accountId:fresh.id,updatedDate:'old',requestKey:crypto.randomUUID()}),{status:409});
  }finally{await f.db.close();}
});
test('account deletion and its tombstone roll back together on a failed delete at the HTTP boundary',async()=>{
  const f=await environment();try{
    const a=await f.create();await f.db.exec("CREATE FUNCTION prevent_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Delete unavailable'; END $$;CREATE TRIGGER no_delete BEFORE DELETE ON account FOR EACH ROW EXECUTE FUNCTION prevent_delete();");
    const request={action:'delete',accountId:a.id,updatedDate:a.updated_date,requestKey:crypto.randomUUID()};
    assert.equal((await f.post(request)).status,400);assert.ok(await f.stores.Account.get(a.id));assert.equal((await f.stores.AuditLog.filter({action:'delete_unused_account'})).length,0);
    await f.db.exec('DROP TRIGGER no_delete ON account');assert.equal((await f.post(request)).status,200);
  }finally{await f.db.close();}
});

test('stock entity writes cannot bypass checked quantity/value workflows, while QC metadata remains editable',async()=>{
 const f=await environment();try{
  const s=f.stores,admin={user:{id:'gm',role:'admin',email:'gm@example.test'},role:'admin'};
  const stock={product_id:'fg',product_name:'Finished product',warehouse_id:'cold',quantity:5,unit_cost:1,total_value:5};
  await assert.rejects(f.operation(admin,'StockBalance','create',[stock]),/checked stock workflow/);
  await assert.rejects(f.operation(admin,'StockBalance','bulkCreate',[[stock]]),/checked stock workflow/);
  const lot=await s.StockBalance.create(stock);
  for(const changes of [{quantity:6},{total_value:6},{unit_cost:2},{warehouse_id:'dry'}])await assert.rejects(f.operation(admin,'StockBalance','update',[lot.id,changes]),/checked stock workflow/);
  await assert.rejects(f.operation(admin,'StockBalance','delete',[lot.id]),/checked stock workflow/);
  await f.operation(admin,'StockBalance','update',[lot.id,{qc_status:'quarantine'}]);assert.equal((await s.StockBalance.get(lot.id)).qc_status,'quarantine');
 }finally{await f.db.close();}
});
test('account deletion audit tombstones cannot be forged, rewritten or removed through generic record endpoints',()=>{
 const admin={user:{id:'gm',role:'admin'},role:'admin'};
 for(const payload of [{action:'delete_unused_account'},{deleted_account_id:'unused'},{id:'AD-'+ 'a'.repeat(40)}])assert.throws(()=>guardMutation(admin,'AuditLog','create',payload),/checked account workflow/);
 for(const operation of ['update','delete','deleteMany'])assert.throws(()=>guardMutation(admin,'AuditLog',operation,{}, {action:'delete_unused_account'}),/checked account workflow/);
});
