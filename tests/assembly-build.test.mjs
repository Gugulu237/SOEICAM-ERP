import {batchTraceAction} from '../src/server/domain/batch-trace.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {fixture,functionRoute,request,user,date} from './helpers/cashier.mjs';
import {assemblyBuildAction} from '../src/server/domain/assembly-build.js';
import {salesOrderAction} from '../src/server/domain/sales-orders.js';
import {guardMutation} from '../src/server/access.js';

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
  const milk=await s.Product.create({name:'Milk',inventory_type:'raw_material',configuration_status:'ready',unit_of_measure:'kg',purchase_price:1200,current_cost:1000,inventory_account_id:'inventory',is_active:true});
  const cup=await s.Product.create({name:'500g cups',inventory_type:'packaging',configuration_status:'ready',unit_of_measure:'ea',purchase_price:25,current_cost:20,inventory_account_id:'inventory',is_active:true});
  const product=await s.Product.create({name:'Nature 500g',inventory_type:'assembly',configuration_status:'ready',unit_of_measure:'ea',selling_price:1000,shelf_life_days:14,inventory_account_id:fg.id,is_active:true,components:[
    {component_type:'inventory_part',product_id:milk.id,quantity:500,unit:'g',unit_cost:1,cost_source:'registered'},
    {component_type:'inventory_part',product_id:cup.id,quantity:1,unit:'ea',unit_cost:20,cost_source:'registered'},
  ]});
  const milkLot=await s.StockBalance.create({product_id:milk.id,warehouse_id:raw.id,quantity:60,unit_cost:1000,total_value:60000,lot_number:'MILK-OPEN',qc_status:'approved'});
  const cupLot=await s.StockBalance.create({product_id:cup.id,warehouse_id:raw.id,quantity:120,unit_cost:20,total_value:2400,lot_number:'CUPS-OPEN',qc_status:'approved'});
  const body={date,warehouseId:cold.id,rows:[{product_id:product.id,quantity:100}]};
  const call=value=>assemblyBuildAction(f.client,user,value);
  const preview=()=>call({...body,action:'previewAssemblyBuild'});
  const post=async()=>({...body,action:'postAssemblyBuild',requestKey:crypto.randomUUID(),fingerprint:(await preview()).fingerprint});
  return {...f,milk,cup,product,milkLot,cupLot,raw,cold,fg,body,call,preview,post};
}

test('100 finished units use the saved assembly, convert grams to kg and expose a read-only shortage check',async()=>{
  const f=await setup(),before=structuredClone(f.rows),p=await f.preview();
  assert.equal(p.materials.find(m=>m.product_id===f.milk.id).required,50);assert.equal(p.materials.find(m=>m.product_id===f.cup.id).required,100);
  assert.equal(p.can_build,true);assert.equal(p.total_cost,52000);assert.ok(p.outputs[0].expiry_date>date);assert.deepEqual(f.rows,before);
  const workspace=await f.call({action:'assemblyBuildWorkspace'});assert.equal(workspace.can_build,true);assert.ok(workspace.products.some(p=>p.id===f.product.id));
});

test('build consumes real carrying costs, posts a balanced asset transfer and receives immediately saleable finished goods exactly once',async()=>{
  const f=await setup(),s=f.entities,body=await f.post(),saved=await f.call(body),order=await s.ProductionOrder.get(saved.orders[0].id);
  assert.equal(order.status,'released');assert.equal(order.production_method,'assembly_build');assert.equal(order.actual_output,100);assert.equal(order.actual_cost_per_unit,520);
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
  const rows=[...f.body.rows,{product_id:second.id,quantity:100}],p=await f.call({...f.body,rows,action:'previewAssemblyBuild'});assert.equal(p.can_build,false);assert.equal(p.materials.find(m=>m.product_id===f.milk.id).missing,15);
  const before=structuredClone(f.rows);await assert.rejects(f.call({...f.body,rows,action:'postAssemblyBuild',requestKey:crypto.randomUUID(),fingerprint:p.fingerprint}),/short/);assert.deepEqual(f.rows,before);
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
  const p=await f.call({...f.body,rows,action:'previewAssemblyBuild'});await f.call({...f.body,rows,action:'postAssemblyBuild',requestKey:crypto.randomUUID(),fingerprint:p.fingerprint});
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
