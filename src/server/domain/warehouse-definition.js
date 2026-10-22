import { WAREHOUSE_TYPES, MANAGED_WAREHOUSE_TYPES } from '../../lib/warehouse-workspace.js';
import { readRecords } from './commercial-workspace.js';

// Runs inside the entity API's serializable transaction; historical rows retain their IDs.
export async function prepareWarehouseDefinition(stores,input,existing = null) {
  const fields = ['name','code','warehouse_type','branch_id','address','is_active'];
  if (!input || Object.keys(input).some(key => !fields.includes(key))) throw Error('Only warehouse details can be changed here. Vehicle and agent assignments are managed in Distribution.');
  const next = {...existing,...input};
  const name = String(next.name || '').trim(), code = String(next.code || '').trim().toUpperCase(), address = String(next.address || '').trim();
  if (!name || name.length > 120 || !/^[A-Z0-9][A-Z0-9_-]{0,59}$/.test(code) || address.length > 500) throw Error('Enter a warehouse name and a unique code using letters, numbers, hyphens or underscores.');
  if (!Object.hasOwn(WAREHOUSE_TYPES,next.warehouse_type) || typeof (next.is_active ?? true) !== 'boolean') throw Error('Choose a valid warehouse type and status.');
  if ((!existing || next.warehouse_type !== existing.warehouse_type) && (MANAGED_WAREHOUSE_TYPES.includes(next.warehouse_type) || MANAGED_WAREHOUSE_TYPES.includes(existing?.warehouse_type))) throw Error('Vehicle and agent stock locations are managed in Distribution. Their type cannot be changed here.');
  if (existing && MANAGED_WAREHOUSE_TYPES.includes(existing.warehouse_type) && (next.is_active ?? true) !== (existing.is_active ?? true)) throw Error('Manage the status of this linked stock location in Distribution.');
  const others = await readRecords(stores.Warehouse);
  if (others.some(row => row.id !== existing?.id && String(row.code).trim().toUpperCase() === code)) throw Error('This warehouse code is already in use.');
  if (next.branch_id && !(await stores.Branch.get(next.branch_id))) throw Error('Choose an existing branch.');
  if (existing && (next.warehouse_type !== existing.warehouse_type || next.is_active === false && existing.is_active !== false)) {
    const [balances,runs,production,purchases,requests,vehicles] = await Promise.all([
      readRecords(stores.StockBalance,{warehouse_id:existing.id}),
      readRecords(stores.Dispatch,{$or:[{warehouse_id:existing.id},{vehicle_warehouse_id:existing.id}],status:{$nin:['completed','cancelled','rejected']}}),
      readRecords(stores.ProductionOrder,{status:{$nin:['completed','released','cancelled','rejected']}}).then(rows=>rows.filter(row=>[row.warehouse_id,row.source_warehouse_id,row.destination_warehouse_id,row.wip_warehouse_id,row.output_warehouse_id,...Object.values(row.material_warehouses || {})].includes(existing.id))),
      readRecords(stores.PurchaseOrder,{warehouse_id:existing.id,status:{$nin:['received','billed','cancelled','rejected']}}),
      readRecords(stores.DispatchRequest,{$or:[{warehouse_id:existing.id},{source_warehouse_id:existing.id}],status:{$nin:['processed','cancelled','rejected']}}),
      readRecords(stores.Vehicle,{warehouse_id:existing.id,is_active:{$ne:false}}),
    ]);
    if (balances.some(row => !Number.isFinite(Number(row.quantity)) || Number(row.quantity) !== 0 || Number(row.total_value || 0) !== 0)) throw Error('Move or reconcile the remaining stock before changing the warehouse type or making it inactive.');
    if (runs.length || production.length || purchases.length || requests.length || vehicles.length) throw Error('Complete or reassign open deliveries, production, purchase orders and vehicle links before changing the warehouse type or status.');
  }
  return {name,code,address,warehouse_type:next.warehouse_type,branch_id:next.branch_id || '',is_active:next.is_active ?? true};
}
