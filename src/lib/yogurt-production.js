import {yogurtItemFlavour,yogurtItemSize,yogurtPackingMaterials} from './yogurt-product-materials.js';
import { PRODUCT_FLAVOURS, PRODUCT_SIZES, canonicalFlavour, canonicalSize, variantFamily } from './product-variants.js';
import { isPackagingItem } from './inventory-packaging.js';
import { stockUnit, unitFactor } from './item-units.js';

export const YOGURT_KIND = 'yogurt_phased_v1';
export const YOGURT_BASES = [{ value:'brasse', label:'Yaourt brassé', milk:4 }, { value:'boire', label:'Yaourt à boire', milk:2.5 }];
export const YOGURT_STAGES = ['fermentation','additives','flavouring','packaging'];
export const fourStageYogurt=config=>config?.formula_version===3;
export const yogurtStages=config=>fourStageYogurt(config)?YOGURT_STAGES:['fermentation','flavouring','packaging'];
export const yogurtBase = family => YOGURT_BASES.find(base=>base.value===family);
export const isYogurt = row => row?.recipe_kind===YOGURT_KIND;
// These are net saleable-yield estimates, not a litre-to-mass conversion or an output cap.
export const standardBucketWeight = family => family==='brasse'?26:33;
export const standardBucketUnits = (family,size) => family==='brasse'&&canonicalSize(size)==='500 g'?52:family==='boire'&&['330 g','330 ml'].includes(canonicalSize(size))?100:'';
export function yogurtAssemblyPackaging(product,products,options={}){return yogurtPackingMaterials(product,products,options);}
export function recipeBucketPlan(config,total=config.planned_buckets){
  const buckets=yogurtNumber(total,'whole recipe bucket count',{integer:true,max:10000});
  const base=yogurtNumber(config.planned_buckets,'whole recipe bucket count',{integer:true,max:10000});
  if(!config.outputs.length||Math.abs(config.outputs.reduce((n,o)=>n+yogurtNumber(o.buckets,'product buckets'),0)-base)>1e-6)throw Error('Product buckets must add up to the recipe bucket count.');
  const allocations=[],outputs=[];
  for(const o of config.outputs){
    if(/ml$/i.test(o.size))yogurtNumber(o.net_weight_g,'net weight in grams per finished unit',{max:100000});
    const count=Number(o.buckets)*buckets/base,units=yogurtNumber(o.standard_units_per_bucket || standardBucketUnits(config.family,o.size),'standard units per bucket',{integer:true});
    const quantity=units*count;if(!Number.isSafeInteger(quantity))throw Error('Product bucket allocation must produce whole finished units.');
    let a=allocations.find(a=>a.flavor===o.flavor);if(!a){a={flavor:o.flavor,buckets:0,sweetened_buckets:0};allocations.push(a);}a.buckets=yogurtRound(a.buckets+count);if(o.flavor!=='Non sucré')a.sweetened_buckets=yogurtRound(a.sweetened_buckets+count);
    outputs.push({product_id:o.product_id,quantity});
  }
  return {buckets,allocations,outputs};
}
export function standardOutputPlan(config,allocations){
  if(config.product_bucket_recipe){return allocations.flatMap(a=>{const variants=config.outputs.filter(o=>o.flavor===a.flavor),total=variants.reduce((n,o)=>n+Number(o.buckets),0);return variants.flatMap(v=>{const quantity=Number(v.standard_units_per_bucket || standardBucketUnits(config.family,v.size))*Number(a.buckets)*Number(v.buckets)/total;return Number.isSafeInteger(quantity)&&quantity>0?[{product_id:v.product_id,quantity}]:[];});});}

  return allocations.flatMap(a=>{const variants=config.outputs.filter(o=>o.flavor===a.flavor);if(variants.length!==1)return [];const v=variants[0],quantity=Number(v.standard_units_per_bucket || standardBucketUnits(config.family,v.size))*Number(a.buckets);return Number.isSafeInteger(quantity)&&quantity>0?[{product_id:v.product_id,quantity}]:[];});
}
export function yogurtNumber(value,label,{zero=false,integer=false,max=1e7}={}) {
  const number=Number(value);
  if (!['number','string'].includes(typeof value) || String(value).trim()==='' || !Number.isFinite(number) || (zero?number<0:number<=0) || number>max || integer && !Number.isSafeInteger(number)) throw Error(`Enter a valid ${label}.`);
  return number;
}
export const yogurtRound = value => Math.round((value+Number.EPSILON)*1e6)/1e6;
export function yogurtProductIdentity(product,family,options={}){
  if(!product||product.is_active===false||product.configuration_status==='draft'||!['assembly','finished_product'].includes(product.inventory_type)||(variantFamily(product)||options.variant_override?.family)!==family)throw Error('Choose an active finished yogurt item for this base.');
  const flavor=yogurtItemFlavour(product,options.variant_override?.flavor),size=yogurtItemSize(product,options.variant_override?.size);
  const volume=family==='boire'&&/^(250|330|500)\s*ml$/i.test(size);
  if(!PRODUCT_FLAVOURS.some(f=>f.value===flavor)||!PRODUCT_SIZES[family]?.includes(size)&&!volume)throw Error('Set an unambiguous yogurt flavour and supported size in Inventory quick edit.');
  unitFactor(stockUnit(product),'ea');
  return {...(options.variant_override?{variant_override:{family,flavor,size}}:{}),product_id:product.id,product_name:product.name,flavor,size,kg_per_unit:volume?null:parseFloat(size)/1000};
}
export function yogurtVariant(product,family,options={}){
  const variant=yogurtProductIdentity(product,family,options);
  if(variant.kg_per_unit==null){const grams=yogurtNumber(options.net_weight_g,'net weight in grams per finished unit',{max:100000});return {...variant,net_weight_g:grams,kg_per_unit:grams/1000};}
  return variant;
}
export function emptyYogurtConfig(family='brasse') {
  return { formula_version:2, packaging_from_assembly:true, product_bucket_recipe:true, planned_buckets:1, family, expected_kg_per_bucket:standardBucketWeight(family), fermentation:[{role:'milk',material_id:'',quantity:yogurtBase(family).milk,unit:'kg'},{role:'culture',material_id:'',quantity:'',unit:'g'}], blends:[], outputs:[] };
}
export function emptyPhasedYogurtConfig(family='brasse'){
 const config=emptyYogurtConfig(family);return {...config,formula_version:3,additives:[],fermentation:config.fermentation.map(line=>line.role==='culture'?{...line,measure_count:2,measure_unit:'teaspoon',quantity_per_measure:''}:line)};
}
// Formula quantities are per 30 L bucket; packaging quantities are per finished unit.
// Keep volume and mass separate: the measured blend mass controls final output.
export function yogurtRequirements(config,plan) {
  const buckets=yogurtNumber(plan.buckets,'whole number of buckets',{integer:true,max:10000});
  const allocations=plan.allocations || [], outputs=plan.outputs || [];
  if (!allocations.length || allocations.length>5 || new Set(allocations.map(a=>a.flavor)).size!==allocations.length) throw Error('Allocate the buckets to distinct flavours.');
  if (Math.abs(allocations.reduce((sum,a)=>sum+yogurtNumber(a.buckets,'flavour bucket allocation'),0)-buckets)>1e-6) throw Error('Flavour allocations must add up to the bucket count.');
  const requirements=[];
  const add=(line,factor,stage,extra={})=>requirements.push({...line,...extra,stage,quantity:yogurtRound(yogurtNumber(line.quantity,'material quantity')*factor)});
  config.fermentation.filter(line=>line.role!=='sugar' || Number(line.quantity)!==0).forEach(line=>add(line,buckets,'fermentation'));
  if(fourStageYogurt(config))for(const line of config.additives || [])add(line,buckets,'additives');
  for (const allocation of allocations) {
    const blend=config.blends.find(b=>b.flavor===allocation.flavor);
    if(!blend)throw Error('Choose flavours configured in this recipe.');
    if(config.formula_version>=2){
      const sweet=yogurtNumber(allocation.sweetened_buckets ?? 0,'sweetened bucket count',{zero:true});
      if(sweet>Number(allocation.buckets) || allocation.flavor==='Non sucré'&&sweet>0)throw Error('Sweetened buckets must fit this flavour allocation; unsweetened yogurt cannot contain added sugar.');
      if(config.product_bucket_recipe&&allocation.flavor!=='Non sucré'&&Math.abs(sweet-Number(allocation.buckets))>1e-6)throw Error('Sweetened products require sugar for all allocated buckets.');
      if(sweet>0&&!blend.materials.some(r=>r.recipe_role==='sugar'))throw Error('Configure sugar for the sweetened buckets.');
      blend.materials.forEach(line=>{const factor=line.recipe_role==='sugar'?sweet:Number(allocation.buckets);if(factor>0)add(line,factor,'flavouring',{flavor:allocation.flavor});});
    }else blend.materials.forEach(line=>add(line,Number(allocation.buckets),'flavouring',{flavor:allocation.flavor}));
  }
  if(!outputs.length || outputs.length>50 || new Set(outputs.map(o=>o.product_id)).size!==outputs.length)throw Error('Plan 1 to 50 distinct finished products.');
  for(const output of outputs) {
    const variant=config.outputs.find(o=>o.product_id===output.product_id);
    if(!variant || !allocations.some(a=>a.flavor===variant.flavor))throw Error('Every finished product needs an allocated flavour.');
    const quantity=yogurtNumber(output.quantity,'whole finished-product quantity',{integer:true});
    variant.packaging.forEach(line=>add(line,quantity,'packaging',{output_product_id:variant.product_id}));
  }
  for(const allocation of allocations) {
    const mass=outputs.reduce((sum,o)=>{const v=config.outputs.find(v=>v.product_id===o.product_id);return sum+(v?.flavor===allocation.flavor?Number(o.quantity)*v.kg_per_unit:0);},0);
    if(!mass || mass>Number(allocation.buckets)*Number(config.expected_kg_per_bucket)+1e-6)throw Error('Planned packed weight must fit the expected weight of each allocated flavour.');
  }
  return requirements;
}
export function packagingReport(config,plan,measured,actual,lossReason='') {
  if(!Array.isArray(actual) || actual.length!==plan.outputs.length || new Set(actual.map(o=>o.product_id)).size!==actual.length)throw Error('Report every planned finished product exactly once.');
  const outputs=actual.map(row=>{
    const planned=plan.outputs.find(p=>p.product_id===row.product_id),variant=config.outputs.find(v=>v.product_id===row.product_id);
    const quantity=yogurtNumber(row.quantity,'actual whole finished-product quantity',{integer:true,zero:true});
    if(!planned || !variant)throw Error('Actual output must use the approved finished products.');
    if(quantity>Number(planned.quantity) && !String(lossReason).trim())throw Error('Explain the actual output above the standard plan.');
    return {...variant,quantity,packed_kg:yogurtRound(quantity*variant.kg_per_unit)};
  });
  if(!outputs.some(o=>o.quantity>0))throw Error('Report at least one finished unit.');
  const yields=plan.allocations.map(a=>{
    const kg=yogurtNumber(measured.find(m=>m.flavor===a.flavor)?.kg,'measured blend weight');
    const packed=yogurtRound(outputs.filter(o=>o.flavor===a.flavor).reduce((s,o)=>s+o.packed_kg,0));
    if(packed>kg+1e-6)throw Error('Packed weight exceeds the measured blend weight for '+a.flavor+'.');
    return {flavor:a.flavor,measured_kg:kg,packed_kg:packed,loss_kg:yogurtRound(kg-packed)};
  });
  if(yields.some(y=>y.loss_kg>0) && !String(lossReason).trim())throw Error('Explain the unpacked yogurt recorded as process loss.');
  return {outputs,yields};
}

// Resolve shared ingredients only when Inventory has one unambiguous match. Never guess.
export function sharedYogurtMaterial(items,role){
  const aliases={milk:['milk','lait','milk powder','powdered milk','lait en poudre'],sugar:['sugar','sucre'],culture:['culture','yogurt culture','yoghurt culture','ferment','ferments','culture yaourt']};
  const normalize=value=>String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/\s+/g,' ');
  const eligible=items.filter(p=>p.is_active!==false&&p.configuration_status!=='draft'&&!isPackagingItem(p)&&['raw_material','inventory_part','consumable','additive','inventory_item'].includes(p.inventory_type));
  const tagged=eligible.filter(p=>p.yogurt_material_role===role);
  const matches=tagged.length?tagged:eligible.filter(p=>aliases[role]?.includes(normalize(p.name)));
  return matches.length===1?matches[0]:null;
}
