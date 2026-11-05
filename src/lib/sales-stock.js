import {isAssemblyInventoryType} from './item-types.js';
import {businessDate} from './business-date.js';

export const FACTORY_SALES_LOCATION_TYPES=['finished_goods','cold_room','general','factory'];
export const companySalesWarehouse = w => !!w?.id && w.is_active!==false && !w?.vehicle_id && !w?.custodian_employee_id && [...FACTORY_SALES_LOCATION_TYPES,'raw_material','packaging',''].includes(w?.warehouse_type || '');
export function finishedStockForSale(products,balances,warehouseId,date=businessDate(),{includeUnavailable=false}={}){
  const warehouseIds=new Set(Array.isArray(warehouseId)?warehouseId:[warehouseId]);
  warehouseIds.delete(undefined);warehouseIds.delete('');
  if(!warehouseIds.size)return [];
  const quantities=new Map(),blocked=new Map();
  for(const b of balances){
    const quantity=Number(b.quantity);
    if(warehouseIds.has(b.warehouse_id)&&Number.isFinite(quantity)&&quantity>0){
      const reason=b.qc_status&&b.qc_status!=='approved'?(b.qc_status==='rejected'?'Rejected':'On quality hold'):b.expiry_date&&b.expiry_date<date?'Expired':'';
      if(reason){if(!blocked.has(b.product_id))blocked.set(b.product_id,new Set());blocked.get(b.product_id).add(reason);}
    }
    if(warehouseIds.has(b.warehouse_id) && Number.isFinite(quantity) && quantity>0 && (!b.qc_status || b.qc_status==='approved') && (!b.expiry_date || b.expiry_date>=date))quantities.set(b.product_id,(quantities.get(b.product_id)||0)+quantity);
  }
  // Assembly setup controls future production, not already received finished stock.
  return products.filter(p=>p.is_active!==false && isAssemblyInventoryType(p.inventory_type)).map(p=>({...p,available:Math.round((quantities.get(p.id)||0)*1000)/1000,unavailable_reason:quantities.get(p.id)>0?'':blocked.get(p.id)?.size>1?'Stock is on quality hold or expired':blocked.get(p.id)?.values().next().value||'No saleable stock at this source'})).filter(p=>includeUnavailable||p.available>0);
}
export function factorySalesLocations(warehouses,products,balances,date=businessDate()){
  const finishedIds=new Set(products.filter(p=>p.is_active!==false && isAssemblyInventoryType(p.inventory_type)).map(p=>p.id));
  const stocked=new Set(balances.filter(b=>finishedIds.has(b.product_id) && Number(b.quantity)>0 && (!b.qc_status || b.qc_status==='approved') && (!b.expiry_date || b.expiry_date>=date)).map(b=>b.warehouse_id));
  return warehouses.filter(w=>w.is_active!==false && !w.vehicle_id && FACTORY_SALES_LOCATION_TYPES.includes(w.warehouse_type) && stocked.has(w.id));
}
