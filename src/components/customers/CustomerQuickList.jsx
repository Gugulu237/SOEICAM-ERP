'use client';
import React,{useState} from 'react';
import {ChevronRight,ChevronDown,X} from 'lucide-react';
import {ui} from '@/lib/i18n';
import {useLocaleRender} from '@/lib/localization';
import CustomerMapLinks from './CustomerMapLinks';
import CustomerGpsButton from './CustomerGpsButton';

// One open preview at a time. Opening a profile is always an explicit second action.
export default function CustomerQuickList({customers,onOpen,onEditGps,renderDetails,locationsByCustomer={},selection,onToggle,disabled=false,emptyMessage,initialExpandedId='',branchCounts={}}) {
  useLocaleRender();
  const [expanded,setExpanded]=useState(initialExpandedId),[limit,setLimit]=useState(40);
  return <div className="min-w-0 overflow-hidden rounded-xl border bg-white">
    <ul className="divide-y divide-slate-100">{customers.slice(0,limit).map(customer=>{
      const open=expanded===customer.id;
      const detailsId='customer-preview-'+customer.id;
      const locations=locationsByCustomer[customer.id]||[];
      return <li key={customer.id} className="min-w-0">
        <div className="flex min-w-0 items-center">
          {selection&&<input type="checkbox" className="ml-4 h-4 w-4 shrink-0" aria-label={ui('Select {0}',customer.business_name)} checked={selection.includes(customer.id)} disabled={disabled||(!selection.includes(customer.id)&&selection.length>=100)} onChange={event=>onToggle(customer.id,event.target.checked)}/>}
          <button type="button" aria-label={customer.business_name} aria-expanded={open} aria-controls={detailsId} className="flex min-h-14 min-w-0 flex-1 items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50 focus-visible:outline-emerald-600" onClick={()=>open&&onOpen?onOpen(customer):setExpanded(open?'':customer.id)}>
            <span className="min-w-0 break-words text-sm font-medium text-slate-900">{customer.business_name}{branchCounts[customer.id]>0&&<span className="ml-2 inline-block rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-normal text-emerald-800">{ui('{0} branches',branchCounts[customer.id])}</span>}</span>
            {open?<ChevronDown size={17} className="shrink-0 text-emerald-700"/>:<ChevronRight size={17} className="shrink-0 text-slate-400"/>}
          </button>
        </div>
        {open&&<section id={detailsId} aria-label={ui('Quick review: {0}',customer.business_name)} className="space-y-2 border-t border-slate-100 bg-slate-50/70 px-4 py-3 text-sm">
          <div className="flex items-start justify-between gap-2"><div className="min-w-0 space-y-1">
            {customer.contact_person&&<p className="break-words text-slate-700">{customer.contact_person}</p>}
            {customer.phone&&<a className="inline-flex min-h-10 items-center text-emerald-800" href={'tel:'+customer.phone}>{customer.phone}</a>}
            <p className="break-words text-xs text-slate-500">{[customer.address,customer.neighbourhood,customer.town].filter(Boolean).join(', ')||ui('Address not specified')}</p>
            {customer.zone_name&&<p className="text-xs text-slate-500">{customer.zone_name}</p>}
          </div><button type="button" aria-label={ui('Close quick review')} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md hover:bg-slate-100" onClick={()=>setExpanded('')}><X size={15}/></button></div>
          {locations.length?<div className="max-h-36 space-y-2 overflow-y-auto">{locations.map(location=><div key={location.id}><p className="text-xs font-medium">{location.name}</p><div className="flex flex-wrap items-center gap-2"><CustomerMapLinks customer={{...location,business_name:customer.business_name+' · '+location.name}} compact/>{onEditGps&&customer.is_active!==false&&location.is_active!==false&&<CustomerGpsButton point={location} disabled={disabled} onClick={()=>onEditGps(customer,location)}/>}</div></div>)}</div>:<div className="flex flex-wrap items-center gap-2"><CustomerMapLinks customer={customer} compact/>{onEditGps&&customer.is_active!==false&&<CustomerGpsButton point={customer} disabled={disabled} onClick={()=>onEditGps(customer)}/>}</div>}
          {renderDetails?.(customer)}
          {onOpen&&<button type="button" className="inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-emerald-800" onClick={()=>onOpen(customer)}>{ui('Open customer profile')}<ChevronRight size={14}/></button>}
        </section>}
      </li>;
    })}</ul>
    {!customers.length&&<p className="p-8 text-center text-sm text-slate-500">{emptyMessage||ui('No customers match these filters.')}</p>}
    {customers.length>limit&&<button type="button" className="min-h-12 w-full border-t text-sm font-medium text-emerald-800" onClick={()=>setLimit(value=>value+40)}>{ui('Show more customers')}</button>}
  </div>;
}

