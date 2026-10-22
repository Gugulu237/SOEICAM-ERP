import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture,user } from './helpers/cashier.mjs';
import { yogurtAction } from '../src/server/domain/yogurt-production.js';
import { emptyYogurtConfig,recipeBucketPlan,yogurtRequirements } from '../src/lib/yogurt-production.js';
import { productRecipeDraft,commitProductDraft,presetBlend,presetMaterial,recipeCatalogue } from '../src/lib/yogurt-recipe-presets.js';

test('visual presets round-trip through recipe validation and calculate a five-flavour batch without double-counting shared ingredients',async()=>{
 const f=await fixture(),s=f.entities;
 await s.Employee.update('cashier',{role:'production_manager',assigned_role:'production_manager'});
 const make=(name,unit='g',extra={})=>s.Product.create({name,unit_of_measure:unit,inventory_type:'raw_material',is_active:true,...extra});
 const milk=await make('Milk','kg'),culture=await make('Culture'),sugar=await make('Sugar','kg');
 const additives=await Promise.all(['Benzoate','Citric acid','Sorbate'].map(name=>make(name)));
 const flavors=['Non sucré','Nature','Chocolat','Vanille','Fraise'];
 const flavours=await Promise.all(flavors.slice(2).map(flavor=>make(flavor+' flavour','bottle',{flavor})));
 const cups=await make('Cups','ea',{inventory_type:'packaging'});
 for(const family of ['brasse','boire']){
   const products=await Promise.all(flavors.map(flavor=>make(family+' '+flavor,'ea',{inventory_type:'assembly',product_family:family==='brasse'?'Yaourt brasse':'Yaourt a boire',flavor,size:family==='brasse'?'500 g':'330 g',components:[{product_id:cups.id,quantity:1,unit:'ea'}]})));
   const items=[milk,culture,sugar,...additives,...flavours,cups,...products];
   let config=emptyYogurtConfig(family);config.planned_buckets=10;config.fermentation[0].material_id=milk.id;Object.assign(config.fermentation[1],{material_id:culture.id,quantity:10});
   for(const p of products){const draft=productRecipeDraft(p,config,items);draft.output.buckets=2;draft.blend.materials.filter(m=>m.recipe_role==='additive').forEach(m=>m.quantity=1);config=commitProductDraft(config,draft);}
   const saved=(await yogurtAction(f.client,user,{action:'saveYogurtRecipe',name:family+' preset batch',config})).recipe;
   const rows=yogurtRequirements(saved.yogurt_config,recipeBucketPlan(saved.yogurt_config));
   const sum=id=>rows.filter(r=>r.material_id===id).reduce((n,r)=>n+r.quantity,0);
   assert.equal(sum(milk.id),family==='brasse'?40:25);assert.equal(sum(culture.id),100);assert.equal(sum(sugar.id),20);
   for(const flavour of flavours)assert.equal(sum(flavour.id),4);
   for(const additive of additives)assert.equal(sum(additive.id),10);
   assert.equal(sum(cups.id),family==='brasse'?520:1000);
   const fresh=productRecipeDraft(products[1],saved.yogurt_config,items);assert.equal(fresh.blend.materials.length,4);fresh.blend.materials[1].quantity=9;
   assert.equal(saved.yogurt_config.blends.find(b=>b.flavor==='Nature').materials[1].quantity,1,'Editing a reopened product must not mutate the saved snapshot');
   config.blends[0].materials[0].quantity='';await assert.rejects(yogurtAction(f.client,user,{action:'saveYogurtRecipe',name:'Missing dose',config}),/formula quantity/);
 }
});

test('ambiguous ingredients remain unlinked and unspecified additive doses are never invented',()=>{
 const ingredient=(id,name,extra={})=>({id,name,inventory_type:'raw_material',unit_of_measure:'g',...extra});
 const one=ingredient('one','Citric acid'),two=ingredient('two','Acide citrique');
 assert.equal(presetMaterial([one,two],'citric_acid'),null);assert.equal(presetMaterial([one,{...two,is_active:false}],'citric_acid').id,'one');
 const raw=ingredient('flavor','Strawberry flavour',{unit_of_measure:'bottle'}),fg={...raw,id:'fg',inventory_type:'assembly'};
 assert.equal(presetMaterial([raw,fg],'flavour','Fraise').id,raw.id);
 assert.equal(presetMaterial([raw,{...raw,id:'duplicate'}],'flavour','Fraise'),null);
 const blend=presetBlend([one,raw],'Fraise');assert.equal(blend.materials.find(m=>m.recipe_role==='flavour').quantity,2);assert.ok(blend.materials.filter(m=>m.recipe_role==='additive').every(m=>m.quantity===''));
 const volume=presetBlend([{...raw,unit_of_measure:'l'}],'Fraise');assert.equal(volume.materials.find(m=>m.recipe_role==='flavour').quantity,'','Bottle count is not a guessed litre conversion');
 for(const flavor of ['Nature','Non sucré'])assert.equal(presetBlend([raw],flavor).materials.some(m=>m.recipe_role==='flavour'),false);
 assert.equal(presetBlend([], 'Non sucré').materials.some(m=>m.recipe_role==='sugar'),false);
});

test('catalogue retains unclassified and disabled items for setup while separating known yogurt bases',()=>{
 const p={id:'p',name:'Yaourt Brasse Fraise 500g',inventory_type:'assembly',unit_of_measure:'ea'};
 const rows=recipeCatalogue([p,{...p,id:'inactive',is_active:false},{...p,id:'draft',configuration_status:'draft'},{...p,id:'other',name:'Yaourt a boire Nature 330g'},{...p,id:'unknown',name:'New SKU'},{...p,id:'raw',inventory_type:'raw_material'}],'brasse');
 assert.deepEqual(rows.map(r=>r.product_id),['p','inactive','draft','unknown']);assert.equal(rows[0].flavor,'Fraise');assert.equal(rows[0].size,'500 g');assert.ok(rows[1].unavailable);assert.ok(rows[2].unavailable);assert.ok(rows[3].variant_override);
 const generic={...p,name:'Yogurt',flavor:'Nature',size:'500 g'};
 assert.equal(recipeCatalogue([generic],'brasse')[0].flavor,'Nature');const draft=productRecipeDraft(generic,emptyYogurtConfig(),[]);assert.equal(draft.output.flavor,'Nature');assert.equal(draft.output.variant_override.family,'brasse');assert.equal(draft.output.standard_units_per_bucket,52);
});
