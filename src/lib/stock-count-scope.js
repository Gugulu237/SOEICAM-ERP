import {isAssemblyInventoryType} from './item-types.js';
import {isPackagingItem} from './inventory-packaging.js';

export const COUNT_ITEM_GROUPS=[
  ['packaging','Packaging'],
  ['ingredients','Raw materials'],
  ['finished','Finished products'],
  ['all','All items'],
];
export function stockCountGroup(item){
  if(isAssemblyInventoryType(item?.inventory_type))return 'finished';
  return item&&isPackagingItem(item)?'packaging':'ingredients';
}
export function warehouseCountGroup(warehouse){
  if(warehouse?.warehouse_type==='packaging')return 'packaging';
  if(warehouse?.warehouse_type==='raw_material')return 'ingredients';
  if(['cold_room','finished_goods'].includes(warehouse?.warehouse_type))return 'finished';
  return 'all';
}
export function countGroupMatches(item,group){
  return group==='all'||stockCountGroup(item)===group;
}

// Compare only the items the user has counted. Unrelated receipts may refresh
// the list without invalidating a physical count for an untouched product.
export function changedCountItems(previous,current,ids){
  if(!previous||!current)return [...ids];
  if(previous.warehouse?.id!==current.warehouse?.id||previous.date!==current.date||previous.item_group!==current.item_group)return [...ids];
  const proof=(data,id)=>{
    const item=data.items?.find(row=>row.id===id);
    if(!item)return null;
    const rows=(data.rows||[]).filter(row=>row.product_id===id).map(row=>[row.balance_id,row.fingerprint,row.book_quantity,row.book_value,row.unit_cost,row.qc_status,row.expiry_date]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
    return JSON.stringify([item.count_fingerprint,item.count_group,item.unit,item.unit_cost,item.inventory_account?.id,rows]);
  };
  return ids.filter(id=>!current.items?.some(item=>item.id===id)||proof(previous,id)!==proof(current,id));
}

