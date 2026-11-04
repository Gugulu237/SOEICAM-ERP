import {pricedAssemblyProducts} from '../../lib/assembly-pricing.js';
import { assertEntityAccess, recordScope, visibleRecord } from '../access.js';
import { assertModule } from './role-catalogue.js';
import { readRecords } from './commercial-workspace.js';
export async function inventoryOverview(context, stores, {compact=false,includeRemoved=true}={}) {
  const names = ['Product', 'StockBalance', 'Warehouse'];
  // Registry details are optional: inventory readers keep their existing scope
  // even when their role cannot access Distribution's vehicle register.
  if(!compact)try {
    assertEntityAccess(context, 'Vehicle', 'filter');
    names.push('Vehicle');
  } catch (error) {
    if (error.status !== 403) throw error;
  }
  // Apply the same per-table scopes as the entity API before reading anything.
  const scopes = await Promise.all(names.map(name => recordScope(context, name, 'filter', stores)));
  const records = await Promise.all(names.map(async (name, index) => {
    const store=stores[name];
    // Native numeric columns can exclude exhausted layers before transporting
    // years of stock history from SQL. IS DISTINCT FROM also retains NULL,
    // negative quantities and any nonzero residual carrying value. Unknown
    // adapters keep the conservative JavaScript projection below.
    const query=compact&&name==='StockBalance'&&store.readRecordsPageSize===1000
      ? {$and:[scopes[index],{$or:[{quantity:{$ne:0}},{total_value:{$ne:0}}]}]}
      : scopes[index];
    return (await readRecords(store,query)).map(row => visibleRecord(context, name, row));
  }));
  let canManageItems=false;
  try{assertModule(context,'inventory');assertEntityAccess(context,'Product','update');canManageItems=true;}catch(error){if(error.status!==403)throw error;}
  return { products:pricedAssemblyProducts(records[0]).filter(p=>!p.item_removed_at), removedProducts:canManageItems&&includeRemoved?records[0].filter(p=>p.item_removed_at):[], balances:compact?compactStockBalances(records[1]):records[1], warehouses:records[2], vehicles:records[3]||[] };
}

const BALANCE_FIELDS=['id','product_id','product_name','warehouse_id','warehouse_name','quantity','unit_cost','total_value','qc_status','lot_number','batch_number','expiry_date','production_order_id','opening_batch_id','stock_origin','created_date','updated_date'];
const knownZero=value=>['number','string'].includes(typeof value)&&String(value).trim()!==''&&Number(value)===0;
// Read-only list projection. Original lots, counts and movement history stay in
// their authoritative workflows; never collapse distinct remaining batches.
export function compactStockBalances(rows){
  return rows.filter(row=>!(knownZero(row.quantity)&&knownZero(row.total_value))).map(row=>Object.fromEntries(BALANCE_FIELDS.filter(key=>Object.hasOwn(row,key)).map(key=>[key,row[key]])));
}
