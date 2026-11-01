import React from 'react';
import {ui} from '@/lib/i18n';
import {formatNumber} from '@/lib/formatters';
import {validProductQuantity} from '@/lib/product-quantity';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';

// Draft quantities only become selection lines after an explicit confirmation.
// Enter must never submit an enclosing sale, load or return form.
export default function ProductQuantityBar({product,value,onChange,maximum,label=ui('Quantity'),inputLabel,existing=false,disabled=false,showAvailability=true,onConfirm,onCancel,onRemove}) {
  const valid=validProductQuantity(value,maximum),bad=String(value??'').trim()!==''&&!valid;
  const confirm=()=>{if(!disabled&&valid)onConfirm(Number(value));};
  return <div className="min-h-0 w-full min-w-0 space-y-3 overflow-y-auto overscroll-contain p-2" onKeyDown={event=>{if(event.key==='Enter'&&event.target.tagName==='INPUT'){event.preventDefault();event.stopPropagation();confirm();}}}>
    <div className="min-w-0 space-y-1">
      <p title={product.name} className="line-clamp-2 break-words text-sm font-semibold leading-5">{product.name}</p>
      {showAvailability&&<p className="break-words text-xs text-slate-500">{ui('Available')}: {formatNumber(Number.isFinite(Number(maximum))?maximum:0,3)} {product.unit||product.unit_of_measure||product.storage_unit||ui('units')}</p>}
    </div>
    <div className="grid min-w-0 grid-cols-1 gap-3"><label className="block min-w-0 space-y-1.5 text-sm font-medium">{label}
      <Input aria-label={inputLabel||ui('Quantity for {0}',product.name)} aria-invalid={bad} type="number" inputMode="decimal" enterKeyHint="done" autoComplete="off" min="0.001" max={maximum} step="0.001" value={value} disabled={disabled} placeholder={ui('Enter quantity')} onFocus={event=>event.currentTarget.select()} onChange={event=>onChange(event.target.value)} className="h-12 w-full min-w-0 text-base tabular-nums sm:h-12 md:text-base"/>
    </label>{bad&&<p role="alert" className="break-words text-xs leading-5 text-red-700">{ui('Enter a quantity above zero, up to {0}, with at most three decimal places.',formatNumber(Number.isFinite(Number(maximum))?maximum:0,3))}</p>}
      <Button type="button" disabled={disabled||!valid} onClick={confirm} className="h-auto min-h-12 w-full whitespace-normal px-4 text-sm leading-5 sm:h-auto sm:min-h-12 sm:whitespace-normal">{ui(existing?'Update quantity':'Add product')}</Button>
    </div>
    <div className="flex min-w-0 items-stretch gap-2 border-t border-slate-100 pt-1"><Button type="button" variant="ghost" disabled={disabled} onClick={onCancel} className="h-auto min-h-11 min-w-0 flex-1 whitespace-normal px-2 text-sm sm:h-auto sm:min-h-11 sm:whitespace-normal">{ui('Cancel')}</Button>{existing&&onRemove&&<Button type="button" variant="ghost" disabled={disabled} onClick={onRemove} className="h-auto min-h-11 min-w-0 flex-1 whitespace-normal px-2 text-sm text-red-700 sm:h-auto sm:min-h-11 sm:whitespace-normal">{ui('Remove product')}</Button>}</div>
  </div>;
}
