export const ACCOUNTING_REPORT_PATHS = ['/accounting','/accounting/statements','/accounting/ledger','/accounting/trial-balance','/accounting/cash-flow'];
export function canReadManagementAccounting(role, employee = {}) {
  if (['admin','cashier'].includes(role)) return true;
  if (Array.isArray(employee.allowed_modules) && !employee.allowed_modules.includes('accounting')) return false;
  return role==='production_manager' || role==='warehouse_manager' && (employee.assigned_role==='supply_chain_manager' || employee.allowed_modules?.includes('accounting'));
}
