
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState } from "react";
import { Link, useLocation } from "@/lib/router";
import {
  LayoutDashboard, BookOpen, ShoppingCart, Users, Package, Factory,
  Receipt, UserCheck, Truck, Wallet, BarChart3,
  Settings, ChevronLeft, ChevronRight, LogOut, Menu, Banknote,
  ShoppingBag
} from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { hasRoleAccess } from "@/lib/permissions";
import { INVENTORY_PATH, INVENTORY_ROLES, isInventoryPath } from "@/lib/inventory-navigation";
import { QUALITY_ROLES, isQualityPath } from '@/lib/quality-workspace';
import { PURCHASE_ROLES } from '@/lib/purchase-workspace';
import { permitsWorkspace,workspacePath } from '@/lib/workspace-navigation';

const navItems = [
  { get label(){return ui("Home");}, icon: LayoutDashboard, path: "/", roles: null },
  { get label(){return ui("Employee Dashboard");}, icon: Users, path: "/team-workspaces", roles: ["admin","cashier"] },
  { get label(){return ui("Supply Chain Dashboard");}, icon: Truck, path: "/supply-chain", roles: ["warehouse_manager"], assignedRole: "supply_chain_manager" },
  { get label(){return ui("Commercial Dashboard");}, icon: ShoppingBag, path: "/commercial", roles: ["commercial"], personalCommercial: true },
  { get label(){return ui("Expenses");}, icon: Wallet, path: "/expenses", roles: ["admin", "cashier", "production_manager", "procurement", "warehouse_manager", "employee"] },
  { get label(){return ui("Business Cockpit");}, icon: BarChart3, path: "/cockpit", roles: ["admin"] },
  { get label(){return ui("Accounting");}, icon: BookOpen, path: "/accounting", roles: ["admin", "cashier","production_manager","warehouse_manager"] },
  { get label(){return ui("Purchases");}, icon: ShoppingCart, path: "/purchases", roles: PURCHASE_ROLES },
  { get label(){return ui("Inventory");}, icon: Package, path: INVENTORY_PATH, roles: INVENTORY_ROLES },
  { get label(){return ui("Manufacturing");}, icon: Factory, path: "/manufacturing", roles: QUALITY_ROLES },
  { get label(){return ui("Sales");}, icon: Receipt, path: "/sales", roles: ["admin", "employee", "hotesse", "production_manager","warehouse_manager"], children: [
    { get label(){return ui("Outlet Reports");}, path: "/outlet-reports", roles: ["admin", "hotesse"] },
  ] },
  { get label(){return ui("Customers");}, icon: UserCheck, path: "/customers", roles: ["admin", "employee", "commercial"] },
  { get label(){return ui("Distribution");}, icon: Truck, path: "/distribution", roles: ["admin", "employee", "warehouse_manager", "production_manager", "driver"] },
  { get label(){return ui("Cashier");}, icon: Banknote, path: "/cashier", roles: ["admin", "cashier", "production_manager"] },
  { get label(){return ui("Reports");}, icon: BarChart3, path: "/reports", roles: ["admin"] },
  { get label(){return ui("Administration");}, icon: Settings, path: "/admin", roles: ["admin"] },
];

