import catalog from '../src/server/generated/schema.json' with {type:'json'};
import {splitRecord} from '../src/server/query.js';
import {batchTraceAction} from '../src/server/domain/batch-trace.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {fixture,functionRoute,request,user,date} from './helpers/cashier.mjs';
import {assemblyBuildAction} from '../src/server/domain/assembly-build.js';
import {salesOrderAction} from '../src/server/domain/sales-orders.js';
import {stockOnHandGroups} from '../src/lib/stock-on-hand.js';
import {inventoryStockIndex} from '../src/lib/inventory-workspace.js';
import {guardMutation} from '../src/server/access.js';
import {isAssemblyPackaging} from '../src/lib/assembly-materials.js';

async function setup(db){
  const f=await fixture(db),s=f.entities;
  await s.Employee.update('cashier',{role:'production_manager'});
  const create=s.AuditLog.create;
  s.AuditLog.create=async value=>{
    if(!value.id)return create(value);
    if(db)await db.query('INSERT INTO fixture_entity VALUES($1,$2,$3)',['AuditLog',value.id,JSON.stringify(value)]);
    else{if(f.rows.AuditLog.some(a=>a.id===value.id))throw Error('Duplicate audit');f.rows.AuditLog.push(structuredClone(value));}
    return structuredClone(value);
  };
  await s.StockBalance.deleteMany({});
  await s.Account.update('inventory',{account_type:'asset',normal_balance:'debit',balance:62400});
  const fg=await s.Account.create({name:'Finished inventory',account_number:'1320',account_type:'asset',normal_balance:'debit',is_active:true,is_posting:true,balance:0});
  const raw=await s.Warehouse.create({name:'Company materials',warehouse_type:'raw_material',is_active:true});
  const cold=await s.Warehouse.create({name:'Cold Room',warehouse_type:'cold_room',is_active:true});
  const milk=await s.Product.create({sku:'MILK-BUILD',name:'Milk',inventory_type:'raw_material',configuration_status:'ready',unit_of_measure:'kg',purchase_price:1200,current_cost:1000,inventory_account_id:'inventory',is_active:true});
  const cup=await s.Product.create({sku:'CUPS-BUILD',name:'500g cups',inventory_type:'packaging',configuration_status:'ready',unit_of_measure:'ea',purchase_price:25,current_cost:20,inventory_account_id:'inventory',is_active:true});
  const product=await s.Product.create({sku:'NATURE-BUILD',name:'Nature 500g',inventory_type:'assembly',configuration_status:'ready',unit_of_measure:'ea',selling_price:1000,shelf_life_days:14,inventory_account_id:fg.id,is_active:true,components:[
    {component_type:'inventory_part',product_id:milk.id,quantity:500,unit:'g',unit_cost:1,cost_source:'registered'},
    {component_type:'inventory_part',product_id:cup.id,quantity:1,unit:'ea',unit_cost:20,cost_source:'registered'},
  ]});
  const milkLot=await s.StockBalance.create({product_id:milk.id,warehouse_id:raw.id,quantity:60,unit_cost:1000,total_value:60000,lot_number:'MILK-OPEN',qc_status:'approved'});
  const cupLot=await s.StockBalance.create({product_id:cup.id,warehouse_id:raw.id,quantity:120,unit_cost:20,total_value:2400,lot_number:'CUPS-OPEN',qc_status:'approved'});
  for(const [name,store] of Object.entries(s))if(catalog[name]){
    const create=store.create;store.create=async value=>{const {record,extra}=splitRecord(value,catalog[name],{creating:true});return create({...record,...extra});};
    store.bulkCreate=async values=>{const result=[];for(const value of values)result.push(await store.create(value));return result;};
    store.bulkUpdate=async values=>{const result=[];for(const {id,...value} of values){const {record,extra}=splitRecord(value,catalog[name]);result.push(await store.update(id,{...record,...extra}));}return result;};
  }
  const body={date,warehouseId:cold.id,actualMaterials:[{product_id:milk.id,quantity:50,unit:'kg'}],rows:[{product_id:product.id,quantity:100}]};
  const call=value=>assemblyBuildAction(f.client,user,value);
  const preview=()=>call({...body,action:'previewAssemblyBuild'});
  const post=async()=>({...body,action:'postAssemblyBuild',requestKey:crypto.randomUUID(),fingerprint:(await preview()).fingerprint});
  return {...f,milk,cup,product,milkLot,cupLot,raw,cold,fg,body,call,preview,post};
}

test('100 finished units use explicit actual materials, calculate saved packaging and expose a read-only shortage check',async()=>{
  const f=await setup(),before=structuredClone(f.rows),p=await f.preview();
  assert.equal(p.materials.find(m=>m.product_id===f.milk.id).required,50);assert.equal(p.materials.find(m=>m.product_id===f.cup.id).required,100);
  assert.equal(p.can_build,true);assert.equal(p.total_cost,52000);assert.ok(p.outputs[0].expiry_date>date);assert.deepEqual(f.rows,before);
  const workspace=await f.call({action:'assemblyBuildWorkspace'});assert.equal(workspace.can_build,true);assert.ok(workspace.products.some(p=>p.id===f.product.id));
});

