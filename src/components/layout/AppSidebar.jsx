import React, { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard, BookOpen, ShoppingCart, Users, Package, Factory,
  ShieldCheck, Receipt, UserCheck, Truck, UserCog, Wallet, BarChart3,
  CheckSquare, Settings, ChevronLeft, ChevronRight, LogOut, Menu, Banknote,
  CalendarClock, GitBranch, Boxes
} from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useCurrentUser } from "@/hooks/useCurrentUser";

const navItems = [
  { label: "Home", icon: LayoutDashboard, path: "/", roles: null },
  { label: "Business Cockpit", icon: BarChart3, path: "/cockpit", roles: ["admin"] },
  { label: "Accounting", icon: BookOpen, path: "/accounting", roles: ["admin", "cashier"] },
  { label: "Purchases", icon: ShoppingCart, path: "/purchases", roles: ["admin", "procurement", "production_manager", "warehouse_manager", "employee"] },
  { label: "Suppliers", icon: Users, path: "/suppliers", roles: ["admin", "procurement"] },
  { label: "Items & Services", icon: Boxes, path: "/items", roles: ["admin", "warehouse_manager", "procurement", "employee"] },
  { label: "Inventory", icon: Package, path: "/inventory", roles: ["admin", "warehouse_manager", "procurement"] },
  { label: "Manufacturing", icon: Factory, path: "/manufacturing", roles: ["admin", "production_manager", "warehouse_manager"] },
  { label: "Quality Control", icon: ShieldCheck, path: "/quality", roles: ["admin", "production_manager"] },
  { label: "Expiry Risk", icon: CalendarClock, path: "/expiry", roles: ["admin", "warehouse_manager", "production_manager", "employee"] },
  { label: "Traceability", icon: GitBranch, path: "/traceability", roles: ["admin", "production_manager", "warehouse_manager"] },
  { label: "Sales", icon: Receipt, path: "/sales", roles: ["admin", "employee"] },
  { label: "Customers", icon: UserCheck, path: "/customers", roles: ["admin", "employee"] },
  { label: "Distribution", icon: Truck, path: "/distribution", roles: ["admin", "employee"] },
  { label: "Employees", icon: UserCog, path: "/employees", roles: ["admin"] },
  { label: "Payroll", icon: Wallet, path: "/payroll", roles: ["admin"] },
  { label: "Cashier", icon: Banknote, path: "/cashier", roles: ["admin", "cashier"] },
  { label: "Reports", icon: BarChart3, path: "/reports", roles: ["admin"] },
  { label: "Approvals", icon: CheckSquare, path: "/approvals", roles: ["admin", "procurement", "production_manager"] },
  { label: "Administration", icon: Settings, path: "/admin", roles: ["admin"] },
];

export default function AppSidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const { role } = useCurrentUser();

  const visibleItems = navItems.filter(item => {
    if (!role || role === 'admin') return true;
    return !item.roles || item.roles.includes(role);
  });

  const isActive = (path) => {
    if (path === "/") return location.pathname === "/";
    return location.pathname.startsWith(path);
  };

  const sidebar = (
    <div className={`flex flex-col h-full bg-slate-900 text-white transition-all duration-200 ${collapsed ? "w-16" : "w-60"}`}>
      <div className="flex items-center justify-between px-4 py-4 border-b border-slate-700">
        {!collapsed && (
          <div>
            <h1 className="text-lg font-bold tracking-tight text-amber-400">SOEICAM</h1>
            <p className="text-[10px] text-slate-400 tracking-widest uppercase">YOLA ERP</p>
          </div>
        )}
        <button onClick={() => setCollapsed(!collapsed)} className="p-1 rounded hover:bg-slate-700 hidden lg:block">
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto py-2 space-y-0.5">
        {visibleItems.map(item => (
          <Link
            key={item.path}
            to={item.path}
            onClick={() => setMobileOpen(false)}
            className={`flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
              isActive(item.path)
                ? "bg-amber-500/20 text-amber-400 border-r-2 border-amber-400"
                : "text-slate-300 hover:bg-slate-800 hover:text-white"
            } ${collapsed ? "justify-center px-2" : ""}`}
          >
            <item.icon size={18} className="shrink-0" />
            {!collapsed && <span>{item.label}</span>}
          </Link>
        ))}
      </nav>
      <div className="border-t border-slate-700 p-3">
        <button
          onClick={() => base44.auth.logout("/")}
          className={`flex items-center gap-3 w-full px-2 py-2 text-sm text-slate-400 hover:text-white rounded hover:bg-slate-800 ${collapsed ? "justify-center" : ""}`}
        >
          <LogOut size={18} />
          {!collapsed && <span>Sign Out</span>}
        </button>
      </div>
    </div>
  );

  return (
    <>
      <button onClick={() => setMobileOpen(true)} className="lg:hidden fixed top-3 left-3 z-50 p-2 bg-slate-900 text-white rounded-lg shadow-lg">
        <Menu size={20} />
      </button>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setMobileOpen(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative h-full" onClick={e => e.stopPropagation()}>
            {sidebar}
          </div>
        </div>
      )}
      <div className="hidden lg:block h-screen sticky top-0">
        {sidebar}
      </div>
    </>
  );
}