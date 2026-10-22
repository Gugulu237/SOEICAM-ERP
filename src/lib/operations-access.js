import { normalizeRole } from '../server/domain/roles.js';

// Operational authority does not imply General Manager or cash-desk authority.
export const COMPANY_SALES_ROLES = ['admin', 'employee', 'production_manager'];
export const COMMERCIAL_REPORT_ROLES = ['admin', 'commercial', 'production_manager', 'warehouse_manager'];
export const DISPATCH_MANAGER_ROLES = ['admin', 'warehouse_manager', 'production_manager'];
export const canManageDeliveries = role => DISPATCH_MANAGER_ROLES.includes(normalizeRole(role));
export const canViewAllCommercialReports = (role, employee = {}) => ['admin', 'production_manager'].includes(normalizeRole(role)) || normalizeRole(role) === 'warehouse_manager' && employee.assigned_role === 'supply_chain_manager' && employee.allowed_modules?.includes('sales_reports');
