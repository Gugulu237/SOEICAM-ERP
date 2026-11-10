import React from 'react';
import {ui} from '@/lib/i18n';
import {formatXAF,formatDate,statusLabel} from '@/lib/formatters';
import {supplierTimelineEntries} from './supplier-timeline';

export default function SupplierTimeline({bills,payments,orders,renderBillActions,renderPaymentActions}) {
  const entries=supplierTimelineEntries({bills,payments,orders});
  return <section aria-label={ui('Bills, advances & payments')}>
    <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-primary">{ui('Bills, advances & payments')}</h3>
    <div className="divide-y rounded-xl border bg-white">
      {!entries.length?<p className="p-4 text-sm text-muted-foreground">{ui('No supplier bills or payments recorded.')}</p>:entries.map(entry=>{
        const {record,kind}=entry,bill=kind==='bill';
        const amount=bill?(entry.outstanding?record.balance:record.total):record.amount;
        const label=kind==='advance'?ui('Advance paid'):bill?ui('Bill'):ui('Payment');
        const settled=bill&&record.status==='paid';
        const state=record.historical_settlement_id?ui(record.historical_settlement_policy==='paid-setup-reclassification-v1'?'Archived setup bill':'Paid before migration'):entry.outstanding?ui(Number(record.amount_paid)>0?'Partly paid':'Unpaid'):statusLabel(record.status);
        const actions=bill?renderBillActions?.(record):renderPaymentActions?.(record);
        return <article key={entry.id} data-supplier-activity={entry.id} className="p-3">
          <div className="flex min-h-10 items-center gap-3">
            <div className="min-w-0 flex-1"><h4 className="break-words text-sm font-semibold">{entry.reference||label}<span className="font-normal text-muted-foreground"> · {label}</span></h4><p className="mt-1 break-words text-xs text-muted-foreground">{formatDate(entry.date)}{entry.relatedReference?' · '+entry.relatedReference:''}{bill&&record.due_date&&!settled?' · '+ui('Due')+' '+formatDate(record.due_date):''}</p></div>
            <div className="shrink-0 text-right"><strong className="text-sm tabular-nums">{formatXAF(amount)}</strong><p className={'mt-0.5 text-[11px] font-semibold '+(kind==='advance'?'text-primary':entry.outstanding?'text-slate-700':'text-muted-foreground')}>{state}</p></div>
          </div>
          {record.reference&&<p className="mt-1 break-words text-xs text-muted-foreground">{record.reference}</p>}
          {actions&&<div className="mt-2 empty:hidden [&>div:empty]:hidden">{actions}</div>}
        </article>;
      })}
    </div>
  </section>;
}
