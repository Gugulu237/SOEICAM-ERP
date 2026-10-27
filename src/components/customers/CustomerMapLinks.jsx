'use client';
import {ui} from '@/lib/i18n';
import {useLocaleRender} from '@/lib/localization';
import React,{useState} from 'react';
import {MapPin,Navigation} from 'lucide-react';
import {hasCustomerLocation} from '@/lib/customer-location';
import GoogleCustomerMap from './GoogleCustomerMap';

export default function CustomerMapLinks({customer,onViewMap,onNavigate}){
  useLocaleRender();
  const [session,setSession]=useState(null);
  if(!hasCustomerLocation(customer))return <span className="text-xs text-slate-400">{ui('No delivery pin recorded')}</span>;
  const open=viewOnly=>setSession({points:[{...customer,id:customer.id||'location-preview'}],viewOnly});
  const action='inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-emerald-700 hover:bg-emerald-50';
  return <div className="flex flex-wrap gap-2">
    <button type="button" className={action} onClick={()=>onViewMap?onViewMap():open(true)}><MapPin size={15}/>{ui('View map')}</button>
    <button type="button" className={action} onClick={()=>onNavigate?onNavigate():open(false)}><Navigation size={15}/>{ui('Directions')}</button>
    {session&&<GoogleCustomerMap customers={session.points} selectedId={session.points[0].id} navigationRequest={session} initialExpanded onClose={()=>setSession(null)}/>}
  </div>;
}
