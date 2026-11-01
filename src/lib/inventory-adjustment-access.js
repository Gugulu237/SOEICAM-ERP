export const INVENTORY_ADJUSTMENT_PERMISSION='inventory_adjustments';
export function canAdjustInventory(role,employee,modules) {
  // Callers supply the signed-in principal role, never a feature-elevated role.
  if(role!=='admin' || employee?.status && employee.status!=='active')return false;
  if(Array.isArray(modules))return modules.includes(INVENTORY_ADJUSTMENT_PERMISSION);
  return true;
}
export const canReconcileInventoryValue=canAdjustInventory;
