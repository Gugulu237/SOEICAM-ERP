import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { fixture,user,date,functionRoute,request } from './helpers/cashier.mjs';
import { yogurtAction } from '../src/server/domain/yogurt-production.js';
import { stockIssue,postJournal } from '../src/server/domain/field-ops.js';
import { productionAction } from '../src/server/domain/production-batches.js';
import { guardRecipeMutation } from '../src/server/domain/recipe-integrity.js';
import { guardMutation } from '../src/server/access.js';
import { guardStockStorage } from '../src/server/domain/stock-storage.js';
import { batchTraceAction } from '../src/server/domain/batch-trace.js';
import { packagingReport,yogurtRequirements,emptyYogurtConfig,standardBucketUnits,standardOutputPlan,yogurtAssemblyPackaging,sharedYogurtMaterial,recipeBucketPlan,yogurtVariant,yogurtProductIdentity } from '../src/lib/yogurt-production.js';
import { productionReadyForIssue } from '../src/lib/production-handoff.js';
import { operationalStaffData } from '../src/server/domain/staff-workspace.js';
import { productionRequirements } from '../src/server/domain/production-batches.js';

async function setup(db) {
  const f=await fixture(db),s=f.entities;await s.Employee.update('cashier',{role:'production_manager',assigned_role:'production_manager'});
  const raw=await s.Warehouse.create({name:'Ingredients',warehouse_type:'raw_material',is_active:true}),packs=await s.Warehouse.create({name:'Packaging',warehouse_type:'packaging',is_active:true}),cold=await s.Warehouse.create({name:'Cold Room',warehouse_type:'cold_room',is_active:true});
  const make=async(name,type,unit,cost,quantity)=>{const p=await s.Product.create({name,inventory_type:type,unit_of_measure:unit,is_active:true});await s.StockBalance.create({product_id:p.id,product_name:p.name,warehouse_id:type==='packaging'?packs.id:raw.id,quantity,unit_cost:cost,total_value:cost*quantity,lot_number:name+'-LOT',qc_status:'approved'});return p;};
  const milk=await make('Milk','raw_material','kg',10,100),sugar=await make('Sugar','raw_material','kg',2,100),culture=await make('Culture','raw_material','g',1,100),vanilla=await make('Vanilla','raw_material','kg',50,10),cups=await make('Cups','packaging','ea',2,1000);
  const fg=async(name,flavor,size)=>s.Product.create({name,inventory_type:'assembly',unit_of_measure:'ea',product_family:'Yaourt brassé',flavor,size,shelf_life_days:14,is_active:true});
  const n250=await fg('Nature 250 g','Nature','250 g'),n500=await fg('Nature 500 g','Nature','500 g'),v500=await fg('Vanilla 500 g','Vanille','500 g');
  const inventory=await s.Account.create({account_number:'1310',account_type:'asset',normal_balance:'debit',balance:10000,is_active:true,is_posting:true,name:'Ingredients'}),wip=await s.Account.create({account_number:'1315',account_type:'asset',normal_balance:'debit',balance:0,is_active:true,is_posting:true,name:'WIP'}),finished=await s.Account.create({account_number:'1320',account_type:'asset',normal_balance:'debit',balance:0,is_active:true,is_posting:true,name:'Finished goods'});
  await s.PostingRule.create({rule_key:'raw_material_inventory',account_id:inventory.id,is_active:true});
  const config={family:'brasse',expected_kg_per_bucket:30,fermentation:[{role:'milk',material_id:milk.id,quantity:4,unit:'kg'},{role:'sugar',material_id:sugar.id,quantity:1,unit:'kg'},{role:'culture',material_id:culture.id,quantity:10,unit:'g'}],blends:[{flavor:'Nature',materials:[]},{flavor:'Vanille',materials:[{material_id:vanilla.id,quantity:0.1,unit:'kg'}]}],outputs:[n250,n500,v500].map(p=>({product_id:p.id,packaging:[{material_id:cups.id,quantity:1,unit:'ea'}]}))};
  const saved=await yogurtAction(f.client,user,{action:'saveYogurtRecipe',name:'Brassé 30 L',config});const recipe=(await yogurtAction(f.client,user,{action:'approveYogurtRecipe',recipeId:saved.recipe.id})).recipe;
  const plan={recipe_id:recipe.id,buckets:2,production_date:date,allocations:[{flavor:'Nature',buckets:1},{flavor:'Vanille',buckets:1}],outputs:[{product_id:n250.id,quantity:80},{product_id:n500.id,quantity:20},{product_id:v500.id,quantity:60}]};
  const order=(await yogurtAction(f.client,user,{action:'saveYogurtPlan',requestKey:crypto.randomUUID(),plan,status:'awaiting_approval'})).order;
  return {...f,raw,packs,cold,milk,sugar,culture,vanilla,cups,n250,n500,v500,inventory,wip,finished,recipe,plan,order};
}
const call=(f,action,extra={})=>yogurtAction(f.client,user,{action,orderId:f.order.id,...extra});
const staff=(f,role)=>f.entities.Employee.update('cashier',{role,assigned_role:role});
const stock=async(f,product)=>Number((await f.entities.StockBalance.filter({product_id:product.id})).reduce((sum,b)=>sum+Number(b.quantity),0));
async function phase(f,target='packaging') {
  await staff(f,'admin');await productionAction(f.client,user,{action:'approveProductionOrder',orderId:f.order.id});
  await staff(f,'warehouse_manager');await call(f,'issueYogurtStage',{stage:'fermentation'});await staff(f,'production_manager');await call(f,'startFermentation');
  await f.entities.ProductionOrder.update(f.order.id,{fermentation_started_at:new Date(Date.now()-9*3600000).toISOString(),fermentation_due_at:new Date(Date.now()-3600000).toISOString()});
  await call(f,'finishYogurtFermentation',{notes:'pH, temperature and texture checked'});if(target==='flavouring')return;
  await staff(f,'warehouse_manager');await call(f,'issueYogurtStage',{stage:'flavouring'});await staff(f,'production_manager');await call(f,'finishYogurtFlavouring',{measured:[{flavor:'Nature',kg:30},{flavor:'Vanille',kg:29}],notes:'Mixed, weighed and checked'});
  // Packaging remains in its store until actual output is reported.
  await staff(f,'production_manager');
}
// Fixture for historical batches that had already issued their forecast packaging.
async function legacyPackaging(f){
 const s=f.entities,svc=f.client.asServiceRole;let total=0;
 for(const m of (await s.ProductionMaterial.filter({production_order_id:f.order.id})).filter(m=>m.yogurt_stage==='packaging')){
  const result=await stockIssue(svc,{productId:m.material_id,productName:m.material_name,warehouseId:f.packs.id,quantity:m.standard_quantity,movementType:'production_issue',documentType:'ProductionOrder',documentId:f.order.id,movementDate:date,saleableOnly:true});
  await s.ProductionMaterial.update(m.id,{issued_quantity:m.standard_quantity,consumed_quantity:m.standard_quantity,total_cost:result.totalValue,unit_cost:result.totalValue/m.standard_quantity,yogurt_layers:result.layers,yogurt_source_warehouse_id:f.packs.id});total+=result.totalValue;
 }
 const o=await s.ProductionOrder.get(f.order.id);await s.ProductionOrder.update(o.id,{yogurt_issued_stages:{...o.yogurt_issued_stages,packaging:{at:'historical',by:user.id}}});
 await postJournal(svc,{entryDate:date,description:'Historical forecast packaging',sourceModule:'manufacturing',sourceDocumentType:'ProductionMaterialIssue',sourceDocumentId:'historical:'+o.id,userId:user.id,lines:[{account_id:f.wip.id,debit:total,credit:0},{account_id:f.inventory.id,debit:0,credit:total}]});
}
const outputBody=f=>({outputs:[{product_id:f.n250.id,quantity:72},{product_id:f.n500.id,quantity:20},{product_id:f.v500.id,quantity:56}],warehouseId:f.cold.id,lossReason:'Measured residue and filling loss',lossAccountId:'expense'});