test('background reads keep the inventory revision stable while actual build inputs change it',async()=>{
  const f=await setup(),workspace=()=>f.call({action:'assemblyBuildWorkspace'}),first=await workspace();
  assert.match(first.inventory_revision,/^[a-f0-9]{64}$/);
  assert.equal((await workspace()).inventory_revision,first.inventory_revision);
  assert.equal((await f.preview()).inventory_revision,first.inventory_revision);
  await f.entities.StockBalance.update(f.milkLot.id,{quantity:59,total_value:59000});
  const stock=await workspace();assert.notEqual(stock.inventory_revision,first.inventory_revision);
  assert.equal((await f.preview()).inventory_revision,stock.inventory_revision);
  await f.entities.Product.update(f.product.id,{components:[{...f.product.components[0],quantity:450},f.product.components[1]]});
  const assembly=await workspace();assert.notEqual(assembly.inventory_revision,stock.inventory_revision);
  await f.entities.AccountingPeriod.update('period',{status:'closed'});
  assert.notEqual((await workspace()).inventory_revision,assembly.inventory_revision);
});

test('build consumes real carrying costs, posts a balanced asset transfer and receives immediately saleable finished goods exactly once',async()=>{
  const f=await setup(),s=f.entities,body=await f.post(),saved=await f.call(body),order=await s.ProductionOrder.get(saved.orders[0].id);
  assert.equal(order.status,'released');assert.equal(order.production_method,'assembly_build');assert.equal(order.actual_output,100);assert.equal(order.actual_cost_per_unit,520);const snapshot=await s.Recipe.get(order.recipe_id);assert.ok(snapshot);assert.equal(snapshot.recipe_kind,'assembly_build_snapshot');assert.equal(snapshot.status,'archived');assert.equal((await s.RecipeLine.filter({recipe_id:snapshot.id})).length,2);
  const output=(await s.StockBalance.list()).find(b=>b.production_order_id===order.id);assert.equal(output.qc_status,'approved');assert.equal(output.quantity,100);assert.equal(output.total_value,52000);assert.equal(output.unit_cost,520);assert.ok(output.expiry_date>date);
  assert.equal((await s.StockBalance.get(f.milkLot.id)).quantity,10);assert.equal((await s.StockBalance.get(f.cupLot.id)).quantity,20);
  assert.equal((await s.Account.get('inventory')).balance,10400);assert.equal((await s.Account.get(f.fg.id)).balance,52000);
  const lines=await s.JournalLine.list();assert.equal(lines.reduce((n,l)=>n+l.debit-l.credit,0),0);assert.equal((await s.TreasuryTransaction.list()).length,0);
  const trace=await batchTraceAction(f.client,user,{action:'batchTrace',productId:f.product.id,lotNumber:output.lot_number});assert.equal(trace.backward.ingredients.find(m=>m.material_id===f.milk.id).consumed_quantity,50);assert.equal(trace.backward.ingredients.find(m=>m.material_id===f.milk.id).lot_number,'MILK-OPEN');
  assert.equal((await f.call(body)).reused,true);assert.equal((await s.ProductionOrder.list()).length,1);assert.equal((await s.JournalEntry.list()).length,1);
  const admin={id:'gm',role:'admin'};f.client.auth.me=async()=>admin;const stock=await salesOrderAction(f.client,admin,{action:'salesOrderStock',sourceType:'company',date});assert.equal(stock.products.find(p=>p.id===f.product.id).available,100);
  await assert.rejects(f.call({...body,notes:'different notes'}),/different details/);
});

test('shared components are aggregated across products before allowing any stock movement',async()=>{
  const f=await setup(),s=f.entities,second=await s.Product.create({...f.product,id:undefined,name:'Nature small',components:[{component_type:'inventory_part',product_id:f.milk.id,quantity:0.25,unit:'kg',unit_cost:1000}]});
  const rows=[...f.body.rows,{product_id:second.id,quantity:100}],actualMaterials=[{product_id:f.milk.id,quantity:75,unit:'kg'}],p=await f.call({...f.body,rows,actualMaterials,action:'previewAssemblyBuild'});assert.equal(p.can_build,false);assert.equal(p.materials.find(m=>m.product_id===f.milk.id).missing,15);
  const before=structuredClone(f.rows);await assert.rejects(f.call({...f.body,rows,actualMaterials,action:'postAssemblyBuild',requestKey:crypto.randomUUID(),fingerprint:p.fingerprint}),/short/);assert.deepEqual(f.rows,before);
});

