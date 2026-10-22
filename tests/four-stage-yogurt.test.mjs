import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {fourStageFixture,act,asRole,quantity,finishBase,readyToPack,user} from './helpers/four-stage-yogurt.mjs';
import {functionRoute,request} from './helpers/cashier.mjs';
import {yogurtRequirements,recipeBucketPlan} from '../src/lib/yogurt-production.js';
import {productionReadyForIssue} from '../src/lib/production-handoff.js';
import {newPhasedRecipe,upgradePhasedRecipe} from '../src/lib/yogurt-recipe-presets.js';

test('both yogurt bases calculate one shared preservation formula and exact flavour-specific requirements',async()=>{
 for(const family of ['brasse','boire']){
  const f=await fourStageFixture({family}),rows=yogurtRequirements(f.config,recipeBucketPlan(f.config)),sum=id=>rows.filter(row=>row.material_id===id).reduce((n,row)=>n+row.quantity,0);
  assert.equal(sum(f.milk.id),family==='brasse'?40:25);assert.equal(sum(f.culture.id),100);assert.equal(sum(f.sugar.id),20);assert.equal(sum(f.martinal.id),40);
  for(const item of f.flavourItems)assert.equal(sum(item.id),4);
  assert.equal(rows.filter(row=>row.stage==='additives').length,3);
  assert.equal(rows.filter(row=>row.stage==='fermentation').length,2);
  assert.equal(rows.filter(row=>row.flavor==='Non sucré'&&row.stage==='flavouring').length,0);
  assert.equal(sum(f.cups.id),family==='brasse'?520:1000);
  for(const label of f.labels)assert.equal(sum(label.id),family==='brasse'?104:200);
 }
});
test('four phase production consumes ingredients in order and records actual units with all packaging and costs reconciled',async()=>{
 const f=await fourStageFixture(),s=f.entities;
 const originalSugar=await quantity(f,f.sugar),originalPacks=await quantity(f,f.cups);
 await finishBase(f);let order=await s.ProductionOrder.get(f.order.id);
 assert.equal(order.yogurt_base_litres,299);assert.equal(order.yogurt_phase,'additives');assert.equal(productionReadyForIssue(order),true);
 assert.equal(await quantity(f,f.sugar),originalSugar);assert.equal(await quantity(f,f.cups),originalPacks);
 await asRole(f,'warehouse_manager');await act(f,'issueYogurtStage',{stage:'additives'});await asRole(f,'production_manager');
 order=(await act(f,'finishYogurtAdditives',{notes:'Synthetic additive checks'})).order;
 assert.equal(order.yogurt_phase,'flavouring');assert.deepEqual(order.yogurt_ready_flavors,['Non sucré']);
 assert.equal(await quantity(f,f.sugar),originalSugar);
 await asRole(f,'warehouse_manager');await act(f,'issueYogurtStage',{stage:'flavouring'});assert.equal(await quantity(f,f.sugar),originalSugar-20);
 const measured=f.plan.allocations.map(a=>({flavor:a.flavor,kg:53}));await asRole(f,'production_manager');await act(f,'finishYogurtFlavouring',{notes:'Synthetic weights',measured});
 const outputs=f.plan.outputs.map((o,i)=>({...o,quantity:o.quantity+(i===0?2:0)})),body={outputs,warehouseId:f.cold.id,lossReason:'Synthetic higher yield and residue',lossAccountId:'expense'};
 order=(await act(f,'completeYogurtPackaging',body)).order;
 assert.equal(order.actual_output,522);assert.equal(order.status,'awaiting_qc');assert.equal(await quantity(f,f.cups),originalPacks-522);
 assert.equal(Number((await s.Account.get(f.wip.id)).balance),0);
 assert.equal(order.total_material_cost,Math.round((order.yogurt_finished_cost+order.yogurt_loss_cost)*100)/100);
 for(const entry of await s.JournalEntry.filter({})){const lines=await s.JournalLine.filter({journal_entry_id:entry.id});assert.equal(Math.round(lines.reduce((n,row)=>n+Number(row.debit)-Number(row.credit),0)*100),0);}
 const before=await s.StockMovement.filter({document_id:f.order.id});assert.equal((await act(f,'completeYogurtPackaging',body)).reused,true);assert.deepEqual(await s.StockMovement.filter({document_id:f.order.id}),before);
});
test('unsweetened-only batches skip flavouring after common additives and still reconcile actual packaging',async()=>{
 const f=await fourStageFixture({flavors:['Non sucré'],bucketsPerProduct:1}),order=await readyToPack(f);
 assert.equal(order.yogurt_phase,'packaging');assert.equal(order.yogurt_flavouring_skipped,true);assert.equal(order.yogurt_flavouring_completed_at,undefined);
 assert.equal((await f.entities.ProductionMaterial.filter({production_order_id:f.order.id})).some(m=>m.yogurt_stage==='flavouring'),false);
 const result=await act(f,'completeYogurtPackaging',{outputs:f.plan.outputs,warehouseId:f.cold.id,lossReason:'Synthetic filling residue',lossAccountId:'expense'});
 assert.equal(result.order.actual_output,52);assert.equal(Number((await f.entities.Account.get(f.wip.id)).balance),0);
});
test('warehouse and PM handoffs enforce the additive stage and fermentation timer',async()=>{
 const f=await fourStageFixture({flavors:['Nature'],bucketsPerProduct:1});
 await assert.rejects(act(f,'issueYogurtStage',{stage:'additives'}),{status:403});
 await asRole(f,'admin');await act(f,'approveProductionOrder');await asRole(f,'warehouse_manager');await act(f,'issueYogurtStage',{stage:'fermentation'});
 await assert.rejects(act(f,'finishYogurtAdditives',{notes:'Cannot complete as warehouse'}),{status:403});
 await asRole(f,'production_manager');await act(f,'startFermentation');await assert.rejects(act(f,'finishYogurtFermentation',{notes:'Too early',actualLitres:30}),/eight-hour/);
 await asRole(f,'warehouse_manager');await assert.rejects(act(f,'issueYogurtStage',{stage:'additives'}),/current production phase/);
});
test('missing doses, uncertain measures, duplicate preservation and incomplete chocolate ingredients cannot be saved',async()=>{
 const f=await fourStageFixture(),original=structuredClone(f.config);
 const change=async fn=>{const config=structuredClone(original);fn(config);await assert.rejects(act(f,'saveYogurtRecipe',{name:'Invalid synthetic recipe',config}));};
 await change(c=>c.additives.pop());await change(c=>c.additives[0].quantity='');
 await change(c=>c.fermentation.find(row=>row.role==='culture').quantity_per_measure='');
 await change(c=>c.fermentation.find(row=>row.role==='culture').quantity=11);
 await change(c=>c.blends.find(row=>row.flavor==='Chocolat').materials.find(row=>row.recipe_role==='martinal').unit='');
 await change(c=>c.blends.find(row=>row.flavor==='Chocolat').materials.find(row=>row.recipe_role==='martinal').quantity=19);
 await change(c=>c.blends.find(row=>row.flavor==='Non sucré').materials.push(c.additives[0]));
 await change(c=>c.blends.find(row=>row.flavor==='Nature').materials.push(c.additives[0]));
 assert.deepEqual(f.config,original);
});
test('full requirement check catches Martinal and packaging shortages before a production request is written',async()=>{
 const f=await fourStageFixture({createOrder:false});
 const lot=(await f.entities.StockBalance.filter({product_id:f.martinal.id}))[0];await f.entities.StockBalance.update(lot.id,{quantity:0,total_value:0});
 const before=await f.entities.ProductionOrder.filter({}),result=await act(f,'saveYogurtPlan',{plan:f.plan,status:'awaiting_approval',requestKey:crypto.randomUUID()});
 assert.equal(result.blocked,true);assert.ok(result.shortages.some(row=>row.material_id===f.martinal.id));assert.deepEqual(await f.entities.ProductionOrder.filter({}),before);
  await f.entities.StockBalance.update(lot.id,{quantity:10000,total_value:30000});
  const cupLot=(await f.entities.StockBalance.filter({product_id:f.cups.id}))[0];await f.entities.StockBalance.update(cupLot.id,{quantity:1,total_value:1});
  const packaging=await act(f,'saveYogurtPlan',{plan:f.plan,status:'awaiting_approval',requestKey:crypto.randomUUID()});assert.equal(packaging.blocked,true);assert.ok(packaging.shortages.some(row=>row.material_id===f.cups.id));assert.deepEqual(await f.entities.ProductionOrder.filter({}),before);
});
test('flavour bottles stored in litres require an explicit per-bottle quantity',async()=>{
 const f=await fourStageFixture({flavors:['Vanille'],bucketsPerProduct:2}),item=f.flavourItems.find(p=>p.flavor==='Vanille');
 await f.entities.Product.update(item.id,{unit_of_measure:'l'});
 const config=structuredClone(f.config),line=config.blends[0].materials.find(r=>r.recipe_role==='flavour');
 Object.assign(line,{unit:'l',quantity_per_measure:0.03,quantity:0.06});
 const saved=(await act(f,'saveYogurtRecipe',{name:'Synthetic litre bottle conversion',config})).recipe;
 const material=yogurtRequirements(saved.yogurt_config,recipeBucketPlan(saved.yogurt_config)).find(r=>r.material_id===item.id);
 assert.equal(material.quantity,0.12);assert.equal(material.unit,'l');
 line.quantity_per_measure='';await assert.rejects(act(f,'saveYogurtRecipe',{name:'Missing bottle conversion',config}),/inventory quantity per bottle/);
});
test('new formulas never invent additive doses or a culture mass conversion and upgrading retains the approved input',async()=>{
 const f=await fourStageFixture(),items=await f.entities.Product.filter({}),fresh=newPhasedRecipe(items);
 assert.equal(fresh.fermentation.find(row=>row.role==='culture').quantity_per_measure,'');assert.ok(fresh.additives.every(row=>row.quantity===''));
 const legacy={...f.config,formula_version:2,additives:undefined,blends:f.config.blends.map(b=>({...b,materials:[...b.materials,...f.config.additives]}))},before=structuredClone(legacy);
 const draft=upgradePhasedRecipe(legacy,items);assert.equal(draft.formula_version,3);assert.equal(draft.additives.length,3);assert.equal(draft.fermentation.find(row=>row.role==='culture').quantity,'');assert.deepEqual(legacy,before);
  const older={...legacy,formula_version:1,product_bucket_recipe:false,planned_buckets:undefined,fermentation:[...legacy.fermentation,{role:'sugar',material_id:f.sugar.id,quantity:1,unit:'kg'}],outputs:legacy.outputs.map(({buckets,standard_units_per_bucket,...row})=>row)};
  const converted=upgradePhasedRecipe(older,items);assert.equal(converted.product_bucket_recipe,true);assert.equal(converted.packaging_from_assembly,true);assert.equal(converted.fermentation.some(row=>row.role==='sugar'),false);assert.ok(converted.outputs.every(row=>row.standard_units_per_bucket===52));
});
test('the HTTP transaction rolls additive costs, packaging, finished stock and postings back when completion audit fails',async()=>{
 const db=new PGlite();try{
  const f=await fourStageFixture({db,flavors:['Nature'],bucketsPerProduct:1});await readyToPack(f);const route=await functionRoute();
  globalThis.__cashierClient=f.client;globalThis.__cashierTransaction=async fn=>{await db.exec('BEGIN');try{const result=await fn();await db.exec('COMMIT');return result;}catch(error){await db.exec('ROLLBACK');throw error;}};
  const before=(await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows,create=f.entities.AuditLog.create;
  f.entities.AuditLog.create=async row=>{if(row.action==='complete_yogurt_packaging')throw Error('Synthetic audit failure');return create(row);};
  const submit=()=>route(request({action:'completeYogurtPackaging',orderId:f.order.id,outputs:f.plan.outputs,warehouseId:f.cold.id,lossReason:'Synthetic filling residue',lossAccountId:'expense'}),{params:Promise.resolve({name:'fieldOps'})});
  assert.equal((await submit()).status,400);assert.deepEqual((await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows,before);
  f.entities.AuditLog.create=create;assert.equal((await submit()).status,200);
 }finally{delete globalThis.__cashierClient;delete globalThis.__cashierTransaction;await db.close();}
});