test('bucket recipes calculate 4 kg / 2.5 kg milk, preserve explicit formula quantities, and separate litres from output mass',async()=>{
  const f=await setup(),c=f.recipe.yogurt_config;
  assert.equal(c.bucket_litres,30);assert.equal(c.milk_kg_per_bucket,4);
  const rows=yogurtRequirements(c,f.plan);assert.equal(rows.find(r=>r.material_id===f.milk.id).quantity,8);assert.equal(rows.find(r=>r.material_id===f.vanilla.id).quantity,0.1);assert.equal(rows.filter(r=>r.stage==='packaging').reduce((s,r)=>s+r.quantity,0),160);
  const drink=structuredClone(f.recipe.yogurt_config);drink.family='boire';drink.fermentation[0].quantity=2.5;
  for(const p of [f.n250,f.n500,f.v500])await f.entities.Product.update(p.id,{product_family:'Yaourt à boire'});
  const saved=await yogurtAction(f.client,user,{action:'saveYogurtRecipe',name:'Drinkable 30 L',config:drink});assert.equal(saved.recipe.yogurt_config.milk_kg_per_bucket,2.5);
  assert.equal(yogurtRequirements(saved.recipe.yogurt_config,f.plan).find(r=>r.material_id===f.milk.id).quantity,5);
  drink.fermentation[0].quantity=4;await assert.rejects(yogurtAction(f.client,user,{action:'saveYogurtRecipe',name:'Bad',config:drink}),/2.5 kg/);
  assert.throws(()=>yogurtRequirements(c,{...f.plan,buckets:3}),/add up/);assert.throws(()=>yogurtRequirements(c,{...f.plan,buckets:2.5}),/bucket/);
  assert.throws(()=>yogurtRequirements(c,{...f.plan,outputs:[{product_id:f.n250.id,quantity:10000},{product_id:f.v500.id,quantity:60}]}),/weight/);
});

test('formula validation rejects incompatible units, missing classifications, service inputs and forged packaging materials',async()=>{
  const f=await setup();const bad=async change=>{const c=structuredClone(f.recipe.yogurt_config);change(c);await assert.rejects(yogurtAction(f.client,user,{action:'saveYogurtRecipe',name:'Invalid',config:c}));};
  await bad(c=>c.fermentation[1].unit='l');await bad(c=>c.fermentation[2].quantity=0);await bad(c=>c.fermentation[2].material_id=f.sugar.id);await bad(c=>c.expected_kg_per_bucket='');await bad(c=>c.outputs[0].packaging[0].material_id=f.milk.id);
  await f.entities.Product.update(f.n250.id,{flavor:'',name:'Unclassified product'});await bad(()=>{});
});

test('a configured zero-sugar base omits sugar issues and extra fermentation materials stay in phase one',async()=>{
  const f=await setup(),s=f.entities,config=structuredClone(f.recipe.yogurt_config);
  config.fermentation.find(r=>r.role==='sugar').quantity=0;
  const water=await s.Product.create({name:'Water',inventory_type:'raw_material',unit_of_measure:'l',is_active:true});
  config.fermentation.push({role:'other',material_id:water.id,quantity:27,unit:'l'});
  const recipe=(await yogurtAction(f.client,user,{action:'saveYogurtRecipe',name:'Zero-sugar base',config})).recipe;
  const rows=yogurtRequirements(recipe.yogurt_config,f.plan);assert.equal(rows.some(r=>r.material_id===f.sugar.id),false);assert.equal(rows.find(r=>r.material_id===water.id).quantity,54);
  config.outputs[0].packaging[0]={...config.outputs[0].packaging[0],role:'sugar',quantity:0};await assert.rejects(yogurtAction(f.client,user,{action:'saveYogurtRecipe',name:'Zero packaging',config}),/formula quantity/);
});

test('approved recipes remain immutable and replacement approval affects only its own version series',async()=>{
  const f=await setup(),s=f.entities,context={user,employee:await s.Employee.get('cashier')};
  await assert.rejects(guardRecipeMutation(s,context,'Recipe','update',{yogurt_config:{}},f.recipe),/checked phase/);
  await assert.rejects(guardRecipeMutation(s,context,'RecipeLine','create',{recipe_id:f.recipe.id,material_id:f.milk.id,quantity:1,unit:'kg'}),/checked phase/);
  const next=(await yogurtAction(f.client,user,{action:'saveYogurtRecipe',recipeId:f.recipe.id,name:'Adjusted',config:f.recipe.yogurt_config})).recipe;
  assert.notEqual(next.id,f.recipe.id);assert.equal(next.version,2);assert.equal((await s.Recipe.get(f.recipe.id)).status,'approved');
  await yogurtAction(f.client,user,{action:'approveYogurtRecipe',recipeId:next.id});assert.equal((await s.Recipe.get(f.recipe.id)).status,'superseded');
  assert.equal((await s.ProductionOrder.get(f.order.id)).yogurt_config.fermentation[0].quantity,4);
});

