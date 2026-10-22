import { normalizeProductText, productPresentation } from './product-images.js';
import { isAssemblyInventoryType } from './item-types.js';

export const PRODUCT_FLAVOURS = [
  {value:'Fraise',label:'Strawberry',aliases:['strawberry','strawberr','fraise']},
  {value:'Vanille',label:'Vanilla',aliases:['vanilla','vanille']},
  {value:'Non sucré',label:'Unsweetened',aliases:['unsweetened','non sucre','sans sucre','sans sucres','nonsucre','non sucree','nature non sucre','non sucre nature','no sugar','sugar free','no added sugar','no added sugars']},
  {value:'Nature',label:'Nature',aliases:['nature','natural','plain']},
  {value:'Chocolat',label:'Chocolate',aliases:['chocolate','chocolat']},
];
export const PRODUCT_SIZES = {brasse:['250 g','500 g','1000 g','2500 g','10000 g'],boire:['250 g','330 g','500 g']};
const key = value => normalizeProductText(value || '').trim().replace(/\s+/g,' ');
export const flavourChoice = value => PRODUCT_FLAVOURS.find(option => option.aliases.includes(key(value)));
export const canonicalFlavour = value => flavourChoice(value)?.value || String(value || '').trim();
export function canonicalSize(value) {
  const text=String(value || '').trim(), match=text.toLowerCase().replace(',','.').match(/^(\d+(?:[.,]\d+)?)\s*(g|kg|grams?|grammes?|kilograms?|kilogrammes?)$/);
  if(!match)return text;
  const grams=Number(match[1])*(match[2].startsWith('k')?1000:1);
  return Number.isFinite(grams) && grams>0 ? `${Math.round(grams*1e6)/1e6} g` : text;
}
export function variantFamily(item) {
  const classify=value=>/\b(boire|drink|drinkable|bottles?)\b/.test(key(value))?'boire':/\b(brasse|stirred|cups?|tubs?)\b/.test(key(value))?'brasse':'';
  return typeof item==='string'?classify(item):classify(item?.product_family) || classify([item?.category,item?.name,productPresentation(item || {}).family].join(' '));
}
export function productSizeChoices(item) {
  return PRODUCT_SIZES[variantFamily(item)] || [...new Set([...PRODUCT_SIZES.brasse,...PRODUCT_SIZES.boire])].sort((a,b)=>parseFloat(a)-parseFloat(b));
}

// Only explicitly changed variant fields are normalized. Historical volume
// labels stay readable; no ml-to-g conversion or product-record migration occurs.
export function validateFinishedVariantChanges(input, existing={}) {
  if(!isAssemblyInventoryType(input.inventory_type ?? existing?.inventory_type))return {};
  const result={}, combined={...existing,...input};
  if(Object.hasOwn(input,'flavor')) {
    const value=canonicalFlavour(input.flavor);
    if(value && !flavourChoice(value) && value!==String(existing?.flavor || '').trim())throw Error('Choose Strawberry, Vanilla, Unsweetened, Nature or Chocolate.');
    result.flavor=value;
  }
  const familyChanged=Object.hasOwn(input,'product_family') && variantFamily(combined)!==variantFamily(existing);
  if(Object.hasOwn(input,'size') || familyChanged) {
    const value=canonicalSize(combined.size), allowed=productSizeChoices(combined);
    const unchangedLegacy=!familyChanged && value===canonicalSize(existing?.size);
    if(value && !allowed.includes(value) && !unchangedLegacy)throw Error('Choose a size available for this product family.');
    if(Object.hasOwn(input,'size'))result.size=value;
  }
  return result;
}
