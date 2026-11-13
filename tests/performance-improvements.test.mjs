import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { postgresAdapter } from './helpers/postgres-adapter.mjs';
import { linkedSupabaseContext } from '../src/server/linked-user-context.js';
import { createInFlightReads, isReadOnlyFunction } from '../src/lib/function-actions.js';

test('function coalescing releases settled and failed reads and isolates invalidated generations', async () => {
  const reads=createInFlightReads(); let resolve, calls=0;
  const first=reads.run('a',()=>{calls++;return new Promise(done=>{resolve=done});});
  assert.equal(reads.run('a',()=>assert.fail()),first);
  await Promise.resolve(); assert.equal(calls,1);
  reads.clear(); const newer=reads.run('a',()=>42);
  resolve(1); assert.equal(await first,1); assert.equal(await newer,42);
  assert.equal(await reads.run('a',()=>43),43);
  await assert.rejects(reads.run('a',()=>{throw Error('offline')}),/offline/);
  assert.equal(await reads.run('a',()=>44),44);
  assert.equal(isReadOnlyFunction('fieldOps','cashierWorkspace'),true);
  for(const action of ['confirmCashHandover','reportCashHandover','unknown']) assert.equal(isReadOnlyFunction('fieldOps',action),false);
  assert.equal(isReadOnlyFunction('customerReceipts','preview'),false);
});

async function stores(db) {
  const adapter=postgresAdapter(db); let inserts=0;
  globalThis.__bulkPerfDB={unsafe:async(sql,args)=>{if(sql.startsWith('INSERT'))inserts++;return adapter.unsafe(sql,args)}};
  globalThis.__bulkPerfTransaction=async run=>{await db.exec('BEGIN');try{const value=await run();await db.exec('COMMIT');return value}catch(error){await db.exec('ROLLBACK');throw error}};
  const bundle=await build({entryPoints:['src/server/entities.js'],bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'bulk-fixture',setup(b){
    b.onResolve({filter:/^server-only$/},()=>({path:'empty',namespace:'fixture'}));
    b.onResolve({filter:/(?:^|\/)db\.js$/},()=>({path:'db',namespace:'fixture'}));
    b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='db'?'export const database=()=>globalThis.__bulkPerfDB;export const transaction=run=>globalThis.__bulkPerfTransaction(run);':''}));
  }}]});
  const {entityStore}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
  return {entityStore,inserts:()=>inserts};
}

test('bulk creation batches 401 records in three INSERTs, preserves JSON/defaults/order and rolls back late failures',async()=>{
  const db=new PGlite();
  try{
    await db.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;');
    await db.exec(await readFile(new URL('../supabase/migrations/202610170001_erp_schema.sql',import.meta.url),'utf8'));
    const {entityStore,inserts}=await stores(db), products=entityStore('Product');
    const input=Array.from({length:401},(_,i)=>({id:'perf-'+i,name:'Product '+i,sku:'sku-'+i,inventory_type:'finished_product',...(i%2?{is_active:false}:{}),metadata:{tags:['a','b'],index:i}}));
    const result=await products.bulkCreate(input);
    assert.equal(inserts(),3);assert.deepEqual(result.map(r=>r.id),input.map(r=>r.id));
    assert.deepEqual(result[0].metadata,{tags:['a','b'],index:0});assert.equal(result[1].is_active,false);
    const count=await db.query('SELECT count(*)::int AS n FROM product');assert.equal(count.rows[0].n,401);
    const bad=Array.from({length:201},(_,i)=>({id:i===200?'perf-0':'rollback-'+i,name:'Rollback',sku:'rollback-sku-'+i,inventory_type:'finished_product'}));
    await assert.rejects(products.bulkCreate(bad));
    assert.equal((await db.query("SELECT count(*)::int AS n FROM product WHERE id LIKE 'rollback-%'")).rows[0].n,0);
    assert.deepEqual(await products.bulkCreate([]),[]);
    await assert.rejects(products.bulkCreate(Array(1001).fill({name:'too many'})),/Invalid record batch/);
  }finally{delete globalThis.__bulkPerfDB;delete globalThis.__bulkPerfTransaction;await db.close()}
});

test('linked Supabase sessions fetch current user, employee and role catalogue in one read without write locks',async()=>{
  let queries=0,role='cashier';
  const db={unsafe:async(sql,args)=>{queries++;assert.match(sql,/^SELECT/);assert.doesNotMatch(sql,/pg_advisory|UPDATE|INSERT/);assert.deepEqual(args,['subject']);return[{profile:{id:'user',role},employees:[{id:'employee',status:'active'}],role_catalogue:null}]}};
  const first=await linkedSupabaseContext(db,'subject');assert.equal(queries,1);assert.equal(first.user.role,'cashier');assert.equal(first.employee.id,'employee');
  role='admin';assert.equal((await linkedSupabaseContext(db,'subject')).user.role,'admin');assert.equal(queries,2);
  assert.equal(await linkedSupabaseContext({unsafe:async()=>[]},'none'),null);
  await assert.rejects(linkedSupabaseContext({unsafe:async()=>[{profile:{}},{profile:{}}]},'duplicate'),e=>e.status===409);
  await assert.rejects(linkedSupabaseContext({unsafe:async()=>[{profile:{},employees:[{},{}]}]},'duplicate'),e=>e.status===409);
});

