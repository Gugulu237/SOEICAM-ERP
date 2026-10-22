
/* localized-messages */
import { uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { invokeFieldOps, errorMessage } from '@/lib/field-ops';
import OutletReportCard from '@/components/outlets/OutletReportCard';
import OutletAssignments from '@/components/outlets/OutletAssignments';
import HotesseLiveWorkspace from '@/components/outlets/HotesseLiveWorkspace';
import OutletShelfOverview from '@/components/outlets/OutletShelfOverview';
import { Link } from '@/lib/router';

export default function OutletReports({ embedded = false }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const { role, loading: authLoading, error: authError } = useCurrentUser();
  const isAdmin = role === 'admin';
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Douala', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const [tab, setTab] = useState('shelves'), [from, setFrom] = useState(today.slice(0, 8) + '01'), [to, setTo] = useState(today);
  const [reportType, setReportType] = useState('all');
  const [period, setPeriod] = useState({ from: today.slice(0, 8) + '01', to: today });
  const [rows, setRows] = useState([]), [loading, setLoading] = useState(true), [error, setError] = useState(''), [reload, setReload] = useState(0);
  const [search, setSearch] = useState(''), [pending, setPending] = useState(false);
  useEffect(() => {
    if (authLoading || authError || role !== 'admin' || tab !== 'reports') return;
    let active = true; setLoading(true); setError(''); setRows([]);
    invokeFieldOps({ action: 'outletReports', ...period }).then(res => {
      if (res.data.error) throw new Error(res.data.error);
      if (active) setRows(res.data.reports);
    }).catch(e => { if (active) setError(errorMessage(e)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [authLoading, authError, role, tab, period, reload]);
  const review = async (id, notes) => {
    const res = await invokeFieldOps({ action: 'reviewOutletVisit', reportId: id, notes });
    if (res.data.error) throw new Error(res.data.error);
    setRows(values => values.map(row => row.id === id ? res.data.report : row));
  };
  if (authLoading) return <p role="status">{ui("Loading workspace...")}</p>;
  if (authError || !['admin', 'hotesse'].includes(role)) return <p role="alert">{authError || ui("This workspace is restricted to Hotesse staff and the General Manager.")}</p>;
  if (role === 'hotesse') return <HotesseLiveWorkspace />;
  const visible = rows.filter(r => (!pending || r.status !== 'reviewed') && (reportType === 'all' || r.report_type === reportType) && [r.employee_name, r.customer_name, r.location_name].join(' ').toLowerCase().includes(search.toLowerCase()));
  return <div className="space-y-5"><header>{!embedded && <Link to="/sales" className="text-xs font-medium text-slate-500 hover:text-slate-900">{ui("Sales /")}</Link>}<h1 className={'mt-2 font-bold ' + (embedded ? 'text-xl' : 'text-2xl')}>{ui("Outlet reports")}</h1><p className="mt-2 text-sm text-slate-500">{ui("Review Hotesse daily retail sales, closing stock and concerns at each point of sale.")}</p></header>
    {isAdmin && <div className="flex flex-wrap gap-2"><Button variant={tab === 'shelves' ? 'default' : 'outline'} onClick={() => setTab('shelves')}>{ui("Shelf overview")}</Button><Button variant={tab === 'reports' ? 'default' : 'outline'} onClick={() => setTab('reports')}>{ui("Reports")}</Button><Button variant={tab === 'assignments' ? 'default' : 'outline'} onClick={() => setTab('assignments')}>{ui("Outlet assignments")}</Button></div>}
    {tab === 'shelves' && isAdmin ? <OutletShelfOverview onAssign={() => setTab('assignments')} /> : tab === 'assignments' && isAdmin ? <OutletAssignments /> : <>
      <label className="block text-xs font-medium">{ui("Report type")}<select className="ml-3 h-10 rounded-lg border bg-white px-3" value={reportType} onChange={event => setReportType(event.target.value)}><option value="all">{ui("All reports")}</option><option value="daily_sales">{ui("Daily units sold & closing stock")}</option><option value="delivery_shelf_check">{ui("Shelf counts after delivery")}</option></select></label>
      <form className="flex flex-wrap items-end gap-3 rounded-xl border bg-white p-4" onSubmit={e => { e.preventDefault(); setPeriod({ from, to }); }}><label className="space-y-1 text-xs">{ui("From")}<Input type="date" value={from} required max={to} onChange={e => setFrom(e.target.value)} /></label><label className="space-y-1 text-xs">{ui("To")}<Input type="date" value={to} required min={from} max={today} onChange={e => setTo(e.target.value)} /></label><Button type="submit" disabled={loading}>{ui("Apply dates")}</Button><Button type="button" variant="outline" disabled={loading} onClick={() => setReload(value => value + 1)}>{ui("Refresh")}</Button></form>
      <div className="flex flex-wrap items-center justify-between gap-3"><Input value={search} onChange={e => setSearch(e.target.value)} placeholder={ui("Find customer, outlet or staff")} aria-label={ui("Search visit reports")} className="max-w-sm" /><label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={pending} onChange={e => setPending(e.target.checked)} />{ui("Awaiting review only")}</label></div>
      {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{ui("Reports could not be loaded. ")}{uiMessage(error)}</p>}
      {loading ? <p role="status" className="text-sm text-slate-500">{ui("Loading reports...")}</p> : !error && <><p className="text-xs text-slate-500">{visible.length}{ui(" reports in this view")}</p>{!visible.length && <p className="rounded-xl border bg-white p-6 text-sm text-slate-500">{ui("No reports match these dates and filters.")}</p>}<div className="space-y-3">{[...visible].sort((a, b) => (b.recorded_at || '').localeCompare(a.recorded_at || '')).map(report => <OutletReportCard key={report.id} report={report} onReview={isAdmin ? review : undefined} />)}</div></>}
    </>}
  </div>;
}
