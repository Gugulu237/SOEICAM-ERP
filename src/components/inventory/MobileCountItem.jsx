import React from 'react';
import {ui} from '@/lib/i18n';
import {formatQuantity} from '@/lib/formatters';
import {Input} from '@/components/ui/input';

export default function MobileCountItem({item,book,entry,value,onChange,disabled}){
 return <div data-sleek-screen="inventory-count" className="space-y-3 p-1"><div><h3 className="text-sm font-semibold">{item.name}</h3><p className="mt-1 text-xs text-slate-500">{item.sku||item.unit}</p></div><div className="grid grid-cols-3 gap-2 rounded-xl border bg-white p-3"><div><p className="text-[10px] text-slate-500">{ui('Book quantity')}</p><p className="mt-3 text-base font-bold tabular-nums">{book===null?'—':formatQuantity(book)}</p></div><label className="text-[10px] text-slate-500">{ui('Counted quantity')}<Input aria-label={ui('Physical quantity for {0}',item.name)} type="number" inputMode="decimal" min="0" max="1000000000" step="0.001" placeholder="—" value={value} disabled={disabled} aria-invalid={!!entry?.error} onChange={e=>onChange(e.target.value)} className="mt-1 h-11 min-w-0 px-2 text-base font-semibold tabular-nums"/></label><div><p className="text-[10px] text-slate-500">{ui('Difference')}</p><p aria-label={ui('Difference for {0}',item.name)} className={'mt-3 text-base font-bold tabular-nums '+(entry?.difference<0?'text-red-700':entry?.difference>0?'text-primary':'text-slate-500')}>{entry&&!entry.error?(entry.difference>0?'+':'')+formatQuantity(entry.difference):'—'}</p></div></div></div>;
}
