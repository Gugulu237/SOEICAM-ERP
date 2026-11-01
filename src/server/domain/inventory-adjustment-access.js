import { canAdjustInventory, canReconcileInventoryValue } from '../../lib/inventory-adjustment-access.js';
import {principalRole} from './roles.js';
export async function adjustmentAccess(client,role,employee,{requirePermission=true,user}={}) {
  role=principalRole(user,employee);
  const catalogue=role==='admin'?await client.auth.roleCatalogue?.():null;
  const modules=employee?.allowed_modules || catalogue?.roles?.admin?.modules;
  const permitted=canAdjustInventory(role,employee,modules);
  if(requirePermission && !permitted)throw Error('Special inventory adjustment access is reserved for top administrators (General Manager).');
  if(requirePermission)client.auth.assertModule?.('inventory_adjustments');
  return {can_adjust:permitted,can_reconcile_value:canReconcileInventoryValue(role,employee,modules)};
}
