import React,{useEffect,useRef,useState} from 'react';
import { PRODUCT_FLAVOURS } from '@/lib/product-variants';
import { recipeCatalogue } from '@/lib/yogurt-recipe-presets';
import { ui } from '@/lib/i18n';
import { ProductPhoto } from '@/components/shared/ProductThumb';
import ItemAvailabilityAction from '@/components/items/ItemAvailabilityAction';
import { itemAvailabilityLabel } from '@/lib/item-readiness';
import PickerPopdown from '@/components/ui/picker-popdown';

export default function RecipeProductCatalogue({items,family,outputs,onSelect,onEditItem,onItemSaved,disabled=false}) {
  const [open,setOpen]=useState(false),[path,setPath]=useState([]),[query,setQuery]=useState(''),[limit,setLimit]=useState(25);
  const anchorRef=useRef(null),resultsRef=useRef(null);
  useEffect(()=>{if(open&&resultsRef.current){resultsRef.current.scrollTop=0;resultsRef.current.querySelector('button')?.focus({preventScroll:true});}},[open,path]);
  const rows=recipeCatalogue(items,family),flavor=path[0],size=path[1];
  const flavorName=value=>ui(PRODUCT_FLAVOURS.find(f=>f.value===value)?.label || 'Needs setup');
  const filtered=rows.filter(row=>(!flavor||row.flavor===flavor||flavor==='setup'&&!row.flavor)&&(!size||row.size===size)&&`${row.item.name} ${flavorName(row.flavor)} ${row.size}`.toLowerCase().includes(query.toLowerCase()));
  const groups=flavor?[...new Set(rows.filter(row=>row.flavor===flavor).map(row=>row.size).filter(Boolean))].sort((a,b)=>parseFloat(a)-parseFloat(b)):
    [...PRODUCT_FLAVOURS.filter(f=>rows.some(row=>row.flavor===f.value)).map(f=>f.value),...(rows.some(row=>!row.flavor)?['setup']:[])];
  function move(next){setPath(next);setQuery('');setLimit(25);if(resultsRef.current)resultsRef.current.scrollTop=0;}
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" ref={anchorRef} aria-label={ui('Browse by flavour and size')} aria-expanded={open} aria-haspopup="dialog" disabled={disabled} onClick={()=>setOpen(!open)} className="rounded-md border bg-white px-3 py-2 text-sm font-medium">{path.length?`${flavorName(flavor)}${size?' · '+size:''}`:ui('All flavours and sizes')} ▾</button>
      {path.length>0&&<button type="button" onClick={()=>move([])} className="text-sm text-slate-600 underline">{ui('All products')}</button>}
      <input aria-label={ui('Search projected products')} value={query} onChange={e=>{setQuery(e.target.value);setLimit(25);}} placeholder={ui('Search products')} className="h-10 min-w-0 flex-1 rounded-md border px-3 text-sm"/>
    </div>
    {open&&<PickerPopdown anchorRef={anchorRef} onOpenChange={setOpen} label={ui('Browse by flavour and size')}>
      <div className="flex items-center gap-2"><button type="button" disabled={!path.length} onClick={()=>move(path.slice(0,-1))} className="rounded border px-2 py-1 text-sm">{ui('Back')}</button><button type="button" onClick={()=>move([])} className="text-sm underline">{ui('All flavours')}</button></div>
      <div ref={resultsRef} className="max-h-60 overflow-y-auto">
        {groups.length>0&&path.length<2?groups.map(group=><button data-component-option type="button" key={group} onClick={()=>{move([...path,group]);if(flavor)setOpen(false);}} className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-slate-100">{flavor?group:flavorName(group)} ›</button>):<button data-component-option type="button" onClick={()=>setOpen(false)} className="w-full rounded border px-3 py-2 text-left text-sm">{ui('Show matching products')}</button>}
      </div>
      {path.length===1&&<button type="button" onClick={()=>setOpen(false)} className="rounded border px-3 py-2 text-sm">{ui('All sizes for this flavour')}</button>}
    </PickerPopdown>}
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" aria-label={ui('Projected product catalogue')}>
      {filtered.slice(0,limit).map(row=>{const selected=outputs.find(o=>o.product_id===row.item.id);return <article key={row.item.id} className="min-w-0"><button type="button" title={row.item.name} aria-label={ui('Configure {0}',row.item.name)} aria-pressed={!!selected} disabled={disabled||row.unavailable} onClick={()=>onSelect(row.item)} className={`w-full min-w-0 overflow-hidden rounded-xl border bg-white p-2 text-left transition hover:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-600 disabled:opacity-50 ${selected?'border-emerald-600 ring-1 ring-emerald-600':'border-slate-200'}`}>
        <ProductPhoto product={row.item} name={row.item.name} className="aspect-square w-full" sizes="(min-width:1024px) 180px, 40vw"/>
        <span className="mt-2 block text-sm font-medium">{flavorName(row.flavor)}</span><span className="block text-sm text-slate-600">{row.size || ui('Set size')}</span>
        {selected&&<span className="mt-1 block text-xs font-medium text-emerald-700">{ui('{0} buckets · {1} units',selected.buckets,Number(selected.buckets)*Number(selected.standard_units_per_bucket || 0))}</span>}
        {row.unavailable&&<span className="block text-xs">{ui(itemAvailabilityLabel(row.item))}</span>}
      </button>{row.unavailable&&<div className="mt-2"><ItemAvailabilityAction item={row.item} onEdit={onEditItem} onSaved={onItemSaved} disabled={disabled}/></div>}</article>;})}
    </div>
    {!filtered.length&&<p role="status" className="py-6 text-center text-sm text-slate-500">{ui('No products match this selection.')}</p>}
    {filtered.length>limit&&<button type="button" onClick={()=>setLimit(limit+25)} className="rounded border px-3 py-2 text-sm">{ui('Show more')}</button>}
  </div>;
}
