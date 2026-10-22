import {isStickerItem,isPackagingItem} from './inventory-packaging.js';
import { PRODUCT_FLAVOURS, canonicalFlavour, variantFamily } from './product-variants.js';
import { normalizeProductText } from './product-images.js';
import { stockUnit } from './item-units.js';
import { emptyPhasedYogurtConfig, fourStageYogurt, sharedYogurtMaterial, standardBucketUnits, yogurtAssemblyPackaging, yogurtProductIdentity } from './yogurt-production.js';

export const PRESERVATIVES = [
  {key:'benzoate',label:'Benzoate',aliases:['benzoate','sodium benzoate','benzoate de sodium']},
  {key:'citric_acid',label:'Citric acid',aliases:['citric acid','acid citric','acide citrique']},
  {key:'sorbate',label:'Sorbate',aliases:['sorbate','sorbate powder','potassium sorbate','sorbate de potassium']},
];
const eligible = item => item.is_active!==false && item.configuration_status!=='draft' && !isPackagingItem(item) && ['raw_material','inventory_part','consumable','additive','inventory_item'].includes(item.inventory_type);
const countUnit = unit => ['ea','each','unit','units','bottle','bottles','bouteille','bouteilles'].includes(String(unit).toLowerCase());
const normalized = text => normalizeProductText(text || '').trim().replace(/\s+/g,' ');

// Only pre-link an ingredient when the catalogue provides one unambiguous match.
export function presetMaterial(items,key,flavor) {
  const candidates=items.filter(eligible);
  let matches;
  if(key==='flavour') {
    const aliases=PRODUCT_FLAVOURS.find(f=>f.value===flavor)?.aliases || [];
    matches=candidates.filter(item=>item.flavor?canonicalFlavour(item.flavor)===flavor:
      aliases.some(alias=>[alias,`flavour ${alias}`,`${alias} flavour`,`flavor ${alias}`,`${alias} flavor`,`arome ${alias}`,`arome de ${alias}`].includes(normalized(item.name))));
  } else {
    const preset=key==='martinal'?{aliases:['martinal','martinal powder','poudre martinal']}:PRESERVATIVES.find(p=>p.key===key);
    const tagged=candidates.filter(item=>item.yogurt_material_role===key);
    matches=tagged.length?tagged:candidates.filter(item=>preset?.aliases.includes(normalized(item.name)));
  }
  return matches.length===1?matches[0]:null;
}

export function presetAdditives(items){return PRESERVATIVES.map(preset=>{const item=presetMaterial(items,preset.key);return {recipe_role:'additive',preset_key:preset.key,material_label:preset.label,material_id:item?.id || '',quantity:'',unit:item?stockUnit(item):'g'};});}
export function linkCultureMeasure(line,item){const unit=stockUnit(item),counted=['tsp','teaspoon','teaspoons'].includes(unit.toLowerCase());return {...line,material_id:item.id,unit,measure_count:2,measure_unit:'teaspoon',quantity_per_measure:counted?1:'',quantity:counted?2:''};}
export function newPhasedRecipe(items,family='brasse'){const config=emptyPhasedYogurtConfig(family);return {...config,additives:presetAdditives(items),fermentation:config.fermentation.map(line=>{const item=sharedYogurtMaterial(items,line.role);return item?line.role==='culture'?linkCultureMeasure(line,item):{...line,material_id:item.id}:line;})};}
export function upgradePhasedRecipe(config,items){
 const next=newPhasedRecipe(items,config.family);
 return {...config,formula_version:3,product_bucket_recipe:true,packaging_from_assembly:true,planned_buckets:config.planned_buckets || config.outputs.length || 1,outputs:config.outputs.map(output=>({...output,buckets:output.buckets || 1,standard_units_per_bucket:output.standard_units_per_bucket || standardBucketUnits(config.family,output.size)})),additives:next.additives.map(line=>{const old=config.blends.map(blend=>blend.materials.find(row=>row.preset_key===line.preset_key || row.material_id&&row.material_id===line.material_id));return old.length&&old.every(row=>row&&row.material_id===old[0].material_id&&Number(row.quantity)===Number(old[0].quantity)&&row.unit===old[0].unit)?{...line,...old[0]}:line;}),fermentation:config.fermentation.filter(line=>line.role!=='sugar'&&line.recipe_role!=='sugar').map(line=>line.role==='culture'?{...line,measure_count:2,measure_unit:'teaspoon',quantity_per_measure:'',quantity:''}:line),blends:config.blends.map(blend=>({...blend,materials:presetBlend(items,blend.flavor,{formula_version:3}).materials.map(row=>{const old=blend.materials.find(line=>line.recipe_role===row.recipe_role);if(row.recipe_role==='flavour'&&old)return {...row,material_id:old.material_id};return row.recipe_role==='sugar'&&old?old:row;})}))};
}
export function presetBlend(items,flavor,config={formula_version:2}) {
  const materials=[];
  if(flavor!=='Non sucré')materials.push({recipe_role:'sugar',material_id:sharedYogurtMaterial(items,'sugar')?.id || '',quantity:2.5,unit:'kg'});
  if(['Fraise','Vanille','Chocolat'].includes(flavor)) {
    const item=presetMaterial(items,'flavour',flavor),unit=item?stockUnit(item):'bottle';
    materials.push({recipe_role:'flavour',material_id:item?.id || '',quantity:countUnit(unit)?2:'',unit,...(fourStageYogurt(config)?{measure_count:2,measure_unit:'bottle',quantity_per_measure:countUnit(unit)?1:''}:{})});
  }
  if(fourStageYogurt(config)&&flavor==='Chocolat'){const item=presetMaterial(items,'martinal');materials.push({recipe_role:'martinal',material_label:'Martinal (20 per bucket)',material_id:item?.id || '',quantity:20,unit:''});}
  for(const preset of fourStageYogurt(config)?[]:PRESERVATIVES) {
    const item=presetMaterial(items,preset.key);
    // Doses must come from the company's formula, never inferred from an item name.
    materials.push({recipe_role:'additive',preset_key:preset.key,material_label:preset.label,material_id:item?.id || '',quantity:'',unit:item?stockUnit(item):'g'});
  }
  return {flavor,materials};
}

