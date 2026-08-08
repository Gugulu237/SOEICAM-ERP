// Role-based access control for SOEICAM ERP
// Roles: admin (GM), procurement, warehouse_manager, cashier, production_manager, employee

export const ROLES = {
  ADMIN: 'admin',
  PROCUREMENT: 'procurement',
  WAREHOUSE_MANAGER: 'warehouse_manager',
  CASHIER: 'cashier',
  PRODUCTION_MANAGER: 'production_manager',
  EMPLOYEE: 'employee',
};

export const ROLE_LABELS = {
  admin: 'General Manager',
  procurement: 'Procurement',
  warehouse_manager: 'Warehouse Manager',
  cashier: 'Cashier',
  production_manager: 'Production Manager',
  employee: 'Employee',
};

// Who can approve purchase orders (GM only — procurement/production manager submit, GM approves)
export const PO_APPROVERS = ['admin'];
// Who can see all purchase orders (vs only their department's)
export const PO_FULL_ACCESS = ['admin', 'procurement', 'cashier'];
// Who can disburse payments
export const PAYMENT_DISBURSERS = ['admin', 'cashier'];
// Who can approve production orders (GM only)
export const PRODUCTION_APPROVERS = ['admin'];
// Who can issue materials from warehouse
export const WAREHOUSE_ISSUERS = ['admin', 'warehouse_manager'];
// Who signs cheques (dual signature required: GM + Production Manager)
export const CHEQUE_GM_SIGNERS = ['admin'];
export const CHEQUE_PM_SIGNERS = ['production_manager'];

// Determine effective role from user + employee records
export function getEffectiveRole(user, employee) {
  if (!user) return null;
  if (user.role === 'admin') return 'admin';
  return employee?.role || 'employee';
}

export function canApprovePO(role) {
  return PO_APPROVERS.includes(role);
}

export function canDisburse(role) {
  return PAYMENT_DISBURSERS.includes(role);
}

export function canViewAllPOs(role) {
  return PO_FULL_ACCESS.includes(role);
}

export function canApproveProduction(role) {
  return PRODUCTION_APPROVERS.includes(role);
}

export function canIssueMaterials(role) {
  return WAREHOUSE_ISSUERS.includes(role);
}

// Sidebar navigation role mapping (null = all roles)
export const NAV_ROLE_ACCESS = {
  '/': null,
  '/accounting': ['admin', 'cashier'],
  '/purchases': ['admin', 'procurement', 'production_manager', 'warehouse_manager', 'employee'],
  '/suppliers': ['admin', 'procurement'],
  '/inventory': ['admin', 'warehouse_manager', 'procurement'],
  '/manufacturing': ['admin', 'production_manager', 'warehouse_manager'],
  '/quality': ['admin', 'production_manager'],
  '/sales': ['admin', 'employee'],
  '/customers': ['admin', 'employee'],
  '/distribution': ['admin', 'employee', 'warehouse_manager'],
  '/employees': ['admin'],
  '/payroll': ['admin'],
  '/cashier': ['admin', 'cashier', 'production_manager'],
  '/reports': ['admin'],
  '/approvals': ['admin', 'procurement', 'production_manager', 'warehouse_manager'],
  '/admin': ['admin'],
};