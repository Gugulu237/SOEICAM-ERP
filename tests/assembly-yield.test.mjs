import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { assemblyBucketYield,estimatedBucketUnits,validateAssemblyYieldChanges,assemblyRecipeYield } from '../src/lib/assembly-yield.js';
import { quickItemDraft,buildQuickItemChanges } from '../src/lib/item-quick-edit.js';
import { itemFormChanges } from '../src/lib/item-form-save.js';
import { saveItem } from '../src/server/domain/item-save.js';
import { guardMutation } from '../src/server/access.js';
import { yogurtAction } from '../src/server/domain/yogurt-production.js';
import { productRecipeDraft,refreshRecipePackaging } from '../src/lib/yogurt-recipe-presets.js';
import { fourStageFixture,user } from './helpers/four-stage-yogurt.mjs';
const gm={user:{id:'gm',role:'admin',full_name:'Manager'}};
const item={id:'yogurt',inventory_type:'assembly',unit_of_measure:'ea',product_family:'Yaourt brassé',size:'500 g',flavor:'Nature'};

test('whole unit estimates follow yogurt family and gram pack size, including 52 cups of 500 g brassé',()=>{
  for(const [size,units] of [['250 g',104],['500 g',52],['1 kg',26],['2.5 kg',10],['10000 g',2]])assert.equal(estimatedBucketUnits('brasse',size),units);
  for(const [size,units] of [['250 g',132],['330 g',100],['500 g',66]])assert.equal(estimatedBucketUnits('boire',size),units);
  assert.equal(estimatedBucketUnits('unknown','500 g'),'');
  assert.equal(assemblyBucketYield(item).units,52);
  assert.equal(assemblyBucketYield({...item,yogurt_units_per_bucket:48}).units,48);
  assert.equal(assemblyBucketYield({...item,size:'1000 g'}).units,26);
});

test('volume sizes require confirmed net grams and do not silently convert ml to grams',()=>{
  const drink={...item,product_family:'Yaourt à boire',size:'330 ml'};
  assert.equal(assemblyBucketYield(drink).units,'');
  assert.equal(assemblyBucketYield({...drink,yogurt_net_weight_g:320}).units,103);
  assert.equal(assemblyBucketYield({...drink,yogurt_net_weight_g:330,yogurt_units_per_bucket:98}).units,98);
  assert.deepEqual(assemblyRecipeYield({...drink,yogurt_net_weight_g:320},'boire'),{standard_units_per_bucket:103,net_weight_g:320,kg_per_unit:0.32});
});

test('yield edits reject malformed or inapplicable values and discard an old size estimate after a size or family change',()=>{
  for(const value of [0,-1,1.5,' ',true,{},[],Infinity,1000001])assert.throws(()=>validateAssemblyYieldChanges({yogurt_units_per_bucket:value},item));
  assert.deepEqual(validateAssemblyYieldChanges({yogurt_units_per_bucket:'48'},item),{yogurt_units_per_bucket:48});
  assert.deepEqual(validateAssemblyYieldChanges({yogurt_units_per_bucket:''},item),{yogurt_units_per_bucket:null});
  assert.deepEqual(validateAssemblyYieldChanges({size:'1000 g'},{...item,yogurt_units_per_bucket:48}),{yogurt_units_per_bucket:null});
  assert.throws(()=>validateAssemblyYieldChanges({yogurt_units_per_bucket:48},{...item,inventory_type:'raw_material'}));
  assert.throws(()=>validateAssemblyYieldChanges({yogurt_units_per_bucket:48},{...item,unit_of_measure:'kg'}));
  assert.throws(()=>validateAssemblyYieldChanges({yogurt_net_weight_g:500},item));
  const original={...item,yogurt_units_per_bucket:48};
  assert.deepEqual(itemFormChanges(original,{...original,yogurt_units_per_bucket:'48'}),{});
  assert.deepEqual(buildQuickItemChanges(original,quickItemDraft(original)),{});
  assert.equal(buildQuickItemChanges(original,{...quickItemDraft(original),size:'1000 g'}).yogurt_units_per_bucket,null);
  assert.throws(()=>guardMutation(gm,'ProductionOrder','update',{yogurt_units_per_bucket:52},{status:'draft'}),/checked manufacturing/);
  assert.throws(()=>guardMutation(gm,'Product','update',{yogurt_phase:'packaging'},item),/checked manufacturing/);
});

