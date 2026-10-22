import React, { useState } from 'react';
import { ui } from '@/lib/i18n';

export default function ItemAttributeFilters({ facets, selected, onChange, disabled = false }) {
  const [chosen,setChosen] = useState('');
  const facet = facets.find(f => f.key === chosen);
  const remove = key => onChange(Object.fromEntries(Object.entries(selected).filter(([k]) => k !== key)));
  if (!facets.length && !Object.keys(selected).length) return null;
  return <div className="space-y-2" aria-label={ui('Attribute filters')}>
    <div className="flex flex-wrap gap-2">
      <select aria-label={ui('Filter by attribute')} disabled={disabled} value={facet?.key || ''} onChange={e => setChosen(e.target.value)} className="h-10 max-w-full rounded-md border bg-white px-3 text-sm"><option value="">{ui('Choose an attribute')}</option>{facets.map(f => <option key={f.key} value={f.key}>{f.name}</option>)}</select>
      {facet && <select aria-label={ui('Filter attribute value')} disabled={disabled} value={selected[facet.key] || ''} onChange={e => e.target.value ? onChange({...selected,[facet.key]:e.target.value}) : remove(facet.key)} className="h-10 max-w-full rounded-md border bg-white px-3 text-sm"><option value="">{ui('All values')}</option>{facet.values.map(v => <option key={v.key} value={v.key}>{v.label}</option>)}</select>}
    </div>
    {!!Object.keys(selected).length && <div className="flex flex-wrap gap-2">{Object.entries(selected).map(([key,value]) => {
      const definition = facets.find(f => f.key === key), label = definition?.values.find(v => v.key === value)?.label || value;
      return <button type="button" key={key} disabled={disabled} onClick={() => remove(key)} aria-label={ui('Remove filter {0}',definition?.name || key)} className="max-w-full break-words rounded-full border border-green-200 bg-green-50 px-3 py-1 text-xs text-green-900">{definition?.name || key}: {label} <span aria-hidden="true">×</span></button>;
    })}</div>}
  </div>;
}
