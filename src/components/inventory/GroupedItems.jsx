import { usePhoneLayout } from '@/hooks/usePhoneLayout';
import MobileStockList from './MobileStockList';
import {compareProductSizes,sortProductRows} from '@/lib/product-sorting';
import ProductSortSelect from '@/components/shared/ProductSortSelect';
import React, { useMemo, useRef, useState } from 'react';
import { SlidersHorizontal, Search, Pencil } from 'lucide-react';
import ProductQuickView from '@/components/shared/ProductQuickView';
import { usePageState } from '@/lib/navigation-context';
import { itemAvailabilityLabel } from '@/lib/item-readiness';
import { ui,getLocale } from '@/lib/i18n';
import { inventoryGroup, inventoryVariants, inventoryGroups, inventoryDisplayName } from '@/lib/inventory-groups';
import {packagingGroup,packagingVariants} from '@/lib/inventory-packaging';
import { normalizeProductText } from '@/lib/product-images';
import { stockUnit } from '@/lib/item-units';
import { formatQuantity, formatXAF } from '@/lib/formatters';
import ProductThumb, { ProductPhoto } from '@/components/shared/ProductThumb';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { attributeFacets, itemSearchText, matchesAttributes } from '@/lib/item-attributes';
import { PRODUCT_FLAVOURS, flavourChoice, productSizeChoices } from '@/lib/product-variants';
import ItemAttributeFilters from '@/components/items/ItemAttributeFilters';

