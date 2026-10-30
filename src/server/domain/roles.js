// Canonical ERP roles shared by the browser and server. General Manager is the
// top administrator; no separate, weaker "manager" role exists.
export const ROLE_KEYS = ['admin', 'procurement', 'warehouse_manager', 'cashier', 'production_manager', 'employee', 'commercial', 'hotesse', 'driver'];
// Reporting levels describe the management hierarchy, not inherited permissions.
// Operations / Production Manager has explicitly assigned operational permissions.
export const MANAGEMENT_HIERARCHY = {
  admin: { managementLevel: 1, reportsTo: null },
  production_manager: { managementLevel: 2, reportsTo: 'admin' },
};
const aliases = {
  'general manager': 'admin', general_manager: 'admin', 'managing director': 'admin', gm: 'admin',
  'super admin': 'admin', super_admin: 'admin', superadmin: 'admin',
  accountant: 'cashier', treasurer: 'cashier',
  'procurement officer': 'procurement', buyer: 'procurement',
  'warehouse manager': 'warehouse_manager', storekeeper: 'warehouse_manager', 'store keeper': 'warehouse_manager',
  'production manager': 'production_manager', 'quality-control officer': 'production_manager', 'quality control officer': 'production_manager', 'quality officer': 'production_manager',
  'operations manager': 'production_manager', operations_manager: 'production_manager',
  'operations/production manager': 'production_manager', 'operations / production manager': 'production_manager',
  operations_production_manager: 'production_manager',
  salesperson: 'commercial', 'sales person': 'commercial', 'sales agent': 'commercial', sales_agent: 'commercial', 'commercial agent': 'commercial', commercial_agent: 'commercial', hostess: 'hotesse',
  chauffeur: 'driver', 'delivery driver': 'driver', worker: 'employee', staff: 'employee',
};
export function normalizeRole(value) {
  const role = String(value || '').trim().toLowerCase();
  return ROLE_KEYS.includes(role) ? role : Object.hasOwn(aliases, role) ? aliases[role] : '';
}
export const FEATURE_AUTHORITY=Symbol.for('soeicam.verified-feature-authority');
export function principalRole(user, employee) {
  if (!user) return null;
  if (String(user.role || '').trim().toLowerCase() === 'admin') return 'admin';
  if (employee?.access_template) return normalizeRole(employee.access_template) || 'employee';
  return normalizeRole(employee?.role) || employee?.role || 'employee';
}
export function effectiveRole(user,employee){if(!user)return null;return user?.[FEATURE_AUTHORITY]?.role || employee?.[FEATURE_AUTHORITY]?.role || principalRole(user,employee);}
// Module/role access. Record attribution, valid states and posting checks are
// enforced separately by the action handlers.
export function hasRoleAccess(role, allowed) {
  const canonical = normalizeRole(role);
  if (!canonical) return false;
  return canonical === 'admin' || allowed == null || allowed.some(value => normalizeRole(value) === canonical);
}
