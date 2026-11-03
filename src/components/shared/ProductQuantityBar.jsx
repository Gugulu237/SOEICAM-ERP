import React from 'react';
import {ui} from '@/lib/i18n';
import {formatNumber} from '@/lib/formatters';
import {validProductQuantity} from '@/lib/product-quantity';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import {X,Trash2} from 'lucide-react';

// Draft quantities only become selection lines after an explicit confirmation.
// Enter must never submit an enclosing sale, load or return form.
export default function ProductQuantityBar({product,value,onChange,maximum,label=ui('Quantity'),inputLabel,existing=false,disabled=false,showAvailability=true,onConfirm,onCancel,onRemove,compact=false,prompt=false,autoFocus=false,confirmDisabled=false}) {
  const valid=validProductQuantity(value,maximum),bad=String(value??'').trim()!==''&&!valid;
  const confirm=()=>{if(!disabled&&!confirmDisabled&&valid)onConfirm(Number(value));};
  const keyDown=event=>{if(event.key==='Enter'&&event.target.tagName==='INPUT'){event.preventDefault();event.stopPropagation();confirm();}};
  if(prompt)return <div className="min-w-0 space-y-3" onKeyDown={keyDown}>
    <label className="block min-w-0 text-xs text-slate-600">{label}<Input autoFocus={autoFocus} aria-label={inputLabel||ui('Quantity for {0}',product.name)} aria-invalid={bad} type="number" inputMode="decimal" enterKeyHint="done" autoComplete="off" min="0.001" max={maximum} step="0.001" value={value} disabled={disabled} placeholder={ui('Enter quantity')} onFocus={event=>event.currentTarget.select()} onChange={event=>onChange(event.target.value)} className="mt-1 h-12 w-full min-w-0 text-base tabular-nums md:text-base"/></label>
    {bad&&<p role="alert" className="text-xs leading-4 text-red-700">{ui('Enter a quantity above zero, up to {0}, with at most three decimal places.',formatNumber(Number.isFinite(Number(maximum))?maximum:0,3))}</p>}
    <div className="flex min-w-0 gap-2">
      {existing&&onRemove&&<button type="button" aria-label={ui('Remove product')} disabled={disabled} onClick={onRemove} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-red-700 hover:bg-red-50"><Trash2 size={17}/></button>}
      <Button type="button" disabled={disabled||confirmDisabled||!valid} onClick={confirm} className="min-h-11 min-w-0 flex-1 whitespace-normal px-3 text-sm">{ui(existing?'Update quantity':'Add product')}</Button>
    </div>
  </div>;
  if(compact)return <div className="max-h-[45dvh] min-w-0 space-y-2 overflow-y-auto overscroll-contain" onKeyDown={keyDown}>
    <div className="flex min-w-0 items-center gap-2">
      <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold" title={product.name}>{product.name}</p>{showAvailability&&<p className="text-xs text-slate-500">{ui('Available')}: {formatNumber(Number.isFinite(Number(maximum))?maximum:0,3)} {product.unit||product.unit_of_measure||product.storage_unit||ui('units')}</p>}</div>
      {existing&&onRemove&&<button type="button" aria-label={ui('Remove product')} disabled={disabled} onClick={onRemove} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-red-700 hover:bg-red-50"><Trash2 size={17}/></button>}
      <button type="button" aria-label={ui('Cancel')} onClick={onCancel} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg hover:bg-slate-100"><X size={18}/></button>
    </div>
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
      <label className="min-w-0 text-xs text-slate-600">{label}<Input autoFocus={autoFocus} aria-label={inputLabel||ui('Quantity for {0}',product.name)} aria-invalid={bad} type="number" inputMode="decimal" enterKeyHint="done" autoComplete="off" min="0.001" max={maximum} step="0.001" value={value} disabled={disabled} placeholder={ui('Enter quantity')} onFocus={event=>event.currentTarget.select()} onChange={event=>onChange(event.target.value)} className="mt-1 h-12 w-full min-w-0 text-base tabular-nums md:text-base"/></label>
      <Button type="button" disabled={disabled||confirmDisabled||!valid} onClick={confirm} className="h-12 max-w-40 whitespace-normal px-3 text-sm">{ui(existing?'Update quantity':'Add product')}</Button>
    </div>
    {bad&&<p role="alert" className="text-xs leading-4 text-red-700">{ui('Enter a quantity above zero, up to {0}, with at most three decimal places.',formatNumber(Number.isFinite(Number(maximum))?maximum:0,3))}</p>}
  </div>;
  return <div className="min-h-0 w-full min-w-0 space-y-3 overflow-y-auto overscroll-contain p-2" onKeyDown={keyDown}>
    <div className="min-w-0 space-y-1">
      <p title={product.name} className="line-clamp-2 break-words text-sm font-semibold leading-5">{product.name}</p>
      {showAvailability&&<p className="break-words text-xs text-slate-500">{ui('Available')}: {formatNumber(Number.isFinite(Number(maximum))?maximum:0,3)} {product.unit||product.unit_of_measure||product.storage_unit||ui('units')}</p>}
    </div>
    <div className="grid min-w-0 grid-cols-1 gap-3"><label className="block min-w-0 space-y-1.5 text-sm font-medium">{label}
      <Input aria-label={inputLabel||ui('Quantity for {0}',product.name)} aria-invalid={bad} type="number" inputMode="decimal" enterKeyHint="done" autoComplete="off" min="0.001" max={maximum} step="0.001" value={value} disabled={disabled} placeholder={ui('Enter quantity')} onFocus={event=>event.currentTarget.select()} onChange={event=>onChange(event.target.value)} className="h-12 w-full min-w-0 text-base tabular-nums sm:h-12 md:text-base"/>
    </label>{bad&&<p role="alert" className="break-words text-xs leading-5 text-red-700">{ui('Enter a quantity above zero, up to {0}, with at most three decimal places.',formatNumber(Number.isFinite(Number(maximum))?maximum:0,3))}</p>}
      <Button type="button" disabled={disabled||confirmDisabled||!valid} onClick={confirm} className="h-auto min-h-12 w-full whitespace-normal px-4 text-sm leading-5 sm:h-auto sm:min-h-12 sm:whitespace-normal">{ui(existing?'Update quantity':'Add product')}</Button>
    </div>
    <div className="flex min-w-0 items-stretch gap-2 border-t border-slate-100 pt-1"><Button type="button" variant="ghost" disabled={disabled} onClick={onCancel} className="h-auto min-h-11 min-w-0 flex-1 whitespace-normal px-2 text-sm sm:h-auto sm:min-h-11 sm:whitespace-normal">{ui('Cancel')}</Button>{existing&&onRemove&&<Button type="button" variant="ghost" disabled={disabled} onClick={onRemove} className="h-auto min-h-11 min-w-0 flex-1 whitespace-normal px-2 text-sm text-red-700 sm:h-auto sm:min-h-11 sm:whitespace-normal">{ui('Remove product')}</Button>}</div>
  </div>;
}
