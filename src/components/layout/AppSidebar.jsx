import React, { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard, BookOpen, ShoppingCart, Users, Package, Factory,
  ShieldCheck, Receipt, UserCheck, Truck, UserCog, Wallet, BarChart3,
  CheckSquare, Settings, ChevronLeft, ChevronRight, LogOut, Menu
} from "lucide-react";
import { base44 } from "@/api/base44Client";

const navItems = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/" },
  { label: "Accounting", icon: BookOpen, path: "/accounting" },
  { label: "Purchases", icon: ShoppingCart, path: "/purchases" },
  { label: "Suppliers", icon: Users, path: "/suppliers" },
  { label: "Inventory", icon: Package, path: "/inventory" },
  { label: "Manufacturing", icon: Factory, path: "/manufacturing" },
  { label: "Quality Control", icon: ShieldCheck, path: "/quality" },
  { label: "Sales", icon: Receipt, path: "/sales" },
  { label: "Customers", icon: UserCheck, path: "/customers" },
  { label: "Distribution", icon: Truck, path: "/distribution" },
  { label: "Employees", icon: UserCog, path: "/employees" },
  { label: "Payroll", icon: Wallet, path: "/payroll" },
  { label: "Reports", icon: BarChart3, path: "/reports" },
  { label: "Approvals", icon: CheckSquare, path: "/approvals" },
  { label: "Administration", icon: Settings, path: "/admin" },
];

export default function AppSidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

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
        {navItems.map(item => (
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