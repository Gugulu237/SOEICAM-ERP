
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React from 'react';
import { Minus, Plus, ShoppingBag, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import ProductThumb from '@/components/shared/ProductThumb';
import { formatXAF } from '@/lib/formatters';
import { roundMoney, roundQuantity } from '@/lib/field-pos';

export default function FieldSaleLines({ lines, onChange, stock, disabled = false, isAdmin = false }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const change = (index, patch) => onChange(lines.map((line, i) => i === index ? { ...line, ...patch } : line));
  if (!lines.length) return <div className="rounded-xl border border-dashed border-slate-200 p-7 text-center"><ShoppingBag className="mx-auto mb-2 h-8 w-8 text-slate-300" /><p className="text-sm font-medium text-slate-600">{ui("Your sale starts here")}</p><p className="mt-1 text-xs text-slate-500">{ui("Tap a product photo to add it.")}</p></div>;
  return <div className="divide-y divide-slate-100">
    {lines.map((line, index) => {
      const product = stock.find((p) => p.product_id === line.product_id);
      const name = product?.name || line.product_name || ui("Unavailable product");
      const quantity = Number(line.quantity) || 0;
      const available = product?.quantity || 0;
      const unit = product?.unit_of_measure || product?.storage_unit || ui("units");
      return <div key={`${line.product_id}-${index}`} className="py-4 first:pt-0 last:pb-0">
        <div className="flex items-start gap-3"><ProductThumb product={product} name={name} size={54} />
          <div className="min-w-0 flex-1"><p className="text-sm font-semibold leading-snug text-slate-900">{name}</p><p className="mt-1 text-xs text-slate-500">{disabled ? `${quantity} ${unit} supplied` : ui("{0} {1} on this delivery run", available, unit)}</p></div>
          {!disabled && <button type="button" aria-label={ui("Remove {0}", name)} onClick={() => onChange(lines.filter((_, i) => i !== index))} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={16} /></button>}
        </div>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
          <div><label htmlFor={`qty-${index}`} className="mb-1 block text-[11px] text-slate-500">{ui("Exact quantity supplied (")}{unit})</label><div className="flex items-center rounded-lg border border-slate-200">
            <button type="button" aria-label={ui("Decrease {0}", name)} disabled={disabled} onClick={() => quantity <= 1 ? onChange(lines.filter((_, i) => i !== index)) : change(index, { quantity: roundQuantity(quantity - 1) })} className="flex h-11 w-10 items-center justify-center disabled:opacity-30"><Minus size={16} /></button>
            <input id={`qty-${index}`} type="number" inputMode="decimal" step="0.001" min="0.001" max={available} disabled={disabled} value={line.quantity} onChange={(e) => change(index, { quantity: e.target.value })} className="h-11 w-16 min-w-0 border-x border-slate-200 bg-transparent px-1 text-center text-sm font-semibold tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" />
            <button type="button" aria-label={ui("Increase {0}", name)} disabled={disabled || quantity >= available} onClick={() => change(index, { quantity: Math.min(available, roundQuantity(quantity + 1)) })} className="flex h-11 w-10 items-center justify-center disabled:opacity-30"><Plus size={16} /></button>
          </div></div>
          <div className="w-28"><label htmlFor={`price-${index}`} className="mb-1 block text-[11px] text-slate-500">{ui("Unit price · XAF")}</label><Input id={`price-${index}`} type="number" inputMode="decimal" step="0.01" min={isAdmin ? 0.01 : product?.selling_price || 0.01} value={line.unit_price} disabled={disabled} onChange={(e) => change(index, { unit_price: e.target.value })} className="h-11 text-right" /></div>
        </div>
        {!disabled && quantity > available && <p role="alert" className="mt-2 text-xs text-red-600">{ui("Only ")}{available}{ui(" available. Reduce the quantity.")}</p>}
        {!disabled && quantity > 0 && quantity <= available && <p className="mt-2 text-xs font-medium text-emerald-700">{roundQuantity(available - quantity)} {unit}{ui(" remain on this run after this supply.")}</p>}
        {!disabled && !isAdmin && Number(line.unit_price) < (product?.selling_price || 0) && <p className="mt-2 text-xs text-red-600">{ui("Minimum price: ")}{formatXAF(product.selling_price)}</p>}
        <p className="mt-2 text-right text-sm font-semibold text-slate-800">{formatXAF(roundMoney(roundQuantity(line.quantity) * roundMoney(line.unit_price)))}</p>
      </div>;
    })}
  </div>;
}
