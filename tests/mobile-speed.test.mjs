import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {inventoryOverview,compactStockBalances} from '../src/server/domain/inventory-overview.js';
import {inventorySnapshotResponse} from '../src/server/inventory-snapshot-response.js';
import {hookRuntime} from './helpers/commercial-ui.mjs';

const admin={user:{id:'admin',role:'admin'},role:'admin'};
const commercial={user:{id:'login',role:'user'},employee:{id:'agent',role:'commercial',status:'active'}};
const matches=(row,query)=>Object.entries(query||{}).every(([key,value])=>key==='$and'?value.every(q=>matches(row,q)):key==='$or'?value.some(q=>matches(row,q)):value&&typeof value==='object'?value.$in.includes(row[key]):row[key]===value);
function fixture(){
  const rows={CompanySettings:[],Product:[{id:'p',name:'Yogurt',inventory_type:'finished_product',selling_price:500},{id:'raw',inventory_type:'raw_material'},{id:'removed',inventory_type:'finished_product',item_removed_at:'2026-01-01'}],Warehouse:[{id:'mine',warehouse_type:'commercial_custody',custodian_employee_id:'agent'},{id:'other',warehouse_type:'commercial_custody',custodian_employee_id:'another'}],StockBalance:[{id:'a',product_id:'p',warehouse_id:'mine',quantity:12,total_value:3600,lot_number:'L1',expiry_date:'2026-12-01',qc_status:'released',unit_cost:300,notes:'historical metadata'},{id:'b',product_id:'p',warehouse_id:'other',quantity:9,total_value:2700},{id:'old',product_id:'p',warehouse_id:'mine',quantity:0,total_value:0}],Vehicle:[{id:'van',registration_number:'TEST'}]};
  const reads=[];
  const stores=Object.fromEntries(Object.keys(rows).map(name=>[name,{filter:async(query,sort,limit,skip=0)=>{reads.push(name);return rows[name].filter(row=>matches(row,query)).slice(skip,limit?skip+limit:undefined);}}]));
  return {rows,stores,reads};
}

test('compact inventory retains lot, quality and carrying-value evidence and never hides uncertain balances',()=>{
  const kept=[{id:'lot',product_id:'p',warehouse_id:'w',quantity:'3',total_value:'12',unit_cost:4,qc_status:'quarantine',lot_number:'A',batch_number:'B',expiry_date:'2026-11-01',production_order_id:'po',stock_origin:'production',updated_date:'now',notes:'unneeded list data'},...[
    [0,10],[2,0],[-1,-4],[null,0],['',0],[0,undefined],['invalid',0],['0.00001',0]
  ].map(([quantity,total_value],i)=>({id:String(i),quantity,total_value}))];
  const input=[...kept,{id:'exhausted',quantity:'0',total_value:0}],before=JSON.stringify(input);
  const output=compactStockBalances(input);
  assert.deepEqual(output.map(r=>r.id),kept.map(r=>r.id));
  assert.deepEqual(output[0],Object.fromEntries(Object.entries(kept[0]).filter(([k])=>k!=='notes')));
  assert.equal(JSON.stringify(input),before,'read projection cannot alter accounting history');
});

test('compact overview skips fleet and removed catalogue downloads while retaining role scopes and current quantities',async()=>{
  const f=fixture(),data=await inventoryOverview(admin,f.stores,{compact:true,includeRemoved:false});
  assert.deepEqual(data.vehicles,[]);assert.deepEqual(data.removedProducts,[]);assert.ok(!f.reads.includes('Vehicle'));
  assert.deepEqual(data.balances.map(b=>b.id),['a','b']);assert.equal(data.balances[0].quantity,12);
  assert.equal(data.products[0].selling_price,500);
  const scoped=await inventoryOverview(commercial,f.stores,{compact:true,includeRemoved:true});
  assert.deepEqual(scoped.products.map(p=>p.id),['p']);assert.deepEqual(scoped.balances.map(b=>b.id),['a']);assert.deepEqual(scoped.warehouses.map(w=>w.id),['mine']);assert.deepEqual(scoped.removedProducts,[]);
  const full=await inventoryOverview(admin,f.stores);
  assert.equal(full.vehicles.length,1);assert.equal(full.removedProducts.length,1);assert.equal(full.balances.length,3);assert.equal(full.balances[0].notes,'historical metadata');
});

