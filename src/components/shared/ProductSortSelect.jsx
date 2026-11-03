import React from 'react';
import {ui} from '@/lib/i18n';
import {PRODUCT_SORT_OPTIONS} from '@/lib/product-sorting';

export default function ProductSortSelect({value,onChange,disabled=false,className=''}) {
  return <label className={'flex min-w-0 items-center gap-2 text-xs text-slate-600 '+className}>
    <span className="shrink-0">{ui('Sort by')}</span>
    <select aria-label={ui('Sort products')} value={value} disabled={disabled} onChange={event=>onChange(event.target.value)} className="h-11 w-full min-w-0 max-w-full rounded-lg border bg-white px-2 text-sm text-slate-900">
      {PRODUCT_SORT_OPTIONS.map(([key,label])=><option key={key} value={key}>{ui(label)}</option>)}
    </select>
  </label>;
}
