import {isAssemblyInventoryType} from './item-types.js';
import {attributeKey,itemAttributes} from './item-attributes.js';
import {canonicalFlavour,canonicalSize} from './product-variants.js';
import {productPresentation} from './product-images.js';
const attribute=(item,names)=>itemAttributes(item).find(row=>names.includes(attributeKey(row.name)))?.value || '';
const packagingWords=/^(packaging|emballages?|stickers?|labels?|etiquettes?|autocollants?|cups?|pots?|bottles?|bouteilles?|lids?|couvercles?|cartons?|boxes|caps?)$/;
export function isStickerItem(item){
 if(!item||isAssemblyInventoryType(item.inventory_type)||item.inventory_type==='service'||item.item_type==='service')return false;
 return /\b(stickers?|labels?|etiquettes?|autocollants?)\b/.test(attributeKey([item.name,item.material_group,item.category,attribute(item,['packaging type','packaging category'])].filter(Boolean).join(' ')));
}
export function isPackagingItem(item){
 if(isAssemblyInventoryType(item.inventory_type)||item.inventory_type==='service'||item.item_type==='service')return false;
 return isStickerItem(item)||item.inventory_type==='packaging'||packagingWords.test(attributeKey(item.material_group || ''))||packagingWords.test(attributeKey(item.category || ''))||!!attribute(item,['packaging type','packaging category']);
}
export function packagingGroup(item){
 const explicit=attribute(item,['packaging type','packaging category','type']);
 if(explicit)return explicit;
 const group=String(item.material_group || '').trim();
 if(group&&packagingWords.test(attributeKey(group))&&!/^(packaging|emballages?)$/.test(attributeKey(group)))return group;
 const words=attributeKey([item.category,item.name].filter(Boolean).join(' '));
 if(/\b(stickers?|labels?|etiquettes?|autocollants?)\b/.test(words))return 'Stickers';
 if(/\b(lids?|caps?|couvercles?|opercules?)\b/.test(words))return 'Lids & seals';
 if(/\b(bottles?|bouteilles?)\b/.test(words))return 'Bottles';
 if(/\b(cups?|pots?|tubs?)\b/.test(words))return 'Yogurt cups';
 if(/\b(cartons?|boxes|boites?)\b/.test(words))return 'Cartons & boxes';
 return 'Other packaging';
}
export function packagingVariants(item){
 const shown=productPresentation(item);
 return {flavor:canonicalFlavour(item.flavor || attribute(item,['flavour','flavor']) || shown.flavor || ''),size:canonicalSize(item.size || attribute(item,['size','capacity']) || shown.size || '')};
}
