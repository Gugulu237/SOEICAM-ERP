import { canAdjustInventory, canReconcileInventoryValue } from '../../lib/inventory-adjustment-access.js';
export async function adjustmentAccess(client,role,employee,{requirePermission=true}={}) {
  const catalogue=role==='admin'?await client.auth.roleCatalogue?.():null;
  const modules=employee?.allowed_modules || catalogue?.roles?.admin?.modules;
  const permitted=canAdjustInventory(role,employee,modules);
  if(requirePermission && !permitted)throw Error('Special inventory adjustment access is required. Ask the General Manager to enable Inventory quantity adjustments for your role.');
  if(requirePermission)client.auth.assertModule?.('inventory_adjustments');
  return {can_adjust:permitted,can_reconcile_value:canReconcileInventoryValue(role,employee,modules)};
}
