
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Link, useLocation } from "@/lib/router";
import {
  LayoutDashboard, BookOpen, ShoppingCart, Users, Package, Factory,
  Receipt, UserCheck, Truck, Wallet, BarChart3,
  Settings, ChevronLeft, ChevronRight, LogOut, Menu, Banknote,
  ShoppingBag, Loader2
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
  { get label(){return ui("Commercial Dashboard");}, icon: ShoppingBag, path: "/commercial", roles: ["commercial"], personalCommercial: true, children: [
    { get label(){return ui("Record sale");}, path: "/commercial?section=pos&new=1", roles: ["commercial"] },
  ] },
  { get label(){return ui("Expenses");}, icon: Wallet, path: "/expenses", roles: ["admin", "cashier", "production_manager", "procurement", "warehouse_manager", "employee"] },
  { get label(){return ui("Accounting");}, icon: BookOpen, path: "/accounting", roles: ["admin","production_manager","warehouse_manager"] },
  { get label(){return ui("Purchases");}, icon: ShoppingCart, path: "/purchases", roles: PURCHASE_ROLES },
  { get label(){return ui("Inventory");}, icon: Package, path: INVENTORY_PATH, roles: INVENTORY_ROLES },
  { get label(){return ui("Manufacturing");}, icon: Factory, path: "/manufacturing", roles: QUALITY_ROLES },
  { get label(){return ui("Sales");}, icon: Receipt, path: "/sales", roles: ["admin", "employee", "hotesse", "production_manager","warehouse_manager"] },
  { get label(){return ui("Customers");}, icon: UserCheck, path: "/customers", roles: ["admin", "employee", "commercial"] },
  { get label(){return ui("Distribution");}, icon: Truck, path: "/distribution", roles: ["admin", "employee", "warehouse_manager", "production_manager", "driver"] },
  { get label(){return ui("Cashier");}, icon: Banknote, path: "/cashier", roles: ["admin", "cashier", "production_manager"] },
  { get label(){return ui('Sales reports');}, icon: BarChart3, path: '/sales-reports', roles: null, requiresGrant:'sales_reports' },
  { get label(){return ui("Reports");}, icon: BarChart3, path: "/reports", roles: ["admin"] },
  { get label(){return ui("Administration");}, icon: Settings, path: "/admin", roles: ["admin"] },
];

