import {isAssemblyInventoryType} from './item-types.js';

const nonPurchaseTypes = new Set(['service', 'returned', 'damaged', 'expired', 'recovered_packaging']);

export function supportsPurchasing(item) {
  return !!item?.inventory_type && item.item_type !== 'service' && !nonPurchaseTypes.has(item.inventory_type);
}

export function purchaseEnabled(item) {
  if (!supportsPurchasing(item)) return false;
  if (item.is_purchasable != null) return item.is_purchasable === true;
  return !isAssemblyInventoryType(item.inventory_type) && item.inventory_type !== 'wip';
}

export function isPurchasableItem(item) {
  return purchaseEnabled(item) && item.is_active !== false && item.configuration_status !== 'draft' && !item.item_removed_at;
}

export function supplierItems(supplier) {
  let rows=supplier?.supplier_items;
  for(let i=0;i<2 && typeof rows==='string';i++){try{rows=JSON.parse(rows);}catch{return [];}}
  return Array.isArray(rows)?rows.filter(row=>row && typeof row.product_id==='string'):[];
}

function purchaseChoices(supplier, products, linkedOnly) {
  if (!supplier) return [];
  const offers = new Map(supplierItems(supplier).map(row => [row.product_id, row]));
  return products.filter(isPurchasableItem).flatMap(p => {
    const offer = offers.get(p.id);
    if (linkedOnly && !offer && p.preferred_supplier_id !== supplier.id) return [];
    // A stale catalogue unit must be corrected before its price can be reused.
    const hasSupplierPrice = offer?.unit_price != null && (!offer.unit || offer.unit === p.unit);
    return [{ ...p, supplier_code: offer?.supplier_code || '', supplier_price: hasSupplierPrice ? Number(offer.unit_price) : Number(p.cost || 0), has_supplier_price: hasSupplierPrice }];
  });
}

export function supplierCatalogue(supplier, products = []) {
  return purchaseChoices(supplier, products, true);
}

export function purchaseOrderItems(supplier, products = []) {
  return purchaseChoices(supplier, products, false);
}

// A purchase request may propose a vendor before Procurement has confirmed its
// catalogue. Confirmed suppliers are first; unconfirmed ones need review.
export function productionSupplierChoices(suppliers,products,productId) {
  return suppliers.filter(s=>s.is_active!==false).map(s=>({...s,linked:supplierCatalogue(s,products).some(p=>p.id===productId)})).sort((a,b)=>Number(b.linked)-Number(a.linked) || a.name.localeCompare(b.name));
}
