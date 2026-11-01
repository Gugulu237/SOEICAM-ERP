import React, { useState } from 'react';
import { Plus, RotateCcw, Trash2 } from 'lucide-react';
import { ui } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import SaleProductPicker from '@/components/sales/SaleProductPicker';
import MobileInfo from '@/components/shared/MobileInfo';

export default function SaleReplacements({ rows = [], stock, lines, date, disabled, onChange, declared, onDeclare }) {
  const [localAnswer,setLocalAnswer]=useState(rows.length?true:null),[picker,setPicker]=useState(false);
  const answer=declared===undefined?localAnswer:declared;
  const choose=value=>{setLocalAnswer(value);onDeclare?.(value);if(!value)onChange([]);};
  const pickerLines=rows.filter((row,i)=>row.product_id&&rows.findIndex(r=>r.product_id===row.product_id)===i);
  const products=stock.map(p=>{const first=rows.findIndex(row=>row.product_id===p.id);const used=[...lines,...rows.filter((row,i)=>i!==first)].filter(row=>row.product_id===p.id).reduce((n,row)=>n+Number(row.quantity||0),0);return {...p,available:Math.max(0,Math.round((Number(p.quantity??p.available)-used)*1000)/1000)};});
  const quantity=(p,value)=>{const at=rows.findIndex(row=>row.product_id===p.id);if(value===null){onChange(rows.filter((_,i)=>i!==at));return;}if(at>=0)update(at,{quantity:value});else onChange([...rows,{product_id:p.id,quantity:value,reason:'expired',expiry_date:'',lot_number:''}]);};
  const update = (index, patch) => onChange(rows.map((row, i) => i === index ? { ...row, ...patch } : row));
  return <section className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3" aria-label={ui('Stock replacements')}>
<h3 className="flex items-center gap-2 text-sm font-semibold"><RotateCcw size={17} aria-hidden="true"/>{ui('Were any spoiled goods replaced during this supply?')}</h3><div role="group" aria-label={ui('Spoilage replacement answer')} className="mt-3 grid grid-cols-2 gap-3">{[[false,'No replacements'],[true,'Yes, goods replaced']].map(([value,label])=><Button key={label} type="button" variant={answer===value?'default':'outline'} className="min-h-11 whitespace-normal" aria-pressed={answer===value} disabled={disabled} onClick={()=>choose(value)}>{ui(label)}</Button>)}</div>
    {answer===true && <div className="mt-2 space-y-3">
      <MobileInfo title={ui('Stock replacements')} desktopClassName="text-xs leading-5 text-slate-600"><p>{ui('Free like-for-like replacements reduce the selected stock and do not increase the customer bill. Collected goods are quarantined. Include these exchanges on this supply receipt; do not enter replacements already recorded separately.')}</p></MobileInfo>
      {rows.map((row, index) => {
        const product = stock.find(product => product.id === row.product_id)||(row.product_name?{name:row.product_name}:null);
        const used = [...lines, ...rows.filter((_, i) => i !== index)].filter(line => line.product_id === row.product_id).reduce((sum, line) => sum + Number(line.quantity || 0), 0);
        const available = Math.max(0, Math.round(((product?.quantity || 0) - used) * 1000) / 1000);
        return <fieldset key={index} className="min-w-0 space-y-3 rounded-lg border bg-white p-3"><legend className="px-1 text-xs font-semibold">{ui('Replacement {0}', index + 1)}</legend>
          <div className="flex items-end gap-2"><div className="min-w-0 flex-1"><p className="text-xs text-slate-500">{ui('Product collected and replaced')}</p><p className="mt-1 break-words text-sm font-semibold">{product?.name||ui('Choose product')}</p></div><Button type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0 text-red-700" aria-label={ui('Remove replacement {0}', index + 1)} disabled={disabled} onClick={() => onChange(rows.filter((_, i) => i !== index))}><Trash2 size={17} /></Button></div>
          <div className="grid grid-cols-2 gap-3"><div><Label htmlFor={'exchange-qty-' + index} className="text-xs">{ui('Units replaced')}</Label><Input id={'exchange-qty-' + index} className="mt-1 h-11" type="number" inputMode="decimal" min="0.001" step="0.001" max={available} disabled={disabled} value={row.quantity} onChange={event => update(index, { quantity: event.target.value })} />{product && <p className="mt-1 text-[11px] text-slate-500">{ui('{0} available after sale', available)}</p>}</div><div><Label htmlFor={'exchange-reason-' + index} className="text-xs">{ui('Condition')}</Label><select id={'exchange-reason-' + index} className="mt-1 h-11 w-full rounded-md border bg-white px-2 text-sm" disabled={disabled} value={row.reason} onChange={event => update(index, { reason: event.target.value })}><option value="expired">{ui('Expired')}</option><option value="damaged">{ui('Damaged')}</option></select></div></div>
          <div className="grid grid-cols-1 gap-3"><div><Label htmlFor={'exchange-expiry-' + index} className="text-xs">{ui(row.reason === 'expired' ? 'Printed expiry date *' : 'Printed expiry date')}</Label><Input id={'exchange-expiry-' + index} className="mt-1 h-11 min-w-0" type="date" max={row.reason === 'expired' ? date : undefined} disabled={disabled} value={row.expiry_date} onChange={event => update(index, { expiry_date: event.target.value })} /></div><div><Label htmlFor={'exchange-lot-' + index} className="text-xs">{ui('Batch / lot (optional)')}</Label><Input id={'exchange-lot-' + index} className="mt-1 h-11" disabled={disabled} maxLength={200} value={row.lot_number} onChange={event => update(index, { lot_number: event.target.value })} /></div></div>
        </fieldset>;
      })}
      <Button type="button" variant="outline" className="h-11 w-full border-primary/30 text-primary" disabled={disabled || rows.length >= 50} onClick={() => setPicker(true)}><Plus size={16} className="mr-2" />{ui(rows.length?'Add or edit replacements':'Choose replacement products')}</Button>
    </div>}
    {picker&&<SaleProductPicker open purpose="replacement" onOpenChange={setPicker} products={products} lines={pickerLines} onQuantityChange={quantity} disabled={disabled}/>}
  </section>;
}
