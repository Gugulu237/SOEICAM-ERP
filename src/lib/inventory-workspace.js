import {businessDate} from './business-date.js';
import {companySalesWarehouse} from './sales-stock.js';
/* localized-metadata */
import {ui} from './i18n.js';
import { isPackagingItem } from './inventory-packaging.js';
import { isAssemblyInventoryType } from './item-types.js';

export const INVENTORY_SECTIONS = ['items', 'stock', 'movements', 'alerts', 'recovery'];
export const ITEM_FILTERS = [
  { key: 'finished', get label(){return ui("Finished products");} },
  { key: 'ingredients', get label(){return ui("Ingredients");} },
  { key: 'packaging', get label(){return ui("Packaging");} },
  { key: 'all', get label(){return ui("All items");} },
];
export function inventoryWorkspaceState(params) {
  const legacy = params.get('tab');
  const aliases = { map: 'warehouses', raw: 'items', packaging: 'items', finished: 'items', wip: 'stock', delivery: 'stock' };
  const requested = params.get('section') || aliases[legacy] || legacy;
  const section = requested === 'warehouses' ? ['activity','report'].includes(params.get('panel')) ? 'movements' : 'stock' : requested;
  const requestedFilter = params.get('filter') || (legacy==='raw'?'ingredients':legacy==='packaging'?'packaging':'finished');
  const filter = ['materials','ingredients'].includes(requestedFilter)&&params.get('type')==='packaging'?'packaging':requestedFilter==='materials'?'ingredients':requestedFilter==='services'?'all':requestedFilter;
  const stockArea = params.get('area') || legacy;
  return {
    section: INVENTORY_SECTIONS.includes(section) ? section : 'items',
    filter: ITEM_FILTERS.some(value => value.key === filter) ? filter : 'finished',
    subtype: params.get('type') || (legacy === 'raw' ? 'raw_material' : legacy === 'packaging' ? 'packaging' : 'all'),
    stockArea: ['wip', 'delivery'].includes(stockArea) ? stockArea : 'all',
  };
}
export function matchesItemFilter(item, filter, subtype = 'all') {
  if (item.inventory_type==='service'||item.item_type==='service')return false;
  if (filter === 'all') return true;
  if (filter === 'finished') return isAssemblyInventoryType(item.inventory_type);
  if(filter==='packaging')return isPackagingItem(item);
  return ['ingredients','materials'].includes(filter) && !isAssemblyInventoryType(item.inventory_type) && !isPackagingItem(item) && (subtype === 'all' || item.inventory_type === subtype);
}
export function inventoryItemCounts(products) {
  const counts = { finished: 0, ingredients: 0, packaging: 0, all: 0 };
  for (const product of products) {
    if(product.inventory_type==='service'||product.item_type==='service')continue;
    counts.all++;
    if (isAssemblyInventoryType(product.inventory_type)) counts.finished++;
    else if(isPackagingItem(product))counts.packaging++;
    else counts.ingredients++;
  }
  return counts;
}
export function inventoryStockIndex(balances, warehouses, date=businessDate()) {
  const quantities = new Map(), warehouseTypes = new Map(warehouses.map(value => [value.id, value.warehouse_type]));
  const availableQuantities=new Map(),locations=new Map(warehouses.map(w=>[w.id,w]));
  let totalValue = 0, wipValue = 0, deliveryValue = 0;
  for (const balance of balances) {
    quantities.set(balance.product_id, (quantities.get(balance.product_id) || 0) + Number(balance.quantity || 0));
    if(companySalesWarehouse(locations.get(balance.warehouse_id)) && (!balance.qc_status || balance.qc_status==='approved') && (!balance.expiry_date || balance.expiry_date>=date))availableQuantities.set(balance.product_id,(availableQuantities.get(balance.product_id)||0)+Math.max(0,Number(balance.quantity)||0));
    const value = Number(balance.total_value || 0);
    totalValue += value;
    if (warehouseTypes.get(balance.warehouse_id) === 'wip') wipValue += value;
    if (warehouseTypes.get(balance.warehouse_id) === 'vehicle') deliveryValue += value;
  }
  return { quantities, availableQuantities, warehouseTypes, totalValue, wipValue, deliveryValue };
}