test('held, rejected, expired and delivery stock cannot satisfy an assembly build',async()=>{
  for(const mode of ['held','rejected','expired','delivery']){
    const f=await setup(),s=f.entities;
    if(mode==='held')await s.StockBalance.update(f.milkLot.id,{qc_status:'quarantine'});
    if(mode==='rejected')await s.StockBalance.update(f.milkLot.id,{qc_status:'rejected'});
    if(mode==='expired')await s.StockBalance.update(f.milkLot.id,{expiry_date:'2020-01-01'});
    if(mode==='delivery')await s.Warehouse.update(f.raw.id,{warehouse_type:'vehicle'});
    const p=await f.preview();assert.equal(p.can_build,false);assert.equal(p.materials.find(m=>m.product_id===f.milk.id).available,0);
  }
});

test('stale stock, assembly and expiry changes require a new check; forged quantity and output records cannot bypass it',async()=>{
  for(const mode of ['stock','assembly','expiry']){
    const f=await setup(),body=await f.post();
    if(mode==='stock')await f.entities.StockBalance.update(f.milkLot.id,{quantity:61,total_value:61000});
    if(mode==='assembly')await f.entities.Product.update(f.product.id,{components:[{...f.product.components[0],quantity:450},f.product.components[1]]});
    if(mode==='expiry')await f.entities.Product.update(f.product.id,{shelf_life_days:15});
    await assert.rejects(f.call(body),/changed/);assert.equal((await f.entities.JournalEntry.list()).length,0);
  }
  const f=await setup(),body=await f.post();await assert.rejects(f.call({...body,rows:[{product_id:f.product.id,quantity:99}]}),/changed/);
  for(const q of [0,-1,'',true,NaN,Infinity,0.1])await assert.rejects(f.call({...f.body,action:'previewAssemblyBuild',rows:[{product_id:f.product.id,quantity:q}]}));
  const context={user:{id:'gm',role:'admin'},role:'admin'};
  for(const [entity,value,existing] of [['ProductionOrder',{production_method:'assembly_build'}],['StockMovement',{document_type:'AssemblyBuild'}],['StockBalance',{assembly_build_id:'forged'}],['ProductionOrder',{status:'draft'},{production_method:'assembly_build'}]])assert.throws(()=>guardMutation(context,entity,'update',value,existing),/checked manufacturing/);
});

test('manufacturing roles, active staff and the checked feature grant are enforced; Warehouse can only preview',async()=>{
  const f=await setup(),s=f.entities,body=await f.post();
  await s.Employee.update('cashier',{role:'warehouse_manager'});assert.equal((await f.preview()).can_build,false);await assert.rejects(f.call(body),/production management/);
  for(const role of ['cashier','procurement','commercial','employee','driver','hotesse']){await s.Employee.update('cashier',{role});await assert.rejects(f.call({action:'assemblyBuildWorkspace'}));}
  await s.Employee.update('cashier',{role:'production_manager',status:'inactive'});await assert.rejects(f.preview(),/active/);
  await s.Employee.update('cashier',{status:'active'});f.client.auth.assertModule=()=>{throw Error('Manufacturing grant revoked');};await assert.rejects(f.preview(),/revoked/);
});

test('shared carrying-value cents are retained when multiple products consume a partial lot',async()=>{
  const f=await setup(),s=f.entities;await s.StockBalance.update(f.milkLot.id,{quantity:3,total_value:1,unit_cost:1/3});
  const second=await s.Product.create({...f.product,id:undefined,name:'Another size'});const rows=[{product_id:f.product.id,quantity:1},{product_id:second.id,quantity:2}];
  const actualMaterials=[{product_id:f.milk.id,quantity:1.5,unit:'kg'}],p=await f.call({...f.body,rows,actualMaterials,action:'previewAssemblyBuild'});await f.call({...f.body,rows,actualMaterials,action:'postAssemblyBuild',requestKey:crypto.randomUUID(),fingerprint:p.fingerprint});
  assert.equal((await s.StockBalance.get(f.milkLot.id)).quantity,1.5);assert.equal((await s.StockBalance.get(f.milkLot.id)).total_value,0.5);
  const orders=await s.ProductionOrder.list();assert.equal(orders.reduce((n,o)=>n+o.total_material_cost,0),60.5);const lines=await s.JournalLine.list();assert.equal(lines.reduce((n,l)=>n+l.debit-l.credit,0),0);
});

test('labour or overhead costs need an explicit expense allocation and never create a treasury payment',async()=>{
  const f=await setup(),s=f.entities;await s.Product.update(f.product.id,{components:[...f.product.components,{component_type:'other',product_name:'Labour',quantity:1,unit:'unit',unit_cost:5,cost_source:'manual'}]});
  const p=await f.preview();assert.equal(p.can_build,false);assert.equal(p.overhead,500);
  const input={...f.body,overheadAccountId:'expense'},checked=await f.call({...input,action:'previewAssemblyBuild'});assert.equal(checked.total_cost,52500);assert.equal(checked.can_build,true);
  await f.call({...input,action:'postAssemblyBuild',fingerprint:checked.fingerprint,requestKey:crypto.randomUUID()});assert.equal((await s.Account.get('expense')).balance,-500);assert.equal((await s.TreasuryTransaction.list()).length,0);
});

