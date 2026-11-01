import React, {useMemo, useState} from 'react';
import {ChevronDown, Search, CalendarClock} from 'lucide-react';
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
  return <div className="space-y-3 border-t bg-slate-50/70 p-3 sm:p-4">
    <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
      <span>{ui('On hand')}: <strong>{formatNumber(group.quantity, 3)} {unit}</strong></span>
      <span>{ui('Available in company stock')}: <strong>{formatNumber(group.available, 3)} {unit}</strong></span>
    </div>
    {group.issues && <p role="alert" className="text-sm text-red-700">{ui('Some stock records need reconciliation. Ask a top administrator to review the count.')}</p>}
    {group.rows.some(row => row.expiryMissing && row.available > 0) && <p className="text-xs text-amber-800">{ui('Some available stock has no verified expiry. Check it before supply.')}</p>}
    <p className="text-xs text-slate-500">{ui('Lots are ordered by expiry. Prioritize available dated lots; verify missing expiry dates before supply.')}</p>
    <div className="max-h-[55dvh] space-y-2 overflow-y-auto overscroll-contain" tabIndex={0} aria-label={ui('Remaining batches for {0}', group.product.name)}>
      {group.rows.map(row => <article key={row.id} className="rounded-xl border bg-white p-3 text-sm">
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
  const date = businessDate();
  const groups = useMemo(() => stockOnHandGroups(products, balances, warehouses, {warehouseId, search, expiry, date}), [products, balances, warehouses, warehouseId, search, expiry, date]);
  const pages = Math.max(1, Math.ceil(groups.length / PAGE_SIZE)), currentPage = Math.min(page, pages);
  const filtered = search.trim() || expiry !== 'all';
  return <div className="min-w-0 space-y-3">
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
      <label className="relative min-w-0"><Search className="pointer-events-none absolute left-3 top-3.5 text-slate-400" size={16}/><input aria-label={ui('Search items, lots or batches')} placeholder={ui('Search items, lots or batches')} value={search} onChange={event => {setSearch(event.target.value); setPage(1);}} className="h-11 w-full min-w-0 rounded-xl border bg-white pl-9 pr-3 text-sm"/></label>
      <select aria-label={ui('Expiry window')} value={expiry} onChange={event => {setExpiry(event.target.value); setPage(1);}} className="h-11 min-w-0 max-w-full rounded-xl border bg-white px-3 text-sm">
        <option value="all">{ui('All expiry dates')}</option><option value="7">{ui('Expires within 7 days')}</option><option value="30">{ui('Expires within 30 days')}</option><option value="expired">{ui('Expired')}</option><option value="undated">{ui('Expiry missing')}</option>
      </select>
    </div>
    <p className="flex items-start gap-2 text-xs text-slate-500"><CalendarClock size={16} className="shrink-0"/>{ui('Open an item to see remaining quantities by lot, expiry and location. Earliest available expiry appears first.')}</p>
    {filtered && <p role="status" className="text-xs text-slate-600">{ui('Quantities below include only matching lots.')}</p>}
    {!groups.length && <p role="status" className="rounded-xl border bg-white p-6 text-sm text-slate-500">{ui('No remaining stock matches these filters.')}</p>}
    <div className="space-y-2">{groups.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE).map(group => {
      const open = expanded === group.product.id;
      return <section key={group.product.id} className="min-w-0 overflow-hidden rounded-2xl border bg-white">
        <button type="button" aria-label={ui('Stock details for {0}', group.product.name)} aria-expanded={open} aria-controls={'stock-details-' + group.product.id} onClick={() => setExpanded(open ? null : group.product.id)} className="flex min-h-16 w-full min-w-0 items-center gap-3 p-3 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary sm:p-4">
          <ProductThumb product={group.product} size={40}/><span className="min-w-0 flex-1 break-words font-semibold text-slate-900">{group.product.name}</span>
          <span className="hidden text-right text-sm text-slate-600 xl:block">{formatNumber(group.quantity, 3)} {stockUnit(group.product)}<span className="block text-xs">{group.nextExpiry ? ui('Next expiry: {0}', formatDate(group.nextExpiry)) : ui('View batches')}</span></span>
          <ChevronDown size={18} className={'shrink-0 text-slate-500 transition-transform ' + (open ? 'rotate-180' : '')}/>
        </button>
        {open && <div id={'stock-details-' + group.product.id}><BatchDetails group={group}/></div>}
      </section>;
    })}</div>
    {groups.length > PAGE_SIZE && <div className="flex items-center justify-between gap-2 text-sm"><Button variant="outline" disabled={currentPage <= 1} onClick={() => {setPage(currentPage - 1); setExpanded(null);}}>{ui('Previous')}</Button><span>{ui('Page {0} of {1}', currentPage, pages)}</span><Button variant="outline" disabled={currentPage >= pages} onClick={() => {setPage(currentPage + 1); setExpanded(null);}}>{ui('Next')}</Button></div>}
  </div>;
}
