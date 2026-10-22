
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from '@/lib/router';
import { BriefcaseBusiness, CheckSquare, Users, Store, ArrowUpRight } from 'lucide-react';
import { APP_MODULES } from '@/lib/appModules';
import ManagementHierarchy from '@/components/employees/ManagementHierarchy';
import ManagementQuickReports from './ManagementQuickReports';
import { formatXAF } from '@/lib/formatters';
import { managerSnapshot, cashierSnapshot, productionSnapshot } from '@/lib/staff-dashboard';
import { WorkspaceHero, WorkspaceButton, WorkspaceMetrics, WorkspaceActions, WorkspacePanel, WorkspaceQueue, ProductRange } from './WorkspaceParts';

const Approvals = dynamic(() => import('@/views/Approvals'), { ssr: false });

export default function ManagerHome({ data, loading, preview, onRefresh }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [params, setParams] = useSearchParams();
  const section = ['approvals','quick-reports'].includes(params.get('section')) ? params.get('section') : 'overview';
  const selectSection = value => setParams(current => {
    if (value !== 'overview') current.set('section', value);
    else current.delete('section');
    return current;
  });
  const source = data || {}, summary = managerSnapshot(source), cash = cashierSnapshot(source), production = productionSnapshot(source), ready = !!data && !loading;
  const maximum = Math.max(1, ...summary.trend.map(day => day.value));
  const queues = (source.approvalQueues || []).filter(q => q.count > 0);
  return <div className="space-y-6">
    <nav aria-label={ui("General Manager dashboard sections")} className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
      {[['overview', 'Overview'], ['approvals', 'Approvals'], ['quick-reports', 'Quick reports']].map(([value, label]) => <button key={value} type="button" aria-current={section === value ? 'page' : undefined} onClick={() => selectSection(value)} className={'rounded-lg px-4 py-2 text-sm font-semibold ' + (section === value ? 'bg-primary text-primary-foreground' : 'bg-white text-slate-700 hover:bg-sky-50')}>{ui(label)}</button>)}
    </nav>
    {section === 'approvals' ? <Approvals embedded preview={preview} onDecision={onRefresh} /> : section === 'quick-reports' ? <ManagementQuickReports preview={preview}/> : <>
    <WorkspaceHero eyebrow="General Manager" title={ui("A clear view of SOEICAM")} description={ui("Full administration of every ERP dashboard and department. Review decisions, manage employee access and oversee cash, production and field teams.")} icon={BriefcaseBusiness} color="amber">
      <WorkspaceButton path="/?section=approvals" preview={preview}>{ui("Review approvals")}<ArrowUpRight size={17} className="ml-3" /></WorkspaceButton><WorkspaceButton path="/team-workspaces" preview={preview} variant="outline">{ui("Preview staff dashboards")}</WorkspaceButton>
    </WorkspaceHero>
    <ManagementHierarchy currentRole="admin" />
    <WorkspaceMetrics ready={ready} metrics={[
      { label: 'Invoiced sales today', value: formatXAF(summary.today), note: 'Posted sales including tax; drafts excluded' },
      { label: 'Invoiced sales this month', value: formatXAF(summary.month), note: 'Posted invoices including tax' },
      { label: 'Field supplies today', value: formatXAF(summary.fieldSalesToday), note: 'Posted Commercial supplies including tax' },
      { label: 'Field supplies this month', value: formatXAF(summary.fieldSalesMonth), note: 'Posted separately from invoice sales' },
      { label: 'Company treasury', value: formatXAF(cash.balance), note: 'Active cash, bank and mobile accounts' },
      { label: 'Outstanding invoice balances', value: formatXAF(summary.receivables), note: ready ? formatXAF(summary.overdueAmount) + ' overdue' : 'Open posted customer invoices' },
    ]} />
    <WorkspaceActions preview={preview} actions={[
      { title: 'Approval inbox', detail: 'Purchases, production and payments', path: '/?section=approvals', icon: CheckSquare, color: 'bg-sky-50 text-sky-800' },
      { title: 'Employee dashboard', detail: 'Staff, roles and workspace previews', path: '/team-workspaces?section=people', icon: Users, color: 'bg-blue-50 text-blue-700' },
      { title: 'Outlet reports', detail: 'Daily Hotesse sales, stock and assignments', path: '/outlet-reports', icon: Store, color: 'bg-cyan-50 text-cyan-700' },
    ]} />
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-5"><WorkspacePanel title={ui("Decisions waiting")} subtitle={ready ? summary.approvalCount + ' items in operational approval queues' : ui("Your decision queues will appear when data loads.")}><WorkspaceQueue preview={preview} empty={ready ? 'No pending items in these approval queues.' : 'Waiting for workspace data.'} rows={queues.map(q => ({ id: q.key, title: q.title, value: q.count, path: q.path }))} /></WorkspacePanel>
        <WorkspacePanel title={ui("Invoiced sales over 7 days")} subtitle={ui("Tax-inclusive posted invoices, by invoice date. This is sales value, not cash received.")}>
          {!ready ? <p className="py-8 text-sm text-slate-500">{ui("Waiting for sales data.")}</p> : <div className="flex h-48 items-end gap-2 pt-5 sm:gap-4">{summary.trend.map(day => <div key={day.date} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2"><span className="sr-only">{day.date}: {formatXAF(day.value)}</span><div title={day.date + ': ' + formatXAF(day.value)} className="w-full max-w-12 rounded-t-lg bg-[#0089CF]" style={{ height: day.value > 0 ? Math.max(3, day.value / maximum * 100) + '%' : '2px' }} /><span className="text-[10px] text-slate-500">{day.date.slice(5)}</span></div>)}</div>}
        </WorkspacePanel>
        <WorkspacePanel title={ui("Customers to follow up")}><WorkspaceQueue preview={preview} empty={ready ? 'No overdue posted invoices.' : 'Waiting for receivables.'} rows={[...(summary.overdue || [])].sort((a, b) => (b.balance || 0) - (a.balance || 0)).slice(0, 6).map(i => ({ id: i.id, title: i.customer_name || i.invoice_number, detail: i.invoice_number + ' · Due ' + i.due_date, value: formatXAF(i.balance), path: '/accounting/receivables' }))} /></WorkspacePanel>
      </div>
      <aside className="space-y-5"><WorkspacePanel title={ui("Operations today")}><WorkspaceQueue preview={preview} empty="No operations to display." rows={[
        { id: 'production', title: 'Batches in progress', value: ready ? production.running.length : '—', path: '/manufacturing' },
        { id: 'qc', title: 'Batches awaiting QC', value: ready ? production.awaitingQC.length : '—', path: '/manufacturing?section=quality' },
        { id: 'dispatch', title: 'Runs on the road', value: ready ? (source.dispatches || []).filter(d => d.status === 'in_transit').length : '-', path: '/distribution?tab=deliveries' },
        { id: 'handovers', title: 'Cash handovers to check', value: ready ? cash.handovers.length : '-', path: '/cashier?section=handovers' },
        { id: 'expiry', title: 'Expired / expiring lots', value: ready ? production.expired.length + production.expiring.length : '—', path: '/manufacturing?section=quality&quality=expiry' },
      ]} /></WorkspacePanel>
        <WorkspacePanel title={ui("Field team follow-up")}><WorkspaceQueue preview={preview} empty="No field checks to display." rows={[
          { id: 'customers', title: 'Customers to verify', value: ready ? source.pendingAcquisitions || 0 : '-', path: '/commercial?section=review' },
          { id: 'visits', title: 'Outlet reports to review', value: ready ? source.pendingOutletReports || 0 : '—', path: '/outlet-reports' },
        ]} /><WorkspaceButton path="/reports" preview={preview} variant="outline">{ui("Open company reports")}</WorkspaceButton></WorkspacePanel>
      </aside>
    </div>
    <section className="rounded-2xl border bg-white p-5"><details><summary className="cursor-pointer text-sm font-semibold text-slate-900">{ui("All ERP modules · Full administrator access")}</summary><p className="my-3 text-xs leading-5 text-slate-500">{ui("Open any department, manage staff roles and review each employee dashboard from one place.")}</p><WorkspaceActions preview={preview} actions={APP_MODULES.filter(module => module.key !== "approvals" && module.key !== "driver" && module.key !== "commercial_workspace").map(module => ({ title: module.label, detail: module.description, path: module.path, icon: module.icon, color: module.color }))} /></details></section>
    <ProductRange products={source.products} />
    </>}
  </div>;
}
