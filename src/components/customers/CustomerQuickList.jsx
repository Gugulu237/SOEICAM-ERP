'use client';
import React,{useState} from 'react';
import {usePhoneLayout} from '@/hooks/usePhoneLayout';
import {formatAccountingXAF,formatXAF} from '@/lib/formatters';
import {hasCustomerLocation} from '@/lib/customer-location';
import GoogleCustomerMap from './GoogleCustomerMap';
import {ChevronRight,ChevronDown,MapPin} from 'lucide-react';
import {ui} from '@/lib/i18n';
import {useLocaleRender} from '@/lib/localization';

// Names always open the profile. Only a branch toggle expands a customer row.
export default function CustomerQuickList({customers,onOpen,renderBranches,selection,onToggle,disabled=false,emptyMessage,initialExpandedId='',branchCounts={},mapPointFor,balanceFor}) {
  useLocaleRender();
  const phone=usePhoneLayout();
  const [expanded,setExpanded]=useState(initialExpandedId),[limit,setLimit]=useState(40),[mapCustomer,setMapCustomer]=useState(null);
  return <div className={phone?"min-w-0":"min-w-0 overflow-hidden rounded-xl border bg-white"}>
    <ul className={phone?"space-y-3":"divide-y divide-slate-100"}>{customers.slice(0,limit).map(customer=>{
      const hasBranches=branchCounts[customer.id]>0&&Boolean(renderBranches),open=hasBranches&&expanded===customer.id;
      const detailsId='customer-branches-'+customer.id;
      const mapPoint=mapPointFor?.(customer)||customer;
      const billingBalance=balanceFor?.(customer);
      const billingDetail=billingBalance&&<span className={phone?"mt-1 block text-xs text-muted-foreground":"min-w-0 text-right text-xs text-muted-foreground"}>{billingBalance.label} <strong className="inline-block tabular-nums text-foreground">{billingBalance.amount===null?'—':formatAccountingXAF(billingBalance.amount)}</strong></span>;
      return <li key={customer.id} className={phone?"min-w-0 overflow-hidden rounded-xl border bg-white":"min-w-0"}>
        <div className="flex min-w-0 items-center">
          {selection&&<input type="checkbox" className="ml-4 h-4 w-4 shrink-0" aria-label={ui('Select {0}',customer.business_name)} checked={selection.includes(customer.id)} disabled={disabled||(!selection.includes(customer.id)&&selection.length>=100)} onChange={event=>onToggle(customer.id,event.target.checked)}/>}
          <button type="button" aria-label={customer.business_name} disabled={disabled||!onOpen} className="flex min-h-14 min-w-0 flex-1 items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50 focus-visible:outline-emerald-600 disabled:opacity-60" onClick={()=>{if(!disabled)onOpen?.(customer);}}>
            {phone?<><span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-bold text-primary">{(customer.acquired_by_name||customer.business_name||'?').split(/\s+/).filter(Boolean).map(word=>word[0]).slice(0,2).join('').toUpperCase()}</span><span className="min-w-0 flex-1"><span className="block break-words text-sm font-semibold text-foreground">{customer.business_name}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{[customer.neighbourhood||customer.town,hasBranches?ui('{0} branches',branchCounts[customer.id]):customer.acquired_by_name].filter(Boolean).join(' · ')}</span>{billingDetail}</span></>:<span className="min-w-0 flex-1 break-words text-sm font-medium text-slate-900">{customer.business_name}{hasBranches&&<span className="ml-2 inline-block rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-normal text-emerald-800">{ui('{0} branches',branchCounts[customer.id])}</span>}</span>}
            {phone?(!billingBalance&&Number(customer.balance)>0&&<span className="shrink-0 text-xs font-bold tabular-nums">{formatXAF(customer.balance)}</span>):billingDetail}
            {!hasBranches&&<ChevronRight size={17} className="shrink-0 text-slate-400"/>}
          </button>
          {phone&&hasCustomerLocation(mapPoint)&&<button type="button" aria-label={ui('Locate {0}',customer.business_name)} disabled={disabled} onClick={()=>setMapCustomer({...mapPoint,business_name:customer.business_name})} className="flex min-h-12 w-11 shrink-0 items-center justify-center rounded-lg text-primary hover:bg-secondary"><MapPin size={18}/></button>}
          {hasBranches&&<button type="button" aria-label={ui('Branches for {0}',customer.business_name)} aria-expanded={open} aria-controls={detailsId} disabled={disabled} className="flex min-h-14 w-14 shrink-0 items-center justify-center border-l border-slate-100 text-emerald-700 hover:bg-emerald-50 focus-visible:outline-emerald-600" onClick={()=>{if(!disabled)setExpanded(open?'':customer.id);}}>{open?<ChevronDown size={18}/>:<ChevronRight size={18}/>}</button>}
        </div>
        {open&&<section id={detailsId} aria-label={ui('Branches for {0}',customer.business_name)} className="border-t border-slate-100 bg-slate-50/70 px-3 py-3">{renderBranches(customer)}</section>}
      </li>;
    })}</ul>
    {mapCustomer&&<GoogleCustomerMap customers={[mapCustomer]} selectedId={mapCustomer.id} initialExpanded onClose={()=>setMapCustomer(null)}/>}
    {!customers.length&&<p className="p-8 text-center text-sm text-slate-500">{emptyMessage||ui('No customers match these filters.')}</p>}
    {customers.length>limit&&<button type="button" className="min-h-12 w-full border-t text-sm font-medium text-emerald-800" onClick={()=>setLimit(value=>value+40)}>{ui('Show more customers')}</button>}
  </div>;
}

