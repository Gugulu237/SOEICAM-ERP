import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {build} from 'esbuild';
import {fixture} from './helpers/cashier.mjs';
import {itemLifecycle} from '../src/server/domain/item-lifecycle.js';
import {inventoryOverview} from '../src/server/domain/inventory-overview.js';
import {componentCatalog,validateProductComponents} from '../src/server/domain/assembly-components.js';
import {guardMutation} from '../src/server/access.js';
const context={user:{id:'gm',role:'admin',full_name:'GM'},role:'admin',employee:null};
const input=changes=>({action:'remove',revision:0,requestKey:crypto.randomUUID(),reason:'Obsolete duplicate item',...changes});
async function setup(db){
 const f=await fixture(db),s=f.entities;
 const create=s.AuditLog.create;s.AuditLog.create=async value=>{
  if(!value.id)return create(value);
  if(db)await db.query('INSERT INTO fixture_entity VALUES($1,$2,$3)',['AuditLog',value.id,JSON.stringify(value)]);
  else f.rows.AuditLog.push(structuredClone(value));
  return structuredClone(value);
 };
 s.FixedAsset={filter:async()=>[]};
 const item=await s.Product.create({name:'Obsolete ingredient',sku:'OLD-MILK',inventory_type:'raw_material',is_active:true,unit_of_measure:'kg',current_cost:100});
 return {...f,item};
}
test('catalogue deletion retains historical IDs, hides the item from new selections and is retry-safe; restoration is inactive',async()=>{
 const f=await setup(),s=f.entities,item=f.item;
 await s.StockBalance.create({product_id:item.id,warehouse_id:'factory',quantity:0,total_value:0,unit_cost:100,lot_number:'OLD-LOT'});
 await s.StockMovement.create({product_id:item.id,quantity:10,document_type:'SalesOrder',document_id:'historical-sale'});
 const history=structuredClone({stock:await s.StockBalance.list(),movements:await s.StockMovement.list(),journals:await s.JournalEntry.list()});
 const body=input(),result=await itemLifecycle(context,s,item.id,body);
 assert.equal(result.item.is_active,false);assert.ok(result.item.item_removed_at);assert.equal(result.item.item_lifecycle_revision,1);
 assert.equal((await s.Product.get(item.id)).sku,'OLD-MILK');
 assert.deepEqual({stock:await s.StockBalance.list(),movements:await s.StockMovement.list(),journals:await s.JournalEntry.list()},history);
 const audit=await s.AuditLog.list();assert.equal(audit.at(-1).user_id,'gm');assert.equal(audit.at(-1).action,'remove_item');
 assert.equal((await itemLifecycle(context,s,item.id,body)).reused,true);assert.equal((await s.AuditLog.list()).length,audit.length);
 await assert.rejects(itemLifecycle(context,s,item.id,{...body,reason:'Different details'}),{status:409});
 const overview=await inventoryOverview(context,s);assert.ok(!overview.products.some(p=>p.id===item.id));assert.ok(overview.removedProducts.some(p=>p.id===item.id));
 assert.ok(!(await componentCatalog(s)).products.some(p=>p.id===item.id));
 await assert.rejects(validateProductComponents(s,{inventory_type:'assembly',components:[{product_id:item.id,quantity:1,unit_cost:100,unit:'kg'}]},{id:'assembly',inventory_type:'assembly',components:[{product_id:item.id}]}),/Restore deleted component/);
 const restored=await itemLifecycle(context,s,item.id,input({action:'restore',revision:1,reason:'Reviewed for future use'}));
 assert.equal(restored.item.item_removed_at,null);assert.equal(restored.item.is_active,false);assert.equal(restored.item.item_lifecycle_revision,2);
 assert.ok((await inventoryOverview(context,s)).products.some(p=>p.id===item.id));
});
test('each physical lot and carrying value is checked across warehouses, including custody, negative and invalid balances',async()=>{
 for(const values of [{quantity:1,total_value:100},{quantity:0,total_value:1},{quantity:-1,total_value:-100},{quantity:'invalid',total_value:0}]){
  const f=await setup(),s=f.entities;await s.StockBalance.create({product_id:f.item.id,warehouse_id:'custody',...values});
  if(values.quantity===1)await s.StockBalance.create({product_id:f.item.id,warehouse_id:'factory',quantity:-1,total_value:-100});
  const before=structuredClone(f.rows);
  await assert.rejects(itemLifecycle(context,s,f.item.id,input()),/still has stock or inventory value/);assert.deepEqual(f.rows,before);
 }
});
test('active assemblies, recipe materials, substitute materials and yogurt output variants prevent removal',async()=>{
 for(const kind of ['assembly','recipe material','recipe substitute','yogurt output']){
  const f=await setup(),s=f.entities,id=f.item.id;
  if(kind==='assembly')await s.Product.create({name:'Assembly',is_active:true,components:[{product_id:id}]});
  else{
   const recipe=await s.Recipe.create({status:'approved',product_id:'other-product',...(kind==='yogurt output'?{yogurt_config:{outputs:[{product_id:id}]}}:{})});
   if(kind!=='yogurt output')await s.RecipeLine.create({recipe_id:recipe.id,...(kind==='recipe substitute'?{material_id:'other',substitute_material_id:id}:{material_id:id})});
  }
  const before=structuredClone(f.rows);await assert.rejects(itemLifecycle(context,s,id,input()),/active assembly or recipe/);assert.deepEqual(f.rows,before);
 }
});
test('pending production, sales, purchases and field sales retain their item until resolved',async()=>{
 for(const kind of ['production material','production variant','sale','purchase','field sale']){
  const f=await setup(),s=f.entities,id=f.item.id;
  if(kind==='production material'){const order=await s.ProductionOrder.create({product_id:'other',status:'approved'});await s.ProductionMaterial.create({production_order_id:order.id,material_id:id});}
  if(kind==='production variant')await s.ProductionOrder.create({product_id:'other',status:'in_production',yogurt_config:{outputs:[{product_id:id}]}});
  if(kind==='sale'){const order=await s.SalesOrder.create({status:'confirmed'});await s.SalesOrderLine.create({order_id:order.id,product_id:id});}
  if(kind==='purchase'){const order=await s.PurchaseOrder.create({status:'approved'});await s.PurchaseOrderLine.create({po_id:order.id,product_id:id});}
  if(kind==='field sale'){const order=await s.FieldSale.create({status:'draft'});await s.FieldSaleLine.create({field_sale_id:order.id,product_id:id});}
  const before=structuredClone(f.rows);await assert.rejects(itemLifecycle(context,s,id,input()),/Complete or cancel/);assert.deepEqual(f.rows,before);
 }
});
test('archived recipes and settled operations remain as history without blocking catalogue deletion',async()=>{
 const f=await setup(),s=f.entities,id=f.item.id;
 await s.Recipe.create({product_id:id,status:'superseded'});
 await s.ProductionOrder.create({product_id:id,status:'released'});
 const order=await s.SalesOrder.create({status:'invoiced'});await s.SalesOrderLine.create({order_id:order.id,product_id:id});
 assert.ok((await itemLifecycle(context,s,id,input())).item.item_removed_at);
});
test('only authorized catalogue managers can delete; inactive staff, disabled modules and stale revisions fail before writes',async()=>{
 const f=await setup(),s=f.entities;
 for(const role of ['cashier','employee','driver','commercial']){
  await assert.rejects(itemLifecycle({user:{id:'staff-login',role:'user'},role,employee:{id:'staff',role,status:'active',allowed_modules:['inventory']}},s,f.item.id,input()),{status:403});
 }
 await assert.rejects(itemLifecycle({...context,employee:{role:'admin',status:'inactive'}},s,f.item.id,input()),{status:403});
 await assert.rejects(itemLifecycle({...context,roleCatalogue:{roles:{admin:{modules:['admin','employees']}}}},s,f.item.id,input()),{status:403});
 await assert.rejects(itemLifecycle(context,s,f.item.id,input({revision:2})),{status:409});
 for(const changes of [{reason:' '},{requestKey:'bad'},{action:'purge'},{revision:-1}])await assert.rejects(itemLifecycle(context,s,f.item.id,input(changes)));
 assert.equal((await s.Product.get(f.item.id)).item_removed_at,undefined);
});
test('generic APIs cannot purge items, forge tombstones, reactivate deleted items or manufacture deletion audits',()=>{
 const removed={id:'old',item_removed_at:'2026-10-26'};
 for(const operation of ['delete','deleteMany'])assert.throws(()=>guardMutation(context,'Product',operation,{},removed),{status:403});
 for(const changes of [{item_removed_at:null},{item_lifecycle_revision:2},{is_active:true}])assert.throws(()=>guardMutation(context,'Product','update',changes,removed),{status:403});
 assert.throws(()=>guardMutation(context,'Product','create',{item_removed_at:'fake'}),{status:403});
 assert.throws(()=>guardMutation(context,'AuditLog','create',{action:'remove_item'}),{status:403});
});
async function route(){
 const mocks={
 '@/server/auth':'export const authenticateRequest=async()=>globalThis.__itemLifecycle.context,checkOrigin=()=>{},apiError=e=>Response.json({error:e.message},{status:e.status||400});',
 '@/server/entities':'export const serviceEntities=new Proxy({},{get:(_,key)=>globalThis.__itemLifecycle.entities[key]});',
 '@/server/db':'export const transaction=async run=>{const db=globalThis.__itemLifecycle.db;await db.exec("BEGIN");try{const r=await run();await db.exec("COMMIT");return r;}catch(e){await db.exec("ROLLBACK");throw e;}};'
 };
 const r=await build({entryPoints:['src/app/api/items/[id]/lifecycle/route.js'],bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'item-transaction',setup(b){b.onResolve({filter:/^@\/server\//},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
 return import('data:text/javascript;base64,'+Buffer.from(r.outputFiles[0].text).toString('base64'));
}
test('real API transaction rolls back catalogue deletion on audit failure, then retry removes once and restore remains available',async()=>{
 const db=new PGlite();try{
  const f=await setup(db),s=f.entities,r=await route();globalThis.__itemLifecycle={...f,db,context};const body=input();
  const before=(await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows,create=s.AuditLog.create;
  s.AuditLog.create=async()=>{throw Error('Audit unavailable');};
  const post=value=>r.POST(new Request('http://localhost/api/items/'+f.item.id+'/lifecycle',{method:'POST',body:JSON.stringify(value)}),{params:Promise.resolve({id:f.item.id})});
  assert.equal((await post(body)).status,400);assert.deepEqual((await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows,before);
  s.AuditLog.create=create;assert.equal((await post(body)).status,200);const retry=await post(body);assert.equal(retry.status,200);assert.equal((await retry.json()).reused,true);assert.equal((await s.AuditLog.list()).filter(a=>a.action==='remove_item').length,1);
  assert.equal((await post(input({action:'restore',revision:1,reason:'Restore confirmed item'}))).status,200);
  assert.equal((await s.Product.get(f.item.id)).is_active,false);
 }finally{delete globalThis.__itemLifecycle;await db.close();}
});