test('unchanged responses omit the body but changed quantities and scoped data get new tags without persistent caching',async()=>{
  const f=fixture(),data=await inventoryOverview(admin,f.stores,{compact:true});
  const first=inventorySnapshotResponse(data),tag=first.headers.get('etag');
  assert.equal(first.status,200);assert.deepEqual(await first.json(),data);
  const same=inventorySnapshotResponse(data,tag);assert.equal(same.status,304);assert.equal(await same.text(),'');
  assert.equal(same.headers.get('cache-control'),'private, no-store');assert.match(same.headers.get('vary'),/Cookie.*Authorization/);
  f.rows.StockBalance[0].quantity=11;
  const changed=inventorySnapshotResponse(await inventoryOverview(admin,f.stores,{compact:true}),tag);assert.equal(changed.status,200);assert.notEqual(changed.headers.get('etag'),tag);
  const scoped=inventorySnapshotResponse(await inventoryOverview(commercial,f.stores,{compact:true}),changed.headers.get('etag'));assert.equal(scoped.status,200);assert.deepEqual((await scoped.json()).balances.map(b=>b.id),['a']);
});

test('real overview route authenticates and reads afresh before accepting an unchanged tag; denial cannot reuse it',async()=>{
  const out=await build({entryPoints:['src/app/api/inventory/overview/route.js'],bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'route-fixture',setup(b){
    const mocks={'@/server/auth':'export const authenticateRequest=async module=>{const f=globalThis.__speedRoute;f.auth++;if(f.denied)throw Object.assign(Error("Denied"),{status:403});return f.context;};export const apiError=e=>Response.json({error:e.message},{status:e.status||500});','@/server/entities':'export const serviceEntities=new Proxy({},{get:(_,key)=>globalThis.__speedRoute.stores[key]});'};
    b.onResolve({filter:/^@\/server\/(auth|entities)$/},a=>({path:a.path,namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));
  }}]});
  const {GET}=await import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));
  const f=fixture();globalThis.__speedRoute={...f,context:admin,auth:0};
  const request=tag=>new Request('http://localhost/api/inventory/overview?compact=1',{headers:tag?{'If-None-Match':tag}:{}});
  try{
    const first=await GET(request()),tag=first.headers.get('etag'),reads=f.reads.length;
    const same=await GET(request(tag));assert.equal(same.status,304);assert.ok(f.reads.length>reads);assert.equal(globalThis.__speedRoute.auth,2);
    f.rows.StockBalance[0].quantity=5;const changed=await GET(request(tag));assert.equal(changed.status,200);assert.equal((await changed.json()).balances[0].quantity,5);
    globalThis.__speedRoute.denied=true;const count=f.reads.length;assert.equal((await GET(request(tag))).status,403);assert.equal(f.reads.length,count);
  }finally{delete globalThis.__speedRoute;}
});

