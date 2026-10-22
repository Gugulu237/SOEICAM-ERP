
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { customerDeliveryRequest } from '@/lib/customer-delivery-client';
import { DELIVERY_DAYS } from '@/lib/customer-delivery';
import GpsCapture from './GpsCapture';

export const useDeliveryZoneOptions=()=>useQuery({queryKey:['delivery-zone-options'],queryFn:()=>customerDeliveryRequest({action:'deliveryZoneOptions'}),staleTime:60000});
export function DeliveryZoneSelect({value='',onChange,disabled=false}) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const query=useDeliveryZoneOptions();
  return <label className="block text-xs text-slate-600">{ui("Delivery zone")}<select aria-label={ui("Delivery zone")} disabled={disabled || query.isLoading || query.isError} value={value} onChange={e=>onChange(e.target.value)} className="mt-1 h-10 w-full rounded-md border bg-white px-2 text-sm"><option value="">{ui("Unassigned")}</option>{query.data?.zones.map(z=><option value={z.id} key={z.id}>{z.name}{z.town?' · '+z.town:''}</option>)}{value && !query.data?.zones.some(z=>z.id===value)&&<option value={value}>{ui("Previously assigned zone")}</option>}</select>{query.isError&&<span role="alert" className="mt-1 block text-red-700">{ui("Zone options could not load. ")}<button type="button" className="underline" onClick={()=>query.refetch()}>{ui("Retry")}</button></span>}</label>;
}
export function DeliveryDayPicker({value='',onChange,disabled=false}) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const selected=String(value || '').split(/[,;\s]+/);
  return <fieldset disabled={disabled}><legend className="mb-2 text-xs text-slate-600">{ui("Delivery days")}</legend><div className="flex flex-wrap gap-2">{DELIVERY_DAYS.map(day=><label key={day} className={'inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-md border px-2 text-xs '+(selected.includes(day)?'border-amber-300 bg-amber-50':'bg-white')}><input type="checkbox" checked={selected.includes(day)} onChange={e=>onChange(DELIVERY_DAYS.filter(d=>d===day?e.target.checked:selected.includes(d)).join(', '))}/>{day}</label>)}</div></fieldset>;
}
export default function DeliverySetupFields({value,onChange,disabled=false,onBusyChange}) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const zoneOptions=useDeliveryZoneOptions();
  return <section className="space-y-4 rounded-xl border bg-slate-50 p-4"><div><h3 className="text-sm font-semibold">{ui("Delivery location")}</h3><p className="mt-1 text-xs leading-5 text-slate-500">{ui("Choose its zone and delivery days. Capture GPS while standing at this outlet’s delivery entrance. An office-created record can be completed on the next site visit.")}</p></div><DeliveryZoneSelect value={value.delivery_zone_id || ''} disabled={disabled} onChange={id=>onChange({delivery_zone_id:id})}/><DeliveryDayPicker value={value.delivery_days} disabled={disabled} onChange={days=>onChange({delivery_days:days})}/><label className="block text-xs text-slate-600">{ui("Delivery instructions / opening hours")}<textarea disabled={disabled} className="mt-1 w-full rounded-md border bg-white p-2 text-sm" rows={2} maxLength={2000} value={value.delivery_instructions || ''} onChange={e=>onChange({delivery_instructions:e.target.value})}/></label><GpsCapture maxAccuracy={zoneOptions.data?.policy.maxAccuracy || 30} value={value} onChange={onChange} disabled={disabled} onBusyChange={onBusyChange}/></section>;
}
