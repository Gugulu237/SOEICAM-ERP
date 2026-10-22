
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React from 'react';
import { Button } from '@/components/ui/button';
import ProductThumb from '@/components/shared/ProductThumb';
import { formatDate, formatQuantity } from '@/lib/formatters';
import { PackageCheck } from 'lucide-react';

export default function OutletDeliveryHistory({ deliveries = [], preview = false, loading = false, onCount }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  return <section className="space-y-4"><div><h2 className="flex items-center gap-2 font-semibold"><PackageCheck size={19} />{ui("Supplies & delivery batches")}</h2><p className="mt-1 text-xs leading-5 text-slate-500">{ui("See what arrived at this exact point of sale. After each delivery, count everything currently on the shelves for the products received, including earlier stock.")}</p></div>
    {!deliveries.length && <p className="rounded-xl border border-dashed bg-white p-6 text-sm text-slate-500">{ui("Confirmed deliveries and their batch numbers will appear here.")}</p>}
    {deliveries.map(delivery => <article key={delivery.key} className="overflow-hidden rounded-2xl border bg-white"><header className="flex flex-wrap items-start justify-between gap-3 border-b bg-slate-50/70 p-4"><div><h3 className="text-sm font-semibold">{delivery.document_number}</h3><p className="mt-1 text-xs text-slate-500">{formatDate(delivery.date)} / {delivery.replacement ? ui("Fresh replacement supplied") : ui("Confirmed customer supply")}</p></div>{delivery.shelf_check_id ? <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800">{ui("Shelves counted")}{delivery.shelf_checked_by ? ' by ' + delivery.shelf_checked_by : ''}</span> : onCount ? <Button size="sm" disabled={preview || loading} onClick={() => onCount(delivery)}>{ui("Count shelves after delivery")}</Button> : <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">{ui("Awaiting Hotesse shelf count")}</span>}</header>
      <div className="divide-y">{[...new Set(delivery.lines.map(line => line.product_id))].map(id => { const lines = delivery.lines.filter(line => line.product_id === id), product = lines[0], total = lines.reduce((sum, line) => sum + line.quantity, 0); return <div key={id} className="p-4"><div className="flex items-center gap-3"><ProductThumb product={{ id, name: product.product_name, image_url: product.image_url }} size={48} /><div className="min-w-0 flex-1"><h4 className="text-sm font-semibold">{product.product_name}</h4><p className="mt-1 text-xs font-medium text-blue-800">{ui("Total supplied: ")}{formatQuantity(total)} {product.unit}</p></div></div><div className="mt-3 grid gap-2 sm:grid-cols-2">{lines.map((line, i) => <p key={i} className="rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-600"><span className="block font-semibold text-slate-800">{ui("Batch: ")}{line.lot_number || ui("Not recorded on this delivery")}</span>{formatQuantity(line.quantity)} {line.unit}{line.expiry_date && <>{ui(" / Expires ")}{formatDate(line.expiry_date)}</>}</p>)}</div></div>; })}</div>
    </article>)}
    <p className="text-[11px] leading-5 text-slate-500">{ui("Batch quantities describe the delivery. Remaining shelf stock is reported by product; the system does not guess which batch customers bought.")}</p>
  </section>;
}
