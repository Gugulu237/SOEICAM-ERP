import {compareProductSizes,sortProductRows} from '@/lib/product-sorting';
import ProductSortSelect from '@/components/shared/ProductSortSelect';
import React, { useMemo, useState } from 'react';
import { SlidersHorizontal, Search, ChevronDown, Pencil } from 'lucide-react';
import {useCatalogueColumns} from '@/hooks/useCatalogueColumns';
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
// Cards never change size when selected. Each responsive row owns a separate
// action strip; retaining its last item lets the height animate when closing.
function CatalogueRow({items,expanded,onToggle,quantities,onEdit,renderDetails,renderActions,table,panelId,firstIndex}) {
  const [lastItemId,setLastItemId]=useState(null);
  const current=items.find(row=>row.item.id===expanded),open=!!current;
  const selected=current||items.find(row=>row.item.id===lastItemId);
  const item=selected?.item,actions=item?renderActions?.(item):null;
  return <div className="min-w-0">
    <div className={table?'':'grid grid-cols-2 items-start gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'}>{items.map(({item,variant},index)=>{
      const active=expanded===item.id;
      return <article key={item.id} className={table?'min-w-0 overflow-hidden':'group min-w-0 overflow-hidden rounded-2xl border bg-white transition-colors '+(active?'border-primary ring-1 ring-primary/20':'border-slate-200 hover:border-primary/40')}>
        <button type="button" onClick={()=>{setLastItemId(item.id);onToggle(active?null:item.id);}} aria-expanded={active} aria-controls={panelId} aria-label={ui('Item details for {0}',item.name)} title={item.name} className={'relative flex w-full min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary '+(table?'items-center gap-3 p-3 sm:p-4':'flex-col')}>
          {table?<ProductThumb product={item} name={item.name} size={56}/>:<div className="relative w-full"><ProductPhoto product={item} name={item.name} priority={firstIndex+index<2} className="aspect-[4/3] w-full" imageClassName="p-2 sm:p-3" sizes="(min-width: 1280px) 220px, (min-width: 1024px) 22vw, (min-width: 640px) 30vw, 45vw"/></div>}
          <span className={table?'min-w-0 flex-1':'block w-full min-w-0 px-3 pb-3 pt-2'}>
            <span className="block break-words text-sm font-semibold leading-5 text-slate-900">{inventoryDisplayName(item,{includeSize:false})}</span>
            {variant.size&&<span className="mt-0.5 block text-xs font-medium text-slate-500">{variant.size}</span>}
            {item.inventory_type!=='service'&&<span aria-label={ui('Quantity for {0}',item.name)} className="mt-2 flex flex-wrap items-baseline gap-1 pr-5 text-lg font-bold tabular-nums leading-tight text-primary"><span>{formatQuantity(quantities.get(item.id)||0)}</span>{' '}<span className="text-xs font-normal text-slate-500">{stockUnit(item)}</span></span>}
          </span>
          <ChevronDown size={16} aria-hidden="true" className={'shrink-0 text-slate-400 transition-transform motion-reduce:transition-none '+(active?'rotate-180 ':'')+(table?'':'absolute bottom-3 right-2')}/>
        </button>
      </article>;
    })}</div>
    <div id={panelId} data-item-action-row data-open={open} aria-hidden={!open} inert={!open} className="grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none" style={{gridTemplateRows:open?'1fr':'0fr',opacity:open?1:0}} onTransitionEnd={event=>{if(event.target===event.currentTarget&&!open)setLastItemId(null);}}>
      <div className="min-h-0 overflow-hidden">{item&&<div className="pt-2"><div className="space-y-2 rounded-xl border border-primary/20 bg-primary/5 p-2 sm:p-3">
        {(item.configuration_status==='draft'||item.is_active===false)&&<p className="text-xs text-slate-700">{ui(itemAvailabilityLabel(item))}</p>}
        {renderDetails?.(item)}
        {(actions||onEdit)&&<div aria-label={ui('Actions for {0}',item.name)} className={'grid gap-2 [&_button]:min-h-11 [&_button]:w-full '+(actions&&onEdit?'grid-cols-2':'grid-cols-1')}>
          {actions}
          {onEdit&&<Button type="button" variant="outline" className="h-auto min-w-0 gap-1.5 whitespace-normal px-2 py-2 text-xs sm:text-sm" aria-label={ui('Edit item details for {0}',item.name)} onClick={()=>onEdit(item)}><Pencil size={15} className="shrink-0"/>{ui('Edit item details')}</Button>}
        </div>}
      </div></div>}</div>
    </div>
  </div>;
}