test('saving an assembly yield is revision checked, audited and leaves quantities, costs, journals and approved recipes unchanged',async()=>{
  const f=await fourStageFixture({flavors:['Non sucré'],createOrder:false}),s=f.entities,p=f.products[0];
  await s.Product.update(p.id,{updated_date:'v1'});
  const before={stock:await s.StockBalance.list(),journals:await s.JournalEntry.list(),recipe:await s.Recipe.get(f.recipe.id)};
  const saved=await saveItem(gm,s,{id:p.id,updatedDate:'v1',changes:{yogurt_units_per_bucket:48}},{quick:true});
  assert.equal(saved.yogurt_units_per_bucket,48);assert.deepEqual(saved.components,p.components);
  const audit=(await s.AuditLog.list()).find(a=>a.action==='update_item_attributes'&&a.entity_id===p.id);
  assert.equal(audit.user_id,gm.user.id);assert.equal(audit.item_metadata_after.yogurt_units_per_bucket,48);
  assert.deepEqual(await s.StockBalance.list(),before.stock);assert.deepEqual(await s.JournalEntry.list(),before.journals);assert.deepEqual(await s.Recipe.get(f.recipe.id),before.recipe);
  await assert.rejects(saveItem(gm,s,{id:p.id,updatedDate:'stale',changes:{yogurt_units_per_bucket:40}},{quick:true}),{status:409});
});

test('new recipe drafts use the current assembly yield even when the submitted recipe contains a different estimate; approved plans keep their snapshot',async()=>{
  const f=await fourStageFixture({flavors:['Non sucré'],createOrder:false}),s=f.entities,p=f.products[0];
  await s.Product.update(p.id,{yogurt_units_per_bucket:48});
  const products=await s.Product.list(),current=await s.Product.get(p.id);
  assert.equal(productRecipeDraft(current,f.recipe.yogurt_config,products).output.standard_units_per_bucket,48);
  assert.equal(refreshRecipePackaging(f.recipe.yogurt_config,products).outputs[0].standard_units_per_bucket,48);
  assert.equal(f.recipe.yogurt_config.outputs[0].standard_units_per_bucket,52);
  const config=structuredClone(f.recipe.yogurt_config);config.outputs[0].standard_units_per_bucket=999;
  const next=(await yogurtAction(f.client,user,{action:'saveYogurtRecipe',recipeId:f.recipe.id,name:'Revised assembly yield',config})).recipe;
  assert.equal(next.yogurt_config.outputs[0].standard_units_per_bucket,48);assert.notEqual(next.id,f.recipe.id);
  assert.equal((await s.Recipe.get(f.recipe.id)).yogurt_config.outputs[0].standard_units_per_bucket,52);
  const old=(await yogurtAction(f.client,user,{action:'saveYogurtPlan',requestKey:crypto.randomUUID(),status:'draft',plan:f.plan})).order;
  assert.equal(old.yogurt_plan.outputs[0].quantity,104);
  await yogurtAction(f.client,user,{action:'approveYogurtRecipe',recipeId:next.id});
  const plan={...f.plan,recipe_id:next.id,outputs:[{product_id:p.id,quantity:96}]};
  const order=(await yogurtAction(f.client,user,{action:'saveYogurtPlan',requestKey:crypto.randomUUID(),status:'awaiting_approval',plan})).order;
  assert.equal(order.yogurt_plan.outputs[0].quantity,96);
  assert.equal((await s.ProductionMaterial.filter({production_order_id:order.id,material_id:f.cups.id}))[0].standard_quantity,96);
});

test('assembly yield changes roll back if their audit cannot be recorded',async()=>{
  const db=new PGlite();
  try{
    const f=await fourStageFixture({db,flavors:['Non sucré'],createOrder:false}),s=f.entities,p=f.products[0];
    await s.Product.update(p.id,{updated_date:'v1'});
    const before=(await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows;
    s.AuditLog.create=async()=>{throw Error('Audit unavailable');};
    await db.exec('BEGIN');
    await assert.rejects(saveItem(gm,s,{id:p.id,updatedDate:'v1',changes:{yogurt_units_per_bucket:48}},{quick:true}),/Audit unavailable/);
    await db.exec('ROLLBACK');assert.deepEqual((await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows,before);
  }finally{await db.close();}
});
