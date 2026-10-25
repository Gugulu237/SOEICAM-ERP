import { roleHierarchyRank } from '@/lib/role-organigram';

/* localized-messages */
import { uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useSearchParams, useLocation } from '@/lib/router';
import { RefreshCw, ArrowLeft, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { invokeFieldOps, errorMessage } from '@/lib/field-ops';
import { catalogueFromStored } from '@/server/domain/role-catalogue';
import CommercialDashboard from '@/components/home/CommercialDashboard';
import DriverDashboard from '@/components/home/DriverDashboard';
import CashierHome from '@/components/home/CashierHome';
import ProductionHome from '@/components/home/ProductionHome';
import HotesseHome from '@/components/home/HotesseHome';
import ManagerHome from '@/components/home/ManagerHome';
import CommercialWorkspace from '@/views/CommercialWorkspace';
import Employees from '@/views/Employees';
import dynamic from 'next/dynamic';
const PayrollWorkspace=dynamic(()=>import('@/components/payroll/PayrollWorkspace'));
const EmployeeReportDirectory=dynamic(()=>import('@/components/employees/EmployeeReportDirectory'));
const CommercialPerformance=dynamic(()=>import('@/views/CommercialPerformance'));
import SupplyChainHome from '@/components/home/SupplyChainHome';
import OperationalStaffHome from '@/components/home/OperationalStaffHome';
import { WorkspaceAccess } from '@/components/home/WorkspaceAccess';
import { DashboardIdentity, MobileDashboardIdentity } from '@/components/home/DashboardIdentity';
import MobileInfo from '@/components/shared/MobileInfo';
import ReadOnlyWorkspaceNotice from '@/components/home/ReadOnlyWorkspaceNotice';

const dashboards = { commercial:CommercialDashboard, driver:DriverDashboard, cashier:CashierHome, production_manager:ProductionHome, supply_chain_manager:SupplyChainHome, hotesse:HotesseHome, admin:ManagerHome, warehouse_manager:OperationalStaffHome, procurement:OperationalStaffHome, employee:OperationalStaffHome };
const gm = { key:'admin',get label(){return ui("General Manager");},template_role:'admin' };
const defaultProfiles = catalogueFromStored(null).roles;

export default function EmployeeDashboard() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const { role, roleLabel, employee, user, assignedRole, loading, error, allowedModules } = useCurrentUser();
  const location = useLocation();
  const [params] = useSearchParams();
  const hub = location.pathname === '/team-workspaces';
  const reviewingWorkspace = !!params.get('role') && !['people','roles','payroll'].includes(params.get('section'));
  const [catalogue,setCatalogue] = useState(null), [catalogueError,setCatalogueError] = useState(''), [reload,setReload] = useState(0);
  useEffect(() => {
    if (role !== 'admin' || !hub || !reviewingWorkspace) return;
    let active = true;
    setCatalogueError('');
    fetch('/api/admin/roles',{cache:'no-store'}).then(async response => {
      if (!response.ok) throw Error(ui("Could not load the saved roles."));
      const result = await response.json();
      if (active) setCatalogue(result);
    }).catch(error => { if (active) setCatalogueError(error.message); });
    return () => { active = false; };
  },[role,hub,reviewingWorkspace,reload]);
  if (loading) return <p role="status" className="p-8 text-slate-500">{ui("Loading your workspace...")}</p>;
  if (error) return <p role="alert" className="p-8 text-red-700">{uiMessage(error)}</p>;
  if (hub) {
    if (!['admin','cashier'].includes(role)) return <Navigate to="/" replace />;
    const canPayroll=!allowedModules||allowedModules.includes('payroll');
    const sections=[...(role==='admin'?[['people','Employees'],['roles','Roles & organigram'],['reports','Reports & dashboards']]:[]),...(canPayroll?[['payroll','Payroll']]:[])];
    const requested = params.get('role');
    const section = role==='cashier'?'payroll':sections.some(([key])=>key===params.get('section'))?params.get('section'):requested?'workspace':'people';
    const profiles = { ...(catalogue?catalogue.roles:defaultProfiles),admin:gm };
    const options = Object.values(profiles).sort((a,b) => roleHierarchyRank(a) - roleHierarchyRank(b) || a.label.localeCompare(b.label));
    return <div className="min-w-0 space-y-5"><header className={requested ? "hidden sm:block" : ""}><h1 className="text-3xl font-bold tracking-tight">{ui("Employee dashboard")}</h1></header>
      <nav aria-label={ui("Employee dashboard sections")} className={(requested ? "hidden sm:flex " : "flex ") + "gap-2 overflow-x-auto border-b pb-3 sm:flex-wrap"}>{sections.map(([key,label])=><Link key={key} to={'/team-workspaces?section='+key} aria-current={section===key?'page':undefined} className={'shrink-0 rounded-lg px-4 py-2 text-sm font-semibold '+(section===key?'bg-[#347623] text-white':'bg-white text-slate-700 hover:bg-green-50')}>{ui(label)}</Link>)}</nav>
      {section==='payroll'?canPayroll?<PayrollWorkspace embedded/>:<Navigate to="/" replace/>:section === 'people' || section === 'roles' ? <Employees embedded section={section} initialRole={requested || ''} /> : section==='reports'&&!requested?<EmployeeReportDirectory/>:<>
        {catalogueError && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{catalogueError} <button className="underline" onClick={() => setReload(n => n+1)}>{ui("Retry")}</button></p>}
        {!catalogue && !catalogueError ? <p role="status" className="p-5 text-sm text-slate-500">{ui("Loading roles...")}</p> : profiles[requested] ? <LiveWorkspace profile={profiles[requested]} options={options} managing /> : <p role="alert">{ui("This role is no longer available. ")}<Link to="/team-workspaces" className="underline">{ui("Choose a role")}</Link></p>}
      </>}
    </div>;
  }
  if (role === 'commercial' && (!allowedModules || allowedModules.includes('commercial'))) return <CommercialWorkspace />;
  if (role === 'cashier' && (!allowedModules || allowedModules.includes('cashier'))) return <DashboardIdentity value={{roleName: roleLabel, employeeName: employee?.full_name || user?.full_name}}><CashierHome /></DashboardIdentity>;
  return <LiveWorkspace profile={{ key:role === 'admin' ? 'admin' : assignedRole || role,template_role:role }} />;
}