test('only current-phase materials are issued, fermentation takes eight hours, and retries cannot duplicate stock or journals',async()=>{
  const f=await setup();await staff(f,'admin');await call(f,'approveProductionOrder');await staff(f,'warehouse_manager');
  await assert.rejects(call(f,'issueYogurtStage',{stage:'packaging'}),/Packaging is deducted/);
  await call(f,'issueYogurtStage',{stage:'fermentation'});assert.equal(await stock(f,f.milk),92);assert.equal(await stock(f,f.vanilla),10);assert.equal(await stock(f,f.cups),1000);
  const moves=(await f.entities.StockMovement.list()).length;assert.equal((await call(f,'issueYogurtStage',{stage:'fermentation'})).reused,true);assert.equal((await f.entities.StockMovement.list()).length,moves);
  await staff(f,'production_manager');const start=await call(f,'startFermentation');assert.equal(Date.parse(start.order.fermentation_due_at)-Date.parse(start.order.fermentation_started_at),8*3600000);assert.equal(Date.parse(start.order.fermentation_due_at)-Date.parse(start.order.fermentation_reminder_at),30*60000);
  await assert.rejects(call(f,'finishYogurtFermentation',{notes:'Too early'}),/eight-hour/);await assert.rejects(call(f,'finishYogurtFlavouring',{measured:[],notes:'Skip'}),/mixing/);
  await assert.rejects(productionAction(f.client,user,{action:'completeProduction',orderId:f.order.id,quantity:100}),/phased yogurt/);
});

test('GM approval and warehouse issue recheck usable stock and source selection; shortage does not issue any earlier component',async()=>{
  const f=await setup();await staff(f,'admin');await call(f,'approveProductionOrder');await staff(f,'warehouse_manager');
  const lot=(await f.entities.StockBalance.filter({product_id:f.culture.id}))[0];await f.entities.StockBalance.update(lot.id,{quantity:0});
  const before=structuredClone(f.rows);const blocked=await call(f,'issueYogurtStage',{stage:'fermentation'});assert.equal(blocked.blocked,true);assert.deepEqual(f.rows,before);
  await f.entities.StockBalance.create({product_id:f.culture.id,warehouse_id:f.raw.id,quantity:1000,qc_status:'quarantine'});assert.equal((await call(f,'issueYogurtStage',{stage:'fermentation'})).blocked,true);
  await staff(f,'production_manager');await assert.rejects(call(f,'issueYogurtStage',{stage:'fermentation'}),/role/);assert.equal((await call(f,'approveProductionOrder')).reused,true);await assert.rejects(call(f,'rejectProductionOrder',{reason:'Forged management rejection'}),/role/);
});

test('packaging posts actual SKU inventory, lot expiry, unused packaging returns, process loss and balanced WIP exactly once',async()=>{
  const f=await setup(),s=f.entities;await phase(f);await legacyPackaging(f);assert.equal(await stock(f,f.cups),840);
  const result=await call(f,'completeYogurtPackaging',outputBody(f));assert.equal(result.order.status,'awaiting_qc');assert.equal(result.order.actual_output,148);assert.equal(await stock(f,f.cups),852);
  assert.equal(await stock(f,f.n250),72);assert.equal(await stock(f,f.n500),20);assert.equal(await stock(f,f.v500),56);
  const lots=await s.StockBalance.filter({production_order_id:f.order.id});assert.equal(lots.length,3);assert.ok(lots.every(l=>l.qc_status==='quarantine' && l.lot_number===f.order.batch_number && l.expiry_date>date));
  assert.equal(result.order.yogurt_loss_cost,5.44);assert.equal(result.order.yogurt_finished_cost,399.56);assert.equal(result.order.total_material_cost,405);
  assert.equal((await s.Account.get(f.wip.id)).balance,0);assert.equal((await s.Account.get(f.finished.id)).balance,399.56);assert.equal((await s.Account.get('expense')).balance,5.44);
  assert.ok((await s.JournalEntry.list()).every(j=>j.total_debit===j.total_credit));
  const snapshot=structuredClone(f.rows);assert.equal((await call(f,'completeYogurtPackaging',outputBody(f))).reused,true);assert.deepEqual(f.rows,snapshot);
});

test('actual counts can exceed standard units but cannot exceed measured weight, omit products, or hide process loss',async()=>{
  const f=await setup();await phase(f);const c=f.recipe.yogurt_config,plan=f.plan,measured=(await f.entities.ProductionOrder.get(f.order.id)).yogurt_measured,actual=outputBody(f).outputs;
  assert.throws(()=>packagingReport(c,plan,measured,actual,''),/Explain/);
  assert.throws(()=>packagingReport(c,plan,measured,actual.slice(1),'loss'),/every/);
  assert.doesNotThrow(()=>packagingReport(c,plan,[{flavor:'Nature',kg:31},{flavor:'Vanille',kg:29}],[{product_id:f.n250.id,quantity:81},...actual.slice(1)],'Extra yield and loss'));
  assert.throws(()=>packagingReport(c,plan,measured,[{product_id:'not-approved',quantity:1},...actual.slice(1)],'loss'),/approved/);
  assert.throws(()=>packagingReport(c,plan,[{flavor:'Nature',kg:1},{flavor:'Vanille',kg:29}],actual,'loss'),/exceeds/);
  await assert.rejects(call(f,'completeYogurtPackaging',{...outputBody(f),lossAccountId:f.wip.id}),/expense/);
});

test('approved output identity and planned expiry cannot drift when item metadata changes during production',async()=>{
  const f=await setup(),s=f.entities;
  const expiry=f.order.yogurt_expiries.find(row=>row.product_id===f.v500.id).expiry_date;
  await s.Product.update(f.v500.id,{flavor:'Nature'});
  await assert.rejects(yogurtAction(f.client,user,{action:'saveYogurtPlan',requestKey:crypto.randomUUID(),plan:f.plan,status:'draft'}),/flavour or size changed/);
  await s.Product.update(f.v500.id,{flavor:'Vanille'});await phase(f);
  await s.Product.update(f.v500.id,{size:'1000 g'});
  await assert.rejects(call(f,'completeYogurtPackaging',outputBody(f)),/flavour or size changed/);
  await s.Product.update(f.v500.id,{size:'500 g',shelf_life_days:365});await call(f,'completeYogurtPackaging',outputBody(f));
  assert.equal((await s.StockBalance.filter({product_id:f.v500.id}))[0].expiry_date,expiry);
});

