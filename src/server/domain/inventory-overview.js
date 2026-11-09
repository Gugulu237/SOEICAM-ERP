import {pricedAssemblyProducts} from '../../lib/assembly-pricing.js';
import { assertEntityAccess, recordScope, visibleRecord } from '../access.js';
import { assertModule } from './role-catalogue.js';
import { readRecords } from './commercial-workspace.js';
import {centralInventoryMode} from './centralized-inventory-policy.js';
import {companySalesWarehouse} from '../../lib/sales-stock.js';
import {principalRole} from './roles.js';
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
  const central=await centralInventoryMode(stores),commercial=principalRole(context.user,context.employee)==='commercial';
  if(central&&commercial){
    const ids=(await readRecords(stores.Warehouse)).filter(companySalesWarehouse).map(row=>row.id);
    scopes[names.indexOf('Warehouse')]={id:{$in:ids}};
    scopes[names.indexOf('StockBalance')]={warehouse_id:{$in:ids}};
  }
  const records = await Promise.all(names.map(async (name, index) => (await readRecords(stores[name], scopes[index])).map(row => visibleRecord(context, name, row))));
  let canManageItems=false;
  try{assertModule(context,'inventory');assertEntityAccess(context,'Product','update');canManageItems=true;}catch(error){if(error.status!==403)throw error;}
  const balanceRows=central&&commercial?records[1].map(row=>Object.fromEntries(['id','product_id','product_name','warehouse_id','warehouse_name','quantity','qc_status','lot_number','batch_number','expiry_date'].filter(key=>Object.hasOwn(row,key)).map(key=>[key,row[key]]))):records[1];
  const products=pricedAssemblyProducts(records[0]).filter(p=>!p.item_removed_at);
  const visibleProducts=central&&commercial?products.map(row=>Object.fromEntries(['id','name','sku','category','inventory_type','flavor','size','product_family','image_url','storage_unit','sales_unit','unit_of_measure','selling_price','tax_rate','is_active','configuration_status','reorder_level','min_stock'].filter(key=>Object.hasOwn(row,key)).map(key=>[key,row[key]]))):products;
  return { products:visibleProducts, removedProducts:canManageItems&&includeRemoved?records[0].filter(p=>p.item_removed_at):[], balances:compact?compactStockBalances(balanceRows):balanceRows, warehouses:records[2], vehicles:records[3]||[],centralized_inventory:central||{enabled:false} };
}

const BALANCE_FIELDS=['id','product_id','product_name','warehouse_id','warehouse_name','quantity','unit_cost','total_value','qc_status','lot_number','batch_number','expiry_date','production_order_id','opening_batch_id','stock_origin','created_date','updated_date'];
const knownZero=value=>['number','string'].includes(typeof value)&&String(value).trim()!==''&&Number(value)===0;
// Read-only list projection. Original lots, counts and movement history stay in
// their authoritative workflows; never collapse distinct remaining batches.
export function compactStockBalances(rows){
  return rows.filter(row=>!(knownZero(row.quantity)&&knownZero(row.total_value))).map(row=>Object.fromEntries(BALANCE_FIELDS.filter(key=>Object.hasOwn(row,key)).map(key=>[key,row[key]])));
}
