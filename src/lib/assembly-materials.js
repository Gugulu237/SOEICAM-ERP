import {isPackagingItem} from './inventory-packaging.js';

// Deductions follow registered classification, never a material's name. Older
// inventory records may use a packaging group instead of the packaging type.
export function isAssemblyPackaging(product){
  if(!product||['assembly','finished_product','service'].includes(product.inventory_type)||product.item_type==='service')return false;
  return isPackagingItem({...product,name:''});
}

// Existing on-hand subassemblies can be entered as actual inputs too. Their
// future assembly setup is independent of consuming an already produced lot.
export function isActualAssemblyMaterial(product){
  return !!product&&product.inventory_type!=='service'&&product.item_type!=='service'&&!isAssemblyPackaging(product);
}
