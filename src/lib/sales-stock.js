import {isAssemblyInventoryType} from './item-types.js';
import {businessDate} from './business-date.js';
import {recordedStockQuantity, stockLotHoldReason, stockQuantityTotal, validStockQuantity} from './stock-balance.js';

export const FACTORY_SALES_LOCATION_TYPES=['finished_goods','cold_room','general','factory'];
export const companySalesWarehouse = w => !!w?.id && w.is_active!==false && !w?.vehicle_id && !w?.custodian_employee_id && [...FACTORY_SALES_LOCATION_TYPES,'raw_material','packaging',''].includes(w?.warehouse_type || '');
export function finishedStockForSale(products,balances,warehouseId,date=businessDate(),{includeUnavailable=false}={}){
  const warehouseIds=new Set(Array.isArray(warehouseId)?warehouseId:[warehouseId]);
  warehouseIds.delete(undefined);warehouseIds.delete('');
  if(!warehouseIds.size)return [];
  const quantities=new Map(),blocked=new Map();
  for(const b of balances){
    if(!warehouseIds.has(b.warehouse_id))continue;
    const quantity=recordedStockQuantity(b.quantity);
    if(!Number.isFinite(quantity)||quantity<=0)continue;
    const reason=validStockQuantity(quantity)?stockLotHoldReason(b,date):'Check stock record';
    if(reason){
      if(!blocked.has(b.product_id))blocked.set(b.product_id,new Set());
      blocked.get(b.product_id).add(reason);
    }else{
      if(!quantities.has(b.product_id))quantities.set(b.product_id,[]);
      quantities.get(b.product_id).push(quantity);
    }
  }
  // Assembly setup controls future production, not already received finished stock.
  return products.filter(p=>p.is_active!==false && !p.item_removed_at && isAssemblyInventoryType(p.inventory_type)).map(p=>{
    const available=stockQuantityTotal(quantities.get(p.id)||[]);
    return {...p,available,unavailable_reason:available>0?'':blocked.get(p.id)?.size>1?'Stock is on quality hold or expired':blocked.get(p.id)?.values().next().value||'No saleable stock at this source'};
  }).filter(p=>includeUnavailable||p.available>0);
}
export function factorySalesLocations(warehouses,products,balances,date=businessDate()){
  const finishedIds=new Set(products.filter(p=>p.is_active!==false && !p.item_removed_at && isAssemblyInventoryType(p.inventory_type)).map(p=>p.id));
  const stocked=new Set(balances.filter(b=>{
    const quantity=recordedStockQuantity(b.quantity);
    return finishedIds.has(b.product_id) && quantity>0 && validStockQuantity(quantity) && !stockLotHoldReason(b,date);
  }).map(b=>b.warehouse_id));
  return warehouses.filter(w=>companySalesWarehouse(w) && FACTORY_SALES_LOCATION_TYPES.includes(w.warehouse_type) && stocked.has(w.id));
}