test('missing shelf life and closed accounting periods block manufacturing while explicit future expiry works',async()=>{
  const f=await setup(),s=f.entities;await s.Product.update(f.product.id,{shelf_life_days:0});await assert.rejects(f.preview(),/shelf life/);
  const expiry=new Date(date+'T12:00:00Z');expiry.setUTCDate(expiry.getUTCDate()+21);const rows=[{...f.body.rows[0],expiry_date:expiry.toISOString().slice(0,10)}];
  const p=await f.call({...f.body,rows,action:'previewAssemblyBuild'});assert.equal(p.can_build,true);
  await s.AccountingPeriod.update('period',{status:'closed'});const closed=await f.call({...f.body,rows,action:'previewAssemblyBuild'});assert.equal(closed.can_build,false);assert.match(closed.reasons.join(' '),/open accounting/);
});

test('the real HTTP transaction rolls back components, finished stock, orders, sequence and journal on a late failure, then retries once',async()=>{
  const db=new PGlite();try{
    const f=await setup(db),s=f.entities,route=await functionRoute(),body=await f.post();globalThis.__cashierClient=f.client;
    globalThis.__cashierTransaction=async fn=>{await db.exec('BEGIN');try{const result=await fn();await db.exec('COMMIT');return result;}catch(e){await db.exec('ROLLBACK');throw e;}};
    const before=(await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows,create=s.AuditLog.create;
    s.AuditLog.create=async value=>{if(value.action==='build_assemblies')throw Error('Audit unavailable');return create(value);};
    const post=()=>route(request(body),{params:Promise.resolve({name:'fieldOps'})});assert.equal((await post()).status,400);assert.deepEqual((await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows,before);
    s.AuditLog.create=create;let response=await post();assert.equal(response.status,200,JSON.stringify(await response.clone().json()));assert.equal((await post()).status,200);assert.equal((await s.ProductionOrder.list()).length,1);assert.equal((await s.JournalEntry.list()).length,1);
  }finally{delete globalThis.__cashierClient;delete globalThis.__cashierTransaction;await db.close();}
});


test('a positive-cost component with a missing carrying value must be reconciled before building',async()=>{
 const f=await setup();await f.entities.StockBalance.update(f.milkLot.id,{total_value:0});await assert.rejects(f.preview(),/Reconcile invalid lot/);assert.equal((await f.entities.JournalEntry.list()).length,0);assert.equal((await f.entities.ProductionOrder.list()).length,0);
});


test('assembly workspace includes all active finished products across pages and flags unfinished setup without permitting builds',async()=>{
 const f=await setup(),s=f.entities,created=[];
 for(let i=0;i<215;i++)created.push(await s.Product.create({...f.product,id:undefined,sku:'CAT-'+i,name:'YOLA Brassé '+i,product_family:'Yaourt brassé',size:i%2?'500 g':'1 kg',configuration_status:i===214?'draft':'ready',components:i===213?[]:f.product.components}));
 const inactive=await s.Product.create({...f.product,id:undefined,is_active:false}),removed=await s.Product.create({...f.product,id:undefined,item_removed_at:'2026-11-05'});
 const before=structuredClone(f.rows),workspace=await f.call({action:'assemblyBuildWorkspace'}),listed=new Map(workspace.products.map(p=>[p.id,p]));
 for(const product of [f.product,...created])assert.ok(listed.has(product.id),product.name);
 assert.equal(listed.has(inactive.id),false);assert.equal(listed.has(removed.id),false);assert.equal(listed.has(f.milk.id),false);assert.equal(listed.has(f.cup.id),false);
 assert.equal(listed.get(f.product.id).assembly_ready,true);assert.equal(listed.get(created[213].id).assembly_ready,false);assert.equal(listed.get(created[214].id).assembly_ready,false);assert.equal(listed.get(created[214].id).size,'1 kg');
 for(const product of created.slice(213))await assert.rejects(f.call({...f.body,action:'previewAssemblyBuild',rows:[{product_id:product.id,quantity:1}]}),/active finished product with saved assembly/);
 assert.deepEqual(f.rows,before);
});


test('assembly quantities reconcile with Inventory across raw, packaging, held, expired, delivery and unknown locations',async()=>{
 const f=await setup(),s=f.entities;
 const wip=await s.Warehouse.create({code:'WIP-ASSEMBLY',name:'In production',warehouse_type:'wip',is_active:true});
 const pack=await s.Warehouse.create({code:'PACK-ASSEMBLY',name:'Packaging store',warehouse_type:'packaging',is_active:true});
 for(const [qty,warehouse_id,qc_status,expiry_date] of [[10,f.raw.id,'pending',''],[5,f.raw.id,'approved','2020-01-01'],[7,'van-stock','approved',''],[4,wip.id,'approved',''],[3,'unknown','approved',''],[10,pack.id,'approved','']])await s.StockBalance.create({product_id:f.milk.id,quantity:qty,warehouse_id,qc_status,expiry_date,total_value:qty*1000,unit_cost:1000,lot_number:'EXTRA-'+qty+'-'+warehouse_id});
 const products=await s.Product.list(),balances=await s.StockBalance.list(),warehouses=await s.Warehouse.list(),p=await f.preview(),m=p.materials.find(m=>m.product_id===f.milk.id);
 const inventory=stockOnHandGroups(products,balances,warehouses,{date}).find(g=>g.product.id===f.milk.id),index=inventoryStockIndex(balances,warehouses,date,products);
 assert.equal(m.on_hand,99);assert.equal(m.on_hand,inventory.quantity);assert.equal(m.on_hand,index.quantities.get(f.milk.id));assert.equal(m.available,70);assert.equal(m.available,inventory.available);assert.equal(m.available,index.availableQuantities.get(f.milk.id));assert.equal(m.excluded,29);assert.equal(m.on_hand_after,49);assert.equal(m.required,50);assert.equal(m.unit,'kg');assert.equal(p.can_build,true);
 assert.equal(m.lots.reduce((n,l)=>n+l.quantity,0),m.on_hand);assert.ok(m.lots.some(l=>l.status==='On quality hold'));assert.ok(m.lots.some(l=>l.status==='Out for delivery'));assert.ok(m.lots.some(l=>l.status==='Location unavailable'));
 const saved=await f.call({...f.body,action:'postAssemblyBuild',requestKey:crypto.randomUUID(),fingerprint:p.fingerprint});
 const after=stockOnHandGroups(await s.Product.list(),await s.StockBalance.list(),warehouses,{date}).find(g=>g.product.id===f.milk.id);assert.equal(after.quantity,m.on_hand_after);assert.equal(after.available,m.remaining);assert.equal(saved.materials.find(m=>m.product_id===f.milk.id).on_hand_after,after.quantity);
});

test('all stock pages contribute to the assembly check and the completed deduction matches on-hand exactly',async()=>{
 const f=await setup(),s=f.entities;
 for(let i=0;i<225;i++)await s.StockBalance.create({product_id:f.milk.id,warehouse_id:f.raw.id,quantity:0.1,total_value:100,unit_cost:1000,qc_status:'approved',expiry_date:date,lot_number:'SMALL-'+i});
 const p=await f.preview(),m=p.materials.find(m=>m.product_id===f.milk.id);assert.equal(m.available,82.5);assert.equal(m.on_hand,82.5);assert.equal(m.lots.length,226);
 await f.call({...f.body,action:'postAssemblyBuild',requestKey:crypto.randomUUID(),fingerprint:p.fingerprint});const remaining=(await s.StockBalance.list()).filter(b=>b.product_id===f.milk.id);assert.equal(Math.round(remaining.reduce((n,b)=>n+b.quantity,0)*1000)/1000,32.5);assert.equal(remaining.reduce((n,b)=>n+b.total_value,0),32500);
});

test('approved on-hand subassembly stock can be consumed even when its future manufacturing setup is incomplete',async()=>{
 const f=await setup(),s=f.entities;await s.Product.update(f.milk.id,{inventory_type:'assembly',configuration_status:'draft',components:[],shelf_life_days:14});
 await s.Product.update(f.product.id,{components:[{...f.product.components[0],component_type:'assembly'},f.product.components[1]]});
 const p=await f.preview();assert.equal(p.can_build,true);assert.equal(p.materials.find(m=>m.product_id===f.milk.id).available,60);await f.call(await f.post());assert.equal((await s.StockBalance.get(f.milkLot.id)).quantity,10);
});

test('invalid expiry dates and count anomalies cannot inflate available assembly stock or be repaired by a build',async()=>{
 const f=await setup(),s=f.entities;await s.StockBalance.update(f.milkLot.id,{expiry_date:'2099-13-01'});let p=await f.preview(),m=p.materials.find(m=>m.product_id===f.milk.id);assert.equal(m.on_hand,60);assert.equal(m.available,0);assert.equal(p.can_build,false);assert.equal(m.on_hand_after,null);
 await s.StockBalance.update(f.milkLot.id,{expiry_date:''});await s.StockBalance.create({product_id:f.milk.id,warehouse_id:f.raw.id,quantity:-5,total_value:-5000,unit_cost:1000,qc_status:'approved'});p=await f.preview();assert.equal(p.can_build,false);assert.match(p.reasons.join(' '),/reconciliation/);m=p.materials.find(m=>m.product_id===f.milk.id);assert.equal(m.count_issue,true);assert.equal(m.on_hand,55);assert.equal(m.on_hand_after,null);
 await assert.rejects(f.call({...f.body,action:'postAssemblyBuild',requestKey:crypto.randomUUID(),fingerprint:p.fingerprint}),/reconciliation/);assert.equal((await s.StockBalance.get(f.milkLot.id)).quantity,60);assert.equal((await s.JournalEntry.list()).length,0);
});

test('new component receipts and finished-product sales invalidate old build quantities and completed totals remain exact',async()=>{
 const f=await setup(),s=f.entities;
 const oldFinished=await s.StockBalance.create({product_id:f.product.id,warehouse_id:f.cold.id,quantity:14,total_value:7280,unit_cost:520,qc_status:'approved',expiry_date:'2099-01-01'});
 const p=await f.preview();assert.equal(p.outputs[0].on_hand_before,14);assert.equal(p.outputs[0].on_hand_after,114);assert.equal((await f.call({action:'assemblyBuildWorkspace'})).products.find(p=>p.id===f.product.id).on_hand,14);
 await s.StockBalance.update(oldFinished.id,{quantity:10,total_value:5200});await assert.rejects(f.call({...f.body,action:'postAssemblyBuild',requestKey:crypto.randomUUID(),fingerprint:p.fingerprint}),/changed/);
 await s.StockBalance.update(f.milkLot.id,{quantity:70,total_value:70000});const latest=await f.preview();assert.equal(latest.materials.find(m=>m.product_id===f.milk.id).on_hand,70);assert.equal(latest.outputs[0].on_hand_before,10);
 const saved=await f.call({...f.body,action:'postAssemblyBuild',requestKey:crypto.randomUUID(),fingerprint:latest.fingerprint});assert.equal(saved.orders[0].on_hand_after,110);assert.equal((await s.StockBalance.filter({product_id:f.product.id})).reduce((n,b)=>n+b.quantity,0),110);
});

test('crossing the Cameroon business-date boundary expires stock and invalidates the earlier review even without database edits',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date(date+'T22:59:00Z')});
 const f=await setup(),s=f.entities;await s.StockBalance.update(f.milkLot.id,{expiry_date:date});await s.StockBalance.create({product_id:f.milk.id,warehouse_id:f.raw.id,quantity:80,total_value:80000,unit_cost:1000,qc_status:'approved',expiry_date:'2099-12-31',lot_number:'FRESH'});
 const before=await f.preview(),workspace=await f.call({action:'assemblyBuildWorkspace'});assert.equal(before.materials.find(m=>m.product_id===f.milk.id).available,140);
 t.mock.timers.tick(120000);const after=await f.preview();assert.equal(after.materials.find(m=>m.product_id===f.milk.id).available,80);assert.equal(after.can_build,true);assert.notEqual(after.fingerprint,before.fingerprint);assert.notEqual((await f.call({action:'assemblyBuildWorkspace'})).inventory_revision,workspace.inventory_revision);
 await assert.rejects(f.call({...f.body,action:'postAssemblyBuild',requestKey:crypto.randomUUID(),fingerprint:before.fingerprint}),/changed/);assert.equal((await s.StockBalance.get(f.milkLot.id)).quantity,60);
});

