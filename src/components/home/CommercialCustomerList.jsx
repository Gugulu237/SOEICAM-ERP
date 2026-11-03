import React from 'react';
import {ui} from '@/lib/i18n';
import {useNavigate} from '@/lib/router';
import {ChevronRight,UserRound} from 'lucide-react';

export default function CommercialCustomerList({customers=[],canOpen=false}) {
  const navigate=useNavigate();
  if(!customers.length)return <p className="py-4 text-sm text-slate-500">{ui('No customer acquisition records for this employee.')}</p>;
  return <div className="divide-y rounded-2xl border bg-white px-4">{customers.map(customer=>{
    const Tag=canOpen?'button':'div';
    return <Tag key={customer.id} type={canOpen?'button':undefined} onClick={canOpen?()=>navigate('/customers?view=list&customer='+encodeURIComponent(customer.id)):undefined} className="flex min-h-16 w-full items-center gap-3 py-4 text-left">
      <UserRound size={20} className="shrink-0 text-primary" aria-hidden="true"/><span className="min-w-0 flex-1"><span className="block break-words text-sm font-semibold">{customer.business_name}</span><span className="mt-1 block text-xs text-slate-500">{customer.acquisition_date || ui('date not recorded')} · {customer.acquisition_verified==='verified_unique'?ui('Verified customer'):ui('Awaiting acquisition review')}</span></span>{canOpen&&<ChevronRight size={18} aria-hidden="true"/>}
    </Tag>;
  })}</div>;
}