export default function AppSidebar() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const { role, assignedRole, allowedModules } = useCurrentUser();
  const { logout } = useAuth();

  const targetPath=path=>role==='cashier'&&path==='/team-workspaces'?'/team-workspaces?section=payroll':workspacePath(path,allowedModules);
  const permits = path => permitsWorkspace(targetPath(path),allowedModules);
  const visibleItems = navItems.filter(item => (!item.personalCommercial || role === 'commercial') && hasRoleAccess(role, item.roles) && (!item.assignedRole || item.assignedRole === assignedRole) && permits(item.path));

  const isActive = (path) => {
    if (path === "/") return location.pathname === "/";
    if (path.includes('?')) { const [pathname,query]=path.split('?'); const selected=new URLSearchParams(location.search); return location.pathname === pathname && [...new URLSearchParams(query)].every(([key,value])=>selected.get(key)===value); }
    if (path === INVENTORY_PATH) return isInventoryPath(location.pathname);
    if (path === '/commercial') return ['/commercial', '/commercial-performance', '/field-sales'].some(root => location.pathname === root || location.pathname.startsWith(root + '/'));
    if (path === '/manufacturing') return location.pathname.startsWith('/manufacturing') || isQualityPath(location.pathname);
    if (path === '/customers') return location.pathname.startsWith('/customers') || location.pathname === '/field-customers';
    if (path === '/purchases') return location.pathname.startsWith('/purchases') || location.pathname === '/suppliers';
    if (path === '/distribution') return location.pathname.startsWith('/distribution') || location.pathname === '/driver';
    if (path === '/cashier') return location.pathname.startsWith('/cashier') || location.pathname === '/cash-handovers';
    if (path === '/team-workspaces') return location.pathname.startsWith('/team-workspaces') || location.pathname.startsWith('/employees');
    return location.pathname.startsWith(path);
  };

  const sidebar = (
    <div className={`flex h-full flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-all duration-200 ${collapsed ? "w-16" : "w-60"}`}>
      <div className={`flex min-h-20 items-center gap-2 border-b border-sidebar-border bg-sidebar ${collapsed ? 'justify-center px-2 py-4' : 'justify-between px-3 py-3'}`}>
        {collapsed ? <Link to="/" aria-label={ui("SOEICAM home")} className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-50 text-lg font-extrabold text-[#245719]">S</Link> :
          <Link to="/" aria-label={ui("SOEICAM home")} className="block min-w-0 rounded-xl p-1.5"><img src="/brand/soeicam-logo.png" alt={ui("SOEICAM")} className="block h-auto w-[162px]" /></Link>}
        <button aria-label={collapsed ? ui("Expand navigation") : ui("Collapse navigation")} onClick={() => setCollapsed(!collapsed)} className="hidden rounded p-1 text-[#245719] hover:bg-sidebar-accent lg:block">
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto py-3">
        {visibleItems.map(item => (
          <React.Fragment key={item.path}>
          {role === 'hotesse' && item.path === '/sales' ? <div className="px-4 pb-1 pt-4 text-xs font-semibold uppercase tracking-wider text-slate-500">{collapsed ? <Receipt size={18} /> : ui("Sales")}</div> :
          <Link
            key={item.path}
            to={targetPath(item.path)}
            resume={item.path !== '/' && !item.path.includes('?')}
            onClick={() => setMobileOpen(false)}
            aria-current={isActive(item.path) ? 'page' : undefined}
            className={`mx-2 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
              isActive(item.path)
                ? "bg-[#347623] text-white shadow-sm"
                : "text-slate-700 hover:bg-sidebar-accent hover:text-[#245719]"
            } ${collapsed ? "justify-center px-2" : ""}`}
          >
            <item.icon size={18} className="shrink-0" />
            {!collapsed && <span>{item.label}</span>}
          </Link>
          }
          {(item.children || []).filter(child => hasRoleAccess(role, child.roles) && permits(child.path)).map(child => <Link key={child.path} to={child.path} aria-current={isActive(child.path) ? 'page' : undefined} onClick={() => setMobileOpen(false)} className={'mx-2 flex min-h-10 items-center rounded-lg py-2 text-sm font-medium ' + (collapsed ? 'justify-center px-2' : 'gap-2 pl-10 pr-3') + (isActive(child.path) ? ' bg-[#347623] text-white shadow-sm' : ' text-slate-600 hover:bg-sidebar-accent hover:text-[#245719]')}><Receipt size={15} />{!collapsed && child.label}</Link>)}
          </React.Fragment>
        ))}
      </nav>
      <div className="border-t border-sidebar-border p-3">
        <Link to="/profile" aria-label={ui('My profile')} title={ui('My profile')} aria-current={isActive('/profile') ? 'page' : undefined} onClick={() => setMobileOpen(false)} className={`mb-1 flex w-full items-center gap-3 rounded-lg px-2 py-2 text-sm text-slate-600 hover:bg-sidebar-accent hover:text-[#245719] ${collapsed ? 'justify-center' : ''}`}><Settings size={18}/>{!collapsed && <span>{ui('My profile')}</span>}</Link>
        <button
          onClick={() => logout()}
          className={`flex w-full items-center gap-3 rounded-lg px-2 py-2 text-sm text-slate-600 hover:bg-sidebar-accent hover:text-[#245719] ${collapsed ? "justify-center" : ""}`}
        >
          <LogOut size={18} />
          {!collapsed && <span>{ui("Sign Out")}</span>}
        </button>
      </div>
    </div>
  );

  return (
    <>
      <button aria-label={ui("Open navigation")} onClick={() => setMobileOpen(true)} className="fixed left-3 top-3 z-50 rounded-lg bg-[#347623] p-2 text-white shadow-lg lg:hidden">
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
