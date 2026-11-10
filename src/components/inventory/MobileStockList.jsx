import React from 'react';
import { ChevronRight } from 'lucide-react';
import ProductThumb from '@/components/shared/ProductThumb';
import { inventoryDisplayName } from '@/lib/inventory-groups';
import { formatQuantity } from '@/lib/formatters';
import { stockUnit } from '@/lib/item-units';
import { ui } from '@/lib/i18n';

// Small photos and a single, tappable row keep the stock list easy to scan.
// Quantity remains the catalogue's checked on-hand figure, including zero stock.
export default function MobileStockList({ rows, quantities, expanded, onOpen, renderActions }) {
  return <div data-mobile-stock-list className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-white">
    {rows.map(({item,variant})=><article data-stock-row key={item.id}>
      <button type="button" aria-label={ui('Item details for {0}',item.name)} aria-haspopup="dialog" aria-expanded={expanded===item.id} onClick={event=>onOpen(item,event.currentTarget)} className="flex min-h-[88px] w-full min-w-0 items-center gap-3 px-3 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
        <ProductThumb product={item} name={item.name} size={48}/>
        <span className="min-w-0 flex-1">
          <span className="block break-words text-sm font-semibold leading-5 text-foreground">{inventoryDisplayName(item,{includeSize:false})}</span>
          <span className="mt-1 block text-xs leading-4 text-muted-foreground">{variant.size || item.sku || stockUnit(item)}</span>
        </span>
        {item.inventory_type!=='service'&&<span aria-label={ui('Quantity for {0}',item.name)} className="max-w-[30%] shrink-0 text-right">
          <span className="block break-words text-base font-bold leading-5 tabular-nums text-foreground">{formatQuantity(quantities.get(item.id)||0)}</span>
          <span className="mt-1 block break-words text-[11px] leading-4 text-muted-foreground">{ui('In stock')} · {ui(stockUnit(item))}</span>
        </span>}
        <ChevronRight size={16} className="shrink-0 text-slate-400" aria-hidden="true"/>
      </button>
      {renderActions&&<div className="grid grid-cols-2 gap-2 border-t border-border px-3 py-2 [&>button]:min-h-11">{renderActions(item)}</div>}
    </article>)}
  </div>;
}
