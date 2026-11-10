import React from 'react';
import { PlusCircle, ShoppingCart, Users, ReceiptText, Wallet, ChevronRight } from 'lucide-react';
import { ui, getLocale } from '@/lib/i18n';
import { formatXAF, formatDate } from '@/lib/formatters';
import PageHeader from '@/components/shared/PageHeader';
import StatusBadge from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';

const icons={orders:ShoppingCart,suppliers:Users,bills:ReceiptText,payments:Wallet};
const sum=(rows,key)=>rows.reduce((total,row)=>total+Number(row[key]||0),0);
export default function MobilePurchaseOverview({data,loading,error,sections,onOpen,onRefresh}) {
  const openOrders=(data?.orders||[]).filter(order=>!['cancelled','received','billed','rejected'].includes(order.status));
  const bills=(data?.bills||[]).filter(bill=>!['draft','cancelled'].includes(bill.status)&&Number(bill.balance)>0);
  const permissions=data?.permissions||{};
  const date=data?.date;
  return <div data-sleek-screen="purchases" className="min-w-0 space-y-5">
    <PageHeader title={ui('Purchases')} subtitle={date?new Intl.DateTimeFormat(getLocale(),{month:'long',year:'numeric'}).format(new Date(date+'T12:00:00Z')):undefined}/>
    {error&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{ui(error)} <button onClick={onRefresh} className="underline">{ui('Try again')}</button></p>}
    <section aria-label={ui('Purchase overview')} className="grid grid-cols-3 gap-2 rounded-xl border bg-white p-3">
      {[[ui('Unpaid supplier bills'),permissions.finance?formatXAF(sum(bills,'balance')):'—'],[ui('Open orders'),String(openOrders.length)],[ui('Posted payments'),permissions.finance?formatXAF(sum((data?.payments||[]).filter(p=>p.status==='posted'),'amount')):'—']].map(([label,value])=><div key={label} className="min-w-0"><p className="text-[11px] leading-4 text-muted-foreground">{label}</p><p className="mt-1 break-words text-sm font-bold tabular-nums">{loading?'—':value}</p></div>)}
    </section>
    <section><h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-primary">{ui('Modules')}</h2><nav aria-label={ui('Purchases sections')} className="grid grid-cols-4 gap-2">{sections.filter(section=>section.key!=='receiving').map(section=>{const Icon=icons[section.key]||ShoppingCart;return <button type="button" key={section.key} onClick={()=>onOpen({section:section.key})} className="flex min-h-24 min-w-0 flex-col items-center justify-center gap-2 rounded-xl border bg-white px-1 py-3 text-[11px] font-semibold"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-primary"><Icon size={23}/></span><span className="break-words text-center">{section.label}</span></button>;})}</nav></section>
    <section><div className="mb-3 flex items-center justify-between"><h2 className="text-xs font-bold uppercase tracking-wider text-primary">{ui('Open orders')}</h2><button onClick={()=>onOpen({section:'orders'})} className="min-h-11 text-xs font-semibold text-primary">{ui('View all')}</button></div>{loading?<p role="status" className="text-sm text-muted-foreground">{ui('Loading purchases...')}</p>:!openOrders.length?<p className="rounded-xl border p-4 text-sm text-muted-foreground">{ui('No open purchase orders.')}</p>:<div className="space-y-2">{openOrders.slice(0,6).map(order=><MobileOrderCard key={order.id} order={order} onOpen={()=>onOpen({section:'orders',order:order.id})}/>)}</div>}</section>
    {permissions.purchase&&<Button className="min-h-12 w-full gap-2 rounded-xl" onClick={()=>onOpen({section:'orders',compose:'order'})}><PlusCircle size={20}/>{ui('New purchase order')}</Button>}
  </div>;
}
export function MobileOrderCard({order,onOpen,actionLabel}) {
  return <article className="rounded-xl border bg-white p-3"><button type="button" onClick={onOpen} className="w-full text-left"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><h3 className="break-words text-sm font-semibold">{order.po_number} · {order.supplier_name}</h3><p className="mt-1 text-xs text-muted-foreground">{formatDate(order.order_date)}{order.expected_date?' · '+ui('Expected')+' '+formatDate(order.expected_date):''}</p></div><ChevronRight size={17} className="mt-1 shrink-0 text-muted-foreground"/></div><div className="mt-3 flex items-center justify-between gap-2"><StatusBadge status={order.status}/><strong className="text-sm tabular-nums">{formatXAF(order.total)}</strong></div>{actionLabel&&<span className="mt-3 block border-t pt-3 text-xs font-semibold text-primary">{actionLabel}</span>}</button></article>;
}