test('read-only dashboard calls coalesce without clearing lookups, while successful writes invalidate them',async()=>{
  const output=await build({entryPoints:['src/api/erpClient.js'],bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'client-fixture',setup(b){
    b.onResolve({filter:/supabase\/browser$/},()=>({path:'auth',namespace:'fixture'}));
    b.onResolve({filter:/item-lookup-cache$/},()=>({path:'lookups',namespace:'fixture'}));
    b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='auth'?'export const supabaseBrowser=()=>({});':'export const invalidateItemLookups=()=>globalThis.__lookupClears++;'}));
  }}]});
  const original=globalThis.fetch;globalThis.__lookupClears=0;let count=0,resolve;
  globalThis.fetch=async()=>{count++;await new Promise(done=>{resolve=done});return Response.json({rows:[{amount:10}]})};
  try{
    const {erp}=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
    const a=erp.functions.invoke('fieldOps',{action:'cashierWorkspace'}),b=erp.functions.invoke('fieldOps',{action:'cashierWorkspace'});
    await Promise.resolve();assert.equal(count,1);resolve();const [one,two]=await Promise.all([a,b]);
    one.data.rows[0].amount=999;assert.equal(two.data.rows[0].amount,10);assert.equal(globalThis.__lookupClears,0);
    const next=erp.functions.invoke('fieldOps',{action:'cashierWorkspace'});await Promise.resolve();assert.equal(count,2);resolve();await next;
    const write=erp.functions.invoke('fieldOps',{action:'confirmCashHandover'});resolve();await write;assert.equal(globalThis.__lookupClears,1);
  }finally{globalThis.fetch=original;delete globalThis.__lookupClears}
});

test('same-page query changes use native history, retain replace intent and skip unchanged targets',async()=>{
  const output=await build({entryPoints:['src/lib/router.jsx'],bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'navigation-fixture',setup(b){
    b.onResolve({filter:/^react$|^next\/|navigation-context$|navigation-session$/},a=>({path:a.path,namespace:'fixture'}));
    b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='react'?'export const useCallback=f=>f;export const useEffect=()=>{};export default {forwardRef:f=>f};':a.path==='next/link'?'export default ()=>null;':a.path==='next/navigation'?"export const useRouter=()=>{throw Error('server navigation used')};export const usePathname=()=>'/customers';export const useSearchParams=()=>new URLSearchParams(globalThis.__navFixture.canonical.search);export const useParams=()=>({});":a.path.endsWith('navigation-context')?'export const useNavigationHistory=()=>{};export const useNavigationSession=()=>null;':'export const announceNavigation=(...args)=>globalThis.__navAnnouncements.push(args);'}));
  }}]});
  const previous=globalThis.window,calls=[],url=new URL('https://example.test/customers?view=list');
  const fixture={canonical:url,address:url};globalThis.__navFixture=fixture;
  globalThis.__navAnnouncements=[];
  const tree={tree:['customers']},history={state:{__NA:true,__PRIVATE_NEXTJS_INTERNALS_TREE:tree}};
  const update=(kind,data,_title,href)=>{
    calls.push([kind,data,href]);
    fixture.address=new URL(href,fixture.address);
    // Next skips updating its hooks for navigation writes marked as internal.
    if(data?.__NA||data?._N){history.state=data;return;}
    fixture.canonical=fixture.address;
    history.state={...data,__NA:true,__PRIVATE_NEXTJS_INTERNALS_TREE:tree};
  };
  history.pushState=(...args)=>update('push',...args);
  history.replaceState=(...args)=>update('replace',...args);
  globalThis.window={history};
  try{
    const {useSearchParams}=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
    const [,set]=useSearchParams();set({view:'list'});assert.equal(calls.length,0);
    set({view:'list',customer:'fixture'});assert.equal(calls[0][0],'push');
    assert.equal(calls[0][2],'/customers?view=list&customer=fixture');
    const marker={owner:'fixture',id:'entry-1'};
    history.state={...history.state,soeicamNavigation:marker};
    for(const tab of ['sales','stock',null]){
      const [,selectTab]=useSearchParams();
      selectTab(params=>{if(tab)params.set('tab',tab);else params.delete('tab');return params;},{replace:true});
      assert.equal(fixture.address.searchParams.get('tab'),tab);
      const [params]=useSearchParams();
      assert.equal(params.get('tab'),tab,'Next’s route state must reflect the selected customer tab');
      assert.equal(params.get('customer'),'fixture');
      assert.deepEqual(history.state.soeicamNavigation,marker);
      assert.deepEqual(history.state.__PRIVATE_NEXTJS_INTERNALS_TREE,tree);
      assert.equal(calls.at(-1)[0],'replace');
      assert.equal(globalThis.__navAnnouncements.at(-1)[1].replace,true);
    }
  }finally{globalThis.window=previous;delete globalThis.__navAnnouncements;delete globalThis.__navFixture}
});