const require=createRequire(import.meta.url);
let compiledUI;
async function inventoryUI(){
  compiledUI||=build({entryPoints:['src/views/Inventory.jsx'],bundle:true,format:'cjs',platform:'node',write:false,plugins:[{name:'inventory-fixture',setup(b){
    b.onResolve({filter:/^react$/},a=>/[\\/]views[\\/]Inventory.jsx$/.test(a.importer)?{path:'hooks',namespace:'hooks'}:undefined);
    b.onLoad({filter:/.*/,namespace:'hooks'},()=>({contents:`import React from ${JSON.stringify(require.resolve('react'))};export default {...React,createElement:(tag,props,...children)=>{if(tag?.name==='GroupedItems')globalThis.__mobileUI.items=props;return React.createElement(tag,props,...children);}};export const useState=v=>globalThis.__mobileUI.state('inventory',v),useRef=v=>globalThis.__mobileUI.ref('inventory',v),useEffect=(fn,deps)=>globalThis.__mobileUI.effect('inventory',fn,deps),useMemo=(fn,deps)=>{const r=useRef({});if(!r.current.deps||deps.some((d,i)=>!Object.is(d,r.current.deps[i])))r.current={deps,value:fn()};return r.current.value;};export const useCallback=(fn,deps)=>useMemo(()=>fn,deps);export const lazy=React.lazy,Suspense=React.Suspense;`,resolveDir:process.cwd()}));
    const mocks={
      '@/lib/localization':'export const useLocaleRender=()=>{};',
      '@/hooks/useMenuBack':'export const useMenuBack=()=>()=>{};',
      '@/hooks/useCurrentUser':'export const useCurrentUser=()=>({role:"admin",principalRole:"admin",loading:false});',
      '@/lib/router':'export const useBack=()=>()=>{},useParams=()=>({}),useNavigate=()=>()=>{};export const useSearchParams=()=>[new URLSearchParams(globalThis.__mobileUI.query),()=>{}];',
      '@/lib/navigation-context':'export const usePageState=(_key,value)=>[value,()=>{}];',
      '@/components/ui/use-toast':'export const useToast=()=>({toast:()=>{}});',
      '@/components/inventory/GroupedItems':'export default function GroupedItems(){return null;}',
    };
    b.onResolve({filter:/^@\//},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));
  }}]}).then(out=>{const mod={exports:{}};new Function('require','module','exports',out.outputFiles[0].text)(require,mod,mod.exports);return mod.exports.default;});
  return compiledUI;
}

async function uiFixture(run){
  const Inventory=await inventoryUI(),r=hookRuntime(),previous={window:globalThis.window,document:globalThis.document,fetch:globalThis.fetch,now:Date.now};
  r.query='section=items&filter=all';r.requests=[];r.responses=[];r.time=100000;
  const target=new EventTarget(),doc=new EventTarget(),timers=new Set();doc.visibilityState='visible';
  target.setInterval=fn=>{timers.add(fn);return fn;};target.clearInterval=fn=>timers.delete(fn);
  globalThis.window=target;globalThis.document=doc;Date.now=()=>r.time;globalThis.__mobileUI=r;
  globalThis.fetch=async(url,options)=>{r.requests.push({url,options});const response=r.responses.shift();assert.ok(response,'unexpected inventory request');return typeof response==='function'?response():response;};
  r.paint=()=>{r.beforeRender();return Inventory();};r.tick=async()=>{r.time+=30000;for(const timer of timers)timer();await r.flush();r.paint();};
  r.data=quantity=>({products:[{id:'p',name:'Test',inventory_type:'finished_product'}],removedProducts:[],balances:[{id:'b',product_id:'p',warehouse_id:'w',quantity,total_value:quantity*3}],warehouses:[{id:'w',warehouse_type:'finished_goods'}],vehicles:[]});
  try{await run(r,target,doc);}finally{r.cleanup();globalThis.window=previous.window;globalThis.document=previous.document;globalThis.fetch=previous.fetch;Date.now=previous.now;delete globalThis.__mobileUI;}
}

test('inventory refresh retains unchanged objects, updates changed stock, and coalesces duplicate focus listeners',async()=>uiFixture(async(r,target)=>{
  r.responses.push(inventorySnapshotResponse(r.data(12)));r.paint();await r.flush();r.paint();
  const products=r.items.products;
  assert.equal(r.items.quantities.get('p'),12);assert.match(r.requests[0].url,/compact=1/);
  const unchanged=inventorySnapshotResponse(r.data(12),inventorySnapshotResponse(r.data(12)).headers.get('etag'));
  unchanged.json=()=>assert.fail('304 must not be parsed');r.responses.push(unchanged);await r.tick();
  assert.equal(r.items.products,products);assert.ok(r.requests[1].options.headers['If-None-Match']);assert.equal(r.requests[1].options.cache,'no-store');
  r.responses.push(inventorySnapshotResponse(r.data(8)));r.time+=6000;target.dispatchEvent(new Event('focus'));await r.flush();r.paint();
  assert.equal(r.requests.length,3);assert.equal(r.items.quantities.get('p'),8);
  target.dispatchEvent(new Event('focus'));await r.flush();assert.equal(r.requests.length,3,'immediate focus does not repeat the same download');
}));

test('failed inventory refreshes show an error and retry fetches current stock without losing the prior display',async()=>uiFixture(async(r)=>{
  r.responses.push(inventorySnapshotResponse(r.data(12)));r.paint();await r.flush();r.paint();
  r.responses.push(Response.json({error:'Connection unavailable'},{status:503}));await r.tick();
  const nodes=[];const visit=value=>{if(Array.isArray(value))value.forEach(visit);else if(value?.props){nodes.push(value);visit(value.props.children);}};visit(r.paint());
  assert.ok(nodes.some(n=>n.props.role==='alert'));assert.equal(r.items.quantities.get('p'),12);
  const retry=nodes.find(n=>n.type==='button'&&n.props.children==='Retry');assert.ok(retry);
  r.responses.push(inventorySnapshotResponse(r.data(4)));await retry.props.onClick();r.paint();
  assert.equal(r.items.quantities.get('p'),4);assert.ok(r.requests.at(-1).options.headers['If-None-Match']);
}));

test('catalogue saves invalidate validators and late aborted responses cannot replace new quantities',async()=>uiFixture(async(r)=>{
  r.responses.push(inventorySnapshotResponse(r.data(12)));r.paint();await r.flush();r.paint();
  let resolve;r.responses.push(()=>new Promise(done=>{resolve=done;}));r.time+=30000;window.dispatchEvent(new Event('focus'));await r.flush();
  const actions=r.items.renderActions(r.items.products[0]),save=actions.props.children.props.onSaved;
  r.responses.push(inventorySnapshotResponse(r.data(7)));save({...r.items.products[0],name:'Edited'});await r.flush();r.paint();
  assert.equal(r.requests.at(-1).options.headers['If-None-Match'],undefined);assert.ok(r.requests[1].options.signal.aborted);
  resolve(inventorySnapshotResponse(r.data(99)));await r.flush();r.paint();assert.equal(r.items.quantities.get('p'),7);
}));

test('removed-item mode uses its own validator and hidden tabs skip polling',async()=>uiFixture(async(r,_target,doc)=>{
  r.responses.push(inventorySnapshotResponse(r.data(12)));r.paint();await r.flush();r.paint();
  r.query+='&deleted=1';const deleted={...r.data(12),removedProducts:[{id:'old',name:'Removed',inventory_type:'finished_product',item_removed_at:'date'}]};r.responses.push(inventorySnapshotResponse(deleted));r.paint();await r.flush();r.paint();
  assert.match(r.requests.at(-1).url,/removed=1/);assert.equal(r.requests.at(-1).options.headers['If-None-Match'],undefined);assert.equal(r.items.products[0].id,'old');
  doc.visibilityState='hidden';await r.tick();assert.equal(r.requests.length,2);
}));

test('navigation avoids speculative downloads by default and preserves explicit prefetch and cancellation',async()=>{
  const out=await build({entryPoints:['src/lib/router.jsx'],bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'links',setup(b){
    b.onResolve({filter:/^react$|^next\/|navigation-context$|navigation-session$/},a=>({path:a.path,namespace:'mock'}));
    b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='react'?'export default {forwardRef:f=>f,createElement:(tag,props)=>({tag,props})};export const useCallback=f=>f,useEffect=()=>{};':a.path==='next/link'?'export default ()=>null;':a.path==='next/navigation'?'export const useRouter=()=>{},usePathname=()=>{},useSearchParams=()=>{},useParams=()=>{};':a.path.endsWith('navigation-context')?'export const useNavigationHistory=()=>{},useNavigationSession=()=>null;':'export const announceNavigation=()=>{throw Error("cancelled link navigated");};'}));
  }}]});const mod={exports:{}};new Function('require','module','exports',out.outputFiles[0].text)(require,mod,mod.exports);
  const {Link}=mod.exports;assert.equal(Link({to:'/sales'}).props.prefetch,false);assert.equal(Link({to:'/sales',prefetch:true}).props.prefetch,true);
  let cancelled=false;Link({to:'/sales',onNavigate:e=>e.preventDefault()}).props.onNavigate({preventDefault:()=>{cancelled=true;}});assert.ok(cancelled);
});
