
/* localized-interface */
import { ui } from './i18n.js';
import { ACCOUNTING_REPORT_PATHS } from './management-access.js';
import { normalizeRole, effectiveRole, hasRoleAccess, MANAGEMENT_HIERARCHY } from '../server/domain/roles.js';
import { INVENTORY_ROLES } from './inventory-navigation.js';
import { QUALITY_ROLES } from './quality-workspace.js';
import { PURCHASE_ROLES } from './purchase-workspace.js';
import { COMPANY_SALES_ROLES, COMMERCIAL_REPORT_ROLES, DISPATCH_MANAGER_ROLES } from './operations-access.js';
export { normalizeRole, hasRoleAccess };

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
  DRIVER: 'driver',
};

export const ROLE_LABELS = {
  get admin(){return ui("General Manager");},
  get supply_chain_manager(){return ui("Supply Chain Manager");},
  procurement: 'Procurement',
  get warehouse_manager(){return ui("Warehouse Manager");},
  cashier: 'Cashier',
  get production_manager(){return ui("Operations / Production Manager");},
  employee: 'Employee',
  get commercial(){return ui("Commercial (Field Sales)");},
  get hotesse(){return ui("Hotesse (Outlet Reporting)");},
  get driver(){return ui("Driver (Deliveries)");},
};

// The system roles: how each one is grouped, what it is responsible for, and
// which features it opens. Single source of truth for role assignment on Employees.
export const ROLE_DEFINITIONS = [
  {
    key: 'admin',
    ...MANAGEMENT_HIERARCHY.admin,
    get label(){return ui("General Manager");},
    category: 'Management',
    get summary(){return ui("Full ERP administration across every dashboard, department and management function.");},
    duties: [
      'Final approval of purchase orders and field sales; reviews production activity',
      'Reviews financial statements, budgets and the business cockpit',
      'Manages employees, user accounts and company settings',
      'Full administration of every ERP module and staff dashboard',
    ],
  },
  {
    key: 'production_manager',
    ...MANAGEMENT_HIERARCHY.production_manager,
    label: ROLE_LABELS.production_manager,
    category: 'Management',
    get summary(){return ui("Leads daily operations and production, with company sales and delivery oversight.");},
    duties: [
      'Plans production, requests materials and records output',
      'Views company sales and Commercial performance across all agents',
      'Manages inventory, delivery teams, dispatch loading and returns',
      'Oversees quality control, batch release, expiry and traceability',
      'Reviews recipes and expense requests within the existing approval workflow',
      'Provides the Operations / Production Manager cheque signature',
      'Submits production directly to Warehouse; purchases retain General Manager approval',
    ],
  },
  {
    key: 'supply_chain_manager',
    get label(){return ui("Supply Chain Manager");},
    category: 'Management',
    get summary(){return ui("Coordinates suppliers, purchasing, receiving, inventory, quality and deliveries.");},
    duties: [
      'Maintains suppliers and plans replenishment orders',
      'Oversees receiving, stock and batch quality',
      'Coordinates vehicle loads, returns and deliveries',
    ],
  },
  {
    key: 'cashier',
    get label(){return ui("Cashier");},
    category: 'Finance',
    get summary(){return ui("Handles money in and money out.");},
    duties: [
      'Disburses payments and records treasury receipts and expenses',
      'Confirms cash physically received from Commercials',
      'Runs the Cashier dashboard and expense payments',
      'Sees finance and accounting',
    ],
  },
  {
    key: 'procurement',
    get label(){return ui("Procurement Officer");},
    category: 'Operations',
    get summary(){return ui("Buys what the factory and sales need.");},
    duties: [
      'Creates purchase orders and follows them through to receipt',
      'Maintains supplier accounts and price agreements',
      'Tracks stock levels and reorder needs',
      'Submits purchases for General Manager approval',
    ],
  },
  {
    key: 'warehouse_manager',
    get label(){return ui("Warehouse Manager");},
    category: 'Operations',
    get summary(){return ui("Controls everything that moves in and out of storage.");},
    duties: [
      'Receives goods and manages stock, transfers and cold room',
      'Loads finished goods onto paired Commercial delivery vehicles and receives counted returns',
      'Monitors expiry, quarantine and batch traceability',
      'Approves stock corrections and warehouse movements',
    ],
  },
  {
    key: 'employee',
    get label(){return ui("Employee (General Staff)");},
    category: 'Operations',
    get summary(){return ui("General staff with day-to-day operational access.");},
    duties: [
      'Raises expense requests and records their own activity',
      'Sees sales, customers, procurement and stock screens',
      'Reports stock movements and delivery information',
      'No approval or financial posting rights',
    ],
  },
  {
    key: 'commercial',
    get label(){return ui("Commercial (Field Sales)");},
    category: 'Commercial',
    get summary(){return ui("Sells in the field and holds company stock in custody.");},
    duties: [
      'Holds issued stock in custody and sells on the road',
      'Records deliveries with customer receipt evidence',
      'Collects cash and hands it over to the Cashier',
      'Registers new customers with GPS location',
    ],
  },
  {
    key: 'driver',
    get label(){return ui("Driver (Deliveries)");},
    category: 'Operations',
    get summary(){return ui("Delivers assigned goods and reports progress from the road.");},
    duties: ['Views only assigned runs, load manifests and customer stops', 'Opens customer directions and calls delivery contacts', 'Records departure, delivery outcomes, incidents and return to base', 'Leaves stock reconciliation, invoicing and approvals to authorized staff'],
  },
  {
    key: 'hotesse',
    get label(){return ui("Hotesse (Outlet Reporting)");},
    category: 'Commercial',
    get summary(){return ui("Records daily retail sales and stock counts at assigned points of sale.");},
    duties: [
      'Reports units sold, retail prices and closing stock each day',
      'Sees only finished products confirmed supplied to assigned outlets',
      'Flags count differences, damage and replenishment needs',
      'No financial posting rights',
    ],
  },
];

