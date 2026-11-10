import React,{useMemo} from 'react';
import { ChevronRight } from 'lucide-react';
import ProductThumb from '@/components/shared/ProductThumb';
import { inventoryDisplayName } from '@/lib/inventory-groups';
import { formatDate,formatQuantity,formatXAF } from '@/lib/formatters';
import { stockUnit } from '@/lib/item-units';
import { ui } from '@/lib/i18n';
import { businessDate } from '@/lib/business-date';
import { stockExpirySummary } from '@/lib/stock-expiry-summary';
import { isPackagingItem } from '@/lib/inventory-packaging';
import { isAssemblyInventoryType } from '@/lib/item-types';

// Small photos and a single, tappable row keep the stock list easy to scan.
// Quantity remains the catalogue's checked on-hand figure, including zero stock.
export default function MobileStockList({ rows, quantities, balances=[], expanded, onOpen }) {
  const today=businessDate(),expiryByProduct=useMemo(()=>stockExpirySummary(balances,today),[balances,today]);
  const groups=[];
  for(const row of rows){const label=[row.group,row.variant.size].filter(Boolean).join(' · '),key=label||'items';let group=groups.find(group=>group.key===key);if(!group){group={key,label,rows:[]};groups.push(group);}group.rows.push(row);}
  return <div data-mobile-stock-list className="space-y-5">{groups.map(group=><section key={group.key} className="space-y-2">{group.label&&<h2 className="px-1 text-xs font-bold uppercase tracking-wide text-primary">{group.label}</h2>}<div className="divide-y divide-border overflow-hidden rounded-[22px] border border-border bg-white">
    {group.rows.map(({item,variant})=>{const expiry=expiryByProduct.get(item.id),packaging=isPackagingItem(item),finished=isAssemblyInventoryType(item.inventory_type),showExpiry=packaging||finished||!!expiry?.date;return <article data-stock-row key={item.id}>
      <button type="button" aria-label={ui('Item details for {0}',item.name)} aria-haspopup="dialog" aria-expanded={expanded===item.id} onClick={event=>onOpen(item,event.currentTarget)} className="flex min-h-[88px] w-full min-w-0 items-center gap-2 px-3 py-3 min-[360px]:gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
        <ProductThumb product={item} name={item.name} size={44}/>
        <span className="min-w-0 flex-1">
          <span className="block break-words text-sm font-semibold leading-5 text-foreground">{inventoryDisplayName(item,{includeSize:false})}</span>
          <span className="mt-1 block text-xs leading-4 text-muted-foreground">{variant.size || item.sku || stockUnit(item)}</span>
          {(Number(item.current_cost||item.purchase_price)>0||Number(item.selling_price)>0)&&<span className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1 text-[10px] leading-4 text-muted-foreground">{Number(item.current_cost||item.purchase_price)>0&&<span>{ui('Cost')}: {formatXAF(item.current_cost||item.purchase_price)}</span>}{Number(item.selling_price)>0&&<span>{ui('Selling price')}: {formatXAF(item.selling_price)}</span>}</span>}
          {item.inventory_type!=='service'&&showExpiry&&<span className={'mt-1.5 block text-[10px] leading-4 '+(!packaging&&expiry?.expired?'font-semibold text-red-700':'text-muted-foreground')}>
            {packaging?ui('No expiry required'):expiry?.date?<>{ui(expiry.expired?'Expired':'Nearest recorded expiry')}: <time dateTime={expiry.date}>{formatDate(expiry.date)}</time></>:expiry?ui('Expiry unknown'):ui('No current batch expiry')}
            {!packaging&&finished&&expiry?.date&&(expiry.invalidDates>0||expiry.missingDates>0)&&<span className="block font-normal text-muted-foreground">{ui('Some batch expiry dates are unknown.')}</span>}
          </span>}
        </span>
        {item.inventory_type!=='service'&&<span aria-label={ui('Quantity for {0}',item.name)} className="w-16 max-w-[26%] shrink-0 text-right">
          <span className="block break-words text-base font-bold leading-5 tabular-nums text-foreground">{formatQuantity(quantities.get(item.id)||0)}</span>
          <span className="mt-1 block break-words text-[11px] leading-4 text-muted-foreground">{ui('On hand')} · {ui(stockUnit(item))}</span>
        </span>}
        <ChevronRight size={16} className="shrink-0 text-slate-400" aria-hidden="true"/>
      </button>
    </article>;})}
  </div></section>)}</div>;
}
