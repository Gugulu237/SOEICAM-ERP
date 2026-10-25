import React, { useMemo, useState } from 'react';
import { SlidersHorizontal, Search } from 'lucide-react';
import { usePageState } from '@/lib/navigation-context';
import { itemAvailabilityLabel } from '@/lib/item-readiness';
import { ui } from '@/lib/i18n';
import { inventoryGroup, inventoryVariants, inventoryGroups, inventoryDisplayName } from '@/lib/inventory-groups';
import {packagingGroup,packagingVariants} from '@/lib/inventory-packaging';
import { normalizeProductText } from '@/lib/product-images';
import { stockUnit } from '@/lib/item-units';
import { formatQuantity } from '@/lib/formatters';
import ProductThumb, { ProductPhoto } from '@/components/shared/ProductThumb';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { attributeFacets, itemSearchText, matchesAttributes } from '@/lib/item-attributes';
import { PRODUCT_FLAVOURS, flavourChoice, productSizeChoices } from '@/lib/product-variants';
import ItemAttributeFilters from '@/components/items/ItemAttributeFilters';

const normalize = value => normalizeProductText(value).trim().replace(/\s+/g,' ');
// Resolve photo-derived labels and searchable metadata once per catalogue update.
// The page mounts at most 25 cards, including their lazy images/editors.
export default function GroupedItems({ products, filter, quantities, onEdit, renderDetails, table = false }) {
  const [search,setSearch] = usePageState('inventory:'+filter+':search',''), [group,setGroup] = usePageState('inventory:'+filter+':group',''), [flavor,setFlavor] = usePageState('inventory:'+filter+':flavor',''), [size,setSize] = usePageState('inventory:'+filter+':size',''), [attributes,setAttributes] = usePageState('inventory:'+filter+':attributes',{}), [page,setPage] = usePageState('inventory:'+filter+':page',1);
  const [showFilters,setShowFilters]=useState(false);
  const finished = filter === 'finished',packaging = filter === 'packaging';
  const rows = useMemo(() => products.map(item => {const variant=packaging?packagingVariants(item):inventoryVariants(item);return {item,variant,group:packaging?packagingGroup(item):inventoryGroup(item),search:normalize(itemSearchText(item)+' '+variant.flavor+' '+(flavourChoice(variant.flavor)?.label || '')+' '+variant.size)};}),[products,packaging]);
  const groups = useMemo(() => packaging?[...new Set(rows.map(row=>row.group))].sort((a,b)=>a.localeCompare(b)):filter==='all'?[...inventoryGroups(products,true),...inventoryGroups(products,false)]:inventoryGroups(products, finished).filter(group=>rows.some(row=>row.group===group)), [products,finished,filter,packaging,rows]);
  const flavors = useMemo(() => [...new Set([...(finished?PRODUCT_FLAVOURS.map(option=>option.value):[]),...rows.filter(r=>!group || r.group===group).map(r=>r.variant.flavor).filter(Boolean)])], [rows,group,finished]);
  const sizes = useMemo(() => [...new Set([...(finished?productSizeChoices(group):[]),...rows.filter(r=>(!group || r.group===group) && (!flavor || r.variant.flavor===flavor)).map(r=>r.variant.size).filter(Boolean)])].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})), [rows,group,flavor,finished]);
  const facets = useMemo(() => attributeFacets(products),[products]);
  const filtered = useMemo(() => {
    const terms=normalize(search).split(/\s+/).filter(Boolean);
    return rows.filter(r => (!group || r.group===group) && (!flavor || r.variant.flavor===flavor) && (!size || r.variant.size===size) && terms.every(term=>r.search.includes(term)) && matchesAttributes(r.item,attributes));
  }, [rows,group,flavor,size,search,attributes]);
  const ordered = useMemo(() => {
    const groupOrder=new Map(groups.map((value,index)=>[value,index])),flavourOrder=new Map(PRODUCT_FLAVOURS.map((option,index)=>[option.value,index]));
    return [...filtered].sort((a,b)=>(groupOrder.get(a.group) ?? groups.length)-(groupOrder.get(b.group) ?? groups.length) || a.group.localeCompare(b.group) || (finished?(flavourOrder.get(a.variant.flavor) ?? 99)-(flavourOrder.get(b.variant.flavor) ?? 99) || a.variant.flavor.localeCompare(b.variant.flavor) || a.variant.size.localeCompare(b.variant.size,undefined,{numeric:true}):0) || a.item.name.localeCompare(b.item.name) || String(a.item.id).localeCompare(String(b.item.id)));
  },[filtered,groups,finished]);
  const pages=Math.max(1,Math.ceil(ordered.length/25)),currentPage=Math.min(page,pages),offset=(currentPage-1)*25;
  const visible=ordered.slice(offset,offset+25);
  const update = (setter,value) => {setter(value);setPage(1);};
  const hasFilters=!!(search || group || flavor || size || Object.keys(attributes).length);
  const activeFilters=[group,flavor,size,...Object.values(attributes)].filter(Boolean).length;
  const clear=()=>{setSearch('');setGroup('');setFlavor('');setSize('');setAttributes({});setPage(1);};
  return <div className="space-y-4">
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
      <div className="flex min-w-0 items-center gap-2"><div className="relative min-w-0 flex-1"><Search size={17} aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 text-slate-400"/><Input aria-label={ui('Search items')} placeholder={ui('Search items')} value={search} onChange={e=>update(setSearch,e.target.value)} className="h-11 min-w-0 bg-slate-50 pl-9 text-base sm:text-sm"/></div><Button variant="outline" className="h-11 shrink-0 gap-2 sm:hidden" aria-expanded={showFilters} aria-controls={'item-filters-'+filter} onClick={()=>setShowFilters(value=>!value)}><SlidersHorizontal size={16}/>{ui('Filters')}{activeFilters>0&&<span className="rounded-full bg-green-100 px-1.5 text-green-900">{activeFilters}</span>}</Button>{hasFilters&&<Button type="button" variant="ghost" className="h-11 shrink-0 px-2 text-xs" onClick={clear}>{ui('Clear filters')}</Button>}</div>
      <div id={'item-filters-'+filter} className={(showFilters?'grid':'hidden')+' grid-cols-2 gap-2 sm:flex sm:flex-wrap [&>select]:h-11 [&>select]:min-w-0 [&>select]:w-full sm:[&>select]:w-auto'}>
        {filter!=='all' && <select aria-label={ui(packaging?'Packaging type':'Item group')} value={group} onChange={e=>{update(setGroup,e.target.value);setFlavor('');setSize('');}} className="h-10 max-w-full rounded-md border bg-white px-3 text-sm"><option value="">{ui(packaging?'All packaging types':'All groups')}</option>{groups.map(value=><option key={value}>{value}</option>)}</select>}
        {(finished||packaging) && <><select aria-label={ui('Flavour')} value={flavor} onChange={e=>{update(setFlavor,e.target.value);setSize('');}} className="h-10 max-w-full rounded-md border bg-white px-3 text-sm"><option value="">{ui('All flavours')}</option>{flavors.map(value=><option key={value} value={value}>{ui(flavourChoice(value)?.label || value)}</option>)}</select><select aria-label={ui('Size')} value={size} onChange={e=>update(setSize,e.target.value)} className="h-10 max-w-full rounded-md border bg-white px-3 text-sm"><option value="">{ui('All sizes')}</option>{sizes.map(value=><option key={value}>{value}</option>)}</select></>}
      </div>
      <div className={showFilters?'':'hidden sm:block'}><ItemAttributeFilters facets={facets} selected={attributes} onChange={value=>update(setAttributes,value)}/></div>
    </div>
    {!filtered.length && <div className="rounded-xl border border-dashed bg-white p-8 text-center text-sm text-slate-500">{ui('No items match these filters.')}{hasFilters && <Button type="button" variant="link" onClick={clear}>{ui('Clear filters')}</Button>}</div>}
    {!!visible.length && <div className={table?'divide-y rounded-xl border bg-white':'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'}>{visible.map(({item},index)=>{
        return <article key={item.id} className={table?'flex flex-wrap items-center gap-4 px-4 py-3':'group flex min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white transition-shadow hover:shadow-md'}>
          <button type="button" disabled={!onEdit} onClick={()=>onEdit(item)} aria-label={ui('Open {0}',item.name)} title={item.name} className={table?'flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default':'flex w-full flex-col text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-green-600 disabled:cursor-default'}>
            {table?<ProductThumb product={item} name={item.name} size={56}/>:<div className="relative w-full"><ProductPhoto product={item} name={item.name} priority={index<2} className="aspect-[4/3] w-full" imageClassName="p-2 sm:p-3 transition-transform duration-200 motion-safe:group-hover:scale-105" sizes="(min-width: 1280px) 220px, (min-width: 1024px) 22vw, (min-width: 640px) 30vw, 45vw"/></div>}
            <span className={table?'min-w-0':'block w-full min-w-0 px-2 pb-2 pt-3 sm:px-3'}><span className="block break-words text-sm font-semibold leading-5 text-slate-900">{inventoryDisplayName(item)}</span></span>
          </button>
          <div className={table?'w-full sm:w-auto sm:min-w-40':'flex min-w-0 flex-1 flex-col px-3 pb-3'}>
            {item.inventory_type!=='service' && <p aria-label={ui('Quantity for {0}',item.name)} className="mb-3 flex flex-wrap items-baseline gap-1.5 text-xl sm:text-2xl font-bold tabular-nums leading-tight text-green-800"><span>{formatQuantity(quantities.get(item.id)||0)}</span>{' '}<span className="text-sm font-normal text-slate-500">{stockUnit(item)}</span></p>}
            {(item.configuration_status==='draft'||item.is_active===false)&&<p className="mb-2 text-xs text-slate-800">{ui(itemAvailabilityLabel(item))}</p>}
            <div className={table?'min-w-0 sm:min-w-56':'mt-auto border-t border-slate-100 pt-3 [&_button]:min-h-10'}>{renderDetails?.(item)}</div>
          </div>
        </article>;
      })}</div>}
    <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500"><span aria-live="polite">{ui('Showing {0}–{1} of {2} items',ordered.length?offset+1:0,offset+visible.length,ordered.length)}</span><nav aria-label={ui('Inventory pages')} className="flex items-center gap-2"><Button variant="outline" size="sm" aria-label={ui('Previous item page')} disabled={currentPage===1} onClick={()=>setPage(currentPage-1)}>{ui('Previous')}</Button><span>{ui('Page {0} of {1}',currentPage,pages)}</span><Button variant="outline" size="sm" aria-label={ui('Next item page')} disabled={currentPage===pages} onClick={()=>setPage(currentPage+1)}>{ui('Next')}</Button></nav></div>
  </div>;
}