test('30 finished products consume the actual 12 kg of milk and automatic 30 cups and 30 stickers, leaving unused sugar untouched',async()=>{
 const f=await setup(),s=f.entities;
 const sticker=await s.Product.create({sku:'ACTUAL-STICKER',name:'Nature label',inventory_type:'raw_material',material_group:'Packaging',configuration_status:'ready',unit_of_measure:'ea',purchase_price:5,inventory_account_id:'inventory',is_active:true});
 const sugar=await s.Product.create({sku:'ACTUAL-SUGAR',name:'Sugar',inventory_type:'raw_material',configuration_status:'ready',unit_of_measure:'kg',purchase_price:500,inventory_account_id:'inventory',is_active:true});
 const stickerLot=await s.StockBalance.create({product_id:sticker.id,warehouse_id:f.raw.id,quantity:100,total_value:500,unit_cost:5,qc_status:'approved'});
 const sugarLot=await s.StockBalance.create({product_id:sugar.id,warehouse_id:f.raw.id,quantity:20,total_value:10000,unit_cost:500,qc_status:'approved'});
 await s.Product.update(f.product.id,{components:[...f.product.components,{component_type:'inventory_part',product_id:sticker.id,quantity:1,unit:'ea',unit_cost:5,cost_source:'registered',recover_on_exchange:false},{component_type:'inventory_part',product_id:sugar.id,quantity:0.05,unit:'kg',unit_cost:500,cost_source:'registered'}]});
 const input={...f.body,rows:[{product_id:f.product.id,quantity:30}],actualMaterials:[{product_id:f.milk.id,quantity:12000,unit:'g'}]};
 const p=await f.call({...input,action:'previewAssemblyBuild'});
 assert.equal(p.can_build,true);assert.equal(p.materials.find(m=>m.product_id===f.milk.id).required,12);assert.equal(p.materials.find(m=>m.product_id===f.milk.id).consumption_method,'actual');
 assert.equal(p.materials.find(m=>m.product_id===f.cup.id).required,30);assert.equal(p.materials.find(m=>m.product_id===sticker.id).required,30);assert.equal(p.materials.find(m=>m.product_id===sticker.id).consumption_method,'automatic_packaging');assert.equal(p.materials.some(m=>m.product_id===sugar.id),false);
 const saved=await f.call({...input,action:'postAssemblyBuild',requestKey:crypto.randomUUID(),fingerprint:p.fingerprint});
 assert.equal(saved.total_cost,12750);assert.equal((await s.StockBalance.get(f.milkLot.id)).quantity,48);assert.equal((await s.StockBalance.get(f.cupLot.id)).quantity,90);assert.equal((await s.StockBalance.get(stickerLot.id)).quantity,70);assert.equal((await s.StockBalance.get(sugarLot.id)).quantity,20);
 const order=await s.ProductionOrder.get(saved.orders[0].id),materials=await s.ProductionMaterial.filter({production_order_id:order.id}),milk=materials.find(m=>m.material_id===f.milk.id);
 assert.deepEqual([milk.standard_quantity,milk.consumed_quantity,milk.total_cost],[15,12,12000]);assert.equal(order.actual_cost_per_unit,425);assert.equal(order.assembly_build_consumption_mode,'actual_materials');assert.equal(order.assembly_build_components.find(c=>c.product_id===f.milk.id).quantity,0.4);assert.equal(order.assembly_build_components.find(c=>c.product_id===sticker.id).recover_on_exchange,false);assert.ok(order.assembly_build_template_components.some(c=>c.product_id===sugar.id));assert.equal(order.assembly_build_components.some(c=>c.product_id===sugar.id),false);
 const workspace=await f.call({action:'assemblyBuildWorkspace'});assert.ok(workspace.materials.some(m=>m.id===sugar.id));assert.equal(workspace.materials.some(m=>m.id===sticker.id||m.id===f.cup.id),false);
 const journal=await s.JournalLine.filter({journal_id:saved.journal_id});assert.equal(journal.reduce((n,l)=>n+l.debit,0),12750);assert.equal(journal.reduce((n,l)=>n+l.credit,0),12750);
});

