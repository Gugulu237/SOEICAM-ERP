import React,{useState} from 'react';
import GoogleCustomerMap from './GoogleCustomerMap';
import {ChevronRight,MapPin,Phone,Receipt} from 'lucide-react';
import {ui} from '@/lib/i18n';
import {formatAccountingXAF,formatXAF,formatDate} from '@/lib/formatters';
import {branchTotalDue,customerAccountBalance,headquartersDueForBranch} from '@/lib/customer-billing-summary';
import {hasCustomerLocation} from '@/lib/customer-location';
import CustomerMapLinks from './CustomerMapLinks';
import CustomerGpsButton from './CustomerGpsButton';
import StatusBadge from '@/components/shared/StatusBadge';

// Fiche client: the export's three figures, contact card, responsible person,
// branches and recent history, using only this customer's loaded ERP records.
export default function MobileCustomerOverview({partner,balanceLabel='Account balance due',balance=customerAccountBalance(partner),deliveryBalances,billingSummary,sales=[],monthlySales=null,subPartners=[],locationsByCustomer={},onSelect,onEditGps,onSale,loading=false,salesUnavailable=false,salesError='',onRetrySales}) {
  const [mapPoint,setMapPoint]=useState(null);
  const points=locationsByCustomer[partner.id]?.length?locationsByCustomer[partner.id]:[partner];
  const initials=(partner.acquired_by_name||partner.registered_by_name||'?').split(/\s+/).filter(Boolean).slice(0,2).map(word=>word[0]).join('').toUpperCase();
  return <div data-mobile-customer-profile className="space-y-5 sm:hidden">
    <div className="grid grid-cols-3 gap-2">{[[ui('Invoiced this month'),loading||monthlySales===null?'—':formatXAF(monthlySales)],[ui(balanceLabel),balance===null?'—':formatAccountingXAF(balance)],[ui('Branches'),subPartners.length]].map(([label,value])=><div key={label} className="min-w-0 rounded-xl border bg-white p-3"><p className="text-[11px] leading-4 text-muted-foreground">{label}</p><p className="mt-1 break-words text-sm font-bold tabular-nums">{value}</p></div>)}</div>
    {billingSummary}
    <section><h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-primary">{ui('Contact')} · {ui('Delivery location')}</h3><div className="divide-y rounded-xl border bg-white">
      <div className="flex min-h-12 items-center justify-between gap-3 px-3 py-2"><span className="text-xs text-muted-foreground">{ui('Phone')}</span>{partner.phone?<a href={'tel:'+partner.phone} className="flex min-h-11 items-center gap-2 text-sm font-semibold"><Phone size={15}/>{partner.phone}</a>:<span className="text-xs text-muted-foreground">{ui('Not recorded')}</span>}</div>
      <div className="flex min-h-12 items-center justify-between gap-3 px-3 py-2"><span className="text-xs text-muted-foreground">{ui('Address')}</span><span className="max-w-[70%] break-words text-right text-sm font-semibold">{[partner.address,partner.neighbourhood,partner.town].filter(Boolean).join(', ')||ui('Not recorded')}</span></div>
      {points.map(point=><div key={point.id} className="p-3"><div className="flex items-center gap-2"><MapPin size={16} className="text-primary"/><p className="text-sm font-semibold">{point.id!==partner.id?point.name:ui('GPS location')}</p></div>{hasCustomerLocation(point)&&<p className="mt-1 text-xs tabular-nums text-muted-foreground">{Number(point.gps_lat).toFixed(5)} · {Number(point.gps_lng).toFixed(5)}{Number(point.gps_accuracy_m)>0?' · '+Math.round(point.gps_accuracy_m)+' m':''}</p>}<div className="mt-1 flex flex-wrap items-center justify-between gap-2"><CustomerMapLinks customer={point}/>{onEditGps&&partner.is_active!==false&&point.is_active!==false&&<CustomerGpsButton point={point} onClick={()=>onEditGps(partner,point.id===partner.id?undefined:point)}/>}</div></div>)}
    </div></section>
    {(partner.acquired_by_name||partner.registered_by_name)&&<section><h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-primary">{ui(partner.acquired_by_name?'Acquired by':'Registered by')}</h3><div className="flex items-center gap-3 rounded-xl border bg-white p-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-bold text-primary">{initials}</span><div className="min-w-0"><p className="break-words text-sm font-semibold">{partner.acquired_by_name||partner.registered_by_name}</p>{partner.acquired_by_name&&<p className="mt-1 text-xs text-muted-foreground">{ui('Acquisition: ')}{ui((partner.acquisition_verified||'pending').replaceAll('_',' '))}</p>}{partner.acquired_by_name&&partner.registered_by_name&&<p className="mt-1 text-xs text-muted-foreground">{ui('Registered by ')}{partner.registered_by_name}</p>}</div></div></section>}
    {!!subPartners.length&&<section><h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-primary">{ui('Branches')}</h3><div className="divide-y rounded-xl border bg-white">{subPartners.map(branch=>{
      const point=(locationsByCustomer[branch.id]||[]).find(hasCustomerLocation)||branch;
      const branchBalance=deliveryBalances ? branchTotalDue(branch,headquartersDueForBranch(deliveryBalances.data,branch.id)) : customerAccountBalance(branch);
      return <div key={branch.id} className="flex min-h-14 items-center gap-2 px-3">
        <button type="button" onClick={()=>onSelect?.(branch)} className="flex min-h-14 min-w-0 flex-1 items-center gap-3 py-2 text-left">
          <span className="min-w-0 flex-1">
            <span className="block break-words text-sm font-semibold">{branch.business_name}</span>
            <span className="mt-1 block text-xs text-muted-foreground">{[branch.neighbourhood,branch.town].filter(Boolean).join(' · ')}</span>
            {(deliveryBalances||branchBalance!==null)&&<span className="mt-1 block text-xs text-muted-foreground">{ui(deliveryBalances?'Total due for this branch':'Account balance due')} · <strong className="tabular-nums text-foreground">{branchBalance===null?'—':formatAccountingXAF(branchBalance)}</strong></span>}
          </span>
          <ChevronRight size={18} className="shrink-0 text-primary"/>
        </button>
        {hasCustomerLocation(point)&&<button type="button" aria-label={ui('Locate {0}',branch.business_name)} onClick={()=>setMapPoint({...point,business_name:branch.business_name})} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border text-primary"><MapPin size={18}/></button>}
      </div>;
    })}</div></section>}
    <section><h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-primary">{ui('Recent invoices')}</h3><div className="divide-y rounded-xl border bg-white">{loading?<p role="status" className="p-4 text-sm text-muted-foreground">{ui('Loading...')}</p>:salesUnavailable?<p className="p-4 text-sm text-muted-foreground">{ui('Sales history is not available in this customer workspace.')}</p>:salesError?<p role="alert" className="p-4 text-sm text-red-700">{ui('Sales history could not load.')} {onRetrySales&&<button type="button" className="underline" onClick={onRetrySales}>{ui('Retry')}</button>}</p>:sales.length?sales.slice(0,6).map(order=><div key={order.id} className="flex min-h-14 items-start justify-between gap-3 p-3"><div className="min-w-0"><p className="break-words text-sm font-semibold">{order.invoice_number||ui('Invoice')}</p>{order.customer_id&&order.customer_id!==partner.id&&<p className="mt-1 break-words text-xs text-muted-foreground">{ui('Billed to {0}',order.customer_name)}</p>}<div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span>{formatDate(order.invoice_date)}</span><StatusBadge status={order.status}/></div></div><strong className="text-right text-xs tabular-nums">{formatXAF(order.total)}</strong></div>):<p className="p-4 text-sm text-muted-foreground">{ui('No posted invoices yet.')}</p>}</div></section>
    {mapPoint&&<GoogleCustomerMap customers={[mapPoint]} selectedId={mapPoint.id} initialExpanded onClose={()=>setMapPoint(null)}/>}
    {onSale&&partner.is_active!==false&&<div data-mobile-action-bar className="fixed inset-x-0 bottom-[calc(64px_+_env(safe-area-inset-bottom))] z-30 border-t bg-white p-3"><button type="button" onClick={onSale} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-3 text-sm font-semibold text-white"><Receipt size={18}/>{ui('Register sales')}</button></div>}
  </div>;
}
