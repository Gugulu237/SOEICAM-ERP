import React from 'react';
import { ui } from '@/lib/i18n';
import { useLocaleRender } from '@/lib/localization';
import { productionReadyForIssue } from '@/lib/production-handoff';
import { formatDate, formatNumber } from '@/lib/formatters';
import { WorkspacePanel, WorkspaceButton } from '@/components/home/WorkspaceParts';

export default function MaterialIssueQueue({ orders=[], ready, preview=false }) {
  useLocaleRender();
  const pending=orders.filter(productionReadyForIssue).sort((a,b)=>String(a.approved_at).localeCompare(String(b.approved_at)));
  return <WorkspacePanel title={ui('Approved production — issue materials')} subtitle={ui('General Manager approval authorizes Warehouse Management to check and issue the materials. Production Managers cannot approve or issue their own requests.')}>
    {!ready?<p role="status" className="text-sm text-slate-500">{ui('Loading approved production orders...')}</p>:<>
      <p role="status" className="mb-3 text-sm font-medium">{ui('{0} orders awaiting warehouse issue',pending.length)}</p>
      {!pending.length&&<p className="text-sm text-slate-500">{ui('No GM-approved production orders are waiting for material issue.')}</p>}
      <div className="max-h-96 space-y-3 overflow-y-auto">{pending.map(order=><div key={order.id} className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-semibold">{order.order_number} · {order.product_name}</h3><p className="mt-1 text-xs text-slate-600">{ui('Planned Output')}: {formatNumber(order.planned_output)} · {ui('Production Date')}: {formatDate(order.production_date)}</p><p className="mt-1 text-xs text-slate-600">{ui('Requested by')}: {order.production_requested_by_name || ui('Not recorded')}</p><p className="mt-1 text-xs text-emerald-800">{ui('Approved by General Manager')} · {formatDate(order.approved_at)}</p></div><WorkspaceButton path={'/manufacturing/'+encodeURIComponent(order.id)} preview={preview} variant="outline">{ui('Check & issue materials')}</WorkspaceButton></div></div>)}</div>
    </>}
  </WorkspacePanel>;
}