function LiveWorkspace({ profile, options = [], managing = false }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const { employee, roleLabel, allowedModules, user } = useCurrentUser();
  const [params,setParams] = useSearchParams();
  const mode = profile.key;
  const template = mode === 'supply_chain_manager' ? mode : profile.template_role;
  const Component = dashboards[template];
  const employeeId = managing ? params.get('employee') || '' : employee?.id || '';
  const needsEmployee = ['driver','hotesse','commercial'].includes(template);
  const scope = [user?.id,mode,employeeId,managing].join(':');
  const showPerformance=params.get('performance')==='1';
  const setShowPerformance=next=>setParams(old=>{const p=new URLSearchParams(old);if(typeof next==='function'?next(showPerformance):next)p.set('performance','1');else p.delete('performance');return p;});
  const [selectionOpen, setSelectionOpen] = useState(false);
  const [result,setResult] = useState(null), [loading,setLoading] = useState(true), [error,setError] = useState(''), [reload,setReload] = useState(0);
  const requestInFlight = useRef(null);
  const data = result?.scope === scope ? result.data : null;
  const readOnly = managing || data?.readOnly === true;
  const modules = managing ? profile.modules : allowedModules;
  const requiredModule = {cashier:'cashier',commercial:'commercial',driver:'distribution',hotesse:'outlets'}[template];
  // Staff operating permissions never prevent the GM from reviewing a
  // dashboard. Management previews still disable every submission control.
  const disabled = !managing && requiredModule && modules && !modules.includes(requiredModule);
  const independent = template === 'cashier' && !managing;
  useEffect(() => {
    if (!Component || disabled || independent) { setLoading(false); return; }
    let active = true;
    setLoading(true); setError('');
    const load = async (reuse = false) => {
      const previous = requestInFlight.current;
      const pending = previous?.scope === scope && previous.pending;
      if (pending && !reuse) return;
      const request = pending ? previous : { scope,pending:true,promise:Promise.resolve().then(() => invokeFieldOps({action:'employeeDashboard',mode,employeeId})) };
      requestInFlight.current = request;
      try {
        const response = await request.promise;
        if (response.data.error) throw Error(response.data.error);
        if (active) { setResult({scope,data:response.data,updatedAt:new Date()}); setError(''); }
      } catch (e) { if (active) setError(errorMessage(e)); }
      finally { request.pending = false; if (active) setLoading(false); }
    };
    load(true);
    const refresh = () => { if (document.visibilityState !== 'hidden') load(); };
    const timer = window.setInterval(refresh,30000);
    window.addEventListener('focus',refresh);
    document.addEventListener('visibilitychange',refresh);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus',refresh); document.removeEventListener('visibilitychange',refresh); };
  },[scope,mode,employeeId,Component,disabled,independent,reload]);
  const refresh = () => { if (!requestInFlight.current?.pending) setReload(n => n+1); };
  const title = profile.label || roleLabel || data?.roleLabel;
  return <WorkspaceAccess modules={modules}><DashboardIdentity value={{ roleName: title, employeeName: data?.employee?.full_name || (!managing ? employee?.full_name || user?.full_name : ''), centralHero: true }}><div className="space-y-3 pb-6 sm:space-y-5">
    <header className="relative rounded-2xl border bg-secondary/50 p-4 pr-14 sm:hidden"><MobileDashboardIdentity force /><div className="absolute right-2 top-2"><Button variant="ghost" size="icon" aria-label={ui("Refresh")} disabled={loading} onClick={refresh}><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></Button></div>{managing && <p className="mt-2 text-[11px] font-medium text-slate-500">{ui("Read-only management view")}</p>}<MobileInfo mobileOnly title={title || ui("Employee dashboard")} className="absolute bottom-1 right-2"><p>{template === 'commercial' ? ui('Recorded sales, customers, stock and cash settlement. This report does not create or change employee activity.') : ui('Live workspace')}</p>{managing && <p>{ui('Review this workspace in read-only mode. Employee operations must be submitted from their own account.')}</p>}{result?.updatedAt && <p>{ui("Updated ")}{result.updatedAt.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})} · {data?.date}</p>}</MobileInfo></header>
    {managing && <section className="rounded-2xl border bg-white p-2 sm:p-4"><button type="button" className="flex min-h-11 w-full items-center justify-between gap-2 px-2 text-sm font-medium sm:hidden" aria-expanded={selectionOpen} onClick={() => setSelectionOpen(open => !open)}>{ui("Change employee")}<ChevronDown size={16} className={selectionOpen ? "rotate-180" : ""} /></button><div className={(selectionOpen ? "flex " : "hidden sm:flex ") + "flex-wrap items-center gap-3"}>
      <Button asChild variant="ghost" size="icon"><Link to="/team-workspaces?section=reports" aria-label={ui("All employees")}><ArrowLeft size={18} /></Link></Button>
      <select aria-label={ui("Dashboard role")} className="h-11 min-w-0 flex-1 rounded-lg border bg-white px-3 text-sm font-semibold sm:flex-none" value={mode} onChange={e => setParams({section:'reports',role:e.target.value})}>{options.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}</select>
      {template !== 'admin' && !independent && <select aria-label={ui("Workspace employee")} className="h-11 min-w-0 w-full rounded-lg border bg-white px-3 text-sm sm:w-auto" value={employeeId} onChange={e => setParams({section:'reports',role:mode,...(e.target.value ? {employee:e.target.value} : {})})}><option value="">{needsEmployee ? ui("Choose an employee") : ui("Department overview")}</option>{(data?.choices || []).map(staff => <option key={staff.id} value={staff.id}>{staff.full_name}{staff.status !== 'active' ? ' ('+staff.status+')' : ''}</option>)}</select>}
      <span className="ml-auto hidden items-center sm:flex gap-2 text-xs font-medium text-green-700"><span className="h-2 w-2 rounded-full bg-green-600" />{ui("Live workspace")}</span>
    </div></section>}
    {disabled ? <p className="rounded-xl border bg-white p-5 text-sm text-slate-600">{ui("This workspace is disabled in the saved role permissions. The General Manager can adjust its access under Roles & organigram.")}</p> : <>
      {!independent && <div className="hidden items-center justify-between gap-2 text-xs text-slate-500 sm:flex"><span>{data?.date ? data.date + ' / Cameroon time' : ui("SOEICAM workspace")}{result?.scope === scope && result.updatedAt && ui(" / Updated {0}", result.updatedAt.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}))}</span><Button variant="ghost" size="sm" disabled={loading} onClick={refresh}><RefreshCw size={14} className={'mr-2 ' + (loading ? 'animate-spin' : '')} />{ui("Refresh")}</Button></div>}
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{ui("Could not refresh this workspace. ")}{uiMessage(error)} <button className="underline" onClick={refresh}>{ui("Retry")}</button></p>}
      {loading && !data && <p role="status" className="text-sm text-slate-500">{ui("Loading live records...")}</p>}
      {needsEmployee && !employeeId ? <p className="rounded-2xl border bg-white p-6 text-sm text-slate-600">{ui("Choose an employee to see their assigned work and reports.")}{data?.choices?.length === 0 && <>{ui(" No employees have this role yet. ")}<Link to="/team-workspaces?section=people" className="font-semibold text-green-800 underline">{ui("Add an employee")}</Link></>}</p> : <>
{managing && <div className="hidden sm:block"><ReadOnlyWorkspaceNotice employeeName={needsEmployee ? data?.employee?.full_name : undefined} sharedDepartment={!needsEmployee}/></div>}
        {managing&&template==='commercial'&&employeeId&&<section className="rounded-xl border bg-white p-4"><Button variant="outline" aria-expanded={showPerformance} onClick={()=>setShowPerformance(value=>!value)}>{ui('Performance report')}</Button>{showPerformance&&<CommercialPerformance embedded readOnly selectedAgentId={employeeId}/>}</section>}
        {Component && <Component key={scope} data={data} loading={!data && loading} mode={profile.template_role} roleLabel={title} showReadOnlyNotice={false} hideMobileHero managing={managing} preview={readOnly} onRefresh={refresh} />}
      </>}
    </>}
  </div></DashboardIdentity></WorkspaceAccess>;
}
