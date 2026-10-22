import { isAssemblyInventoryType } from './item-types.js';

export const isColdRoom = warehouse => warehouse?.is_active !== false && warehouse?.warehouse_type === 'cold_room';
export function finishedStorageAllowed(product, warehouse, {isolation=false}={}) {
  return !isAssemblyInventoryType(product?.inventory_type) || isColdRoom(warehouse) || isolation && ['quarantine','damaged'].includes(warehouse?.warehouse_type);
}
export function requireFinishedStorage(product, warehouse, options) {
  if(!finishedStorageAllowed(product,warehouse,options))throw Error('Finished products must be stored in an active Cold Room until dispatch. Use Distribution for driver and agent issues.');
}
export function productionColdRoom(warehouses, id) {
  const rooms=warehouses.filter(isColdRoom);
  const selected=id?rooms.find(w=>w.id===id):rooms.length===1?rooms[0]:null;
  if(!selected)throw Error(rooms.length?'Select the active Cold Room receiving this production.':'Create an active Cold Room warehouse before completing production.');
  return selected;
}

// These are physical quantities elsewhere, never counted as Cold Room stock.
export function finishedStockOutsideColdRoom(products,warehouses,balances) {
  const items=new Map(products.filter(p=>isAssemblyInventoryType(p.inventory_type)).map(p=>[p.id,p]));
  const stores=new Map(warehouses.filter(w=>!['cold_room','quarantine','damaged','vehicle','commercial_custody','field_delivery_pending'].includes(w.warehouse_type)).map(w=>[w.id,w]));
  return balances.filter(b=>Number(b.quantity)>0 && items.has(b.product_id) && stores.has(b.warehouse_id));
}
