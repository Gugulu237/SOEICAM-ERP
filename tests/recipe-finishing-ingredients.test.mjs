import test from 'node:test';
import assert from 'node:assert/strict';
import {fourStageFixture,act,asRole,quantity,readyToPack} from './helpers/four-stage-yogurt.mjs';
import {recipeBucketPlan,yogurtRequirements} from '../src/lib/yogurt-production.js';

async function withFinishingIngredient({stock=1000}={}){
  const f=await fourStageFixture({flavors:['Fraise'],createOrder:false}),s=f.entities;
  const extra=await s.Product.create({name:'Synthetic finishing ingredient',inventory_type:'additive',unit_of_measure:'g',is_active:true});
  await s.StockBalance.create({product_id:extra.id,product_name:extra.name,warehouse_id:f.raw.id,quantity:stock,unit_cost:0.5,total_value:stock*0.5,lot_number:'FINISHING',qc_status:'approved',expiry_date:'2030-12-31'});
  const config=structuredClone(f.config);
  config.blends[0].materials.push({material_id:extra.id,quantity:0.15,unit:'kg',recipe_role:'additive'});
  const recipe=(await act(f,'saveYogurtRecipe',{name:'Synthetic finishing formula',config})).recipe;
  await act(f,'approveYogurtRecipe',{recipeId:recipe.id});
  return {...f,extra,config:recipe.yogurt_config,recipe,plan:{...f.plan,recipe_id:recipe.id,...recipeBucketPlan(recipe.yogurt_config)}};
}

test('extra finishing ingredients survive save, scale by flavour buckets, issue at flavouring and reconcile final inventory costs',async()=>{
  const f=await withFinishingIngredient(),s=f.entities;
  const requirement=yogurtRequirements(f.config,recipeBucketPlan(f.config)).find(row=>row.material_id===f.extra.id);
  assert.equal(requirement.stage,'flavouring');assert.equal(requirement.flavor,'Fraise');assert.equal(requirement.quantity,0.3);assert.equal(requirement.unit,'kg');
  f.order=(await act(f,'saveYogurtPlan',{plan:f.plan,status:'awaiting_approval',requestKey:crypto.randomUUID()})).order;
  const material=(await s.ProductionMaterial.filter({production_order_id:f.order.id})).find(row=>row.material_id===f.extra.id);
  assert.equal(material.standard_quantity,300);assert.equal(material.unit,'g');
  await readyToPack(f);assert.equal(await quantity(f,f.extra),700);
  const posted=await s.ProductionMaterial.get(material.id);assert.equal(posted.total_cost,150);assert.equal(posted.yogurt_stage,'flavouring');
  const result=await act(f,'completeYogurtPackaging',{outputs:f.plan.outputs,warehouseId:f.cold.id,lossReason:'Synthetic filling residue',lossAccountId:'expense'});
  assert.equal(result.order.actual_output,104);assert.equal(Number((await s.Account.get(f.wip.id)).balance),0);
  assert.equal(result.order.total_material_cost,Math.round((result.order.yogurt_finished_cost+result.order.yogurt_loss_cost)*100)/100);
});

test('shortages in an added finishing ingredient block production before a request is written',async()=>{
  const f=await withFinishingIngredient({stock:299});
  const result=await act(f,'saveYogurtPlan',{plan:f.plan,status:'awaiting_approval',requestKey:crypto.randomUUID()});
  assert.equal(result.blocked,true);assert.ok(result.shortages.some(row=>row.material_id===f.extra.id));
  assert.equal((await f.entities.ProductionOrder.filter({})).length,0);assert.equal(await quantity(f,f.extra),299);
});

test('invalid extra components cannot duplicate common materials or use incompatible inventory units',async()=>{
  const f=await withFinishingIngredient();
  const config=structuredClone(f.config);config.blends[0].materials.push({...config.additives[0]});
  await assert.rejects(act(f,'saveYogurtRecipe',{name:'Duplicated shared additive',config}),/must not be repeated/);
  const invalid=structuredClone(f.config);invalid.blends[0].materials.find(row=>row.material_id===f.extra.id).unit='l';
  await assert.rejects(act(f,'saveYogurtRecipe',{name:'Wrong finishing unit',config:invalid}),/compatible/);
  await asRole(f,'warehouse_manager');await assert.rejects(act(f,'saveYogurtRecipe',{name:'Unauthorized change',config:f.config}),{status:403});
});