test('every output traces back to the shared fermentation batch and quality review releases each SKU independently',async()=>{
  const f=await setup(),s=f.entities;await phase(f);await call(f,'completeYogurtPackaging',outputBody(f));
  const trace=await batchTraceAction(f.client,user,{action:'batchTrace',productId:f.v500.id,lotNumber:f.order.batch_number});assert.equal(trace.backward.order.id,f.order.id);assert.equal(trace.backward.order.actual_output,56);assert.equal(trace.backward.order.planned_output,60);assert.ok(trace.backward.ingredients.some(r=>r.material_id===f.milk.id));assert.equal(trace.backward.ingredients.filter(r=>r.material_id===f.cups.id).reduce((sum,r)=>sum+r.consumed_quantity,0),148);
  const lots=await s.StockBalance.filter({production_order_id:f.order.id});
  assert.equal((await yogurtAction(f.client,user,{action:'releaseYogurtLot',balanceId:lots[0].id,status:'approved'})).order.status,'awaiting_qc');
  await yogurtAction(f.client,user,{action:'releaseYogurtLot',balanceId:lots[1].id,status:'approved'});
  await assert.rejects(yogurtAction(f.client,user,{action:'releaseYogurtLot',balanceId:lots[2].id,status:'rejected'}),/Explain/);
  assert.equal((await yogurtAction(f.client,user,{action:'releaseYogurtLot',balanceId:lots[2].id,status:'rejected',notes:'Seal failure'})).order.status,'rejected');
  await assert.rejects(guardStockStorage(s,'StockBalance','update',{qc_status:'approved'},lots[2]),/checked quality/);
});

test('generic entity writes cannot forge phase metadata, overwrite a plan, or complete yogurt through the old single-output endpoint',async()=>{
  const f=await setup(),context={user,employee:await f.entities.Employee.get('cashier')};
  for(const changes of [{notes:'tamper'},{status:'released'},{yogurt_phase:'complete'},{recipe_kind:''}])assert.throws(()=>guardMutation(context,'ProductionOrder','update',changes,f.order),/checked manufacturing/);
  await assert.rejects(productionAction(f.client,user,{action:'saveProductionPlan',requestKey:crypto.randomUUID(),plan:{recipe_id:f.recipe.id,planned_output:100,production_date:date}}),/phased yogurt/);
  await staff(f,'commercial');await assert.rejects(call(f,'yogurtWorkspace'),/restricted/);
});

test('later phase material issues appear on the warehouse queue and lightweight refresh omits unchanged catalogues',async()=>{
  const f=await setup();await phase(f,'flavouring');const order=await f.entities.ProductionOrder.get(f.order.id);assert.equal(productionReadyForIssue(order),true);
  await staff(f,'warehouse_manager');const queue=await operationalStaffData(f.client.asServiceRole,'warehouse_manager',date,['manufacturing'],await f.entities.Employee.get('cashier'),'warehouse_manager');assert.ok(queue.materialIssueOrders.some(o=>o.id===order.id));
  assert.ok(productionReadyForIssue(queue.materialIssueOrders.find(o=>o.id===order.id)));
  const purchase=await productionRequirements(f.entities,{orderId:f.order.id});assert.ok(purchase.materials.every(m=>m.yogurt_stage!=='fermentation'));assert.ok(purchase.availability.some(r=>r.material_id===f.vanilla.id));
  const data=await call(f,'yogurtWorkspace',{catalogue:false});assert.equal(data.products,undefined);assert.equal(data.recipes,undefined);assert.ok(data.materials.length);
});

