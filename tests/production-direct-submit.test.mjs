import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { fixture, functionRoute, request, user, date } from './helpers/cashier.mjs';
import { fourStageFixture, act, asRole, quantity } from './helpers/four-stage-yogurt.mjs';
import { productionAction } from '../src/server/domain/production-batches.js';
import { yogurtAction } from '../src/server/domain/yogurt-production.js';
import { operationalStaffData } from '../src/server/domain/staff-workspace.js';
import { guardMutation } from '../src/server/access.js';

async function assembly(db) {
  const f=await fixture(db),s=f.entities;
  await asRole(f,'production_manager');
  await s.Employee.update('cashier',{full_name:'Production lead'});
  await s.Product.update('product-a',{shelf_life_days:10});
  const raw=await s.Warehouse.create({name:'Ingredients',warehouse_type:'raw_material',is_active:true});
  const milk=await s.Product.create({name:'Milk',inventory_type:'raw_material',unit_of_measure:'kg',is_active:true,current_cost:10});
  const lot=await s.StockBalance.create({product_id:milk.id,warehouse_id:raw.id,quantity:100,unit_cost:10,total_value:1000,qc_status:'approved'});
  const recipe=await s.Recipe.create({recipe_name:'Assembly',product_id:'product-a',batch_output:10,status:'approved'});
  await s.RecipeLine.create({recipe_id:recipe.id,material_id:milk.id,quantity:2,unit:'kg'});
  await s.Account.create({name:'Inventory',account_number:'1310',account_type:'asset',is_active:true,is_posting:true,normal_balance:'debit',balance:1000});
  await s.Account.create({name:'Work in progress',account_number:'1315',account_type:'asset',is_active:true,is_posting:true,normal_balance:'debit',balance:0});
  const inventory=(await s.Account.filter({account_number:'1310'}))[0];
  await s.PostingRule.create({rule_key:'raw_material_inventory',account_id:inventory.id,is_active:true});
  const body={action:'saveProductionPlan',status:'awaiting_approval',requestKey:crypto.randomUUID(),plan:{recipe_id:recipe.id,planned_output:20,production_date:date}};
  return {...f,raw,milk,lot,body};
}
const save=(f,body=f.body)=>productionAction(f.client,user,body);
function checkActor(order) {
  assert.equal(order.status,'approved');
  assert.equal(order.approved_by,user.id);
  assert.ok(Number.isFinite(Date.parse(order.approved_at)));
  assert.equal(order.production_authorization_role,'production_manager');
  assert.equal(order.production_authorization_method,'direct_submission');
}

test('Production Manager submission reaches the assembly warehouse queue once, without issuing stock or posting a journal',async()=>{
  const f=await assembly(),s=f.entities;
  const first=await save(f);checkActor(first.order);
  assert.equal(first.order.production_authorization_name,'Production lead');
  assert.equal(first.order.material_warehouses[f.milk.id],f.raw.id);
  const before=structuredClone(f.rows),retry=await save(f);
  assert.equal(retry.reused,true);assert.equal(retry.order.id,first.order.id);assert.deepEqual(f.rows,before);
  const data=await operationalStaffData(f.client.asServiceRole,'warehouse_manager',date,['manufacturing'],await s.Employee.get('cashier'),'warehouse_manager');
  assert.equal(data.materialIssueOrders[0].id,first.order.id);
  assert.equal(data.materialIssueOrders[0].production_authorization_role,'production_manager');
  assert.equal((await s.StockBalance.get(f.lot.id)).quantity,100);
  assert.equal((await s.JournalEntry.list()).length,0);assert.equal((await s.StockMovement.list()).length,0);
  await assert.rejects(save(f,{action:'issueProductionMaterials',orderId:first.order.id,role:'warehouse_manager',canIssueMaterials:true}),/warehouse management/);
  await asRole(f,'warehouse_manager');
  const issued=await save(f,{action:'issueProductionMaterials',orderId:first.order.id});assert.equal(issued.order.status,'materials_issued');
  assert.equal((await s.StockBalance.get(f.lot.id)).quantity,96);assert.equal((await s.JournalEntry.list()).length,1);
});

test('assembly drafts stay drafts; shortage and ambiguous sources block direct submission without changing records',async()=>{
  const f=await assembly(),s=f.entities;
  const draft=await save(f,{...f.body,status:'draft'});assert.equal(draft.order.status,'draft');assert.equal(draft.order.approved_by,undefined);
  await s.StockBalance.update(f.lot.id,{quantity:1});let before=structuredClone(f.rows);
  assert.equal((await save(f,{...f.body,orderId:draft.order.id})).blocked,true);assert.deepEqual(f.rows,before);
  await s.StockBalance.update(f.lot.id,{quantity:100});
  const second=await s.Warehouse.create({name:'Other ingredients',warehouse_type:'raw_material',is_active:true});
  await s.StockBalance.create({product_id:f.milk.id,warehouse_id:second.id,quantity:100,qc_status:'approved'});
  before=structuredClone(f.rows);assert.equal((await save(f,{...f.body,orderId:draft.order.id})).blocked,true);assert.deepEqual(f.rows,before);
  const submitted=await save(f,{...f.body,orderId:draft.order.id,plan:{...f.body.plan,material_warehouses:{[f.milk.id]:second.id}}});checkActor(submitted.order);
  assert.equal(submitted.order.material_warehouses[f.milk.id],second.id);
});

