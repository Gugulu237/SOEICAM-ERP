/* localized-metadata */
import {ui} from './i18n.js';
import { hasRoleAccess } from './permissions.js';
import { INVENTORY_PATH, INVENTORY_ROLES } from './inventory-navigation.js';
import { QUALITY_ROLES } from './quality-workspace.js';
import { PURCHASE_ROLES } from './purchase-workspace.js';
import { permitsWorkspace,workspacePath } from './workspace-navigation.js';
// Registry of ERP "applications" shown on the visual Home launcher.
// Each module: identity (icon + color), route, roles, and a key into the
// live-stats object computed by Home.jsx.
import {
  Factory, Package, ShoppingCart,
  Users, Receipt, UserCheck, Truck, BookOpen, Banknote, CheckSquare,
  BarChart3, Wallet, Settings, LineChart, Activity,
  ClipboardCheck
} from "lucide-react";

export const APP_MODULES = [
  { key: "commercial_workspace", get label(){return ui("Commercial Dashboard");}, path: "/commercial", icon: Users, description: "Field POS, agent stock, sales and performance", color: "bg-green-50 text-green-700", ring: "hover:border-green-300", roles: ["commercial"] },
  { key: "team_workspaces", get label(){return ui("Employee Dashboard");}, path: "/team-workspaces", icon: Users, description: "Staff, roles, payroll and live workspaces", color: "bg-sky-50 text-sky-800", ring: "hover:border-sky-300", roles: ["admin","cashier"] },
  { key: "driver", get label(){return ui("My Deliveries");}, path: "/distribution?tab=deliveries", icon: Truck, description: "Assigned runs, stops & delivery reports", color: "bg-blue-50 text-blue-700", ring: "hover:border-blue-300", roles: ["driver"] },
  {
    key: "expenses", get label(){return ui("Expenses & Budgets");}, path: "/expenses", icon: Wallet,
    description: "Request, approve & pay expenses",
    color: "bg-sky-50 text-sky-700", ring: "hover:border-sky-300",
    roles: ["admin", "cashier", "procurement", "production_manager", "warehouse_manager", "employee"],
  },
  {
    key: "finance_pulse", get label(){return ui("Finance Pulse");}, path: "/finance-pulse", icon: Activity,
    description: "Cash, sales, spend & losses",
    color: "bg-green-50 text-green-700", ring: "hover:border-green-300",
    roles: ["admin", "cashier", "production_manager"],
  },
  {
    key: "production", get label(){return ui("Manufacturing");}, path: "/manufacturing", icon: Factory,
    description: "Production, recipes, quality & batch tracking",
    color: "bg-blue-50 text-blue-700", ring: "hover:border-blue-300",
    roles: QUALITY_ROLES,
    statKey: "production", badgeKey: "productionAwaitingQC",
  },
  {
    key: "inventory", get label(){return ui("Inventory");}, path: INVENTORY_PATH, icon: Package,
    description: "Finished products, ingredients & stock",
    color: "bg-sky-50 text-sky-600", ring: "hover:border-sky-300",
    roles: INVENTORY_ROLES,
    statKey: "inventory",
  },
  {
    key: "procurement", get label(){return ui("Purchases");}, path: "/purchases", icon: ShoppingCart,
    description: "Suppliers, orders, receiving & bills",
    color: "bg-cyan-50 text-cyan-700", ring: "hover:border-cyan-300",
    roles: PURCHASE_ROLES,
    statKey: "procurement", badgeKey: "posPending",
  },
  {
    key: "sales", get label(){return ui("Sales");}, path: "/sales", icon: Receipt,
    description: "Orders, invoices & outlet reports",
    color: "bg-green-50 text-green-600", ring: "hover:border-green-300",
    roles: ["admin", "employee", "hotesse", "production_manager","warehouse_manager"],
    statKey: "sales",
  },
  {
    key: "customers", get label(){return ui("Customers");}, path: "/customers", icon: UserCheck,
    description: "Accounts, credit & routes",
    color: "bg-teal-50 text-teal-600", ring: "hover:border-teal-300",
    roles: ["admin", "employee", "commercial"],
    statKey: "customers", badgeKey: "overdueCustomers",
  },
  {
    key: "distribution", get label(){return ui("Distribution");}, path: "/distribution", icon: Truck,
    description: "Deliveries, Commercial stock, vehicle loads & returns",
    color: "bg-blue-50 text-blue-600", ring: "hover:border-blue-300",
    roles: ["admin", "employee", "warehouse_manager", "production_manager"],
    statKey: "distribution",
  },
  {
    key: "finance", get label(){return ui("Finance");}, path: "/accounting", icon: BookOpen,
    description: "Ledger, AR/AP & treasury",
    color: "bg-sky-50 text-sky-800", ring: "hover:border-sky-300",
    roles: ["admin", "cashier","production_manager","warehouse_manager"],
    statKey: "finance", badgeKey: "overdueInvoices",
  },
  {
    key: "field_review", get label(){return ui("Field Sale Review");}, path: "/field-review", icon: ClipboardCheck,
    description: "Receipts, approval & posting",
    color: "bg-green-50 text-green-700", ring: "hover:border-green-300",
    roles: ["admin"],
  },
  {
    key: "cashier", get label(){return ui("Cashier");}, path: "/cashier", icon: Banknote,
    description: "Handovers, payments, expenses & transfers",
    color: "bg-green-50 text-green-700", ring: "hover:border-green-300",
    roles: ["admin", "cashier", "production_manager"],
    statKey: "cashier", badgeKey: "cashPending",
  },
  {
    key: "approvals", get label(){return ui("Approvals");}, path: "/approvals", icon: CheckSquare,
    description: "Items waiting for your decision",
    color: "bg-sky-50 text-sky-800", ring: "hover:border-sky-300",
    roles: ["admin", "procurement", "production_manager", "warehouse_manager"],
    statKey: "approvals", badgeKey: "approvals",
  },
  {
    key: "cockpit", get label(){return ui("Business Cockpit");}, path: "/cockpit", icon: LineChart,
    description: "Executive overview",
    color: "bg-blue-50 text-blue-700", ring: "hover:border-blue-300",
    roles: ["admin"],
    statKey: "cockpit",
  },
  {
    key: "reports", get label(){return ui("Reports");}, path: "/reports", icon: BarChart3,
    description: "Analysis & statements",
    color: "bg-cyan-50 text-cyan-700", ring: "hover:border-cyan-300",
    roles: ["admin"],
  },
  {
    key: "administration", get label(){return ui("Administration");}, path: "/admin", icon: Settings,
    description: "Settings & structure",
    color: "bg-slate-100 text-slate-700", ring: "hover:border-slate-300",
    roles: ["admin"],
  },
];

export function modulesForRole(role,allowedModules){
 const destination=module=>role==='cashier'&&module.key==='team_workspaces'?'/team-workspaces?section=payroll':role==='hotesse'&&module.key==='sales'?'/outlet-reports':workspacePath(module.path,allowedModules);
 return APP_MODULES.filter(module=>(module.key!=='commercial_workspace'||role==='commercial')&&hasRoleAccess(role,module.roles)&&(role==='admin'||permitsWorkspace(destination(module),allowedModules))).map(module=>({...module,path:destination(module),...(role==='hotesse'&&module.key==='sales'?{description:'Daily sales and point-of-sale stock'}:{})}));
}