test('mixed output sizes share actual quantities and every carrying-value cent while flavor goes only to its mapped finished product',async()=>{
 const f=await setup(),s=f.entities;
 await s.StockBalance.update(f.milkLot.id,{total_value:1,unit_cost:1/60});
 const flavor=await s.Product.create({sku:'ACTUAL-FLAVOR',name:'Pineapple flavor',inventory_type:'additive',configuration_status:'ready',unit_of_measure:'l',purchase_price:100,inventory_account_id:'inventory',is_active:true});
 await s.StockBalance.create({product_id:flavor.id,warehouse_id:f.raw.id,quantity:1,total_value:100,unit_cost:100,qc_status:'approved'});
 const second=await s.Product.create({...f.product,id:undefined,name:'Pineapple 250g',components:[{...f.product.components[0],quantity:250},f.product.components[1],{component_type:'inventory_part',product_id:flavor.id,quantity:10,unit:'ml',unit_cost:0.1,cost_source:'registered'}]});
 const input={...f.body,rows:[{product_id:f.product.id,quantity:30},{product_id:second.id,quantity:20}],actualMaterials:[{product_id:f.milk.id,quantity:12.001,unit:'kg'},{product_id:flavor.id,quantity:200,unit:'ml'}]};
 const p=await f.call({...input,action:'previewAssemblyBuild'}),saved=await f.call({...input,action:'postAssemblyBuild',requestKey:crypto.randomUUID(),fingerprint:p.fingerprint});
 const materials=await s.ProductionMaterial.list(),made=await s.ProductionOrder.list(),large=made.find(o=>o.product_id===f.product.id),small=made.find(o=>o.product_id===second.id);
 assert.equal(saved.total_cost,1020.2);assert.equal(materials.filter(m=>m.material_id===f.milk.id).reduce((n,m)=>Math.round((n+m.consumed_quantity)*1000)/1000,0),12.001);
 assert.equal(materials.find(m=>m.production_order_id===large.id&&m.material_id===f.milk.id).consumed_quantity,9.001);assert.equal(materials.find(m=>m.production_order_id===small.id&&m.material_id===f.milk.id).consumed_quantity,3);
 assert.equal(materials.filter(m=>m.material_id===flavor.id).length,1);assert.equal(materials.find(m=>m.material_id===flavor.id).production_order_id,small.id);assert.equal(large.total_material_cost,600.15);assert.equal(small.total_material_cost,420.05);
 assert.equal((await s.StockBalance.get(f.milkLot.id)).quantity,47.999);assert.equal((await s.StockBalance.get(f.milkLot.id)).total_value,0.8);assert.equal((await s.JournalLine.list()).reduce((n,l)=>Math.round((n+l.debit-l.credit)*100)/100,0),0);
});

