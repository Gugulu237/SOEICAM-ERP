import { canonicalSize, variantFamily } from './product-variants.js';
import { yogurtItemSize } from './yogurt-product-materials.js';
import { isAssemblyInventoryType } from './item-types.js';
import { stockUnit, unitFactor } from './item-units.js';

export const YOGURT_YIELD_FIELDS = ['yogurt_units_per_bucket','yogurt_net_weight_g'];
export const bucketYieldWeight = family => family==='brasse'?26:family==='boire'?33:null;
const present = value => value!=null && value!=='';
export function estimatedBucketUnits(family,size,netWeightG) {
  const normalized=canonicalSize(size),mass=/^(\d+(?:\.\d+)?) g$/.exec(normalized);
  // Volume labels need a measured net weight; never assume ml equals grams.
  const grams=mass?Number(mass[1]):/ml$/i.test(normalized)&&present(netWeightG)?Number(netWeightG):0;
  const weight=bucketYieldWeight(family);
  if(!weight || !Number.isFinite(grams) || grams<=0)return '';
  const units=Math.floor((weight*1000+1e-7)/grams);
  return Number.isSafeInteger(units)&&units>0?units:'';
}
export function assemblyBucketYield(item={},options={}) {
  const family=variantFamily(item)||options.family,size=yogurtItemSize(item,options.size);
  const netWeightG=present(item?.yogurt_net_weight_g)?Number(item.yogurt_net_weight_g):options.net_weight_g;
  const configured=present(item?.yogurt_units_per_bucket)?Number(item.yogurt_units_per_bucket):null;
  const estimate=estimatedBucketUnits(family,size,netWeightG);
  return {family,size,net_weight_g:netWeightG,estimated_units:estimate,units:configured??estimate,configured:configured!=null};
}
export function validateAssemblyYieldChanges(input,existing={}) {
  const combined={...existing,...input},result={};
  const identityChanged=variantFamily(combined)!==variantFamily(existing)||yogurtItemSize(combined)!==yogurtItemSize(existing);
  for(const field of YOGURT_YIELD_FIELDS) {
    if(!Object.hasOwn(input,field)) {
      if(identityChanged&&present(existing[field]))result[field]=null;
      continue;
    }
    const value=input[field];
    if(value==null||value===''){result[field]=null;continue;}
    // A carried-over estimate must not follow a product into a different size.
    if(identityChanged&&present(existing[field])&&Number(value)===Number(existing[field])){result[field]=null;continue;}
    const volume=/ml$/i.test(yogurtItemSize(combined));
    if(!isAssemblyInventoryType(combined.inventory_type)||!bucketYieldWeight(variantFamily(combined))||!yogurtItemSize(combined))throw Error('Choose a yogurt assembly, family and size before setting its bucket yield.');
    unitFactor(stockUnit(combined),'ea');
    const number=Number(value),weight=field==='yogurt_net_weight_g';
    if(!['number','string'].includes(typeof value)||!String(value).trim()||!Number.isFinite(number)||number<=0||number>(weight?100000:1000000)||!weight&&!Number.isSafeInteger(number))throw Error(weight?'Enter a valid net weight in grams.':'Enter a positive whole estimated units per bucket.');
    if(weight&&!volume)throw Error('Net weight is only needed for volume-labelled yogurt sizes.');
    result[field]=number;
  }
  return result;
}

// Used only for editable recipes. Approved recipes and production orders retain
// their reviewed snapshots until someone saves and approves a new version.
export function assemblyRecipeYield(product,family,output={}) {
  const yieldInfo=assemblyBucketYield(product,{...output,family});
  return {
    standard_units_per_bucket:yieldInfo.units || output.standard_units_per_bucket || '',
    ...(/ml$/i.test(yieldInfo.size)&&present(yieldInfo.net_weight_g)?{net_weight_g:Number(yieldInfo.net_weight_g),kg_per_unit:Number(yieldInfo.net_weight_g)/1000}:{}),
  };
}
