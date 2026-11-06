import React from 'react';
import {Check, ChevronDown, Truck, Warehouse} from 'lucide-react';
import {ui} from '@/lib/i18n';
import {Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription} from '@/components/ui/dialog';

export function vehicleSaleLabel(run) {
  return run.vehicle_registration?.trim() || run.registration?.trim() || run.vehicle_name || run.commercial_name || run.salesperson_name || run.dispatch_number || ui('Vehicle');
}
export default function SaleStockPicker({open,onOpenChange,value,options,onChange,disabled=false,fallbackLabel=''}) {
  const selected=options.find(option=>option.id===value),Icon=selected?.kind==='vehicle'?Truck:Warehouse;
  return <>
    <button type="button" aria-label={ui('Stock source')} aria-haspopup="dialog" disabled={disabled} onClick={()=>onOpenChange(true)} className="flex min-h-14 w-full min-w-0 max-w-full items-center gap-3 rounded-xl border bg-white p-3 text-left disabled:opacity-60">
      <Icon size={24} className="shrink-0 text-green-700"/><span className="min-w-0 flex-1 break-words text-sm font-semibold">{selected?.label||fallbackLabel||ui('Choose stock source')}</span><ChevronDown size={18} className="shrink-0 text-slate-400"/>
    </button>
    <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="flex max-h-[85dvh] min-w-0 flex-col overflow-hidden sm:max-w-lg">
      <DialogHeader><DialogTitle>{ui('Choose stock source')}</DialogTitle><DialogDescription>{ui(options.some(option=>option.kind==='warehouse')?'Choose company stock or goods issued to an employee.':'Choose goods issued to you.')}</DialogDescription></DialogHeader>
      <div className="grid min-h-0 grid-cols-2 gap-3 overflow-y-auto overscroll-contain p-1">{options.map(option=>{
        const ItemIcon=option.kind==='vehicle'?Truck:Warehouse;
        return <button type="button" key={option.id} aria-label={ui('Use {0}',option.label)} aria-pressed={value===option.id} disabled={disabled||option.disabled} onClick={()=>{onChange(option.id);onOpenChange(false);}} className={'relative flex min-h-28 min-w-0 flex-col items-center justify-center gap-3 rounded-xl border p-3 text-center disabled:opacity-50 '+(value===option.id?'border-green-700 bg-green-50':'bg-white hover:border-green-600')}>
          <ItemIcon size={32} className="shrink-0 text-green-700"/><span className="w-full min-w-0 break-words text-sm font-semibold">{option.label}</span>{value===option.id&&<Check size={16} className="absolute right-2 top-2 text-green-700"/>}
        </button>;
      })}</div>
      {!options.length&&<p className="text-sm text-slate-500">{ui('No loaded stock source is available.')}</p>}
    </DialogContent></Dialog>
  </>;
}
