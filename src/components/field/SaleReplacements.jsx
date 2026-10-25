import React, { useState } from 'react';
import { Plus, RotateCcw, Trash2 } from 'lucide-react';
import { ui } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import MobileInfo from '@/components/shared/MobileInfo';

export default function SaleReplacements({ rows = [], stock, lines, date, disabled, onChange }) {
  const [enabled, setEnabled] = useState(rows.length > 0);
  const update = (index, patch) => onChange(rows.map((row, i) => i === index ? { ...row, ...patch } : row));
  return <section className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3" aria-label={ui('Stock replacements')}>
    <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-semibold"><input type="checkbox" className="h-5 w-5 accent-primary" checked={enabled || rows.length > 0} disabled={disabled} onChange={event => { setEnabled(event.target.checked); onChange(event.target.checked ? [{ product_id: '', quantity: '', reason: 'expired', expiry_date: '', lot_number: '' }] : []); }} /><RotateCcw size={17} aria-hidden="true" />{ui('Replace expired or damaged goods')}</label>
    {(enabled || rows.length > 0) && <div className="mt-2 space-y-3">
      <MobileInfo title={ui('Stock replacements')} desktopClassName="text-xs leading-5 text-slate-600"><p>{ui('Free like-for-like replacement. Fresh units reduce your delivery stock; collected goods are quarantined. These units do not increase the customer bill. Include the exchange on the photographed receipt.')}</p></MobileInfo>
      {rows.map((row, index) => {
        const product = stock.find(product => product.id === row.product_id);
        const used = [...lines, ...rows.filter((_, i) => i !== index)].filter(line => line.product_id === row.product_id).reduce((sum, line) => sum + Number(line.quantity || 0), 0);
        const available = Math.max(0, Math.round(((product?.quantity || 0) - used) * 1000) / 1000);
        return <fieldset key={index} className="min-w-0 space-y-3 rounded-lg border bg-white p-3"><legend className="px-1 text-xs font-semibold">{ui('Replacement {0}', index + 1)}</legend>
          <div className="flex items-end gap-2"><div className="min-w-0 flex-1"><Label htmlFor={'exchange-product-' + index} className="text-xs">{ui('Product collected and replaced')}</Label><select id={'exchange-product-' + index} className="mt-1 h-11 w-full min-w-0 rounded-md border bg-white px-2 text-sm" disabled={disabled} value={row.product_id} onChange={event => update(index, { product_id: event.target.value })}><option value="">{ui('Choose product')}</option>{stock.filter(product => product.quantity > 0 || product.id === row.product_id).map(product => <option key={product.id} value={product.id}>{product.name}</option>)}</select></div><Button type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0 text-red-700" aria-label={ui('Remove replacement {0}', index + 1)} disabled={disabled} onClick={() => onChange(rows.filter((_, i) => i !== index))}><Trash2 size={17} /></Button></div>
          <div className="grid grid-cols-2 gap-3"><div><Label htmlFor={'exchange-qty-' + index} className="text-xs">{ui('Units replaced')}</Label><Input id={'exchange-qty-' + index} className="mt-1 h-11" type="number" inputMode="decimal" min="0.001" step="0.001" max={available} disabled={disabled} value={row.quantity} onChange={event => update(index, { quantity: event.target.value })} />{product && <p className="mt-1 text-[11px] text-slate-500">{ui('{0} available after sale', available)}</p>}</div><div><Label htmlFor={'exchange-reason-' + index} className="text-xs">{ui('Condition')}</Label><select id={'exchange-reason-' + index} className="mt-1 h-11 w-full rounded-md border bg-white px-2 text-sm" disabled={disabled} value={row.reason} onChange={event => update(index, { reason: event.target.value })}><option value="expired">{ui('Expired')}</option><option value="damaged">{ui('Damaged')}</option></select></div></div>
          <div className="grid grid-cols-1 gap-3"><div><Label htmlFor={'exchange-expiry-' + index} className="text-xs">{ui(row.reason === 'expired' ? 'Printed expiry date *' : 'Printed expiry date')}</Label><Input id={'exchange-expiry-' + index} className="mt-1 h-11 min-w-0" type="date" max={row.reason === 'expired' ? date : undefined} disabled={disabled} value={row.expiry_date} onChange={event => update(index, { expiry_date: event.target.value })} /></div><div><Label htmlFor={'exchange-lot-' + index} className="text-xs">{ui('Batch / lot (optional)')}</Label><Input id={'exchange-lot-' + index} className="mt-1 h-11" disabled={disabled} maxLength={200} value={row.lot_number} onChange={event => update(index, { lot_number: event.target.value })} /></div></div>
        </fieldset>;
      })}
      <Button type="button" variant="outline" className="h-11 w-full border-primary/30 text-primary" disabled={disabled || rows.length >= 50} onClick={() => onChange([...rows, { product_id: '', quantity: '', reason: 'expired', expiry_date: '', lot_number: '' }])}><Plus size={16} className="mr-2" />{ui('Add replacement')}</Button>
    </div>}
  </section>;
}
