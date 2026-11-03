import {productPresentation,normalizeProductText} from './product-images.js';
import {canonicalFlavour,flavourChoice,PRODUCT_FLAVOURS} from './product-variants.js';
import {getLocale,ui} from './i18n.js';

export const PRODUCT_SORT_OPTIONS=[
  ['name','Name (A–Z)'],['size','Size: smallest first'],
  ['size-desc','Size: largest first'],['flavour','Flavour (A–Z)'],
];
function sizeKey(value) {
  const text=normalizeProductText(String(value||'')).trim().replace(',','.');
  const match=text.match(/^(\d+(?:\.\d+)?)\s*(mg|g|kg|ml|cl|l|grams?|grammes?|kilograms?|kilogrammes?|litres?|liters?)$/);
  if(!match||!(Number(match[1])>0))return {kind:text?2:3,text};
  const unit=match[2],mass=/^(mg|g|kg|gram|kilogram)/.test(unit);
  const factor=unit==='mg'?0.001:unit==='kg'||unit.startsWith('kilogram')?1000:unit==='cl'?10:unit==='l'||unit.startsWith('lit')?1000:1;
  return {kind:mass?0:1,value:Number(match[1])*factor,text};
}
export function compareProductSizes(a,b,descending=false,locale=getLocale()) {
  const x=sizeKey(a),y=sizeKey(b);
  // Mass and volume are separate dimensions; missing sizes always come last.
  if(x.kind!==y.kind)return x.kind-y.kind;
  if(x.kind<2)return (x.value-y.value)*(descending?-1:1);
  return x.text.localeCompare(y.text,locale,{numeric:true,sensitivity:'base'});
}
function details(product) {
  const shown=productPresentation(product),name=product.name||product.product_name||'';
  const inferredSize=String(name).match(/\b\d+(?:[.,]\d+)?\s*(?:kg|mg|ml|cl|g|l)\b/i)?.[0]||'';
  const words=' '+normalizeProductText(name).replace(/[^a-z0-9]+/g,' ').trim()+' ';
  const matches=PRODUCT_FLAVOURS.filter(option=>option.aliases.some(alias=>words.includes(' '+alias+' ')));
  const inferredFlavour=matches.find(option=>option.value==='Non sucré')?.value||(matches.length===1?matches[0].value:'');
  const flavour=canonicalFlavour(product.flavor||product.flavour||shown.flavor||inferredFlavour);
  return {name,size:product.size||shown.size||inferredSize,flavour:flavourChoice(flavour)?ui(flavourChoice(flavour).label):flavour,id:String(product.id||product.product_id||'')};
}
export function sortProductRows(rows,mode='name',getProduct=row=>row) {
  const locale=getLocale(),text=(a,b)=>a.localeCompare(b,locale,{numeric:true,sensitivity:'base'});
  const flavour=(a,b)=>!a.flavour!==!b.flavour?(a.flavour?-1:1):text(a.flavour,b.flavour);
  return rows.map(row=>({row,...details(getProduct(row)||{})})).sort((a,b)=>{
    let order=0;
    if(mode==='size'||mode==='size-desc')order=compareProductSizes(a.size,b.size,mode==='size-desc',locale)||flavour(a,b);
    if(mode==='flavour')order=flavour(a,b)||compareProductSizes(a.size,b.size,false,locale);
    return order||text(a.name,b.name)||text(a.id,b.id);
  }).map(entry=>entry.row);
}