// Resolve photo-derived labels and searchable metadata once per catalogue update.
// The page mounts at most 25 cards, including their lazy images/editors.
export default function GroupedItems({ products, filter, quantities, onEdit, renderDetails, renderActions, table = false }) {
  const [search,setSearch] = usePageState('inventory:'+filter+':search',''), [group,setGroup] = usePageState('inventory:'+filter+':group',''), [flavor,setFlavor] = usePageState('inventory:'+filter+':flavor',''), [size,setSize] = usePageState('inventory:'+filter+':size',''), [attributes,setAttributes] = usePageState('inventory:'+filter+':attributes',{}), [page,setPage] = usePageState('inventory:'+filter+':page',1);
  const [sort,setSort]=usePageState('inventory:'+filter+':sort','name');
  const [showFilters,setShowFilters]=useState(false),[expanded,setExpanded]=useState(null);
  const columns=useCatalogueColumns(table);
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
  const ordered = sortProductRows(filtered,sort,row=>({...row.item,size:row.variant.size,flavor:row.variant.flavor==='Flavour not assigned'?'':row.variant.flavor}));
  const pages=Math.max(1,Math.ceil(ordered.length/25)),currentPage=Math.min(page,pages),offset=(currentPage-1)*25;
  const visible=ordered.slice(offset,offset+25),displayRows=[];
  for(let index=0;index<visible.length;index+=columns)displayRows.push(visible.slice(index,index+columns));
  const update = (setter,value) => {setter(value);setPage(1);setExpanded(null);};
  const hasFilters=!!(search || group || flavor || size || Object.keys(attributes).length);
  const activeFilters=[group,flavor,size,...Object.values(attributes)].filter(Boolean).length;
  const clear=()=>{setSearch('');setGroup('');setFlavor('');setSize('');setAttributes({});setPage(1);setExpanded(null);};
  return <div className="space-y-4">
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
      <div className="flex min-w-0 items-center gap-2"><div className="relative min-w-0 flex-1"><Search size={17} aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 text-slate-400"/><Input aria-label={ui('Search items')} placeholder={ui('Search items')} value={search} onChange={e=>update(setSearch,e.target.value)} className="h-11 min-w-0 bg-slate-50 pl-9 text-base sm:text-sm"/></div><Button variant="outline" className="h-11 shrink-0 gap-2 xl:hidden" aria-expanded={showFilters} aria-controls={'item-filters-'+filter} onClick={()=>setShowFilters(value=>!value)}><SlidersHorizontal size={16}/>{ui('Filters')}{activeFilters>0&&<span className="rounded-full bg-green-100 px-1.5 text-green-900">{activeFilters}</span>}</Button>{hasFilters&&<Button type="button" variant="ghost" className="h-11 shrink-0 px-2 text-xs" onClick={clear}>{ui('Clear filters')}</Button>}</div>
      <ProductSortSelect value={sort} onChange={value=>update(setSort,value)} className="sm:max-w-xs"/>
      <div id={'item-filters-'+filter} className={(showFilters?'grid':'hidden')+' grid-cols-2 gap-2 xl:flex xl:flex-wrap [&>select]:h-11 [&>select]:min-w-0 [&>select]:w-full xl:[&>select]:w-auto'}>
        {filter!=='all' && <select aria-label={ui(packaging?'Packaging type':'Item group')} value={group} onChange={e=>{update(setGroup,e.target.value);setFlavor('');setSize('');}} className="h-10 max-w-full rounded-md border bg-white px-3 text-sm"><option value="">{ui(packaging?'All packaging types':'All groups')}</option>{groups.map(value=><option key={value}>{value}</option>)}</select>}
        {(finished||packaging) && <><select aria-label={ui('Flavour')} value={flavor} onChange={e=>{update(setFlavor,e.target.value);setSize('');}} className="h-10 max-w-full rounded-md border bg-white px-3 text-sm"><option value="">{ui('All flavours')}</option>{flavors.map(value=><option key={value} value={value}>{ui(flavourChoice(value)?.label || value)}</option>)}</select><select aria-label={ui('Size')} value={size} onChange={e=>update(setSize,e.target.value)} className="h-10 max-w-full rounded-md border bg-white px-3 text-sm"><option value="">{ui('All sizes')}</option>{sizes.map(value=><option key={value}>{value}</option>)}</select></>}
      </div>
      <div className={showFilters?'':'hidden xl:block'}><ItemAttributeFilters facets={facets} selected={attributes} onChange={value=>update(setAttributes,value)}/></div>
    </div>
    {!filtered.length && <div className="rounded-xl border border-dashed bg-white p-8 text-center text-sm text-slate-500">{ui('No items match these filters.')}{hasFilters && <Button type="button" variant="link" onClick={clear}>{ui('Clear filters')}</Button>}</div>}
    {!!visible.length && <div className={table?'divide-y rounded-xl border bg-white':'space-y-3'}>{displayRows.map((items,index)=><CatalogueRow key={items.map(row=>row.item.id).join(':')} items={items} expanded={expanded} onToggle={setExpanded} quantities={quantities} onEdit={onEdit} renderDetails={renderDetails} renderActions={renderActions} table={table} firstIndex={index*columns} panelId={'catalogue-actions-'+filter+'-'+index}/>)}</div>}
    <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500"><span aria-live="polite">{ui('Showing {0}–{1} of {2} items',ordered.length?offset+1:0,offset+visible.length,ordered.length)}</span><nav aria-label={ui('Inventory pages')} className="flex items-center gap-2"><Button variant="outline" size="sm" aria-label={ui('Previous item page')} disabled={currentPage===1} onClick={()=>{setPage(currentPage-1);setExpanded(null);}}>{ui('Previous')}</Button><span>{ui('Page {0} of {1}',currentPage,pages)}</span><Button variant="outline" size="sm" aria-label={ui('Next item page')} disabled={currentPage===pages} onClick={()=>{setPage(currentPage+1);setExpanded(null);}}>{ui('Next')}</Button></nav></div>
  </div>;
}
