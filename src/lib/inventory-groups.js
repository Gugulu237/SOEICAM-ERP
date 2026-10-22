import { canonicalFlavour, canonicalSize, flavourChoice, variantFamily } from './product-variants.js';
import { ui } from './i18n.js';
import { isAssemblyInventoryType } from './item-types.js';
import { normalizeProductText, productPresentation } from './product-images.js';

export const PRODUCT_FAMILIES = ['Yaourt brassé', 'Yaourt à boire'];
export const MATERIAL_GROUPS = ['Packaging', 'Raw Material', 'Additives'];
const text = value => typeof value === 'string' ? value.trim() : '';
export function inventoryGroup(item) {
  if (isAssemblyInventoryType(item.inventory_type)) {
    if (text(item.product_family)) return text(item.product_family);
    const presentation = productPresentation(item);
    const words = normalizeProductText([item.category, item.name, presentation.family].join(' '));
    if (/\b(boire|drink|bottle|bottles)\b/.test(words)) return PRODUCT_FAMILIES[1];
    if (/\b(brasse|stirred|cups?|tubs?)\b/.test(words)) return PRODUCT_FAMILIES[0];
    return 'Unassigned finished products';
  }
  if (text(item.material_group)) return text(item.material_group);
  if (item.inventory_type === 'packaging') return MATERIAL_GROUPS[0];
  if (item.inventory_type === 'additive' || /\b(culture|benzoate|citric|citrique|sorbate)\b/.test(normalizeProductText(item.name))) return MATERIAL_GROUPS[2];
  return item.inventory_type === 'raw_material' ? MATERIAL_GROUPS[1] : 'Other material';
}
export function inventoryGroups(products, finished) {
  return [...new Set([...(finished ? PRODUCT_FAMILIES : MATERIAL_GROUPS), ...products.filter(p => isAssemblyInventoryType(p.inventory_type) === finished && p.inventory_type !== 'service').map(inventoryGroup)])];
}
export function inventoryVariants(item) {
  const shown = productPresentation(item);
  const flavor=text(item.flavor) || shown.flavor || 'Flavour not assigned',size=text(item.size) || shown.size || '';
  return isAssemblyInventoryType(item.inventory_type) ? {flavor:canonicalFlavour(flavor),size:canonicalSize(size)} : {flavor,size};
}
// Short presentation labels only. Keep the original catalogue name for search,
// editing, accessibility, printed records and items without a clear variant.
export function inventoryDisplayName(item){
  if(!isAssemblyInventoryType(item.inventory_type))return item.name;
  const variant=inventoryVariants(item),flavor=flavourChoice(variant.flavor),family=variantFamily(item);
  if(!flavor||!variant.size)return item.name;
  return [family?ui(family==='brasse'?'Brassé':'Drinkable'):'',ui(flavor.label),variant.size].filter(Boolean).join(' · ');
}
export function groupedInventory(products, finished) {
  const groups = new Map(inventoryGroups(products, finished).map(name => [name, []]));
  for (const item of products) groups.get(inventoryGroup(item))?.push(item);
  return [...groups].map(([name, items]) => ({ name, items: items.sort((a,b) => {
    const av = inventoryVariants(a), bv = inventoryVariants(b);
    return (finished ? av.flavor.localeCompare(bv.flavor) || av.size.localeCompare(bv.size, undefined, { numeric:true }) : 0) || a.name.localeCompare(b.name);
  }) }));
}
