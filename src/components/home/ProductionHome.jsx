
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState } from 'react';
import { Factory, FlaskConical, ClipboardCheck, Plus, Receipt, Package, Truck, BookOpen, Wallet } from 'lucide-react';
import { useNavigate } from '@/lib/router';
import { Button } from '@/components/ui/button';
import ProductThumb from '@/components/shared/ProductThumb';
import { productionSnapshot } from '@/lib/staff-dashboard';
import { useWorkspaceAccess } from './WorkspaceAccess';
import { WorkspaceHero, WorkspaceButton, WorkspaceMetrics, WorkspaceActions, WorkspacePanel, WorkspaceQueue, ProductRange } from './WorkspaceParts';

export default function ProductionHome({ data, loading, preview, roleLabel }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const { can } = useWorkspaceAccess();
  const [tab, setTab] = useState('active');
  const source = data || {}, summary = productionSnapshot(source), ready = !!data && !loading;
  const navigate = useNavigate();
  const orders = tab === 'qc' ? summary.awaitingQC : tab === 'today' ? summary.plannedToday : source.orders || [];
  return <div className="space-y-6">
    <WorkspaceHero eyebrow={roleLabel || 'Operations / Production Manager workspace'} title={ui("Keep daily operations moving")} description={ui("Oversee inventory, manufacturing, quality, expiry and deliveries. Review company sales and Commercial performance. Coordinate the teams responsible for these operations.")} icon={Factory} color="violet">
      <WorkspaceButton path="/inventory?section=items&filter=materials&area=all&panel=stock" preview={preview} variant="outline">{ui("View warehouse materials")}</WorkspaceButton>
      <WorkspaceButton path="/manufacturing/new" preview={preview}><Plus size={17} className="mr-2" />{ui("Plan production")}</WorkspaceButton><WorkspaceButton path="/manufacturing?section=quality" preview={preview} variant="outline">{ui("Open quality control")}</WorkspaceButton>
    </WorkspaceHero>
    <WorkspaceMetrics ready={ready} metrics={[
      can('manufacturing') && { label: 'Batches planned today', value: summary.plannedToday.length, note: 'Scheduled production orders' },
      can('manufacturing') && { label: 'Batches in progress', value: summary.running.length, note: 'Materials issued or production running' },
      can('manufacturing') && { label: 'Awaiting quality control', value: summary.awaitingQC.length, note: 'Inspect before releasing finished goods' },
      (can('inventory') || can('quality')) && { label: 'Lots on quality hold', value: summary.held.length, note: 'Quarantined or rejected stock with quantity' },
    ].filter(Boolean)} />
    <WorkspaceActions preview={preview} actions={[
      {title:ui('Accounting'),detail:ui('Review accounts and financial reports'),path:'/accounting',icon:BookOpen,color:'bg-sky-50 text-sky-700'},
      {title:ui('Expenses'),detail:ui('Request operating and business expenses'),path:'/expenses',icon:Wallet,color:'bg-sky-50 text-sky-700'},
      { title: 'Company sales', detail: 'View posted invoices and Commercial supplies', path: '/sales', icon: Receipt, color: 'bg-green-50 text-green-700' },
      { title: 'Warehouse', detail: 'Manage items, assemblies and stock', path: '/inventory', icon: Package, color: 'bg-sky-50 text-sky-700' },
      { title: 'Deliveries', detail: 'Manage teams, fleet, dispatches and returns', path: '/distribution?tab=deliveries', icon: Truck, color: 'bg-blue-50 text-blue-700' },
      { title: 'Production board', detail: 'Plan, record output and follow batches', path: '/manufacturing', icon: Factory, color: 'bg-blue-50 text-blue-700' },
      { title: 'Quality control', detail: 'Release batches, inspect quality, review expiry and trace supplies', path: '/manufacturing?section=quality', icon: FlaskConical, color: 'bg-emerald-50 text-emerald-700' },
      { title: 'Review requests', detail: 'Recipes and expense approvals', path: '/approvals', icon: ClipboardCheck, color: 'bg-blue-50 text-blue-700' },
    ]} />
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_310px]">
      {can('manufacturing') && <WorkspacePanel title={ui("Your production board")} subtitle={ui("Open a batch for materials, output and quality details.")}>
        <div className="mb-4 flex flex-wrap gap-2">{[['active', ui("Current batches")], ['today', 'Today'], ['qc', ui("Awaiting QC")]].map(([value, label]) => <Button key={value} variant={tab === value ? 'default' : 'outline'} size="sm" onClick={() => setTab(value)}>{label}</Button>)}</div>
        <div className="space-y-3">{!orders.length && <p className="py-5 text-sm text-slate-500">{ready ? ui("No batches in this view.") : ui("Production orders will appear when data loads.")}</p>}{[...orders].sort((a, b) => (a.production_date || '').localeCompare(b.production_date || '')).map(order => {
          const product = source.products?.find(p => p.id === order.product_id);
          return <button key={order.id} disabled={preview} onClick={() => { if (!preview) navigate('/manufacturing/' + order.id); }} className="flex w-full items-start gap-3 rounded-xl border p-4 text-left hover:border-sky-300 disabled:cursor-default"><ProductThumb product={product} name={order.product_name} size={66} /><div className="min-w-0 flex-1"><div className="flex flex-wrap justify-between gap-2"><h3 className="text-sm font-semibold">{order.product_name}</h3><span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] font-medium text-blue-800">{order.status.replaceAll('_', ' ')}</span></div><p className="mt-1 text-xs text-slate-500">{order.order_number} · {order.batch_number || ui("Batch not assigned")} · {order.production_date}</p><div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs"><span>{ui("Planned ")}<strong>{order.planned_output ?? '—'} {product?.storage_unit || ui("units")}</strong></span><span>{ui("Recorded output ")}<strong>{order.actual_output ?? '—'}</strong></span>{Number(order.rejected_output) > 0 && <span className="text-red-700">{ui("Rejected ")}{order.rejected_output}</span>}</div></div></button>;
        })}</div>
      </WorkspacePanel>}
      <aside className="space-y-5"><WorkspacePanel title={ui("Needs your attention")}><WorkspaceQueue preview={preview} empty="No checks to display." rows={[
        { id: 'warehouse-issue', title: ui('Approved — awaiting warehouse issue'), value: ready ? (source.orders || []).filter(order=>order.status==='approved').length : '-', path: '/manufacturing' },
        { id: 'gm', title: 'Pending production submissions', value: ready ? summary.awaitingGM.length : '-', path: '/manufacturing' },
        { id: 'expiring', title: 'Lots expiring in 7 days', value: ready ? summary.expiring.length : '—', path: '/manufacturing?section=quality&quality=expiry' },
        { id: 'expired', title: 'Expired lots still in stock', value: ready ? summary.expired.length : '—', path: '/manufacturing?section=quality&quality=expiry' },
        ...(source.productionApprovals || []).map(q => ({ id: q.key, title: q.title, value: q.count, path: q.path })),
        { id: 'cheques', title: 'Your cheque signature', value: ready ? (source.cheques || []).length : '—', path: '/cashier' },
      ]} /></WorkspacePanel><div className="rounded-2xl border border-blue-100 bg-blue-50 p-5"><h2 className="font-semibold text-blue-950">{ui("Release with confidence")}</h2><p className="mt-2 text-sm leading-6 text-blue-900">{ui("Production Managers submit directly to Warehouse. Review quality results before releasing a batch to saleable stock.")}</p><WorkspaceButton path="/quality?section=traceability" preview={preview} variant="outline">{ui("Trace a batch")}</WorkspaceButton></div></aside>
    </div>
    <ProductRange products={source.products} />
  </div>;
}
