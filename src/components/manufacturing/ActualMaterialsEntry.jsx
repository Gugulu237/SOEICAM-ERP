import React from 'react';
import {ArrowRight,Trash2} from 'lucide-react';
import {ui} from '@/lib/i18n';
import {formatQuantity} from '@/lib/formatters';
import {DEFAULT_ITEM_UNITS,compatibleUnits} from '@/lib/item-units';
import {businessDate} from '@/lib/business-date';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';

// Controlled by the production draft so back/forward and stock refreshes never
// replace the manager's measurements with assembly blueprint quantities.
export default function ActualMaterialsEntry({materials=[],rows,date,setDate,notes,setNotes,locked,ready,onAdd,onChange,onRemove,onContinue,responsible}){
  const byId=new Map(materials.map(material=>[material.id,material]));
  return <div className="space-y-5">
    <section className="rounded-2xl border bg-white p-4 sm:p-5">
      <h3 className="text-lg font-semibold">{ui('Materials used in this batch')}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-500">{ui('Enter the actual milk, sugar, flavours and preservatives used. Cups and stickers are calculated from the finished quantities in the next step.')}</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="text-xs font-medium text-slate-500">{ui('Production date')}<Input aria-label={ui('Build date')} type="date" max={businessDate()} value={date} disabled={locked} onChange={event=>setDate(event.target.value)} className="mt-1"/></label>{responsible&&<div className="text-xs text-slate-500">{ui('Responsible')}<p className="mt-3 text-sm font-semibold text-slate-900">{responsible}</p></div>}</div>
      <label className="mt-4 block text-sm font-medium">{ui('Add a material used')}<select aria-label={ui('Choose material')} value="" disabled={locked||rows.length>=100} onChange={event=>{if(event.target.value)onAdd(event.target.value);}} className="mt-2 h-12 w-full rounded-xl border bg-white px-3 text-sm"><option value="">{ui('Choose a material...')}</option>{[['material','Raw materials and additives'],['subassembly','On-hand subassemblies']].map(([kind,label])=>{const items=materials.filter(material=>(material.kind||'material')===kind&&!rows.some(row=>row.product_id===material.id)).sort((a,b)=>a.name.localeCompare(b.name));return items.length>0&&<optgroup key={kind} label={ui(label)}>{items.map(material=><option key={material.id} value={material.id}>{material.name} ({material.unit})</option>)}</optgroup>;})}</select></label>
      {!materials.length&&<p role="alert" className="mt-3 text-sm text-amber-900">{ui('No active materials are available. Check the inventory item setup.')}</p>}
    </section>
    {!rows.length&&<p className="rounded-2xl border border-dashed bg-white p-5 text-sm text-slate-500">{ui('Add each material used and enter its measured quantity. Do not enter cups or stickers here.')}</p>}
    <div className="space-y-3">{rows.map(row=>{const material=byId.get(row.product_id),units=compatibleUnits([...DEFAULT_ITEM_UNITS,...(material?.unit&&!DEFAULT_ITEM_UNITS.some(unit=>unit.code===material.unit)?[{code:material.unit,name:material.unit}]:[])],material?.unit||row.unit);return <section key={row.product_id} className="rounded-2xl border bg-white p-4">
      <div className="flex items-start justify-between gap-3"><div><h4 className="font-semibold">{material?.name||row.product_id}</h4>{material&&<p className="mt-1 text-xs text-slate-500">{ui('On hand')}: {formatQuantity(material.on_hand??0)} {material.unit} · {ui('Available to build')}: {formatQuantity(material.available??0)} {material.unit}</p>}</div><button type="button" disabled={locked} aria-label={ui('Remove material {0}',material?.name||row.product_id)} onClick={()=>onRemove(row.product_id)} className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-50"><Trash2 size={17}/></button></div>
      {!material&&<p role="alert" className="mt-2 text-sm text-amber-900">{ui('This material is no longer available. Remove it or check its inventory setup.')}</p>}
      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(5rem,0.4fr)] gap-3"><label className="text-xs font-medium text-slate-500">{ui('Actual quantity used')}<Input aria-label={ui('Actual quantity for {0}',material?.name||row.product_id)} type="number" min="0" max="1000000000" step="any" inputMode="decimal" placeholder="0" value={row.quantity} disabled={locked} onChange={event=>onChange(row.product_id,'quantity',event.target.value)} className="mt-1 h-12 text-base font-semibold"/></label><label className="text-xs font-medium text-slate-500">{ui('Unit')}<select aria-label={ui('Unit for {0}',material?.name||row.product_id)} value={row.unit} disabled={locked} onChange={event=>onChange(row.product_id,'unit',event.target.value)} className="mt-1 h-12 w-full rounded-md border bg-white px-2 text-sm">{units.map(unit=><option key={unit.code} value={unit.code}>{unit.code}</option>)}</select></label></div>
    </section>;})}</div>
    <section className="rounded-2xl border bg-white p-4"><label className="block text-xs font-medium text-slate-500">{ui('Notes (optional)')}<Input aria-label={ui('Build notes')} maxLength={2000} value={notes} disabled={locked} onChange={event=>setNotes(event.target.value)} className="mt-1"/></label><p className="mt-3 text-xs leading-5 text-slate-500">{ui('Stock is updated after you review and confirm the finished production.')}</p><Button className="mt-4 min-h-12 w-full sm:w-auto" disabled={!ready||locked} onClick={onContinue}>{ui('Continue to finished products')}<ArrowRight size={17} className="ml-2"/></Button></section>
  </div>;
}