test('Production Manager can submit a legacy pending order with stock checks and their own authorization identity',async()=>{
  const f=await assembly(),s=f.entities;const {order}=await save(f,{...f.body,status:'draft'});
  await s.ProductionOrder.update(order.id,{status:'awaiting_approval'});await s.StockBalance.update(f.lot.id,{quantity:0});
  const body={action:'approveProductionOrder',orderId:order.id,approved_by:'fake-gm',role:'admin'};
  assert.equal((await save(f,body)).blocked,true);
  await s.StockBalance.update(f.lot.id,{quantity:100});const result=await save(f,body);checkActor(result.order);
  assert.equal((await save(f,body)).reused,true);
  await assert.rejects(save(f,{action:'rejectProductionOrder',orderId:order.id}),/General Manager/);
});

test('unrelated roles and generic entity writes cannot authorize production',async()=>{
  const f=await assembly();
  for(const role of ['warehouse_manager','commercial','driver','cashier']) {
    await asRole(f,role);
    await assert.rejects(save(f,{...f.body,role:'production_manager',approved_by:user.id}));
    await assert.rejects(save(f,{action:'approveProductionOrder',orderId:'fake',role:'production_manager'}));
  }
  await asRole(f,'production_manager');await f.entities.Employee.update('cashier',{status:'inactive'});await assert.rejects(save(f));
  for(const role of ['admin','production_manager'])for(const payload of [{status:'approved'},{approved_by:user.id},{production_authorization_role:'production_manager'},{production_authorization_method:'direct_submission'},{production_authorization_name:'Fake'}])
    assert.throws(()=>guardMutation({user,role,employee:{role,status:'active'}},'ProductionOrder','update',payload,{status:'draft'}),/checked manufacturing/);
});

test('four-stage yogurt goes directly to the warehouse queue and warehouse can issue the first phase without GM approval',async()=>{
  const f=await fourStageFixture({createOrder:false}),s=f.entities,before=await quantity(f,f.milk);
  const body={action:'saveYogurtPlan',status:'awaiting_approval',plan:f.plan,requestKey:crypto.randomUUID()};
  f.order=(await yogurtAction(f.client,user,body)).order;checkActor(f.order);
  assert.equal(f.order.material_warehouses[f.milk.id],f.raw.id);assert.equal(f.order.material_warehouses[f.cups.id],f.packs.id);
  assert.equal(await quantity(f,f.milk),before);assert.equal((await s.JournalEntry.list()).length,0);
  assert.equal((await yogurtAction(f.client,user,body)).reused,true);
  await assert.rejects(act(f,'issueYogurtStage',{stage:'fermentation'}),/role/);
  await asRole(f,'warehouse_manager');assert.equal((await act(f,'issueYogurtStage',{stage:'fermentation'})).order.status,'materials_issued');
  assert.ok(await quantity(f,f.milk)<before);assert.equal((await s.JournalEntry.list()).length,1);
});

for(const kind of ['assembly','yogurt'])test(`${kind} HTTP submission rolls back order, materials and audit on failure, then retries once`,async()=>{
  const db=new PGlite();
  try {
    const f=kind==='assembly'?await assembly(db):await fourStageFixture({db,createOrder:false}),s=f.entities;
    const body=kind==='assembly'?f.body:{action:'saveYogurtPlan',status:'awaiting_approval',plan:f.plan,requestKey:crypto.randomUUID()};
    globalThis.__cashierClient=f.client;
    globalThis.__cashierTransaction=async fn=>{await db.exec('BEGIN');try{const result=await fn();await db.exec('COMMIT');return result;}catch(e){await db.exec('ROLLBACK');throw e;}};
    const route=await functionRoute(),submit=()=>route(request(body),{params:Promise.resolve({name:'fieldOps'})});
    const snapshot=() => db.query('SELECT * FROM fixture_entity ORDER BY entity,id');
    const before=(await snapshot()).rows,original=s.AuditLog.create;
    s.AuditLog.create=async()=>{throw Error('Submission audit unavailable');};
    const failed=await submit();assert.equal(failed.status,400);assert.match((await failed.json()).error,/audit unavailable/);assert.deepEqual((await snapshot()).rows,before);
    s.AuditLog.create=original;const response=await submit();assert.equal(response.status,200);checkActor((await response.json()).order);
    const after=(await snapshot()).rows;assert.equal((await (await submit()).json()).reused,true);assert.deepEqual((await snapshot()).rows,after);
  }finally{delete globalThis.__cashierClient;delete globalThis.__cashierTransaction;await db.close();}
});
