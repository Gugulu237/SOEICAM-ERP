import {isPackagingItem} from './inventory-packaging.js';

// Deductions follow registered classification, never a material's name. Older
// inventory records may use a packaging group instead of the packaging type.
export function isAssemblyPackaging(product){
  if(!product||['assembly','finished_product','service'].includes(product.inventory_type)||product.item_type==='service')return false;
  return isPackagingItem({...product,name:''});
}

// Production entry is limited to ingredients. Finished goods, subassemblies,
// cleaning supplies and other inventory are not raw material consumption.
export function isActualAssemblyMaterial(product){
  return !!product&&['raw_material','additive'].includes(product.inventory_type)&&product.item_type!=='service'&&!isAssemblyPackaging(product);
}
