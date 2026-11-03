import {productPresentation,normalizeProductText} from './product-images.js';
import {variantFamily,canonicalSize} from './product-variants.js';
import {compareProductSizes,sortProductRows} from './product-sorting.js';

// Presentation only: compatible mass/volume labels group together without
// changing stock units, product IDs, quantities or historical product records.
export function catalogueProduct(product) {
  const shown=productPresentation(product);
  const family=variantFamily(product)||'other';
  const rawSize=product.size||shown.size||String(product.name||'').match(/\b\d+(?:[.,]\d+)?\s*(?:kg|mg|ml|cl|g|l)\b/i)?.[0]||'';
  let size=canonicalSize(rawSize);
  const volume=normalizeProductText(size).trim().match(/^(\d+(?:\.\d+)?)\s*(ml|cl|l)$/);
  if(volume)size=(Number(volume[1])*({ml:1,cl:10,l:1000}[volume[2]]))+' ml';
  return {product,family,size,search:normalizeProductText([product.name,product.sku,product.category,product.flavor,shown.flavor,size].filter(Boolean).join(' '))};
}
export const CATALOGUE_FAMILIES=[['brasse','Brassé'],['boire','À boire'],['other','Other products']];
export function catalogueSections(rows,sort='size') {
  return CATALOGUE_FAMILIES.flatMap(([family,label])=>{
    const items=rows.filter(row=>row.family===family);
    const sizes=[...new Set(items.map(row=>row.size))].sort((a,b)=>compareProductSizes(a,b,sort==='size-desc'));
    // Explicit name/flavour sorting remains available. Size order is the default.
    if(sort==='name'||sort==='flavour')return items.length?[{key:family,label,size:'',rows:sortProductRows(items,sort,row=>row.product)}]:[];
    return sizes.map(size=>({key:family+':'+size,label,size,rows:sortProductRows(items.filter(row=>row.size===size),'flavour',row=>row.product)}));
  });
}

