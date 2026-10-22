
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { Fragment, useState } from 'react';
import { usePageState } from '@/lib/navigation-context';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import ProductThumb from '@/components/shared/ProductThumb';
import { formatDate, formatNumber, formatXAF } from '@/lib/formatters';
import { warehouseStockLevel } from '@/lib/warehouse-stock';
import StockLevelPill from './StockLevelPill';

export default function WarehouseStockItems({ rows, renderItemActions, onEditItem, onAdjust }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [search, setSearch] = usePageState('warehouse-stock:search', ''), [filter, setFilter] = usePageState('warehouse-stock:filter', 'all'), [expanded, setExpanded] = useState('');
  const filtered = rows.filter(row => {
    const matches = `${row.name} ${row.product?.sku || ''}`.toLowerCase().includes(search.toLowerCase());
    const level = warehouseStockLevel(row.product, row.quantity);
    return matches && (filter === 'all' || (filter === 'stock' ? row.quantity > 0 : ['empty', 'negative', 'low'].includes(level.status)));
  });
  return <section className="overflow-hidden rounded-2xl border bg-white">
    <div className="flex flex-wrap items-center gap-3 border-b p-4">
      <div className="relative min-w-48 flex-1"><Search size={16} aria-hidden="true" className="absolute left-3 top-3 text-slate-400" /><input aria-label={ui("Search warehouse items")} value={search} onChange={e => setSearch(e.target.value)} placeholder={ui("Search items or codes...")} className="h-10 w-full rounded-lg border pl-9 pr-3 text-sm" /></div>
      <select aria-label={ui("Warehouse stock status")} className="h-10 rounded-lg border bg-white px-3 text-sm" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">{ui("All items (")}{rows.length})</option><option value="stock">{ui("In stock")}</option><option value="low">{ui("Low / out of stock")}</option></select>
      <span className="text-xs text-slate-500">{filtered.length}{ui(" items")}</span>
    </div>
    <p className="border-b bg-slate-50/70 px-4 py-3 text-xs leading-5 text-slate-500">{ui("Quantities are for this warehouse only. Catalogue items remain visible at zero until stock is recorded. Each pill compares on-hand stock with the item maximum or reorder point; a striped pill means no reference is set.")}</p>
    <div className="overflow-x-auto"><table className="w-full text-left text-sm">
      <thead className="border-b text-xs text-slate-500"><tr>{['Item', ui("On hand"), 'Usable', ui("Stock value"), ''].map((label, index) => <th key={index} scope="col" className="px-4 py-3 font-medium">{label || <span className="sr-only">{ui("Item actions")}</span>}</th>)}</tr></thead>
      <tbody>{filtered.map(row => <Fragment key={row.id}>
        <tr className="border-b last:border-0">
          <th scope="row" className="min-w-64 px-4 py-4 font-normal"><div className="flex items-center gap-3"><ProductThumb product={row.product} name={row.name} size={44} /><div>{row.product && onEditItem ? <button type="button" aria-label={ui("Edit {0}",row.name)} onClick={()=>onEditItem(row.product)} className="text-left font-medium text-green-800 underline-offset-2 hover:underline">{row.name}</button> : <span className="font-medium text-slate-900">{row.name}</span>}<p className="mt-0.5 text-xs text-slate-500">{row.product?.sku || ui("No code")}{row.product?.is_active === false ? ui(" · Inactive item") : !row.product ? ui(" · Catalogue record unavailable") : ''}</p>
            {!row.hasRecordedBalance && <p className="mt-1 text-[11px] text-slate-500">{ui("No stock recorded here")}</p>}
            {row.otherQuantity > 0 && <p className="mt-1 text-[11px] text-slate-500">{formatNumber(row.otherQuantity, 3)} {row.unit}{ui(" in other warehouses")}</p>}
            {row.product?.configuration_status === 'draft' && <p className="mt-1 text-[11px] text-amber-800">{ui("Assembly setup needed")}</p>}
          </div></div></th>
          <td className="px-4 py-4"><StockLevelPill row={row} /></td>
          <td className="whitespace-nowrap px-4 py-4"><span className="tabular-nums">{formatNumber(row.usable, 3)} {row.unit}</span>{row.blocked > 0 && <p className="mt-1 text-[11px] text-amber-800">{formatNumber(row.blocked, 3)}{ui(" held / expired")}</p>}</td>
          <td className="whitespace-nowrap px-4 py-4 tabular-nums">{formatXAF(row.value)}</td>
          <td className="px-4 py-4"><div className="flex items-center justify-end gap-2">{row.product && renderItemActions?.(row.product)}{row.product && onAdjust && <button type="button" aria-label={ui("Adjust quantity for {0}",row.name)} disabled={row.product.is_active===false || row.product.configuration_status==='draft'} className="inline-flex h-8 items-center whitespace-nowrap rounded-md border px-2 text-xs text-slate-600 hover:bg-slate-50" onClick={()=>onAdjust(row.product)}>{ui("Adjust quantity")}</button>}{row.lots.length > 0 && <button type="button" aria-label={ui("Stock records for {0}", row.name)} aria-expanded={expanded === row.id} onClick={() => setExpanded(expanded === row.id ? '' : row.id)} className="inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-md border px-2 text-xs text-slate-600 hover:bg-slate-50">{expanded === row.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{row.lots.length}{ui(" records")}</button>}</div></td>
        </tr>
        {expanded === row.id && <tr className="border-b bg-slate-50/70"><td colSpan={5} className="px-4 py-4"><table className="w-full text-left text-xs"><caption className="mb-2 text-left font-medium text-slate-700">{row.name}{ui(" — stock records in this warehouse")}</caption><thead className="text-slate-500"><tr>{[ui("Batch / lot"), 'Expiry', 'Quality', 'Quantity', ui("Stock value")].map(label => <th scope="col" key={label} className="px-3 py-2 font-medium">{label}</th>)}</tr></thead><tbody>{row.lots.map(lot => <tr key={lot.id} className="border-t border-slate-200"><td className="px-3 py-2">{lot.batch_number || lot.lot_number || ui("No batch recorded")}</td><td className="px-3 py-2">{lot.expiry_date ? formatDate(lot.expiry_date) : '—'}</td><td className="px-3 py-2 capitalize">{lot.qc_status || ui("approved")}</td><td className="px-3 py-2 tabular-nums">{formatNumber(lot.quantity, 3)} {row.unit}</td><td className="px-3 py-2 tabular-nums">{formatXAF(lot.total_value)}</td></tr>)}</tbody></table></td></tr>}
      </Fragment>)}</tbody>
    </table></div>
    {!filtered.length && <p className="p-8 text-sm text-slate-500">{ui("No items match these filters.")}</p>}
  </section>;
}