export default function AppSidebar() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [pendingHref,setPendingHref] = useState('');
  const location = useLocation();
  const { role, assignedRole, allowedModules } = useCurrentUser();
  const { logout } = useAuth();

  // Keep the drawer's Back entry until Next commits the selected route. Closing
  // it on click rewinds history while a slower page is still loading and cancels
  // that transition. Replacing the drawer entry leaves one Back step to this page.
  useEffect(()=>{setMobileOpen(false);setPendingHref('');},[location.pathname,location.search]);
  const onMenuLinkClick=event=>{
    if(!mobileOpen || event.defaultPrevented || event.button!==0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)return;
    const href=event.currentTarget.getAttribute('href');
    if(href===location.pathname+location.search+location.hash){setMobileOpen(false);setPendingHref('');}
    else setPendingHref(href);
  };

  const targetPath=path=>role==='hotesse'&&path==='/sales'?'/outlet-reports':role==='cashier'&&path==='/team-workspaces'?'/team-workspaces?section=payroll':workspacePath(path,allowedModules);
  const permits = path => permitsWorkspace(targetPath(path),allowedModules);
  const visibleItems = navItems.filter(item => (!item.personalCommercial || role === 'commercial') && (!item.requiresGrant || role==='admin' || allowedModules?.includes(item.requiresGrant)) && hasRoleAccess(role, item.roles) && (!item.assignedRole || item.assignedRole === assignedRole) && permits(item.path));

  const isActive = (path) => {
    if (path === "/") return location.pathname === "/";
    if (path.includes('?')) { const [pathname,query]=path.split('?'); const selected=new URLSearchParams(location.search); return location.pathname === pathname && [...new URLSearchParams(query)].every(([key,value])=>selected.get(key)===value); }
    if (path === INVENTORY_PATH) return isInventoryPath(location.pathname);
    if (path === '/commercial') return ['/commercial', '/commercial-performance', '/field-sales'].some(root => location.pathname === root || location.pathname.startsWith(root + '/'));
    if (path === '/manufacturing') return location.pathname.startsWith('/manufacturing') || isQualityPath(location.pathname);
    if (path === '/sales') return location.pathname.startsWith('/sales') || location.pathname === '/outlet-reports';
    if (path === '/reports') return location.pathname.startsWith('/reports') || location.pathname === '/cockpit';
    if (path === '/customers') return location.pathname.startsWith('/customers') || location.pathname === '/field-customers';
    if (path === '/purchases') return location.pathname.startsWith('/purchases') || location.pathname === '/suppliers';
    if (path === '/distribution') return location.pathname.startsWith('/distribution') || location.pathname === '/driver';
    if (path === '/cashier') return location.pathname.startsWith('/cashier') || location.pathname === '/cash-handovers';
    if (path === '/team-workspaces') return location.pathname.startsWith('/team-workspaces') || location.pathname.startsWith('/employees');
    return location.pathname.startsWith(path);
  };

  const sidebar = (mobile=false) => { const compact=collapsed&&!mobile; return (
    <div className={`flex h-full flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-all duration-200 ${mobile ? "w-full" : compact ? "w-16" : "w-60"}`}>
      <div className={`flex min-h-20 items-center gap-2 border-b border-sidebar-border bg-sidebar ${compact ? 'justify-center px-2 py-4' : 'justify-between px-3 py-3'}`}>
        {compact ? <Link to="/" replaceOverlay={mobile&&mobileOpen} onClick={onMenuLinkClick} aria-label={ui("SOEICAM home")} className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-50 text-lg font-extrabold text-[#245719]">S</Link> :
          <Link to="/" replaceOverlay={mobile&&mobileOpen} onClick={onMenuLinkClick} aria-label={ui("SOEICAM home")} className="block min-w-0 rounded-xl p-1.5"><img src="/brand/soeicam-logo.png" alt={ui("SOEICAM")} className="block h-auto w-[162px]" /></Link>}
        <button aria-label={compact ? ui("Expand navigation") : ui("Collapse navigation")} onClick={() => setCollapsed(!compact)} className="hidden rounded p-1 text-[#245719] hover:bg-sidebar-accent xl:block">
          {compact ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>
      {mobile&&pendingHref&&<p role="status" className="flex items-center gap-2 border-b px-4 py-2 text-sm text-green-800"><Loader2 size={16} className="animate-spin"/>{ui('Opening section...')}</p>}
      <nav className="flex-1 space-y-0.5 overflow-y-auto py-3">
        {visibleItems.map(item => (
          <React.Fragment key={item.path}>
          {
          <Link
            key={item.path}
            to={targetPath(item.path)}
            resume={item.path !== '/' && !item.path.includes('?')}
            replaceOverlay={mobile&&mobileOpen} onClick={onMenuLinkClick}
            aria-current={isActive(item.path) ? 'page' : undefined}
            className={`mx-2 flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
              isActive(item.path)
                ? "bg-[#347623] text-white shadow-sm"
                : "text-slate-700 hover:bg-sidebar-accent hover:text-[#245719]"
            } ${compact ? "justify-center px-2" : ""}`}
          >
            <item.icon size={18} className="shrink-0" />
            {!compact && <span>{item.label}</span>}
          </Link>
          }
          {(item.children || []).filter(child => child.path !== targetPath(item.path) && hasRoleAccess(role, child.roles) && permits(child.path)).map(child => <Link key={child.path} to={child.path} aria-current={isActive(child.path) ? 'page' : undefined} replaceOverlay={mobile&&mobileOpen} onClick={onMenuLinkClick} className={'mx-2 flex min-h-10 items-center rounded-lg py-2 text-sm font-medium ' + (compact ? 'justify-center px-2' : 'gap-2 pl-10 pr-3') + (isActive(child.path) ? ' bg-[#347623] text-white shadow-sm' : ' text-slate-600 hover:bg-sidebar-accent hover:text-[#245719]')}><Receipt size={15} />{!compact && child.label}</Link>)}
          </React.Fragment>
        ))}
      </nav>
      <div className="border-t border-sidebar-border p-3">
        <Link to="/profile" aria-label={ui('My profile')} title={ui('My profile')} aria-current={isActive('/profile') ? 'page' : undefined} replaceOverlay={mobile&&mobileOpen} onClick={onMenuLinkClick} className={`mb-1 flex w-full items-center gap-3 rounded-lg px-2 py-2 text-sm text-slate-600 hover:bg-sidebar-accent hover:text-[#245719] ${compact ? 'justify-center' : ''}`}><Settings size={18}/>{!compact && <span>{ui('My profile')}</span>}</Link>
        <button
          onClick={() => logout()}
          className={`flex w-full items-center gap-3 rounded-lg px-2 py-2 text-sm text-slate-600 hover:bg-sidebar-accent hover:text-[#245719] ${compact ? "justify-center" : ""}`}
        >
          <LogOut size={18} />
          {!compact && <span>{ui("Sign Out")}</span>}
        </button>
      </div>
    </div>
  ); };

  return (
    <>
      <button aria-label={ui("Open navigation")} aria-expanded={mobileOpen} aria-controls="mobile-navigation" onClick={() => setMobileOpen(true)} className="fixed left-2 top-2 z-40 flex h-10 w-10 items-center justify-center rounded-xl bg-[#347623] text-white shadow-sm xl:hidden"><Menu size={21}/></button>
      <Sheet open={mobileOpen} onOpenChange={open=>{setMobileOpen(open);if(!open)setPendingHref('');}}><SheetContent id="mobile-navigation" side="left" className="w-[min(20rem,88vw)] border-0 p-0 [&>button]:h-10 [&>button]:w-10"><SheetTitle className="sr-only">{ui('Navigation')}</SheetTitle><SheetDescription className="sr-only">{ui('Choose a workspace')}</SheetDescription>{sidebar(true)}</SheetContent></Sheet>
      <div className="sticky top-0 hidden h-dvh xl:block">{sidebar()}</div>
    </>
  );
}
