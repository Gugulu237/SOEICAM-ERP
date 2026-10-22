import {isPackagingItem,isStickerItem} from './inventory-packaging.js';
import {itemAttributes,attributeKey} from './item-attributes.js';
import {PRODUCT_FLAVOURS,canonicalFlavour,canonicalSize,variantFamily} from './product-variants.js';
import {normalizeProductText} from './product-images.js';
import {stockUnit,unitFactor} from './item-units.js';

const attr=(item,names)=>itemAttributes(item).find(row=>names.includes(attributeKey(row.name)))?.value;
export function yogurtItemFlavour(item,override=''){
  const explicit=item.flavor||attr(item,['flavor','flavour']);
  if(explicit)return canonicalFlavour(explicit);
  const name=normalizeProductText(item.name||'');
  const matches=PRODUCT_FLAVOURS.filter(flavor=>flavor.aliases.some(alias=>new RegExp('(?:^|\\W)'+normalizeProductText(alias).replace(/ /g,'\\s+')+'(?:$|\\W)').test(name)));
  // "Nature non sucré" identifies pure unsweetened yogurt, rather than two flavours.
  if(matches.some(f=>f.value==='Non sucré')&&matches.every(f=>['Non sucré','Nature'].includes(f.value)))return 'Non sucré';
  return matches.length===1?matches[0].value:canonicalFlavour(override);
}
export function yogurtItemSize(item,override=''){
  const explicit=item.size||attr(item,['size','capacity']);if(explicit)return canonicalSize(explicit);
  const sizes=[...normalizeProductText(item.name||'').matchAll(/\b(\d+(?:\.\d+)?)\s*(kg|g|ml)\b/g)].map(match=>canonicalSize(match[1]+' '+match[2]));
  return new Set(sizes).size===1?sizes[0]:canonicalSize(override);
}
export function yogurtStickerChoices(product,items,output={}){
  const flavor=yogurtItemFlavour(product,output.flavor),size=yogurtItemSize(product,output.size),family=variantFamily(product)||output.family;
  return items.filter(item=>isStickerItem(item)&&item.is_active!==false&&item.configuration_status!=='draft'&&yogurtItemFlavour(item)===flavor&&yogurtItemSize(item)===size&&(!variantFamily(item)||variantFamily(item)===family));
}
export function yogurtPackingMaterials(product,items,options={}){
  const map=new Map(items.map(item=>[item.id,item]));
  const lines=(product.components||[]).filter(row=>map.has(row.product_id)&&isPackagingItem(map.get(row.product_id))).map(row=>({material_id:row.product_id,quantity:row.quantity,unit:row.unit||stockUnit(map.get(row.product_id))}));
  const assembled=lines.filter(line=>isStickerItem(map.get(line.material_id)));
  let sticker=options.sticker_material_id?map.get(options.sticker_material_id):assembled.length===1?map.get(assembled[0].material_id):null;
  const other=lines.filter(line=>!isStickerItem(map.get(line.material_id)));
  if(!sticker&&!options.sticker_material_id&&options.require_sticker){const choices=yogurtStickerChoices(product,items,options);if(choices.length===1)sticker=choices[0];}
  if(options.sticker_material_id&&!isStickerItem(sticker||{})){if(options.allowMissingSticker)return other;throw Error('Choose a registered sticker inventory item.');}
  if(sticker&&(options.require_sticker||options.sticker_material_id)){
    try{
    if(sticker.is_active===false||sticker.configuration_status==='draft')throw Error('Choose an active, configured sticker.');
    const flavor=yogurtItemFlavour(sticker),size=yogurtItemSize(sticker),family=variantFamily(sticker),targetFamily=variantFamily(product)||options.family;
    if(flavor&&flavor!==yogurtItemFlavour(product,options.flavor)||size&&size!==yogurtItemSize(product,options.size)||family&&targetFamily&&family!==targetFamily)throw Error('The sticker must match the finished product base, flavour and size.');
    const quantity=unitFactor('ea',stockUnit(sticker));
    return [...other,{material_id:sticker.id,quantity,unit:stockUnit(sticker)}];
    }catch(error){if(options.allowMissingSticker)return other;throw error;}
  }
  if(options.require_sticker&&!options.allowMissingSticker)throw Error('Select the matching sticker for every finished product. Each cup or bottle uses one sticker.');
  return lines;
}
export function yogurtRecipeHasStickers(config,items){
  if(config?.formula_version!==3)return true;
  return !!config.outputs?.length&&config.outputs.every(output=>{
    const stickers=(output.packaging||[]).filter(line=>isStickerItem(items.find(item=>item.id===line.material_id)));
    if(stickers.length!==1)return false;
    try{return Math.abs(Number(stickers[0].quantity)*unitFactor(stickers[0].unit,'ea')-1)<1e-9;}catch{return false;}
  });
}