export const ROLE_CATEGORIES = ['Management', 'Finance', 'Operations', 'Commercial'];

export function roleDefinition(role) {
  return ROLE_DEFINITIONS.find(r => r.key === (normalizeRole(role) || role)) || null;
}

export function roleLabel(role) {
  return roleDefinition(role)?.label || ROLE_LABELS[role] || role || 'Unassigned';
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
// Who signs cheques (dual signature required: GM + Operations / Production Manager)
export const CHEQUE_GM_SIGNERS = ['admin'];
export const CHEQUE_PM_SIGNERS = ['production_manager'];

// Determine effective role from user + employee records
export function getEffectiveRole(user, employee) {
  return effectiveRole(user, employee);
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
  '/accounting': ['admin', 'cashier','production_manager','warehouse_manager'],
  '/purchases': PURCHASE_ROLES,
  '/suppliers': ['admin', 'procurement', 'cashier'],
  '/inventory': INVENTORY_ROLES,
  '/items': INVENTORY_ROLES,
  '/manufacturing': QUALITY_ROLES,
  '/quality': QUALITY_ROLES,
  '/expiry': ['admin', 'warehouse_manager', 'production_manager', 'employee'],
  '/traceability': ['admin', 'production_manager', 'warehouse_manager'],
  '/sales': [...COMPANY_SALES_ROLES,'warehouse_manager'],
  '/customers': ['admin', 'employee', 'commercial'],
  '/distribution': [...DISPATCH_MANAGER_ROLES, 'employee', 'driver'],
  '/employees': ['admin'],
  '/payroll': ['admin','cashier'],
  '/cashier': ['admin', 'cashier', 'production_manager'],
  '/expenses': null,
  '/reports': ['admin'],
  '/approvals': ['admin', 'procurement', 'production_manager', 'warehouse_manager'],
  '/admin': ['admin'],
  '/team-workspaces': ['admin','cashier'],
  '/commercial': ['admin', 'commercial', 'production_manager'],
  '/driver': ['admin', 'driver'],
  '/hotesse': ['admin', 'hotesse'],
  '/outlet-reports': ['admin', 'hotesse'],
  '/field-customers': ['admin', 'commercial'],
  '/commercial-performance': COMMERCIAL_REPORT_ROLES,
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
// Field staff use dedicated workspaces; hiding navigation alone is insufficient.
export function canOpenFieldPath(role, path) {
  const [pathname,query='']=String(path||'').split('?');path=pathname;
  role = normalizeRole(role);
  if (!role) return false;
  if (role === 'admin') return true;
  if (path === '/profile' || path === '/profile/') return true;
  if (path === '/sales-reports') return true;
  const isWithin = root => root === '/' ? path === '/' : path === root || path.startsWith(root + '/');
  if (isWithin('/team-workspaces')) return role === 'admin'||role==='cashier'&&new URLSearchParams(query).get('section')==='payroll';
  if (isWithin('/commercial')) return ['commercial', 'production_manager'].includes(role) && path.replace(/\/+$/, '') === '/commercial';
  if (role === 'driver' && isWithin('/distribution')) return path.replace(/\/+$/, '') === '/distribution';
  if (isWithin('/outlet-reports')) return ['admin', 'hotesse'].includes(role);
  if (['production_manager','warehouse_manager'].includes(role) && isWithin('/accounting')) return ACCOUNTING_REPORT_PATHS.includes(path.replace(/\/+$/, ''));
  if (['production_manager','warehouse_manager'].includes(role) && isWithin('/sales')) return path.replace(/\/+$/, '') === '/sales';
  const scopes = {
    commercial: ['/', '/customers', '/commercial', '/field-sales', '/field-customers', '/commercial-performance', '/cash-handovers'],
    driver: ['/', '/driver', '/distribution'],
    hotesse: ['/', '/hotesse', '/outlet-reports'],
    cashier: ['/', '/payroll', '/cashier', '/cash-handovers', '/accounting', '/expenses', '/finance-pulse', '/purchases', '/suppliers'],
    production_manager: ['/', '/inventory', '/items', '/manufacturing', '/quality', '/expiry', '/traceability', '/purchases', '/cashier', '/expenses', '/approvals', '/finance-pulse', '/distribution', '/commercial-performance'],
  };
  return scopes[role] ? scopes[role].some(isWithin) : true;
}