test('a material with no mapped output cannot be silently charged to a different flavor or product',async()=>{
 const f=await setup(),s=f.entities,flavor=await s.Product.create({sku:'UNMAPPED-FLAVOR',name:'Pineapple',inventory_type:'raw_material',configuration_status:'ready',unit_of_measure:'l',inventory_account_id:'inventory',purchase_price:100,is_active:true});
 const input={...f.body,actualMaterials:[...f.body.actualMaterials,{product_id:flavor.id,quantity:0.1,unit:'l'}]};
 await assert.rejects(f.call({...input,action:'previewAssemblyBuild'}),/Add Pineapple to a selected assembly/);assert.equal((await s.JournalEntry.list()).length,0);
});

test('new builds require deliberate valid actual material input and cannot inject packaging, inactive items or duplicate materials',async()=>{
 const f=await setup(),s=f.entities;
 for(const actualMaterials of [undefined,[],null,[{product_id:f.milk.id,quantity:0,unit:'kg'}],[{product_id:f.milk.id,quantity:true,unit:'kg'}],[{product_id:f.milk.id,quantity:1.2345,unit:'kg'}],[{product_id:f.milk.id,quantity:0.5,unit:'g'}],[{product_id:f.milk.id,quantity:50,unit:'l'}],[{product_id:f.milk.id,quantity:50}],[...f.body.actualMaterials,...f.body.actualMaterials],[{product_id:f.cup.id,quantity:30,unit:'ea'}],[{product_id:'missing',quantity:50,unit:'kg'}]]){
  await assert.rejects(f.call({...f.body,actualMaterials,action:'previewAssemblyBuild'}));
 }
 await s.Product.update(f.milk.id,{is_active:false});await assert.rejects(f.preview(),/active raw material/);assert.equal((await s.JournalEntry.list()).length,0);
});

