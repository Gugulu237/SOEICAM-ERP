
/* localized-messages */
import { uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useEffect, useState } from 'react';
import { erp } from '@/api/erpClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ProductPhoto } from '@/components/shared/ProductThumb';
import { RefreshCw, Truck, Package, AlertTriangle } from 'lucide-react';

const qty = v => v == null ? '—' : Number(v).toLocaleString('en-CM', { maximumFractionDigits: 3 });
export default function FieldInventoryCards({ employeeId, enabled = true }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [result, setResult] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(false), [reload, setReload] = useState(0), [search, setSearch] = useState('');
  const data = result?.employee.id === employeeId ? result : null;
  useEffect(() => {
    if (!enabled || !employeeId) return;
    let active = true, pending = false;
    const load = async () => {
      if (pending) return; pending = true; if (active) setLoading(true);
      try { const { data } = await erp.functions.invoke('fieldOps', { action: 'fieldStockInventory', employeeId }); if (data.error) throw Error(data.error); if (active) { setResult(data); setError(''); } }
      catch (e) { if (active) setError(e.message); } finally { pending = false; if (active) setLoading(false); }
    };
    load(); const refresh = () => { if (document.visibilityState === 'visible') load(); }, timer = window.setInterval(refresh, 30000); window.addEventListener('focus', refresh);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [employeeId, enabled, reload]);
  const filtered = rows => rows.filter(row => `${row.product.name} ${row.product.sku || ''}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <section className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 text-lg font-bold"><Package size={20} />{ui("Goods in my possession")}</h2><p className="mt-1 text-xs text-slate-500">{ui("Recorded stock by vehicle and product. Driver and Commercial see the same shared load.")}</p></div><Button variant="outline" disabled={loading || !enabled} onClick={() => setReload(n => n + 1)}><RefreshCw size={16} className={'mr-2 ' + (loading ? 'animate-spin' : '')} />{ui("Refresh quantities")}</Button></div>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{ui("Refresh failed. ")}{data ? ui("The figures below are from the last successful refresh. ") : ''}{uiMessage(error)}</p>}
    {data && <p className="text-xs text-slate-500">{ui("Updated ")}{new Date(data.updated_at).toLocaleString()}{ui(" · Quantities remain in each product's stock unit.")}</p>}
    <Input aria-label={ui("Search goods in my possession")} placeholder={ui("Find a product in your load...")} value={search} onChange={e => setSearch(e.target.value)} />
    {!data ? <p role="status" className="p-6 text-sm text-slate-500">{loading ? ui("Loading assigned inventory...") : ui("Select an active employee to see inventory.")}</p> : <>
      {!data.runs.length && !data.legacy.length && <div className="rounded-2xl border border-dashed p-8 text-center"><Truck className="mx-auto mb-3 text-slate-400" size={36} /><h3 className="font-semibold">{ui("No goods currently assigned")}</h3><p className="mt-2 text-sm text-slate-500">{ui("Warehouse staff issue your goods to the assigned delivery vehicle. The recorded transfer appears here.")}</p></div>}
      {data.runs.map(run => <section key={run.id} className="space-y-4 rounded-2xl border bg-white p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="flex items-center gap-2 font-bold"><Truck className="text-blue-700" size={20} />{run.vehicle_name}</h3><p className="mt-1 text-xs text-slate-500">{run.dispatch_number} · {run.driver_name} + {run.salesperson_name}</p></div><span className="rounded-full bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-900">{run.planned ? ui("Approved - not yet issued") : run.back_at_base ? ui("At base - awaiting warehouse receipt") : run.status === 'in_transit' ? ui("On delivery") : ui("Loaded")}</span></div>
        {run.error ? <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">{uiMessage(run.error)}</p> : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{filtered(run.rows).map(row => <InventoryProductCard key={row.product.id} row={row} planned={run.planned} />)}</div>}
        {!run.error && !filtered(run.rows).length && <p className="text-sm text-slate-500">{ui("No products match this view.")}</p>}
        {!!run.expired_returns?.length && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4"><h4 className="flex items-center gap-2 text-sm font-semibold text-amber-900"><AlertTriangle size={16} />{ui("Expired customer collections - keep separate")}</h4>{run.expired_returns.map(r => <p key={r.id} className="mt-2 text-sm">{r.product_name}: {qty(r.quantity)} {r.unit}{ui(" · Batch ")}{r.returned_lot_number || ui("unrecorded")}</p>)}<p className="mt-2 text-xs text-amber-900">{ui("Awaiting warehouse quarantine receipt. These quantities are separate from the fresh vehicle load.")}</p></div>}
      </section>)}
      {data.legacy.map(location => <section key={location.id} className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50/40 p-5"><h3 className="font-semibold">{ui("Older individual custody: ")}{location.name}</h3><p className="text-xs text-amber-900">{ui("These goods remain attributed to you. Ask Distribution to recover and reconcile them before reissue.")}</p><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{filtered(location.rows).map(row => <InventoryProductCard key={row.product.id} row={row} legacy />)}</div></section>)}
    </>}
  </section>;
}
export function InventoryProductCard({ row, planned = false, legacy = false }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const progress = !planned && !legacy && row.loaded > 0 ? Math.max(0, Math.min(100, row.on_hand / row.loaded * 100)) : null;
  return <article className="overflow-hidden rounded-2xl border bg-white shadow-sm"><ProductPhoto product={row.product} className="aspect-[4/3] w-full bg-gradient-to-br from-slate-50 to-emerald-50" /><div className="space-y-3 p-4"><div><h4 className="font-bold">{row.product.name}</h4><p className="mt-1 text-xs text-slate-500">{row.unit}</p></div><div className="flex items-end justify-between gap-2"><div><p className="text-xs text-slate-500">{planned ? ui("Approved for collection") : ui("On hand")}</p><p className="mt-1 text-3xl font-bold text-blue-900">{qty(planned ? row.loaded : row.on_hand)} <span className="text-sm font-medium">{row.unit}</span></p></div>{!planned && <span className={'rounded-full px-2 py-1 text-xs font-semibold ' + (row.usable > 0 ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900')}>{row.usable > 0 ? ui("Usable stock") : ui("No usable stock")}</span>}</div>
    {progress !== null && <div><div role="progressbar" aria-label={'Remaining share of load for ' + row.product.name} aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100} className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500" style={{ width: progress + '%' }} /></div><p className="mt-1 text-[11px] text-slate-500">{qty(row.on_hand)}{ui(" of ")}{qty(row.loaded)}{ui(" originally loaded")}</p></div>}
    {!planned && <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-3 text-sm"><div><p className="text-xs text-slate-500">{ui("Usable")}</p><strong className="text-green-800">{qty(row.usable)} {row.unit}</strong></div><div><p className="text-xs text-slate-500">{ui("Held / expired")}</p><strong className={row.held > 0 ? 'text-amber-800' : ''}>{qty(row.held)} {row.unit}</strong></div>{!legacy && <><div><p className="text-xs text-slate-500">{ui("Supplied")}</p><strong>{qty(row.supplied)}</strong></div><div><p className="text-xs text-slate-500">{ui("Returned / replaced")}</p><strong>{qty(row.returned)} / {qty(row.replaced)}</strong></div></>}</div>}
    {row.variance !== undefined && row.variance !== null && row.variance !== 0 && <p role="alert" className="rounded-lg bg-red-50 p-2 text-xs text-red-800">{ui("Stock difference: ")}{qty(row.variance)} {row.unit}{ui(". Report this to Distribution for reconciliation.")}</p>}
    {!!row.lots?.length && <details className="border-t pt-3"><summary className="cursor-pointer text-sm font-semibold text-blue-800">{ui("View batches & expiry (")}{row.lots.length})</summary><div className="mt-2 space-y-2">{row.lots.map(lot => <div key={lot.id} className="rounded-lg bg-slate-50 p-2 text-xs"><p className="font-semibold">{lot.lot_number || ui("No lot label")} · {qty(lot.quantity)} {row.unit}</p><p className="mt-1 capitalize">{lot.qc_status || ui("approved")} · {lot.expiry_date ? 'Expiry ' + lot.expiry_date : ui("No expiry recorded")}</p></div>)}</div></details>}
  </div></article>;
}
