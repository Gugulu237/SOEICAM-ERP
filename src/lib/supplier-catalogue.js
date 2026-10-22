import {isAssemblyInventoryType} from './item-types.js';
export const supplierMaterial=item=>!!item&&!isAssemblyInventoryType(item.inventory_type)&&item.inventory_type!=='service'&&item.item_type!=='service';
export function supplierItems(supplier) {
  let rows=supplier?.supplier_items;
  for(let i=0;i<2 && typeof rows==='string';i++){try{rows=JSON.parse(rows);}catch{return [];}}
  return Array.isArray(rows)?rows.filter(row=>row && typeof row.product_id==='string'):[];
}

// A vendor's offer always uses the item's inventory unit. Never substitute the
// entire product register when that vendor has no linked goods.
export function supplierCatalogue(supplier, products = []) {
  if (!supplier) return [];
  const offers = new Map(supplierItems(supplier).map(row => [row.product_id, row]));
  return products.filter(p => p.is_active !== false && p.configuration_status !== 'draft' && supplierMaterial(p) && (offers.has(p.id) || p.preferred_supplier_id === supplier.id)).map(p => {
    const offer = offers.get(p.id);
    // A stale catalogue unit must be corrected before its price can be reused.
    const compatible = !offer?.unit || offer.unit === p.unit;
    return { ...p, supplier_code: offer?.supplier_code || '', supplier_price: compatible && offer?.unit_price != null ? Number(offer.unit_price) : Number(p.cost || 0) };
  });
}

// A purchase request may propose a vendor before Procurement has confirmed its
// catalogue. Confirmed suppliers are first; unconfirmed ones need review.
export function productionSupplierChoices(suppliers,products,productId) {
  return suppliers.filter(s=>s.is_active!==false).map(s=>({...s,linked:supplierCatalogue(s,products).some(p=>p.id===productId)})).sort((a,b)=>Number(b.linked)-Number(a.linked) || a.name.localeCompare(b.name));
}