test('changing the actual quantity or input unit after review requires a fresh fingerprint and post retry consumes once',async()=>{
 const f=await setup(),body=await f.post();
 await assert.rejects(f.call({...body,actualMaterials:[{product_id:f.milk.id,quantity:49,unit:'kg'}]}),/changed/);
 await assert.rejects(f.call({...body,actualMaterials:[{product_id:f.milk.id,quantity:50000,unit:'g'}]}),/changed/);
 assert.equal((await f.entities.StockBalance.get(f.milkLot.id)).quantity,60);
 await f.call(body);assert.equal((await f.call(body)).reused,true);assert.equal((await f.entities.StockBalance.get(f.milkLot.id)).quantity,10);
});

test('automatic packaging is based on explicit classification and never an ingredient name',()=>{
 assert.equal(isAssemblyPackaging({inventory_type:'raw_material',name:'Milk stickers flavor'}),false);
 for(const record of [{inventory_type:'packaging'},{inventory_type:'raw_material',material_group:'Packaging'},{inventory_type:'raw_material',category:'Emballages'},{inventory_type:'raw_material',category:'Stickers'},{inventory_type:'raw_material',attributes:[{name:'Packaging type',value:'Yogurt cups'}]}])assert.equal(isAssemblyPackaging(record),true);
 assert.equal(isAssemblyPackaging({inventory_type:'assembly',category:'Packaging'}),false);
});

test('actual quantities validate precision after conversion and enforce whole units for counted materials',async()=>{
 const f=await setup(),s=f.entities;
 await s.Product.update(f.milk.id,{unit_of_measure:'g'});
 const p=await f.call({...f.body,actualMaterials:[{product_id:f.milk.id,quantity:0.0005,unit:'kg'}],action:'previewAssemblyBuild'});
 assert.equal(p.materials.find(m=>m.product_id===f.milk.id).required,0.5);
 await s.Product.update(f.milk.id,{unit_of_measure:'ea'});
 await s.Product.update(f.product.id,{components:[{...f.product.components[0],quantity:1,unit:'ea'},f.product.components[1]]});
 await assert.rejects(f.call({...f.body,actualMaterials:[{product_id:f.milk.id,quantity:0.5,unit:'ea'}],action:'previewAssemblyBuild'}),/whole units/);
 await assert.rejects(f.call({...f.body,actualMaterials:[{product_id:f.milk.id,quantity:1e-12,unit:'ea'}],action:'previewAssemblyBuild'}),/three decimal places/);
});
