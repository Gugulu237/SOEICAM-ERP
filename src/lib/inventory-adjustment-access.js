export const INVENTORY_ADJUSTMENT_PERMISSION='inventory_adjustments';
export function canAdjustInventory(role,employee,modules) {
  if(!['admin','warehouse_manager','cashier'].includes(role) || role!=='admin' && employee?.assigned_role==='production_manager')return false;
  if(Array.isArray(modules))return modules.includes(INVENTORY_ADJUSTMENT_PERMISSION);
  return role==='admin' || role==='warehouse_manager';
}
export const canReconcileInventoryValue=(role,employee,modules)=>['admin','cashier'].includes(role) && canAdjustInventory(role,employee,modules);
