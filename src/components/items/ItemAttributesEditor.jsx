import React, { useId } from 'react';
import { ui } from '@/lib/i18n';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { MAX_ITEM_ATTRIBUTES } from '@/lib/item-attributes';

export default function ItemAttributesEditor({ value = [], onChange, disabled = false, suggestions = [] }) {
  const id = useId(), rows = Array.isArray(value) ? value : [];
  const change = (index, key, next) => onChange(rows.map((row,i) => i === index ? {...row,[key]:next} : row));
  return <section className="space-y-3" aria-label={ui('Item attributes')}>
    <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold text-slate-900">{ui('Additional attributes')}</h3><Button type="button" variant="outline" size="sm" disabled={disabled || rows.length >= MAX_ITEM_ATTRIBUTES} onClick={() => onChange([...rows,{name:'',value:''}])}>{ui('Add attribute')}</Button></div>
    <p className="text-xs leading-5 text-slate-500">{ui('Add details such as packaging type, milk type, brand or fat content. Reuse the same attribute names to keep filtering consistent.')}</p>
    <datalist id={id}>{suggestions.map(row => <option key={row.key} value={row.name}/>)}</datalist>
    {rows.map((row,index) => <div key={index} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto] items-end gap-2">
      <label className="min-w-0 space-y-1 text-xs">{ui('Attribute name')}<Input aria-label={ui('Attribute name {0}',index+1)} list={id} maxLength={50} value={row.name} disabled={disabled} placeholder={ui('e.g. Packaging type')} onChange={e => change(index,'name',e.target.value)}/></label>
      <label className="min-w-0 space-y-1 text-xs">{ui('Attribute value')}<Input aria-label={ui('Attribute value {0}',index+1)} maxLength={120} value={row.value} disabled={disabled} placeholder={ui('e.g. Returnable cup')} onChange={e => change(index,'value',e.target.value)}/></label>
      <Button type="button" variant="ghost" size="sm" disabled={disabled} aria-label={ui('Remove attribute {0}',index+1)} onClick={() => onChange(rows.filter((_,i) => i !== index))}>{ui('Remove')}</Button>
    </div>)}
    {!rows.length && <p className="text-xs text-slate-400">{ui('No additional attributes recorded.')}</p>}
  </section>;
}