const normalize = value => normalizeProductText(value).trim().replace(/\s+/g,' ');
// Resolve photo-derived labels and searchable metadata once per catalogue update.
// The page mounts at most 25 cards, including their lazy images/editors.
export default function GroupedItems({ products, filter, quantities, balances, onEdit, renderDetails, renderActions, table = false }) {
  const phone=usePhoneLayout();
  const [search,setSearch] = usePageState('inventory:'+filter+':search',''), [group,setGroup] = usePageState('inventory:'+filter+':group',''), [flavor,setFlavor] = usePageState('inventory:'+filter+':flavor',''), [size,setSize] = usePageState('inventory:'+filter+':size',''), [attributes,setAttributes] = usePageState('inventory:'+filter+':attributes',{}), [page,setPage] = usePageState('inventory:'+filter+':page',1);
  const [sort,setSort]=usePageState('inventory:'+filter+':sort','name');
  const [showFilters,setShowFilters]=useState(false),[expanded,setExpanded]=useState(null);
  const anchor=useRef(null);
  const finished = filter === 'finished',packaging = filter === 'packaging';
  const rows = useMemo(() => products.map(item => {const variant=packaging?packagingVariants(item):inventoryVariants(item);return {item,variant,group:packaging?packagingGroup(item):inventoryGroup(item),search:normalize(itemSearchText(item)+' '+variant.flavor+' '+(flavourChoice(variant.flavor)?.label || '')+' '+variant.size)};}),[products,packaging]);
  const groups = useMemo(() => packaging?[...new Set(rows.map(row=>row.group))].sort((a,b)=>a.localeCompare(b)):filter==='all'?[...inventoryGroups(products,true),...inventoryGroups(products,false)]:inventoryGroups(products, finished).filter(group=>rows.some(row=>row.group===group)), [products,finished,filter,packaging,rows]);
  const flavors = useMemo(() => [...new Set([...(finished?PRODUCT_FLAVOURS.map(option=>option.value):[]),...rows.filter(r=>!group || r.group===group).map(r=>r.variant.flavor).filter(Boolean)])], [rows,group,finished]);
  const sizes = useMemo(() => [...new Set([...(finished?productSizeChoices(group):[]),...rows.filter(r=>(!group || r.group===group) && (!flavor || r.variant.flavor===flavor)).map(r=>r.variant.size).filter(Boolean)])].sort(compareProductSizes), [rows,group,flavor,finished]);
  const facets = useMemo(() => attributeFacets(products),[products]);
  const filtered = useMemo(() => {
    const terms=normalize(search).split(/\s+/).filter(Boolean);
    return rows.filter(r => (!group || r.group===group) && (!flavor || r.variant.flavor===flavor) && (!size || r.variant.size===size) && terms.every(term=>r.search.includes(term)) && matchesAttributes(r.item,attributes));
  }, [rows,group,flavor,size,search,attributes]);
  const locale=getLocale();
  const ordered = useMemo(()=>sortProductRows(filtered,sort,row=>({...row.item,size:row.variant.size,flavor:row.variant.flavor==='Flavour not assigned'?'':row.variant.flavor})),[filtered,sort,locale]);
  const pages=Math.max(1,Math.ceil(ordered.length/25)),currentPage=Math.min(page,pages),offset=(currentPage-1)*25;
  const visible=ordered.slice(offset,offset+25);
  const selected=visible.find(row=>row.item.id===expanded)?.item;
  const actions=selected?renderActions?.(selected):null;
  const update = (setter,value) => {setter(value);setPage(1);setExpanded(null);};
  const hasFilters=!!(search || group || flavor || size || Object.keys(attributes).length);
  const activeFilters=[group,flavor,size,...Object.values(attributes)].filter(Boolean).length;
  const clear=()=>{setSearch('');setGroup('');setFlavor('');setSize('');setAttributes({});setPage(1);setExpanded(null);};
  return <div className="space-y-4">
    {phone&&finished&&groups.length>1&&<nav aria-label={ui('Product types')} className="flex gap-2 overflow-x-auto pb-1">{['',...groups].map(value=><button key={value} type="button" aria-pressed={group===value} onClick={()=>{update(setGroup,value);setFlavor('');setSize('');}} className={'min-h-11 shrink-0 rounded-lg border px-3 text-xs font-semibold '+(group===value?'border-primary bg-primary text-white':'bg-white')}>{value||ui('All types')}</button>)}</nav>}
    <div className={phone?"space-y-3":"space-y-3 rounded-xl border border-slate-200 bg-white p-3 sm:p-4"}>
      <div className="flex min-w-0 items-center gap-2"><div className="relative min-w-0 flex-1"><Search size={17} aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 text-slate-400"/><Input aria-label={ui('Search items')} placeholder={ui('Search items')} value={search} onChange={e=>update(setSearch,e.target.value)} className="h-11 min-w-0 bg-white pl-9 text-base sm:bg-slate-50 sm:text-sm"/></div><Button variant="outline" className="h-11 shrink-0 gap-2 xl:hidden" aria-label={ui('Filters')} aria-expanded={showFilters} aria-controls={'item-filters-'+filter} onClick={()=>setShowFilters(value=>!value)}><SlidersHorizontal size={16}/><span className="hidden min-[390px]:inline">{ui('Filters')}</span>{activeFilters>0&&<span className="rounded-full bg-green-100 px-1.5 text-green-900">{activeFilters}</span>}</Button>{hasFilters&&!phone&&<Button type="button" variant="ghost" className="h-11 shrink-0 px-2 text-xs" onClick={clear}>{ui('Clear filters')}</Button>}</div>
      {(!phone||showFilters)&&<ProductSortSelect value={sort} onChange={value=>update(setSort,value)} className="sm:max-w-xs"/>}
      {phone&&showFilters&&hasFilters&&<Button type="button" variant="ghost" className="min-h-11 px-0 text-xs" onClick={clear}>{ui('Clear filters')}</Button>}
      <div id={'item-filters-'+filter} className={(showFilters?'grid':'hidden')+' grid-cols-2 gap-2 xl:flex xl:flex-wrap [&>select]:h-11 [&>select]:min-w-0 [&>select]:w-full xl:[&>select]:w-auto'}>
        {filter!=='all' && <select aria-label={ui(packaging?'Packaging type':'Item group')} value={group} onChange={e=>{update(setGroup,e.target.value);setFlavor('');setSize('');}} className="h-10 max-w-full rounded-md border bg-white px-3 text-sm"><option value="">{ui(packaging?'All packaging types':'All groups')}</option>{groups.map(value=><option key={value}>{value}</option>)}</select>}
        {(finished||packaging) && <><select aria-label={ui('Flavour')} value={flavor} onChange={e=>{update(setFlavor,e.target.value);setSize('');}} className="h-10 max-w-full rounded-md border bg-white px-3 text-sm"><option value="">{ui('All flavours')}</option>{flavors.map(value=><option key={value} value={value}>{ui(flavourChoice(value)?.label || value)}</option>)}</select><select aria-label={ui('Size')} value={size} onChange={e=>update(setSize,e.target.value)} className="h-10 max-w-full rounded-md border bg-white px-3 text-sm"><option value="">{ui('All sizes')}</option>{sizes.map(value=><option key={value}>{value}</option>)}</select></>}
      </div>
      <div className={showFilters?'':'hidden xl:block'}><ItemAttributeFilters facets={facets} selected={attributes} onChange={value=>update(setAttributes,value)}/></div>
    </div>
    {!filtered.length && <div className="rounded-xl border border-dashed bg-white p-8 text-center text-sm text-slate-500">{ui('No items match these filters.')}{hasFilters && <Button type="button" variant="link" onClick={clear}>{ui('Clear filters')}</Button>}</div>}
    {!!visible.length&&(phone?<MobileStockList rows={visible} quantities={quantities} balances={balances} expanded={expanded} onOpen={(item,element)=>{anchor.current=element;setExpanded(item.id);}}/>:<div className={table?'divide-y rounded-xl border bg-white':'grid grid-cols-2 items-stretch gap-3 md:grid-cols-3 xl:grid-cols-4'}>
      {visible.map(({item,variant},index)=><article data-stock-card key={item.id} className={table?'min-w-0':'min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white'}>
        <button type="button" aria-label={ui('Item details for {0}',item.name)} aria-haspopup="dialog" aria-expanded={expanded===item.id} onClick={event=>{anchor.current=event?.currentTarget;setExpanded(item.id);}} title={item.name} className={'flex w-full min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary '+(table?'items-center gap-3 p-3':'h-full flex-col')}>
          {table?<ProductThumb product={item} name={item.name} size={48}/>:<ProductPhoto product={item} name={item.name} priority={index<2} className="h-28 w-full bg-slate-50 sm:h-36" imageClassName="p-3" sizes="(min-width: 1280px) 22vw, (min-width: 768px) 30vw, 45vw"/>}
          <span className={table?'min-w-0 flex-1':'flex w-full min-w-0 flex-1 flex-col gap-3 p-3'}>
            <span className="block min-w-0">
              <span className="line-clamp-2 min-h-10 break-words text-sm font-semibold leading-5 text-slate-900 sm:text-base">{inventoryDisplayName(item,{includeSize:false})}</span>
              <span className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">{variant.size&&<span className="rounded bg-slate-100 px-2 py-0.5 font-medium text-slate-700">{variant.size}</span>}</span>
            </span>
            {item.inventory_type!=='service'?<span aria-label={ui('Quantity for {0}',item.name)} className={'block min-w-0 '+(table?'mt-2':'mt-auto')}><span className="block text-xs text-slate-500">{ui('On hand')}</span><span className="block break-words text-lg font-bold leading-6 tabular-nums text-primary">{formatQuantity(quantities.get(item.id)||0)} <span className="text-xs font-normal text-slate-500">{stockUnit(item)}</span></span></span>:!table&&<span/>}

          </span>
        </button>
      </article>)}
    </div>)}
    {selected&&<ProductQuickView title={selected.name} focusRef={anchor} onClose={()=>setExpanded(null)}>
      <dl className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 text-xs">
        {selected.inventory_type!=='service'&&<><dt className="text-slate-500">{ui('On hand')}</dt><dd className="text-right font-semibold">{formatQuantity(quantities.get(selected.id)||0)} {stockUnit(selected)}</dd></>}
        <dt className="text-slate-500">{ui('Code')}</dt><dd className="break-words text-right">{selected.sku||ui('Not recorded')}</dd>
        {Number(selected.selling_price)>0&&<><dt className="text-slate-500">{ui('Sales price')}</dt><dd className="text-right font-semibold">{formatXAF(selected.selling_price)}</dd></>}
      </dl>
      {(selected.configuration_status==='draft'||selected.is_active===false)&&<p className="text-xs text-slate-700">{ui(itemAvailabilityLabel(selected))}</p>}
      {renderDetails?.(selected)}
      {(actions||onEdit)&&<div aria-label={ui('Actions for {0}',selected.name)} className={'grid gap-2 [&_button]:min-h-11 [&_button]:w-full '+(actions&&onEdit?'grid-cols-2':'grid-cols-1')}>
        {actions}
        {onEdit&&<Button type="button" variant="outline" className="h-auto min-w-0 gap-1 whitespace-normal px-2 py-2 text-xs" aria-label={ui('Edit item details for {0}',selected.name)} onClick={()=>onEdit(selected)}><Pencil size={14} className="shrink-0"/>{ui('Edit item details')}</Button>}
      </div>}
    </ProductQuickView>}
    <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500"><span aria-live="polite">{ui('Showing {0}–{1} of {2} items',ordered.length?offset+1:0,offset+visible.length,ordered.length)}</span><nav aria-label={ui('Inventory pages')} className="flex items-center gap-2"><Button variant="outline" size="sm" aria-label={ui('Previous item page')} disabled={currentPage===1} onClick={()=>{setPage(currentPage-1);setExpanded(null);}}>{ui('Previous')}</Button><span>{ui('Page {0} of {1}',currentPage,pages)}</span><Button variant="outline" size="sm" aria-label={ui('Next item page')} disabled={currentPage===pages} onClick={()=>{setPage(currentPage+1);setExpanded(null);}}>{ui('Next')}</Button></nav></div>
  </div>;
}