export function recipeCatalogue(items,family) {
  return items.filter(item=>['assembly','finished_product'].includes(item.inventory_type)).flatMap(item=>{
    const knownFamily=variantFamily(item);
    if(knownFamily&&knownFamily!==family)return [];
    let identity;
    try {identity=yogurtProductIdentity({...item,is_active:true,configuration_status:'ready'},family,knownFamily?{}:{variant_override:{family}});}
    catch {identity={product_id:item.id,product_name:item.name,flavor:canonicalFlavour(item.flavor) || '',size:item.size || '',variant_override:{family,flavor:'',size:''}};}
    return [{item,...identity,unavailable:item.is_active===false||item.configuration_status==='draft'}];
  });
}

export function productRecipeDraft(item,config,items) {
  const existing=config.outputs.find(o=>o.product_id===item.id);
  let output;
  if(existing)output=structuredClone(existing);
  else {
    let identity;
    try {identity=yogurtProductIdentity(item,config.family,variantFamily(item)?{}:{variant_override:{family:config.family}});}
    catch {identity={product_id:item.id,product_name:item.name,flavor:'',size:'',kg_per_unit:null,variant_override:{family:config.family,flavor:'',size:''}};}
    output={...identity,buckets:1,standard_units_per_bucket:standardBucketUnits(config.family,identity.size),packaging:yogurtAssemblyPackaging(item,items)};
  }
  if(fourStageYogurt(config)){
    output={...output,require_sticker:true,packaging:yogurtAssemblyPackaging(item,items,{...output,family:config.family,require_sticker:true,allowMissingSticker:true})};
    output.sticker_material_id=output.packaging.find(line=>isStickerItem(items.find(p=>p.id===line.material_id)))?.material_id || '';
  }
  const blend=fourStageYogurt(config)&&output.flavor==='Non sucré'?{flavor:output.flavor,materials:[]}:config.blends.find(b=>b.flavor===output.flavor) || presetBlend(items,output.flavor,config);
  return {output,fermentation:structuredClone(config.fermentation),blend:structuredClone(blend)};
}

export function commitProductDraft(config,draft) {
  const outputs=config.outputs.some(o=>o.product_id===draft.output.product_id)?config.outputs.map(o=>o.product_id===draft.output.product_id?draft.output:o):[...config.outputs,draft.output];
  const flavors=[...new Set(outputs.map(o=>o.flavor))];
  return {...config,fermentation:fourStageYogurt(config)?config.fermentation:draft.fermentation,outputs,blends:flavors.map(flavor=>flavor===draft.blend.flavor?draft.blend:config.blends.find(b=>b.flavor===flavor))};
}

// A local editable preview refreshes packaging; approved production snapshots are untouched.
export function refreshRecipePackaging(config,items){
  if(!fourStageYogurt(config))return config;
  return {...config,outputs:config.outputs.map(output=>{
    const product=items.find(item=>item.id===output.product_id);if(!product)return output;
    const packaging=yogurtAssemblyPackaging(product,items,{...output,family:config.family,require_sticker:true,allowMissingSticker:true});
    return {...output,require_sticker:true,packaging,sticker_material_id:packaging.find(line=>isStickerItem(items.find(item=>item.id===line.material_id)))?.material_id || ''};
  })};
}