test('HTTP completion rolls stock, returns, product cost, all journals and ledger balances back if the final audit fails',async()=>{
  const db=new PGlite();try{
    const f=await setup(db),s=f.entities;await phase(f);const route=await functionRoute();globalThis.__cashierClient=f.client;globalThis.__cashierTransaction=async fn=>{await db.exec('BEGIN');try{const v=await fn();await db.exec('COMMIT');return v;}catch(e){await db.exec('ROLLBACK');throw e;}};
    const before=(await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows,original=s.AuditLog.create;
    s.AuditLog.create=async row=>{if(row.action==='complete_yogurt_packaging')throw Error('Audit unavailable');return original(row);};
    const submit=()=>route(request({action:'completeYogurtPackaging',orderId:f.order.id,...outputBody(f),outputs:[{product_id:f.n250.id,quantity:82},{product_id:f.n500.id,quantity:18},{product_id:f.v500.id,quantity:56}],lossReason:'Higher SKU yield and filling residue'}),{params:Promise.resolve({name:'fieldOps'})});
    const failed=await submit();assert.equal(failed.status,400);assert.deepEqual((await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows,before);
    s.AuditLog.create=original;assert.equal((await submit()).status,200);const committed=(await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows;
    assert.equal((await submit()).status,200);assert.deepEqual((await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows,committed);
  }finally{delete globalThis.__cashierClient;delete globalThis.__cashierTransaction;await db.close();}
});


test('standard bucket estimates use 52 Brassé 500 g cups or 100 drinkable 330 g units without guessing other sizes',()=>{
 assert.equal(emptyYogurtConfig('brasse').expected_kg_per_bucket,26);assert.equal(emptyYogurtConfig('boire').expected_kg_per_bucket,33);
 assert.equal(emptyYogurtConfig('boire').fermentation.find(r=>r.role==='milk').quantity,2.5);assert.equal(emptyYogurtConfig().fermentation.some(r=>r.role==='sugar'),false);
 assert.equal(standardBucketUnits('brasse','500 g'),52);assert.equal(standardBucketUnits('boire','330 g'),100);assert.equal(standardBucketUnits('boire','500 g'),66);
 const c={family:'brasse',outputs:[{product_id:'sku',flavor:'Nature',size:'500 g',standard_units_per_bucket:52}]};assert.deepEqual(standardOutputPlan(c,[{flavor:'Nature',buckets:3}]),[{product_id:'sku',quantity:156}]);
 c.outputs.push({product_id:'other',flavor:'Nature',size:'250 g'});assert.deepEqual(standardOutputPlan(c,[{flavor:'Nature',buckets:3}]),[]);
 assert.deepEqual(yogurtAssemblyPackaging({components:[{product_id:'cup',quantity:1,unit:'ea'},{product_id:'milk',quantity:0.1,unit:'kg'}]},[{id:'cup',inventory_type:'packaging'},{id:'milk',inventory_type:'raw_material'}]),[{material_id:'cup',quantity:1,unit:'ea'}]);
});
test('above-standard output by Warehouse Manager reconciles packaging automatically, retains bucket ingredient usage and posts once',async()=>{
 const f=await setup(),s=f.entities;await phase(f);await staff(f,'warehouse_manager');
 const beforeMilk=await stock(f,f.milk),beforeSugar=await stock(f,f.sugar),beforeFlavour=await stock(f,f.vanilla);
 // Extra 250 g cups and fewer 500 g cups stay within the measured flavour weight.
 const body={...outputBody(f),outputs:[{product_id:f.n250.id,quantity:82},{product_id:f.n500.id,quantity:18},{product_id:f.v500.id,quantity:56}],lossReason:'Higher 250 g yield; filling residue'};
 const result=await call(f,'completeYogurtPackaging',body);assert.equal(result.order.yogurt_packaged_by_role,'warehouse_manager');assert.equal(result.order.yogurt_packaged_by,user.id);
 assert.equal(await stock(f,f.cups),844);assert.equal(await stock(f,f.n250),82);assert.equal(await stock(f,f.n500),18);assert.equal(await stock(f,f.milk),beforeMilk);assert.equal(await stock(f,f.sugar),beforeSugar);assert.equal(await stock(f,f.vanilla),beforeFlavour);
 assert.equal((await s.Account.get(f.wip.id)).balance,0);assert.ok((await s.JournalEntry.list()).every(j=>j.total_debit===j.total_credit));
 const m=(await s.ProductionMaterial.filter({production_order_id:f.order.id})).find(m=>m.yogurt_output_product_id===f.n250.id);assert.equal(m.standard_quantity,80);assert.equal(m.issued_quantity,82);assert.equal(m.consumed_quantity,82);assert.equal(m.yogurt_extra_issued_quantity,2);
 const snapshot=structuredClone(f.rows);assert.equal((await call(f,'completeYogurtPackaging',body)).reused,true);assert.deepEqual(f.rows,snapshot);
});
test('unused packaging from another SKU can cover extra output without requiring fresh warehouse stock',async()=>{
 const f=await setup(),s=f.entities;await phase(f);await legacyPackaging(f);for(const lot of await s.StockBalance.filter({product_id:f.cups.id}))await s.StockBalance.update(lot.id,{quantity:0,total_value:0});
 const result=await call(f,'completeYogurtPackaging',{...outputBody(f),outputs:[{product_id:f.n250.id,quantity:82},{product_id:f.n500.id,quantity:18},{product_id:f.v500.id,quantity:56}],lossReason:'Pack-size mix variance and residue'});
 assert.equal(result.order.actual_output,156);assert.equal(await stock(f,f.cups),4);assert.equal((await s.Account.get(f.wip.id)).balance,0);
});
test('insufficient extra packaging prevents completion before any stock changes, and unavailable units do not become negative',async()=>{
 const f=await setup(),s=f.entities;await phase(f);await s.ProductionOrder.update(f.order.id,{yogurt_measured:[{flavor:'Nature',kg:35},{flavor:'Vanille',kg:35}]});
 for(const lot of await s.StockBalance.filter({product_id:f.cups.id}))await s.StockBalance.update(lot.id,{quantity:1,total_value:2});
 const before=structuredClone(f.rows);await assert.rejects(call(f,'completeYogurtPackaging',{...outputBody(f),outputs:[{product_id:f.n250.id,quantity:84},{product_id:f.n500.id,quantity:20},{product_id:f.v500.id,quantity:62}],lossReason:'Higher measured output and waste'}),/packaging/);assert.deepEqual(f.rows,before);
});


test('drinkable recipe scales 2.5 kg milk, optional 2.5 kg sugar, two flavour bottles and 100 packed 330 g units per bucket',async()=>{
 const f=await setup(),s=f.entities,bottle=await s.Product.create({name:'Flavour bottles',inventory_type:'raw_material',unit_of_measure:'bottle',is_active:true});
 await s.StockBalance.create({product_id:bottle.id,warehouse_id:f.raw.id,quantity:20,unit_cost:3,total_value:60,qc_status:'approved',lot_number:'FLAVOUR-BOTTLES'});
 const product=await s.Product.create({name:'Drinkable Vanilla 330 g',inventory_type:'assembly',unit_of_measure:'ea',product_family:'Yaourt à boire',flavor:'Vanille',size:'330 g',shelf_life_days:14,is_active:true});
 const config={...emptyYogurtConfig('boire'),packaging_from_assembly:false,product_bucket_recipe:false,fermentation:[{role:'milk',material_id:f.milk.id,quantity:2.5,unit:'kg'},{role:'culture',material_id:f.culture.id,quantity:10,unit:'g'}],blends:[{flavor:'Vanille',materials:[{material_id:bottle.id,quantity:2,unit:'bottle',recipe_role:'flavour'},{material_id:f.sugar.id,quantity:2.5,unit:'kg',recipe_role:'sugar'}]}],outputs:[{product_id:product.id,standard_units_per_bucket:100,packaging:[{material_id:f.cups.id,quantity:1,unit:'ea'}]}]};
 const recipe=(await yogurtAction(f.client,user,{action:'saveYogurtRecipe',name:'Drinkable Vanilla 330 g standard',config})).recipe;
 assert.equal(recipe.yogurt_config.outputs[0].standard_units_per_bucket,100);assert.equal(recipe.yogurt_config.blends[0].materials[0].recipe_role,'flavour');
 const allocations=[{flavor:'Vanille',buckets:3,sweetened_buckets:3}],outputs=standardOutputPlan(recipe.yogurt_config,allocations),rows=yogurtRequirements(recipe.yogurt_config,{buckets:3,allocations,outputs});
 assert.equal(rows.find(r=>r.material_id===f.milk.id).quantity,7.5);assert.equal(rows.filter(r=>r.material_id===f.sugar.id).length,1);assert.equal(rows.find(r=>r.material_id===f.sugar.id).quantity,7.5);assert.equal(rows.find(r=>r.material_id===bottle.id).quantity,6);assert.equal(rows.find(r=>r.material_id===f.cups.id).quantity,300);
 const noSugar=structuredClone(recipe.yogurt_config);noSugar.blends[0].materials=noSugar.blends[0].materials.filter(r=>r.recipe_role!=='sugar');assert.equal(yogurtRequirements(noSugar,{buckets:3,allocations:[{flavor:'Vanille',buckets:3,sweetened_buckets:0}],outputs}).some(r=>r.material_id===f.sugar.id),false);
});
test('total output above the standard consumes only the additional packaging and clears WIP at actual batch cost',async()=>{
 const f=await setup(),s=f.entities;await phase(f);await s.ProductionOrder.update(f.order.id,{yogurt_measured:[{flavor:'Nature',kg:35},{flavor:'Vanille',kg:35}]});
 const result=await call(f,'completeYogurtPackaging',{...outputBody(f),outputs:[{product_id:f.n250.id,quantity:84},{product_id:f.n500.id,quantity:20},{product_id:f.v500.id,quantity:62}],lossReason:'Higher measured yield with filling waste'});
 assert.equal(result.order.planned_output,160);assert.equal(result.order.actual_output,166);assert.equal(await stock(f,f.cups),834);assert.equal(await stock(f,f.milk),92);assert.equal(result.order.yogurt_extra_packaging_cost,12);assert.equal(result.order.total_material_cost,441);assert.equal((await s.Account.get(f.wip.id)).balance,0);assert.ok((await s.JournalEntry.list()).every(j=>j.total_debit===j.total_credit));
});


test('post-fermentation sugar scales only sweetened buckets and checked plans preserve that split',async()=>{
 const f=await setup(),config=structuredClone(f.recipe.yogurt_config);config.formula_version=2;config.fermentation=config.fermentation.filter(r=>r.role!=='sugar');config.blends.find(b=>b.flavor==='Vanille').materials.push({material_id:f.sugar.id,quantity:2.5,unit:'kg',recipe_role:'sugar'});
 const recipe=(await yogurtAction(f.client,user,{action:'saveYogurtRecipe',name:'Post-fermentation sugar',config})).recipe;
 await yogurtAction(f.client,user,{action:'approveYogurtRecipe',recipeId:recipe.id});
 const plan={...f.plan,recipe_id:recipe.id,buckets:4,allocations:[{flavor:'Nature',buckets:1,sweetened_buckets:0},{flavor:'Vanille',buckets:3,sweetened_buckets:2}]};
 const saved=(await yogurtAction(f.client,user,{action:'saveYogurtPlan',plan,requestKey:crypto.randomUUID(),status:'draft'})).order;
 assert.equal(saved.yogurt_plan.allocations[1].sweetened_buckets,2);
 const rows=yogurtRequirements(recipe.yogurt_config,plan);assert.equal(rows.find(r=>r.material_id===f.sugar.id).quantity,5);assert.equal(rows.find(r=>r.material_id===f.sugar.id).stage,'flavouring');assert.equal(rows.find(r=>r.material_id===f.milk.id).quantity,16);assert.equal(rows.find(r=>r.material_id===f.vanilla.id).quantity,0.3);
 for(const value of [-1,4,''])assert.throws(()=>yogurtRequirements(recipe.yogurt_config,{...plan,allocations:[plan.allocations[0],{...plan.allocations[1],sweetened_buckets:value}]}));
 const unsweetened=structuredClone(recipe.yogurt_config);unsweetened.blends[1].flavor='Non sucré';unsweetened.outputs.filter(o=>o.flavor==='Vanille').forEach(o=>o.flavor='Non sucré');assert.throws(()=>yogurtRequirements(unsweetened,{...plan,allocations:[plan.allocations[0],{flavor:'Non sucré',buckets:3,sweetened_buckets:1}]}),/unsweetened/);
 const zero={...plan,allocations:plan.allocations.map(a=>({...a,sweetened_buckets:0}))};assert.equal(yogurtRequirements(recipe.yogurt_config,zero).some(r=>r.material_id===f.sugar.id),false);
 const bad=structuredClone(config);bad.fermentation.push({role:'other',material_id:f.sugar.id,quantity:1,unit:'kg'});await assert.rejects(yogurtAction(f.client,user,{action:'saveYogurtRecipe',name:'Bad sugar timing',config:bad}),/after fermentation/);
 const untyped=structuredClone(config);delete untyped.blends[1].materials.at(-1).recipe_role;await assert.rejects(yogurtAction(f.client,user,{action:'saveYogurtRecipe',name:'Bypass',config:untyped}),/sweetened-bucket/);
 assert.equal((await f.entities.ProductionOrder.get(f.order.id)).yogurt_config.formula_version,undefined);
});

test('shared ingredient resolution rejects ambiguity and accepts a single explicit inventory role',()=>{
 const rows=[{id:'a',name:'Milk',inventory_type:'raw_material'},{id:'b',name:'Lait',inventory_type:'raw_material'}];assert.equal(sharedYogurtMaterial(rows,'milk'),null);assert.equal(sharedYogurtMaterial([{...rows[0],yogurt_material_role:'milk'},rows[1]],'milk').id,'a');assert.equal(sharedYogurtMaterial([{...rows[0],is_active:false}],'milk'),null);
});


test('ten bucket product recipe forecasts five 104-cup outputs and phases milk, sugar, flavour and packaging correctly',async()=>{
 const f=await setup(),config={...emptyYogurtConfig(),planned_buckets:10,packaging_from_assembly:false};
 config.fermentation=[{role:'milk',material_id:f.milk.id,quantity:4,unit:'kg'},{role:'culture',material_id:f.culture.id,quantity:10,unit:'g'}];
 const flavours=['Non sucré','Nature','Chocolat','Vanille','Fraise'];config.blends=[];config.outputs=[];
 for(const flavor of flavours){
  const product=await f.entities.Product.create({name:flavor+' Brasse 500 g',inventory_type:'assembly',unit_of_measure:'ea',product_family:'Yaourt brassé',flavor,size:'500 g',shelf_life_days:14,is_active:true});
  const materials=[];if(flavor!=='Non sucré')materials.push({recipe_role:'sugar',material_id:f.sugar.id,quantity:2.5,unit:'kg'});
  if(!['Non sucré','Nature'].includes(flavor)){const ingredient=await f.entities.Product.create({name:flavor+' bottles',flavor,inventory_type:'additive',unit_of_measure:'bottle',is_active:true});materials.push({recipe_role:'flavour',material_id:ingredient.id,quantity:2,unit:'bottle'});}
  materials.push({material_id:f.vanilla.id,quantity:0.01,unit:'kg',recipe_role:'additive'});
  config.blends.push({flavor,materials});config.outputs.push({product_id:product.id,product_name:product.name,flavor,size:'500 g',kg_per_unit:0.5,buckets:2,standard_units_per_bucket:52,packaging:[{material_id:f.cups.id,quantity:1,unit:'ea'}]});
 }
 const recipe=(await yogurtAction(f.client,user,{action:'saveYogurtRecipe',name:'Five flavours 10 buckets',config})).recipe,c=recipe.yogurt_config,plan=recipeBucketPlan(c),rows=yogurtRequirements(c,plan);
 assert.equal(c.planned_buckets,10);assert.equal(plan.buckets,10);assert.deepEqual(plan.outputs.map(o=>o.quantity),[104,104,104,104,104]);assert.equal(rows.find(r=>r.material_id===f.milk.id).quantity,40);assert.equal(rows.filter(r=>r.recipe_role==='sugar').reduce((n,r)=>n+r.quantity,0),20);assert.equal(rows.filter(r=>r.recipe_role==='flavour').reduce((n,r)=>n+r.quantity,0),12);assert.equal(rows.filter(r=>r.stage==='packaging').reduce((n,r)=>n+r.quantity,0),520);
 assert.equal(rows.some(r=>r.flavor==='Non sucré'&&['sugar','flavour'].includes(r.recipe_role)),false);assert.equal(rows.filter(r=>r.recipe_role==='additive').reduce((n,r)=>n+r.quantity,0),0.1);
 assert.deepEqual(recipeBucketPlan(c,20).outputs.map(o=>o.quantity),[208,208,208,208,208]);
 const bad=structuredClone(config);bad.outputs[0].buckets=1;await assert.rejects(yogurtAction(f.client,user,{action:'saveYogurtRecipe',name:'Incomplete split',config:bad}),/add up/);
 const missing=structuredClone(config);missing.blends[2].materials=missing.blends[2].materials.filter(r=>r.recipe_role!=='flavour');await assert.rejects(yogurtAction(f.client,user,{action:'saveYogurtRecipe',name:'Missing flavour',config:missing}),/matching flavour/);
 const wrong=structuredClone(config);wrong.blends[2].materials.find(r=>r.recipe_role==='flavour').quantity=1;await assert.rejects(yogurtAction(f.client,user,{action:'saveYogurtRecipe',name:'Wrong flavour dose',config:wrong}),/two flavour bottles/);
});

test('product bucket forecast separates two pack sizes of the same flavour and drinkable standards',()=>{
 const c={...emptyYogurtConfig('boire'),planned_buckets:3,outputs:[{product_id:'a',flavor:'Vanille',size:'330 g',buckets:2,standard_units_per_bucket:100},{product_id:'b',flavor:'Vanille',size:'500 g',buckets:1,standard_units_per_bucket:66}]};
 const plan=recipeBucketPlan(c);assert.deepEqual(plan.outputs,[{product_id:'a',quantity:200},{product_id:'b',quantity:66}]);assert.deepEqual(plan.allocations,[{flavor:'Vanille',buckets:3,sweetened_buckets:3}]);assert.deepEqual(standardOutputPlan(c,plan.allocations),plan.outputs);
 assert.equal(recipeBucketPlan({...c,outputs:[{...c.outputs[0],buckets:3,size:'250 g',standard_units_per_bucket:''}]}).outputs[0].quantity,396);
 assert.throws(()=>recipeBucketPlan({...c,outputs:[{...c.outputs[0],buckets:3,size:'unconfigured',standard_units_per_bucket:''}]}),/standard units/);
});


test('recipe catalogue is available to active Production without generic Inventory reads and excludes other staff',async()=>{
 const f=await setup();const data=await yogurtAction(f.client,user,{action:'yogurtRecipeCatalogue'});assert.ok(data.products.some(p=>p.id===f.n250.id));assert.ok(data.products.some(p=>p.id===f.milk.id));assert.ok(data.products.some(p=>p.id===f.cups.id));assert.deepEqual(Object.keys(data),['products']);await staff(f,'commercial');await assert.rejects(yogurtAction(f.client,user,{action:'yogurtRecipeCatalogue'}),/restricted/);
});

test('recipe detection reads unambiguous names for both yogurt bases and never treats ml as grams',()=>{
 const p={id:'sku',name:'YOLA Yaourt Brasse Non Sucre 500G',inventory_type:'assembly',unit_of_measure:'ea'};assert.equal(yogurtVariant(p,'brasse').flavor,'Non sucré');assert.equal(yogurtVariant(p,'brasse').kg_per_unit,0.5);
 const drink={...p,name:'YOLA Yaourt a Boire Vanille 330ML'};assert.equal(yogurtProductIdentity(drink,'boire').size,'330 ml');assert.throws(()=>yogurtVariant(drink,'boire'),/net weight/);assert.equal(yogurtVariant(drink,'boire',{net_weight_g:320}).kg_per_unit,0.32);assert.throws(()=>yogurtVariant({...p,name:'Nature Vanille Brasse 500g'},'brasse'),/unambiguous/);assert.throws(()=>yogurtVariant({...p,flavor:'Unknown'},'brasse'),/unambiguous/);
});

test('submission and GM approval check every projected ingredient and packaging before writing or advancing an order',async()=>{
 const f=await setup(),s=f.entities;
 for(const [product,quantity] of [[f.milk,7],[f.cups,159]]){const lot=(await s.StockBalance.filter({product_id:product.id}))[0];await s.StockBalance.update(lot.id,{quantity});}
 // Expired and quarantine inventory cannot conceal missing usable packaging.
 await s.StockBalance.create({product_id:f.cups.id,warehouse_id:f.packs.id,quantity:1000,qc_status:'quarantine'});await s.StockBalance.create({product_id:f.cups.id,warehouse_id:f.packs.id,quantity:1000,qc_status:'approved',expiry_date:'2000-01-01'});
 const before=structuredClone(f.rows);const blocked=await yogurtAction(f.client,user,{action:'saveYogurtPlan',plan:f.plan,status:'awaiting_approval',requestKey:crypto.randomUUID()});assert.equal(blocked.blocked,true);assert.equal(blocked.shortages.find(r=>r.material_id===f.milk.id).required,8);assert.equal(blocked.shortages.find(r=>r.material_id===f.cups.id).required,160);assert.deepEqual(f.rows,before);
 await s.ProductionOrder.update(f.order.id,{status:'awaiting_approval',approved_by:'',approved_at:''});await staff(f,'admin');const snapshot=structuredClone(f.rows);assert.equal((await call(f,'approveProductionOrder')).blocked,true);assert.deepEqual(f.rows,snapshot);
});


test('packaging stays in Inventory until actual output, then consumes only actual cups and commits once',async()=>{
 const f=await setup(),s=f.entities;await phase(f);assert.equal(await stock(f,f.cups),1000);
 assert.equal((await s.ProductionOrder.get(f.order.id)).yogurt_issued_stages.packaging,undefined);
 await staff(f,'warehouse_manager');await assert.rejects(call(f,'issueYogurtStage',{stage:'packaging'}),/deducted from actual finished output/);await staff(f,'production_manager');
 const beforeMilk=await stock(f,f.milk),result=await call(f,'completeYogurtPackaging',outputBody(f));
 assert.equal(await stock(f,f.cups),852);assert.equal(await stock(f,f.milk),beforeMilk);assert.equal(result.order.yogurt_packaging_cost,296);assert.ok(result.order.yogurt_packaging_journal_id);assert.equal(result.order.yogurt_issued_stages.packaging.actual_output,true);
 const m=(await s.ProductionMaterial.filter({production_order_id:f.order.id})).find(m=>m.yogurt_output_product_id===f.n250.id);assert.equal(m.standard_quantity,80);assert.equal(m.issued_quantity,72);assert.equal(m.consumed_quantity,72);assert.equal(m.returned_quantity,0);
 assert.equal((await s.StockMovement.filter({document_id:f.order.id,movement_type:'production_return'})).length,0);assert.equal((await s.Account.get(f.wip.id)).balance,0);
 const snapshot=structuredClone(f.rows);assert.equal((await call(f,'completeYogurtPackaging',outputBody(f))).reused,true);assert.deepEqual(f.rows,snapshot);
});

test('actual packaging shortage stops before any output or issue, while stock sufficient for actual below forecast succeeds',async()=>{
 const f=await setup(),s=f.entities;await phase(f);const lot=(await s.StockBalance.filter({product_id:f.cups.id}))[0];await s.StockBalance.update(lot.id,{quantity:147,total_value:294});await s.StockBalance.create({product_id:f.cups.id,warehouse_id:f.packs.id,quantity:500,qc_status:'quarantine'});
 const snapshot=structuredClone(f.rows);await assert.rejects(call(f,'completeYogurtPackaging',outputBody(f)),/Receive packaging/);assert.deepEqual(f.rows,snapshot);
 await s.StockBalance.update(lot.id,{quantity:148,total_value:296});await call(f,'completeYogurtPackaging',outputBody(f));assert.equal(Number((await s.StockBalance.get(lot.id)).quantity),0);assert.equal(await stock(f,f.n250),72);
});

test('assembly packaging is resolved on recipe save and frozen for approved planning',async()=>{
 const f=await setup(),s=f.entities,config=structuredClone(f.recipe.yogurt_config);config.packaging_from_assembly=true;
 await assert.rejects(yogurtAction(f.client,user,{action:'saveYogurtRecipe',name:'Assembly based',config}),/Configure assembly packaging.*Nature 250/);
 for(const p of [f.n250,f.n500,f.v500])await s.Product.update(p.id,{components:[{product_id:f.cups.id,quantity:1,unit:'ea'},{product_id:f.milk.id,quantity:0.1,unit:'kg'}]});
 // A forged caller packaging line is ignored in favor of the inventory assembly.
 config.outputs[0].packaging=[{material_id:f.milk.id,quantity:999,unit:'kg'}];
 const recipe=(await yogurtAction(f.client,user,{action:'saveYogurtRecipe',name:'Assembly based',config})).recipe;assert.equal(recipe.yogurt_config.packaging_from_assembly,true);assert.deepEqual(recipe.yogurt_config.outputs[0].packaging.map(r=>[r.material_id,r.quantity]),[[f.cups.id,1]]);
 await yogurtAction(f.client,user,{action:'approveYogurtRecipe',recipeId:recipe.id});await s.Product.update(f.n250.id,{components:[{product_id:f.cups.id,quantity:2,unit:'ea'}]});
 const order=(await yogurtAction(f.client,user,{action:'saveYogurtPlan',requestKey:crypto.randomUUID(),status:'draft',plan:{...f.plan,recipe_id:recipe.id}})).order;
 assert.equal(order.yogurt_config.outputs[0].packaging[0].quantity,1);assert.equal((await s.ProductionMaterial.filter({production_order_id:order.id})).find(m=>m.yogurt_output_product_id===f.n250.id).standard_quantity,80);
 const updated=(await yogurtAction(f.client,user,{action:'saveYogurtRecipe',name:'Assembly revised',config:recipe.yogurt_config})).recipe;assert.equal(updated.yogurt_config.outputs[0].packaging[0].quantity,2);
});


test('zero actual output for one planned SKU consumes no packaging for that SKU and records its bulk loss',async()=>{
 const f=await setup(),s=f.entities;await phase(f);const body=outputBody(f);body.outputs[0].quantity=0;const result=await call(f,'completeYogurtPackaging',body);
 const packaging=(await s.ProductionMaterial.filter({production_order_id:f.order.id})).find(m=>m.yogurt_output_product_id===f.n250.id);assert.equal(packaging.issued_quantity,0);assert.equal(packaging.consumed_quantity,0);assert.equal(packaging.total_cost,0);assert.equal(await stock(f,f.cups),924);assert.equal(await stock(f,f.n250),0);assert.equal(result.order.actual_output,76);assert.equal((await s.Account.get(f.wip.id)).balance,0);
});


test('recipe-level identity override configures an active unclassified SKU and stays frozen without overriding explicit Inventory metadata',async()=>{
 const f=await setup(),s=f.entities,product=await s.Product.create({name:'Unclassified finished SKU',inventory_type:'assembly',is_active:true,unit_of_measure:'ea',shelf_life_days:14,components:[{product_id:f.cups.id,quantity:1,unit:'ea'}]});
 const override={family:'brasse',flavor:'Nature',size:'500 g'};
 const config={...emptyYogurtConfig('brasse'),fermentation:[{role:'milk',material_id:f.milk.id,quantity:4,unit:'kg'},{role:'culture',material_id:f.culture.id,quantity:10,unit:'g'}],blends:[{flavor:'Nature',materials:[{material_id:f.sugar.id,quantity:2.5,unit:'kg',recipe_role:'sugar'}]}],outputs:[{product_id:product.id,variant_override:override,buckets:1,standard_units_per_bucket:52}]};
 const saved=(await yogurtAction(f.client,user,{action:'saveYogurtRecipe',name:'Configured unclassified SKU',config})).recipe;assert.deepEqual(saved.yogurt_config.outputs[0].variant_override,override);assert.equal(saved.yogurt_config.outputs[0].flavor,'Nature');assert.equal(saved.yogurt_config.outputs[0].kg_per_unit,0.5);assert.equal(saved.yogurt_config.outputs[0].packaging[0].material_id,f.cups.id);
 const recipe=(await yogurtAction(f.client,user,{action:'approveYogurtRecipe',recipeId:saved.id})).recipe;
 const plan={recipe_id:recipe.id,...recipeBucketPlan(recipe.yogurt_config),production_date:date};
 const order=(await yogurtAction(f.client,user,{action:'saveYogurtPlan',requestKey:crypto.randomUUID(),status:'awaiting_approval',plan})).order;
 assert.deepEqual(order.yogurt_config.outputs[0].variant_override,override);assert.equal(order.yogurt_plan.outputs[0].quantity,52);assert.equal((await s.Product.get(product.id)).flavor,undefined);
 // An explicit item definition is authoritative; the recipe override cannot conceal later drift.
 await s.Product.update(product.id,{product_family:'Yaourt brassé',flavor:'Vanille',size:'500 g'});
 await assert.rejects(yogurtAction(f.client,user,{action:'saveYogurtPlan',requestKey:crypto.randomUUID(),status:'draft',plan}));
 const frozen=await s.ProductionOrder.get(order.id);assert.equal(frozen.yogurt_config.outputs[0].flavor,'Nature');assert.deepEqual(frozen.yogurt_config.outputs[0].variant_override,override);
 assert.equal(yogurtVariant(await s.Product.get(product.id),'brasse',{variant_override:override}).flavor,'Vanille');
 await s.Product.update(product.id,{product_family:'Yaourt à boire'});assert.throws(()=>yogurtVariant({...product,product_family:'Yaourt à boire'},'brasse',{variant_override:override}),/this base/);
});
