import React from 'react';
import { ArrowLeft, PlusCircle, ClipboardList, Contact, FileText, HandCoins } from 'lucide-react';
import { ui, getLocale } from '@/lib/i18n';
import { formatXAF, formatDate } from '@/lib/formatters';
import StatusBadge from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';

const icons={orders:ClipboardList,suppliers:Contact,bills:FileText,payments:HandCoins};
const sum=(rows,key)=>rows.reduce((total,row)=>total+Number(row[key]||0),0);
const money=value=>new Intl.NumberFormat(getLocale(),{maximumFractionDigits:0}).format(Number(value||0));
// The third summary is posted order advances, not every supplier payment.
// This is a gross payment total; it does not claim an unapplied credit balance.
export const orderAdvances=payments=>payments.filter(payment=>payment.status==='posted'&&payment.po_id&&!payment.bill_id);
export default function MobilePurchaseOverview({data,loading,error,sections,onOpen,onRefresh,onBack}) {
  const bills=(data?.bills||[]).filter(bill=>!['draft','cancelled'].includes(bill.status)&&Number(bill.balance)>0);
  const unpaidOrders=new Set(bills.map(bill=>bill.po_id).filter(Boolean));
  const openOrders=(data?.orders||[]).filter(order=>!['cancelled','rejected'].includes(order.status)&&(!['received','billed'].includes(order.status)||unpaidOrders.has(order.id)));
  const advances=orderAdvances(data?.payments||[]),permissions=data?.permissions||{},date=data?.date;
  return <div data-sleek-screen="purchases" className="min-w-0 pb-2">
    <header className="mb-4 flex items-center gap-3"><button type="button" aria-label={ui('Back')} onClick={onBack} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border bg-white"><ArrowLeft size={20}/></button><div className="min-w-0 flex-1"><h1 className="text-xl font-bold leading-tight">{ui('Purchases')}</h1><p className="mt-0.5 text-xs text-muted-foreground">{date?new Intl.DateTimeFormat(getLocale(),{month:'long',year:'numeric'}).format(new Date(date+'T12:00:00Z')):'—'}</p></div></header>
    {error&&<p role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{ui(error)} <button onClick={onRefresh} className="underline">{ui('Try again')}</button></p>}
    <section aria-label={ui('Purchase overview')} className="grid grid-cols-3 gap-2 rounded-xl border bg-white p-4">
      {[[ui('Supplier payables'),permissions.finance?money(sum(bills,'balance')):'—'],[ui('Open orders'),String(openOrders.length)],[ui('Advances paid'),permissions.finance?money(sum(advances,'amount')):'—']].map(([label,value])=><div key={label} className="min-w-0"><p className="text-[11px] leading-4 text-muted-foreground">{label}</p><p className="mt-1 break-words text-base font-bold tabular-nums">{loading?'—':value}</p></div>)}
    </section>
    <section className="mt-5"><h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-primary">{ui('Modules')}</h2><nav aria-label={ui('Purchases sections')} className="grid grid-cols-2 gap-2 min-[360px]:grid-cols-4">{sections.filter(section=>section.key!=='receiving').map(section=>{const Icon=icons[section.key]||ClipboardList;return <button type="button" key={section.key} onClick={()=>onOpen({section:section.key})} className="flex min-h-[96px] min-w-0 flex-col items-center justify-center gap-2 rounded-xl border bg-white p-2 text-[11px] font-semibold"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-secondary text-primary"><Icon size={24} strokeWidth={1.7}/></span><span className="min-w-0 w-full break-words text-center text-[11px] leading-tight">{section.key==='orders'?ui('Orders'):section.label}</span></button>;})}</nav></section>
    <section className="mt-6"><div className="mb-2 flex items-center justify-between"><h2 className="text-xs font-bold uppercase tracking-wider text-primary">{ui('Open orders')}</h2>{openOrders.length>6&&<button onClick={()=>onOpen({section:'orders'})} className="min-h-11 text-xs font-semibold text-primary">{ui('View all')}</button>}</div>{loading?<p role="status" className="text-sm text-muted-foreground">{ui('Loading purchases...')}</p>:!openOrders.length?<p className="rounded-xl border p-4 text-sm text-muted-foreground">{ui('No open purchase orders.')}</p>:<div className="space-y-2">{openOrders.slice(0,6).map(order=><MobileOrderCard key={order.id} order={order} advance={sum(advances.filter(payment=>payment.po_id===order.id),'amount')} bill={bills.find(bill=>bill.po_id===order.id)} onOpen={()=>onOpen({section:'orders',order:order.id})}/>)}</div>}</section>
    {permissions.purchase&&<section data-mobile-action-bar className="mt-5"><Button className="min-h-14 w-full gap-2 rounded-xl font-semibold" onClick={()=>onOpen({section:'orders',compose:'order'})}><PlusCircle size={20}/>{ui('New purchase order')}</Button></section>}
  </div>;
}
export function MobileOrderCard({order,onOpen,actionLabel,advance=0,bill}) {
  const detail=order.notes?.trim()||[formatDate(order.order_date),order.expected_date?ui('Expected')+' '+formatDate(order.expected_date):''].filter(Boolean).join(' · ');
  return <article className="min-h-16 rounded-xl border bg-white p-3"><button type="button" onClick={onOpen} className="w-full text-left"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><h3 className="truncate text-sm font-semibold">{order.po_number} · {order.supplier_name}</h3><p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{detail}{advance>0?' · '+ui('Advance paid')+' '+formatXAF(advance):''}</p></div><div className="shrink-0">{bill?<span className="rounded-md border border-amber-300 px-2 py-0.5 text-[11px] font-semibold text-amber-700">{ui('Bill due')}</span>:<StatusBadge status={order.status}/>}</div></div><div className="mt-2 flex items-center justify-between gap-2 text-xs"><span className="text-muted-foreground">{ui('Order total')}</span><strong className="tabular-nums">{formatXAF(order.total)}</strong></div>{actionLabel&&<span className="mt-3 block border-t pt-3 text-xs font-semibold text-primary">{actionLabel}</span>}</button></article>;
}
