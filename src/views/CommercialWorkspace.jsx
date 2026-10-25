
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from '@/lib/router';
import { RefreshCw } from 'lucide-react';
import { erp } from '@/api/erpClient';
import { Button } from '@/components/ui/button';
import CommercialDashboard from '@/components/home/CommercialDashboard';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { readAll } from '@/lib/field-pos';
import { invokeFieldOps, errorMessage } from '@/lib/field-ops';
import { commercialWorkspaceSubject, commercialWorkspaceSection, validateCommercialWorkspace } from '@/lib/commercial-workspace';
import dynamic from 'next/dynamic';
import MobileInfo from '@/components/shared/MobileInfo';

const CommercialPerformance = dynamic(() => import('@/views/CommercialPerformance'), { loading: () => <p role="status" className="p-6 text-sm text-slate-500">{ui("Loading performance...")}</p> });

export default function CommercialWorkspace() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const { role, roleLabel, employee, user, loading: authLoading, error: authError } = useCurrentUser();
  const [params, setParams] = useSearchParams();
  const managing = role === 'admin';
  const section = commercialWorkspaceSection(role,params);
  const reviewing = managing && section==='review';
  const reportSection = managing && (section==='performance'||reviewing);
  const employeeId = commercialWorkspaceSubject(role, employee, params.get('employee') || '');
  const [roster, setRoster] = useState([]), [rosterLoading, setRosterLoading] = useState(true), [rosterError, setRosterError] = useState('');
  const [result, setResult] = useState(null), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [entryActive, setEntryActive] = useState(false);
  const [rosterReload, setRosterReload] = useState(0);
  const pendingWorkspace = useRef(null);
  const scope = [user?.id, role, employeeId].join(':');
  const data = result?.scope === scope ? result.data : null;
  const refresh = () => { setReload(value => value + 1); if (managing) setRosterReload(value => value + 1); };

  useEffect(() => {
    if (authLoading || authError || !managing) return;
    let active = true;
    setRosterLoading(true); setRosterError('');
    readAll(erp.entities.Employee, { role: 'commercial' }, 'full_name')
      .then(rows => { if (active) setRoster(rows); })
      .catch(e => { if (active) { setRoster([]); setRosterError(errorMessage(e)); } })
      .finally(() => { if (active) setRosterLoading(false); });
    return () => { active = false; };
  }, [authLoading, authError, managing, user?.id, rosterReload]);

  useEffect(() => {
    if (!managing || employeeId || rosterLoading || rosterError) return;
    const active = roster.filter(row => !row.status || row.status === 'active');
    const own = active.find(row => row.id === employee?.id);
    if (own || active.length === 1) setParams(current => { current.set('employee', (own || active[0]).id); return current; }, { replace: true });
  }, [managing, employeeId, roster, rosterLoading, rosterError, employee?.id, setParams]);

  useEffect(() => {
    if (role === 'production_manager' && section !== 'performance') setParams(current => { current.set('section', 'performance'); current.delete('new'); current.delete('customer'); return current; }, { replace: true });
  }, [role, section, setParams]);

  useEffect(() => {
    if (authLoading || authError || !employeeId || reportSection) { setLoading(false); return; }
    let active = true;
    const request = {};
    pendingWorkspace.current = request;
    setLoading(true); setError('');
    invokeFieldOps({ action: 'employeeDashboard', mode: 'commercial', employeeId })
      .then(res => {
        if (res.data.error) throw new Error(res.data.error);
        const value = validateCommercialWorkspace(res.data, employeeId);
        if (active) setResult({ scope, data: value, loadedAt: new Date() });
      })
      .catch(e => { if (active) setError(errorMessage(e)); })
      .finally(() => {
        if (pendingWorkspace.current === request) pendingWorkspace.current = null;
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [authLoading, authError, employeeId, section, reportSection, scope, reload]);

  useEffect(() => {
    if (!employeeId || authLoading || authError || reportSection || entryActive) return;
    const onReturn = () => { if (document.visibilityState === 'visible' && !pendingWorkspace.current) setReload(value => value + 1); };
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    const timer = window.setInterval(onReturn, 30000);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', onReturn); document.removeEventListener('visibilitychange', onReturn); };
  }, [employeeId, authLoading, authError, section, reportSection, entryActive]);

  if (authLoading) return <p role="status" className="p-8 text-slate-500">{ui("Loading your Commercial workspace...")}</p>;
  if (role === 'production_manager' && !authError) return <div className="space-y-5 pb-6"><header className="rounded-2xl border border-emerald-200 bg-white p-5"><p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">{ui("Commercial Dashboard")}</p><h1 className="mt-2 text-2xl font-bold">{ui("Performance")}</h1><p className="mt-2 text-sm text-slate-600">{ui("Review agent supplies, customer acquisition and bonus progress across the field team.")}</p></header><CommercialPerformance embedded readOnly /></div>;
  if (authError || !['admin', 'commercial'].includes(role)) return <p role="alert" className="p-8 text-red-700">{authError || ui("A Commercial or General Manager account is required.")}</p>;
  const serviceMissing = /unknown action.*employeeDashboard|function.*(?:not found|not deployed)|status code 404/i.test(error);
  return <div className="space-y-5 pb-6">
    <section className="rounded-2xl border border-emerald-200 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative min-w-0 flex-1 pr-10 sm:pr-0">{!managing && <div className="sm:hidden"><p className="text-xs font-semibold uppercase tracking-wide text-primary">{ui(roleLabel || "Commercial agent")}</p><h1 className="mt-1 break-words text-2xl font-bold text-slate-900">{employee?.full_name || user?.full_name}</h1></div>}<h2 className={"font-semibold text-slate-900 " + (!managing ? "hidden sm:block" : "")}>{reviewing ? ui('Customer acquisition review') : managing ? ui("Commercial quick reports") : ui("Commercial Agent dashboard")}</h2><MobileInfo title={ui("Commercial workspace")} className="absolute right-0 top-0 sm:static" desktopClassName="mt-1 text-xs text-slate-500"><p>{reviewing ? ui('Verify reported customer acquisitions as General Manager. The review records your own account and does not create employee sales or operations.') : managing ? ui("Choose an agent to review their recorded activity. Employee operations are read-only.") : ui("Your stock, customers, sales and cash from SOEICAM.")}</p></MobileInfo></div>
        <div className="flex items-center gap-2"><span className={`rounded-full px-3 py-1 text-xs font-semibold ${data ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>{reportSection ? reviewing ? ui("Acquisition review") : ui("Reports") : data ? ui("Live records") : loading ? ui("Connecting...") : ui("Awaiting connection")}</span><Button variant="outline" size="sm" disabled={loading || (managing && rosterLoading)} onClick={refresh}><RefreshCw size={14} className={'mr-2 ' + (loading ? 'animate-spin' : '')} />{ui("Refresh")}</Button></div>
      </div>
      {managing && <div className="mt-4 flex flex-wrap items-end gap-3 border-t pt-4">
        <label className="min-w-0 flex-1 text-xs font-medium text-slate-600">{ui("Commercial agent")}<select aria-label={ui("Live Commercial agent")} className="mt-1 block h-11 w-full rounded-lg border bg-white px-3 text-sm text-slate-900" value={employeeId} disabled={rosterLoading} onChange={e => setParams(current => { if (e.target.value) current.set('employee', e.target.value); else current.delete('employee'); current.delete('new'); current.delete('customer'); return current; })}><option value="">{rosterLoading ? ui("Loading agents...") : ui("Choose a Commercial agent")}</option>{roster.map(row => <option key={row.id} value={row.id}>{row.full_name}{row.status && row.status !== 'active' ? ' (' + row.status + ')' : ''}</option>)}</select></label>
        <Button asChild variant="outline"><Link to="/employees">{ui("Manage staff accounts")}</Link></Button><Button asChild variant="ghost"><Link to="/team-workspaces?role=commercial">{ui("Employee dashboards")}</Link></Button>
      </div>}
      {data && <p className="mt-3 hidden text-xs text-slate-500 sm:block">{managing ? ui("Viewing {0} as General Manager. ", data.employee.full_name) : ''}{ui("Updated ")}{result.loadedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {data.date}{ui(" · Cameroon time")}</p>}
    </section>
    {managing && <nav aria-label={ui("Commercial Dashboard sections")} className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">{(managing ? [['performance', 'Performance'], ['workspace', 'Employee activity'], ['review','Acquisition review']] : [['workspace', 'Workspace'], ['pos', ui("Field POS")], ['performance', 'Performance']]).map(([value, label]) => <button key={value} type="button" aria-current={section === value ? 'page' : undefined} className={'rounded-lg px-4 py-2 text-sm font-semibold ' + (section === value ? 'bg-emerald-800 text-white' : 'bg-white text-slate-700 hover:bg-slate-100')} onClick={() => setParams(current => { if (value === 'workspace') current.delete('section'); else current.set('section', value); current.delete('new'); current.delete('customer'); return current; })}>{ui(label)}</button>)}</nav>}
    {rosterError && managing && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{ui("Could not load Commercial agents. ")}{rosterError}</p>}
    {!employeeId && !reportSection && !rosterLoading && managing && !rosterError && <div className="rounded-2xl border bg-white p-6"><h3 className="font-semibold">{roster.length ? ui("Choose the agent whose activity you want to review") : ui("Set up your first Commercial agent")}</h3><p className="mt-2 text-sm text-slate-600">{roster.length ? ui("Their actual stock, customers and sales will load here.") : ui("Create or edit an employee, choose Commercial, set the account to Active and link their login. Then pair them with a driver and load finished products onto their delivery run.")}</p>{!roster.length && <Button asChild className="mt-4"><Link to="/employees">{ui("Open Employees")}</Link></Button>}</div>}
    {!employeeId && !managing && <p role="alert" className="rounded-xl bg-slate-50 p-4 text-sm text-slate-900">{ui("Link this login to an active Commercial employee to open the live dashboard.")}</p>}
    {employeeId && !reportSection && error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><p className="font-semibold">{ui("Live records could not be loaded.")}</p><p className="mt-1">{serviceMissing ? ui("The Commercial workspace service needs activation on the linked SOEICAM backend. Your local dashboard is ready.") : error}</p><button onClick={refresh} className="mt-2 font-semibold underline">{ui("Retry connection")}</button></div>}
    {reportSection ? <CommercialPerformance key={section+':'+reload} embedded selectedAgentId={managing ? employeeId : ''} readOnly={managing && !reviewing} reviewMode={reviewing} /> : employeeId && <CommercialDashboard key={scope} section={section} activeTab={params.get('view') || 'sales'} onTabChange={value => setParams(current => { current.set('view', value); if (!managing) { current.delete('section'); current.delete('new'); current.delete('customer'); } return current; })} openFromLink={section === 'pos' && params.get('new') === '1'} initialCustomerId={params.get('customer') || ''} onClearEntry={() => setParams(current => { current.delete('new'); current.delete('customer'); return current; }, { replace: true })} data={data} actorEmployee={managing ? undefined : employee} loading={loading && !data} managing={managing} onRefresh={refresh} onEntryChange={setEntryActive} />}
  </div>;
}
