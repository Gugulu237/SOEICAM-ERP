import {sortProductRows} from '@/lib/product-sorting';
import ProductSortSelect from '@/components/shared/ProductSortSelect';
import React, {useMemo, useRef, useState} from 'react';
import {Search} from 'lucide-react';
import ProductQuickView from '@/components/shared/ProductQuickView';
import {stockOnHandGroups} from '@/lib/stock-on-hand';
import {stockUnit} from '@/lib/item-units';
import {businessDate} from '@/lib/business-date';
import {formatDate, formatNumber} from '@/lib/formatters';
import {ui} from '@/lib/i18n';
import ProductThumb from '@/components/shared/ProductThumb';
import {Button} from '@/components/ui/button';

const PAGE_SIZE = 20;
function BatchDetails({group}) {
  const unit = stockUnit(group.product);
  return <div className="space-y-3">
    <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
      <span>{ui('On hand')}: <strong>{formatNumber(group.quantity, 3)} {unit}</strong></span>
      <span>{ui('Available in company stock')}: <strong>{formatNumber(group.available, 3)} {unit}</strong></span>
    </div>
    {group.issues && <p role="alert" className="text-sm text-red-700">{ui('Some stock records need reconciliation. Ask a top administrator to review the count.')}</p>}
    {group.rows.some(row => row.expiryMissing && row.available > 0) && <p className="text-xs text-amber-800">{ui('Some available stock has no verified expiry. Check it before supply.')}</p>}
    <div className="space-y-2" aria-label={ui('Remaining batches for {0}', group.product.name)}>
      {group.rows.map(row => <article key={row.id} className="rounded-lg border bg-white p-2 text-xs">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1 break-words"><p className="font-semibold">{ui('Lot')}: {row.lot_number || ui('Not recorded')}</p><p className="text-xs text-slate-600">{ui('Production batch')}: {row.batch_number || ui('Not recorded')}</p>{!row.batch_number && row.production_order_id && <p className="text-xs text-slate-500">{ui('Production record')}: {row.production_order_id}</p>}</div>
          <strong className="text-right">{row.quantity === null ? ui('Invalid quantity') : formatNumber(row.quantity, 3)} {unit}</strong>
        </div>
        <div className="mt-2 grid gap-1 text-xs text-slate-600 sm:grid-cols-2">
          <p className="break-words">{ui('Location')}: {row.warehouse_name === 'Unknown location' ? ui('Unknown location') : row.warehouse_name}</p>
          <p>{ui('Expiry')}: {row.expiryValid ? formatDate(row.expiry_date) : ui('Not recorded')}{row.daysLeft !== null && !row.expired && <span> · {row.daysLeft === 0 ? ui('Expires today') : ui('{0} days left', row.daysLeft)}</span>}</p>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <span className={'rounded-full px-2 py-1 text-xs font-medium ' + (row.expired || row.countIssue || row.status === 'Rejected' ? 'bg-red-50 text-red-800' : row.status !== 'Available' || row.daysLeft !== null && row.daysLeft <= 7 ? 'bg-amber-50 text-amber-900' : 'bg-green-50 text-green-800')}>{ui(row.status)}</span>
          {row.priorityQuantity > 0 && row.expiry_date === group.nextExpiry && <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary">{ui('Send first')}</span>}
          {row.expired && <span className="self-center text-xs text-red-700">{ui('Do not supply')}</span>}
        </div>
      </article>)}
    </div>
  </div>;
}

export default function StockOnHand({products, balances, warehouses, warehouseId = ''}) {
  const [search, setSearch] = useState(''), [expiry, setExpiry] = useState('all'), [expanded, setExpanded] = useState(null), [page, setPage] = useState(1);
  const [sort,setSort]=useState('name');
  const anchor=useRef(null);
  const date = businessDate();
  const matching = useMemo(() => stockOnHandGroups(products, balances, warehouses, {warehouseId, search, expiry, date}), [products, balances, warehouses, warehouseId, search, expiry, date]);
  const groups=sortProductRows(matching,sort,row=>row.product);
  const selected=groups.find(group=>group.product.id===expanded);
  const pages = Math.max(1, Math.ceil(groups.length / PAGE_SIZE)), currentPage = Math.min(page, pages);
  const filtered = search.trim() || expiry !== 'all';
  return <div className="min-w-0 space-y-3">
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
      <label className="relative min-w-0"><Search className="pointer-events-none absolute left-3 top-3.5 text-slate-400" size={16}/><input aria-label={ui('Search items, lots or batches')} placeholder={ui('Search items, lots or batches')} value={search} onChange={event => {setSearch(event.target.value); setPage(1);}} className="h-11 w-full min-w-0 rounded-xl border bg-white pl-9 pr-3 text-sm"/></label>
      <select aria-label={ui('Expiry window')} value={expiry} onChange={event => {setExpiry(event.target.value); setPage(1);}} className="h-11 min-w-0 max-w-full rounded-xl border bg-white px-3 text-sm">
        <option value="all">{ui('All expiry dates')}</option><option value="7">{ui('Expires within 7 days')}</option><option value="30">{ui('Expires within 30 days')}</option><option value="expired">{ui('Expired')}</option><option value="undated">{ui('Expiry missing')}</option>
      </select>
    </div>
    <ProductSortSelect value={sort} onChange={value=>{setSort(value);setPage(1);setExpanded(null);}} className="sm:max-w-xs"/>
    <p className="sr-only">{ui('Open an item to see remaining quantities by lot, expiry and location. Earliest available expiry appears first.')}</p>
    {filtered && <p role="status" className="text-xs text-slate-600">{ui('Quantities below include only matching lots.')}</p>}
    {!groups.length && <p role="status" className="rounded-xl border bg-white p-6 text-sm text-slate-500">{ui('No remaining stock matches these filters.')}</p>}
    <div className="space-y-2">{groups.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE).map(group => {
      const open = expanded === group.product.id;
      return <section key={group.product.id} className="min-w-0 overflow-hidden rounded-2xl border bg-white">
        <button type="button" aria-label={ui('Stock details for {0}', group.product.name)} aria-haspopup="dialog" aria-expanded={open} onClick={event=>{anchor.current=event?.currentTarget;setExpanded(group.product.id);}} className="flex min-h-16 w-full min-w-0 items-center gap-2 p-2.5 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
          <ProductThumb product={group.product} size={36}/><span className="min-w-0 flex-1 break-words text-sm font-semibold text-slate-900">{group.product.name}</span>
          <span className="max-w-[35%] shrink-0 break-words text-right text-sm font-semibold text-primary">{formatNumber(group.quantity, 3)} <span className="text-xs font-normal">{stockUnit(group.product)}</span></span>
        </button>
      </section>;
    })}</div>
    {selected&&<ProductQuickView title={selected.product.name} focusRef={anchor} onClose={()=>setExpanded(null)}><BatchDetails group={selected}/></ProductQuickView>}
    {groups.length > PAGE_SIZE && <div className="flex items-center justify-between gap-2 text-sm"><Button variant="outline" disabled={currentPage <= 1} onClick={() => {setPage(currentPage - 1); setExpanded(null);}}>{ui('Previous')}</Button><span>{ui('Page {0} of {1}', currentPage, pages)}</span><Button variant="outline" disabled={currentPage >= pages} onClick={() => {setPage(currentPage + 1); setExpanded(null);}}>{ui('Next')}</Button></div>}
  </div>;
}
