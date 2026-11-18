import React from 'react';
import { Check } from 'lucide-react';
import { ui } from '@/lib/i18n';
import { formatQuantity, formatXAF } from '@/lib/formatters';
import { isPackagingItem } from '@/lib/inventory-packaging';

export function MobilePurchaseProgress({order,payments,advancePaid,receivedValue,unpaidBills}) {
  const ordered=['approved','partially_received','received','billed'].includes(order.status);
  const received=['received','billed'].includes(order.status);
  const paid=!!payments&&Number(order.total)>0&&payments.filter(payment=>payment.status==='posted').reduce((sum,payment)=>sum+Number(payment.amount||0),0)>=Number(order.total);
  const stages=[
    {key:'ordered',label:ui('Ordered'),complete:ordered,current:!ordered},
    {key:'received',label:ui(order.status==='partially_received'?'Partially received':'Received'),complete:received,current:ordered&&!received},
    {key:'paid',label:ui(paid?'Paid':unpaidBills.length?'Bill due':'Payment'),complete:paid,current:received&&!paid},
  ];
  return <section className="rounded-xl border bg-card p-4">
    <ol aria-label={ui('Purchase progress')} className="grid grid-cols-3 gap-2 text-center text-[11px]">
      {stages.map((stage,index)=><li key={stage.key} aria-current={stage.current?'step':undefined}>
        <span className={'mx-auto mb-1 flex h-9 w-9 items-center justify-center rounded-full border-2 text-xs font-bold '+(stage.complete?'border-primary bg-primary text-primary-foreground':stage.current?'border-primary bg-secondary text-primary':'border-transparent bg-muted text-muted-foreground')}>
          {stage.complete?<Check size={18} aria-hidden="true"/>:index+1}
        </span>
        <span className={stage.current||stage.complete?'font-semibold':'text-muted-foreground'}>{stage.label}</span>
      </li>)}
    </ol>
    <dl className="mt-4 grid grid-cols-2 gap-2">
      <div className="rounded-lg bg-secondary p-2"><dt className="text-[11px] text-muted-foreground">{ui('Advance paid')}</dt><dd className="mt-1 text-sm font-bold tabular-nums">{payments?formatXAF(advancePaid):'-'}</dd></div>
      <div className="rounded-lg bg-secondary p-2"><dt className="text-[11px] text-muted-foreground">{ui('Received value')}</dt><dd className="mt-1 text-sm font-bold tabular-nums">{formatXAF(receivedValue)}</dd></div>
    </dl>
  </section>;
}

export function MobilePurchaseItems({lines,products}) {
  return <section className="space-y-2" aria-label={ui('Order items')}>
    <div className="flex items-center justify-between gap-2"><h3 className="text-xs font-bold uppercase tracking-wider text-primary">{ui('Items')}</h3><span className="text-[11px] text-muted-foreground">{ui('Order total')}</span></div>
    <div className="divide-y rounded-xl border bg-card">{lines.map(line=>{
      const product=products.find(product=>product.id===line.product_id),packaging=isPackagingItem(product||{}),complete=Number(line.received_quantity||0)>=Number(line.quantity);
      const badge=complete?ui('Received'):packaging?ui('Packaging has no expiry date.'):product?.expiry_tracking?ui('Expiry date required'):null;
      return <article key={line.id} className="p-3">
        <div className="flex items-start justify-between gap-2"><div className="min-w-0"><h4 className="break-words text-sm font-semibold">{line.product_name}</h4><p className="mt-1 text-xs text-muted-foreground">{formatXAF(line.unit_price)} / {line.unit}</p></div>{badge&&<span className={'max-w-[45%] shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-semibold '+(complete?'border-transparent bg-secondary text-primary':product?.expiry_tracking&&!packaging?'border-amber-300 text-amber-700':'text-muted-foreground')}>{badge}</span>}</div>
        <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">{[[ui('Ordered'),formatQuantity(line.quantity)+' '+line.unit],[ui('Received'),formatQuantity(line.received_quantity||0)+' '+line.unit],[ui('Order total'),formatXAF(line.total)]].map(([label,value],index)=><div key={label}><dt className="text-muted-foreground">{label}</dt><dd className={'mt-1 break-words font-bold tabular-nums '+(index===1?'text-primary':'')}>{value}</dd></div>)}</dl>
      </article>;
    })}</div>
  </section>;
}
