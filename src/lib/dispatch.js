// Checked dispatch actions run in one server transaction. A browser retry cannot
// partially load a vehicle or copy stock a second time.
import { erp } from '@/api/erpClient';
import { getStockOnHand, round3 } from '@/lib/inventory';
import { DISPATCH_MANAGER_ROLES } from './operations-access.js';

export const DISPATCH_APPROVERS = DISPATCH_MANAGER_ROLES;
export function canApproveDispatch(role) { return DISPATCH_APPROVERS.includes(role); }

async function dispatchAction(action, dispatch, extra={}) {
  if (!dispatch?.id) throw new Error('Select a dispatch run');
  const { data } = await erp.functions.invoke('fieldOps', { action, dispatchId: dispatch.id, ...extra });
  return data;
}

export async function resolveVehicleWarehouse(vehicleId) {
  const vehicle = await erp.entities.Vehicle.get(vehicleId);
  if (!vehicle?.warehouse_id || vehicle.is_active === false) throw new Error(`Vehicle ${vehicle?.name || ''} has no active stock location. Assign a vehicle warehouse in Administration first.`);
  return vehicle.warehouse_id;
}

export function loadDispatch(dispatch) { return dispatchAction('loadDispatch', dispatch); }
export function approveDispatch(dispatch) { return dispatchAction('approveDispatch', dispatch); }
export function returnDispatchStock(dispatch,_userName,countedLines) { return dispatchAction('returnDispatchStock', dispatch, countedLines?{countedLines}:{}); }
export function getDispatchReconciliation(dispatch) { return dispatchAction('dispatchReconciliation', dispatch); }
export function closeDispatch(dispatch){return dispatchAction('closeDistributionRun',dispatch);}

// Legacy order screens still use this read. Commercial supplies receive their
// assigned run stock from the protected employee workspace instead.
export async function getVehicleStock(vehicleWarehouseId) {
  if (!vehicleWarehouseId) return [];
  const balances = await erp.entities.StockBalance.filter({ warehouse_id: vehicleWarehouseId });
  const date = new Date().toISOString().slice(0, 10), byProduct = {};
  for (const balance of balances) {
    if ((balance.qc_status || 'approved') !== 'approved' || (balance.expiry_date && balance.expiry_date < date)) continue;
    if (!byProduct[balance.product_id]) byProduct[balance.product_id] = { product_id: balance.product_id, product_name: balance.product_name, quantity: 0 };
    byProduct[balance.product_id].quantity = round3(byProduct[balance.product_id].quantity + (balance.quantity || 0));
  }
  return Object.values(byProduct).filter(product => product.quantity > 0);
}

export async function getLoadedDispatches() {
  return erp.entities.Dispatch.filter({ status: { $in: ['loaded', 'in_transit'] } });
}
export async function getActiveDispatchForUser(employeeId) {
  if (!employeeId) return null;
  const all = await getLoadedDispatches();
  return all.find(dispatch => dispatch.salesperson_id === employeeId || dispatch.driver_id === employeeId) || null;
}
export { getStockOnHand };
