// Role-based access control for SOEICAM ERP
// Roles: admin (GM), procurement, warehouse_manager, cashier, production_manager, employee

export const ROLES = {
  ADMIN: 'admin',
  PROCUREMENT: 'procurement',
  WAREHOUSE_MANAGER: 'warehouse_manager',
  CASHIER: 'cashier',
  PRODUCTION_MANAGER: 'production_manager',
  EMPLOYEE: 'employee',
  COMMERCIAL: 'commercial',
  HOTESSE: 'hotesse',
};

export const ROLE_LABELS = {
  admin: 'General Manager',
  procurement: 'Procurement',
  warehouse_manager: 'Warehouse Manager',
  cashier: 'Cashier',
  production_manager: 'Production Manager',
  employee: 'Employee',
  commercial: 'Commercial (Field Sales)',
  hotesse: 'Hotesse (Outlet Reporting)',
};

// The system roles: how each one is grouped, what it is responsible for, and
// which features it opens. Single source of truth for role assignment on Employees.
export const ROLE_DEFINITIONS = [
  {
    key: 'admin',
    label: 'General Manager',
    category: 'Management',
    summary: 'Owns the operation and gives final approval.',
    duties: [
      'Final approval of purchase orders, production orders and field sales',
      'Reviews financial statements, budgets and the business cockpit',
      'Manages employees, user accounts and company settings',
      'Full access to every module',
    ],
  },
  {
    key: 'cashier',
    label: 'Cashier',
    category: 'Finance',
    summary: 'Handles money in and money out.',
    duties: [
      'Disburses payments and records treasury receipts and expenses',
      'Confirms cash physically received from Commercials',
      'Runs the Cashier dashboard and expense payments',
      'Sees finance and accounting',
    ],
  },
  {
    key: 'procurement',
    label: 'Procurement Officer',
    category: 'Operations',
    summary: 'Buys what the factory and sales need.',
    duties: [
      'Creates purchase orders and follows them through to receipt',
      'Maintains supplier accounts and price agreements',
      'Tracks stock levels and reorder needs',
      'Submits purchases for General Manager approval',
    ],
  },
  {
    key: 'warehouse_manager',
    label: 'Warehouse Manager',
    category: 'Operations',
    summary: 'Controls everything that moves in and out of storage.',
    duties: [
      'Receives goods and manages stock, transfers and cold room',
      'Issues goods into a Commercial custody location',
      'Monitors expiry, quarantine and batch traceability',
      'Approves stock corrections and warehouse movements',
    ],
  },
  {
    key: 'production_manager',
    label: 'Production Manager',
    category: 'Operations',
    summary: 'Runs the factory floor.',
    duties: [
      'Plans and runs production batches, recipes and yield',
      'Requests materials and records production output',
      'Owns quality control and batch release',
      'Second signature on cheques with the General Manager',
    ],
  },
  {
    key: 'employee',
    label: 'Employee (General Staff)',
    category: 'Operations',
    summary: 'General staff with day-to-day operational access.',
    duties: [
      'Raises expense requests and records their own activity',
      'Sees sales, customers, procurement and stock screens',
      'Reports stock movements and delivery information',
      'No approval or financial posting rights',
    ],
  },
  {
    key: 'commercial',
    label: 'Commercial (Field Sales)',
    category: 'Commercial',
    summary: 'Sells in the field and holds company stock in custody.',
    duties: [
      'Holds issued stock in custody and sells on the road',
      'Records deliveries with customer receipt evidence',
      'Collects cash and hands it over to the Cashier',
      'Registers new customers with GPS location',
    ],
  },
  {
    key: 'hotesse',
    label: 'Hotesse (Outlet Reporting)',
    category: 'Commercial',
    summary: 'Reports on outlets and shelf activity.',
    duties: [
      'Reports outlet visits and product availability',
      'Flags out-of-stock, expiry and pricing issues at outlets',
      'Supports Commercials with customer information',
      'No financial posting rights',
    ],
  },
];

export const ROLE_CATEGORIES = ['Management', 'Finance', 'Operations', 'Commercial'];

export function roleDefinition(role) {
  return ROLE_DEFINITIONS.find(r => r.key === role) || null;
}

export function roleLabel(role) {
  return roleDefinition(role)?.label || ROLE_LABELS[role] || role || 'Unassigned';
}

// Older employee records stored the role as free text (e.g. "Cashier"). Map those
// labels onto the system roles so every employee opens with a usable role.
const LEGACY_ROLE_ALIASES = {
  'managing director': 'admin', 'general manager': 'admin', 'gm': 'admin',
  'cashier': 'cashier', 'accountant': 'cashier', 'treasurer': 'cashier',
  'procurement': 'procurement', 'procurement officer': 'procurement', 'buyer': 'procurement',
  'warehouse manager': 'warehouse_manager', 'storekeeper': 'warehouse_manager', 'store keeper': 'warehouse_manager',
  'production manager': 'production_manager', 'quality-control officer': 'production_manager',
  'quality control officer': 'production_manager', 'quality officer': 'production_manager',
  'commercial': 'commercial', 'salesperson': 'commercial', 'sales person': 'commercial',
  'hotesse': 'hotesse', 'hostess': 'hotesse',
  'employee': 'employee', 'driver': 'employee', 'worker': 'employee', 'staff': 'employee',
};

export function normalizeRole(role) {
  if (!role) return '';
  if (roleDefinition(role)) return role;
  return LEGACY_ROLE_ALIASES[String(role).trim().toLowerCase()] || '';
}

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

// Who may issue goods into a Commercial's custody
export const CUSTODY_ISSUERS = ['admin', 'warehouse_manager'];
// Who may review and approve field sales (never the submitting Commercial)
export const FIELD_SALE_APPROVERS = ['admin'];
// Who may confirm cash physically received from a Commercial
export const HANDOVER_RECEIVERS = ['admin', 'cashier'];

// Sidebar navigation role mapping (null = all roles)
export const NAV_ROLE_ACCESS = {
  '/': null,
  '/cockpit': ['admin'],
  '/accounting': ['admin', 'cashier'],
  '/purchases': ['admin', 'procurement', 'production_manager', 'warehouse_manager', 'employee'],
  '/suppliers': ['admin', 'procurement'],
  '/inventory': ['admin', 'warehouse_manager', 'procurement'],
  '/manufacturing': ['admin', 'production_manager', 'warehouse_manager'],
  '/quality': ['admin', 'production_manager'],
  '/expiry': ['admin', 'warehouse_manager', 'production_manager', 'employee'],
  '/traceability': ['admin', 'production_manager', 'warehouse_manager'],
  '/sales': ['admin', 'employee'],
  '/customers': ['admin', 'employee'],
  '/distribution': ['admin', 'employee', 'warehouse_manager'],
  '/employees': ['admin'],
  '/payroll': ['admin'],
  '/cashier': ['admin', 'cashier', 'production_manager'],
  '/expenses': null,
  '/reports': ['admin'],
  '/approvals': ['admin', 'procurement', 'production_manager', 'warehouse_manager'],
  '/admin': ['admin'],
  '/field-sales': ['admin', 'commercial'],
  '/field-review': ['admin'],
  '/custody': ['admin', 'warehouse_manager'],
  '/cash-handovers': ['admin', 'cashier', 'commercial'],
};

export function canIssueCustody(role) {
  return CUSTODY_ISSUERS.includes(role);
}

export function canApproveFieldSale(role) {
  return FIELD_SALE_APPROVERS.includes(role);
}

export function canReceiveHandover(role) {
  return HANDOVER_RECEIVERS.includes(role);
}