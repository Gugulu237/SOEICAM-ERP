// Registry of ERP "applications" shown on the visual Home launcher.
// Each module: identity (icon + color), route, roles, and a key into the
// live-stats object computed by Home.jsx.
import {
  Factory, FlaskConical, Package, CalendarClock, GitBranch, ShoppingCart,
  Users, Receipt, UserCheck, Truck, BookOpen, Banknote, CheckSquare,
  BarChart3, Wallet, UserCog, Settings, LineChart, Activity, Boxes
} from "lucide-react";

export const APP_MODULES = [
  {
    key: "expenses", label: "Expenses & Budgets", path: "/expenses", icon: Wallet,
    description: "Request, approve & pay expenses",
    color: "bg-amber-50 text-amber-600", ring: "hover:border-amber-300",
    roles: ["admin", "cashier", "procurement", "production_manager", "warehouse_manager", "employee"],
  },
  {
    key: "finance_pulse", label: "Finance Pulse", path: "/finance-pulse", icon: Activity,
    description: "Cash, sales, spend & losses",
    color: "bg-emerald-50 text-emerald-700", ring: "hover:border-emerald-300",
    roles: ["admin", "cashier", "production_manager"],
  },
  {
    key: "production", label: "Production", path: "/manufacturing", icon: Factory,
    description: "Batches, recipes & yield",
    color: "bg-purple-50 text-purple-600", ring: "hover:border-purple-300",
    roles: ["admin", "production_manager", "warehouse_manager"],
    statKey: "production", badgeKey: "productionAwaitingQC",
  },
  {
    key: "quality", label: "Quality Control", path: "/quality", icon: FlaskConical,
    description: "Batch release & inspections",
    color: "bg-emerald-50 text-emerald-600", ring: "hover:border-emerald-300",
    roles: ["admin", "production_manager"],
    statKey: "quality", badgeKey: "quarantined",
  },
  {
    key: "inventory", label: "Inventory & Cold Room", path: "/inventory", icon: Package,
    description: "Stock, transfers & movements",
    color: "bg-sky-50 text-sky-600", ring: "hover:border-sky-300",
    roles: ["admin", "warehouse_manager", "procurement"],
    statKey: "inventory",
  },
  {
    key: "items", label: "Items & Services", path: "/items", icon: Boxes,
    description: "Inventory items, services & assemblies",
    color: "bg-slate-100 text-slate-700", ring: "hover:border-slate-300",
    roles: ["admin", "warehouse_manager", "procurement", "employee"],
  },
  {
    key: "expiry", label: "Expiry Center", path: "/expiry", icon: CalendarClock,
    description: "Batches at risk of loss",
    color: "bg-red-50 text-red-600", ring: "hover:border-red-300",
    roles: ["admin", "warehouse_manager", "production_manager", "employee"],
    statKey: "expiry", badgeKey: "expiringSoon",
  },
  {
    key: "traceability", label: "Traceability", path: "/traceability", icon: GitBranch,
    description: "Batch genealogy & recall",
    color: "bg-indigo-50 text-indigo-600", ring: "hover:border-indigo-300",
    roles: ["admin", "production_manager", "warehouse_manager"],
  },
  {
    key: "procurement", label: "Procurement", path: "/purchases", icon: ShoppingCart,
    description: "Purchase orders & receiving",
    color: "bg-orange-50 text-orange-600", ring: "hover:border-orange-300",
    roles: ["admin", "procurement", "production_manager", "warehouse_manager", "employee"],
    statKey: "procurement", badgeKey: "posPending",
  },
  {
    key: "sales", label: "Sales", path: "/sales", icon: Receipt,
    description: "Orders & invoicing",
    color: "bg-green-50 text-green-600", ring: "hover:border-green-300",
    roles: ["admin", "employee"],
    statKey: "sales",
  },
  {
    key: "customers", label: "Customers", path: "/customers", icon: UserCheck,
    description: "Accounts, credit & routes",
    color: "bg-teal-50 text-teal-600", ring: "hover:border-teal-300",
    roles: ["admin", "employee"],
    statKey: "customers", badgeKey: "overdueCustomers",
  },
  {
    key: "distribution", label: "Distribution", path: "/distribution", icon: Truck,
    description: "Trucks, routes & dispatches",
    color: "bg-blue-50 text-blue-600", ring: "hover:border-blue-300",
    roles: ["admin", "employee", "warehouse_manager"],
    statKey: "distribution",
  },
  {
    key: "finance", label: "Finance", path: "/accounting", icon: BookOpen,
    description: "Ledger, AR/AP & treasury",
    color: "bg-amber-50 text-amber-700", ring: "hover:border-amber-300",
    roles: ["admin", "cashier"],
    statKey: "finance", badgeKey: "overdueInvoices",
  },
  {
    key: "cashier", label: "Cashier", path: "/cashier", icon: Banknote,
    description: "Disbursements & collections",
    color: "bg-lime-50 text-lime-700", ring: "hover:border-lime-300",
    roles: ["admin", "cashier", "production_manager"],
    statKey: "cashier", badgeKey: "cashPending",
  },
  {
    key: "approvals", label: "Approvals", path: "/approvals", icon: CheckSquare,
    description: "Items waiting for your decision",
    color: "bg-yellow-50 text-yellow-700", ring: "hover:border-yellow-300",
    roles: ["admin", "procurement", "production_manager", "warehouse_manager"],
    statKey: "approvals", badgeKey: "approvals",
  },
  {
    key: "suppliers", label: "Suppliers", path: "/suppliers", icon: Users,
    description: "Vendor accounts",
    color: "bg-slate-100 text-slate-600", ring: "hover:border-slate-300",
    roles: ["admin", "procurement"],
  },
  {
    key: "cockpit", label: "Business Cockpit", path: "/cockpit", icon: LineChart,
    description: "Executive overview",
    color: "bg-fuchsia-50 text-fuchsia-600", ring: "hover:border-fuchsia-300",
    roles: ["admin"],
    statKey: "cockpit",
  },
  {
    key: "reports", label: "Reports", path: "/reports", icon: BarChart3,
    description: "Analysis & statements",
    color: "bg-cyan-50 text-cyan-700", ring: "hover:border-cyan-300",
    roles: ["admin"],
  },
  {
    key: "payroll", label: "Payroll", path: "/payroll", icon: Wallet,
    description: "Salary runs",
    color: "bg-rose-50 text-rose-600", ring: "hover:border-rose-300",
    roles: ["admin"],
  },
  {
    key: "employees", label: "Employees", path: "/employees", icon: UserCog,
    description: "Team & roles",
    color: "bg-violet-50 text-violet-600", ring: "hover:border-violet-300",
    roles: ["admin"],
  },
  {
    key: "administration", label: "Administration", path: "/admin", icon: Settings,
    description: "Settings & structure",
    color: "bg-gray-100 text-gray-600", ring: "hover:border-gray-300",
    roles: ["admin"],
  },
];

export function modulesForRole(role) {
  if (!role || role === "admin") return APP_MODULES;
  return APP_MODULES.filter(m => m.roles.includes(role));
}