import LearnMore from '@/components/shared/LearnMore';

/* localized-messages */
import { uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useEffect, useState } from 'react';
import { invokeFieldOps, errorMessage } from '@/lib/field-ops';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import ProductThumb from '@/components/shared/ProductThumb';
import OutletDeliveryHistory from './OutletDeliveryHistory';
import { formatQuantity, formatDateTime } from '@/lib/formatters';
import { RefreshCw } from 'lucide-react';

export default function OutletShelfOverview({ onAssign }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [data, setData] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(true), [reload, setReload] = useState(0);
  const [search, setSearch] = useState(''), [attention, setAttention] = useState(false), [expanded, setExpanded] = useState('');
  useEffect(() => {
    let active = true, pending = false;
    const refresh = async () => {
      if (!active || pending) return;
      pending = true; setLoading(true); setError('');
      try { const result = await invokeFieldOps({ action: 'outletShelfOverview' }); if (result.data.error) throw new Error(result.data.error); if (active) setData(result.data); }
      catch (failure) { if (active) setError(errorMessage(failure)); }
      finally { pending = false; if (active) setLoading(false); }
    };
    const visible = () => { if (!document.hidden) refresh(); };
    refresh(); const timer = window.setInterval(visible, 30000); window.addEventListener('focus', visible); document.addEventListener('visibilitychange', visible);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', visible); document.removeEventListener('visibilitychange', visible); };
  }, [reload]);
  const all = data?.outlets || [], needsCount = outlet => outlet.deliveries.filter(row => !row.shelf_check_id).length;
  const stockouts = outlet => outlet.products.filter(product => product.display_quantity === 0).length;
  const rows = all.filter(outlet => [outlet.customer_name, outlet.name, ...outlet.staff_names].join(' ').toLowerCase().includes(search.toLowerCase()) && (!attention || needsCount(outlet) || stockouts(outlet)));
  return <section className="space-y-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">{ui("Shelves at Hotesse points")}</h2><LearnMore title={ui("Shelf overview")}><p>{ui("Latest reported counts plus confirmed supplies and returns since each count. These observations support replenishment and marketing; they do not change company accounting or warehouse inventory.")}</p></LearnMore></div><Button variant="outline" disabled={loading} onClick={() => setReload(value => value + 1)}><RefreshCw size={15} className="mr-2" />{ui("Refresh")}</Button></div>
    <div className="grid grid-cols-1 min-[380px]:grid-cols-2 sm:grid-cols-3 gap-3">{[[ui("Staffed points"), all.length], [ui("Points with stock-outs"), all.filter(outlet => stockouts(outlet)).length], [ui("Delivery checks pending"), all.reduce((sum, outlet) => sum + needsCount(outlet), 0)]].map(([label, value]) => <div key={label} className="rounded-xl border bg-white p-4"><p className="text-xs text-slate-500">{label}</p><p className="mt-2 text-xl font-bold">{!data || error ? '-' : value}</p></div>)}</div>
    <div className="flex flex-wrap items-center justify-between gap-3"><Input value={search} onChange={event => setSearch(event.target.value)} placeholder={ui("Find point, customer or Hotesse")} aria-label={ui("Find staffed point")} className="max-w-sm" /><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={attention} onChange={event => setAttention(event.target.checked)} />{ui("Needs stock or shelf check")}</label></div>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{uiMessage(error)}</p>}{loading && !data && <p role="status" className="py-8 text-sm text-slate-500">{ui("Loading staffed points...")}</p>}
    {!loading && !error && !rows.length && <div className="rounded-xl border bg-white p-6 text-sm text-slate-500"><p>{all.length ? ui("No points match this filter.") : ui("Assign active Hotesse staff to registered customer outlets to begin shelf reporting.")}</p>{!all.length && <Button className="mt-4" onClick={onAssign}>{ui("Assign outlets")}</Button>}</div>}
    {!error && rows.map(outlet => <article key={outlet.id} className="space-y-4 rounded-2xl border bg-white p-4 sm:p-5"><header className="flex flex-wrap justify-between gap-3"><div><h3 className="font-semibold">{outlet.customer_name} / {outlet.name}</h3><p className="mt-1 text-xs text-slate-500">{outlet.staff_names.join(', ')} / {outlet.daily_report_submitted ? ui("Daily report submitted") : ui("No daily report today")}</p></div><Button variant="outline" size="sm" onClick={() => setExpanded(value => value === outlet.id ? '' : outlet.id)}>{ui("Supplies & batches")}{needsCount(outlet) ? ui(" ({0} to count)", needsCount(outlet)) : ''}</Button></header>
      {!outlet.products.length && <p className="text-sm text-slate-500">{ui("No confirmed supplies to this exact point of sale yet.")}</p>}<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{outlet.products.map(product => <div key={product.id} className="flex items-start gap-3 rounded-xl border p-3"><ProductThumb product={product} size={50} /><div><h4 className="text-sm font-semibold">{product.name}</h4><p className={'mt-2 text-sm font-bold ' + (product.display_quantity === 0 ? 'text-red-700' : 'text-slate-900')}>{formatQuantity(product.display_quantity)} {product.unit_of_measure || product.storage_unit || ui("units")}{product.display_quantity === 0 ? ui(" / Stock-out") : ''}</p><p className="mt-1 text-[11px] leading-5 text-slate-500">{product.last_count_at ? ui("Last shelf count: {0} / {1}", product.last_count_quantity, formatDateTime(product.last_count_at)) : ui("Not yet shelf-counted")}<br />{ui("Total supplied: ")}{formatQuantity(product.supplied_quantity)}</p></div></div>)}</div>
      {expanded === outlet.id && <OutletDeliveryHistory deliveries={outlet.deliveries} preview />}
    </article>)}
  </section>;
}
