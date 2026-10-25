import HelpNotice from '@/components/shared/HelpNotice';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState } from 'react';
import { useNavigate } from '@/lib/router';
import { formatDate } from '@/lib/formatters';
import StatusBadge from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';

const openStatuses = ['approved', 'loaded', 'in_transit', 'returned'];

export default function DeliveriesBoard({ dispatches = [] }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const navigate = useNavigate();
  const [view, setView] = useState('active');
  const active = dispatches.filter(run => openStatuses.includes(run.status));
  const rows = view === 'active' ? active : dispatches.filter(run => !openStatuses.includes(run.status));
  const counts = {
    loading: active.filter(run => ['approved', 'loaded'].includes(run.status)).length,
    road: active.filter(run => run.status === 'in_transit').length,
    returns: active.filter(run => run.status === 'returned').length,
  };

  return <div className="space-y-5">
    <div className="rounded-xl border bg-white p-5">
      <h2 className="text-lg font-semibold text-slate-900">{ui("Delivery runs")}</h2>
      <HelpNotice title={ui("Delivery tracking")}><p>{ui("Follow the driver and Commercial pair from loading through customer stops, return and reconciliation. Open a run to see its driver reports and stock detail.")}</p></HelpNotice>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {[[ui("Awaiting departure"), counts.loading], [ui("On the road"), counts.road], [ui("Back for reconciliation"), counts.returns]].map(([label, count]) => <div key={label} className="rounded-xl bg-slate-50 p-4"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-2xl font-bold tabular-nums">{count}</p></div>)}
      </div>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="font-semibold text-slate-900">{view === 'active' ? ui("Active deliveries") : ui("Past and draft runs")}</h3>
      <div className="flex gap-2"><Button size="sm" variant={view === 'active' ? 'default' : 'outline'} onClick={() => setView('active')}>{ui("Active (")}{active.length})</Button><Button size="sm" variant={view === 'history' ? 'default' : 'outline'} onClick={() => setView('history')}>{ui("Other runs")}</Button></div>
    </div>
    {!rows.length ? <p className="rounded-xl border border-dashed bg-white p-6 text-sm text-slate-500">{ui("No delivery runs in this view.")}</p> : <div className="grid gap-3 lg:grid-cols-2">{rows.map(run => <button key={run.id} type="button" onClick={() => navigate('/distribution/dispatches/' + encodeURIComponent(run.id))} className="rounded-xl border bg-white p-5 text-left transition hover:border-blue-400 hover:shadow-sm">
      <div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-slate-900">{run.route_name || run.dispatch_number || ui("Delivery run")}</p><p className="mt-1 text-xs text-slate-500">{run.dispatch_number} · {formatDate(run.dispatch_date)}</p></div><StatusBadge status={run.status} /></div>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-xs text-slate-500">{ui("Driver")}</dt><dd className="font-medium">{run.driver_name || ui("Not assigned")}</dd></div><div><dt className="text-xs text-slate-500">{ui("Commercial agent")}</dt><dd className="font-medium">{run.salesperson_name || ui("Not assigned")}</dd></div><div className="col-span-2"><dt className="text-xs text-slate-500">{ui("Vehicle")}</dt><dd className="font-medium">{run.vehicle_name || ui("Not assigned")}</dd></div></dl>
      <span className="mt-4 block border-t pt-3 text-xs font-semibold text-blue-700">{ui("Open delivery and reports →")}</span>
    </button>)}</div>}
  </div>;
}
