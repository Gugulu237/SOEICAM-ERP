
/* localized-messages */
import { uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useEffect, useState } from 'react';
import { usePageState } from '@/lib/navigation-context';
import { Truck, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import StatusPill from './StatusPill';
import { SALE_STATUS, invokeFieldOps, errorMessage } from '@/lib/field-ops';
import { dailySupplySummary } from '@/lib/commercial-daily';
import { formatXAF } from '@/lib/formatters';
import ProductThumb from '@/components/shared/ProductThumb';
import { availableCustody } from '@/lib/field-pos';

function SupplyRow({ readOnly, onOpen, children, ...props }) {
  return readOnly ? <article {...props}>{children}</article> : <button type="button" onClick={onOpen} {...props}>{children}</button>;
}

export default function CommercialDailySupplies({ employeeId, today, preview, managing, readOnly = false, onOpenSale }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [date, setDate] = usePageState('daily-supplies:date:' + employeeId, today), [filter, setFilter] = usePageState('daily-supplies:filter:' + employeeId, 'all'), [data, setData] = useState(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState(''), [reload, setReload] = useState(0);
  const [updatedAt, setUpdatedAt] = useState('');
  useEffect(() => { if (!date && today) setDate(today); }, [date, today]);
  useEffect(() => {
    if (preview || !employeeId || !date) return;
    let active = true, pending = false;
    setData(null); setUpdatedAt('');
    const refresh = async () => {
      if (!active || pending) return;
      pending = true; setLoading(true); setError('');
      try {
        const res = await invokeFieldOps({ action: 'commercialDailySupplies', commercialId: employeeId, date });
        if (res.data.error) throw new Error(res.data.error);
        if (active) { setData(res.data); setUpdatedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })); }
      } catch (reason) { if (active) setError(errorMessage(reason)); }
      finally { pending = false; if (active) setLoading(false); }
    };
    const onFocus = () => { if (!document.hidden) refresh(); };
    refresh();
    const timer = window.setInterval(onFocus, 30000);
    window.addEventListener('focus', onFocus); document.addEventListener('visibilitychange', onFocus);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus); };
  }, [employeeId, date, preview, reload]);
  const summary = dailySupplySummary(data?.sales || [], date);
  const sales = (data?.sales || []).filter(sale => filter === 'all' || sale.payment_type === filter);
  return <section className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg font-semibold">{ui("Daily supplies")}</h2><p className="mt-1 text-xs text-slate-500">{ui("Every customer supply, paid in cash or on credit. Dates follow Cameroon time.")}</p></div><div className="flex items-end gap-2"><label className="space-y-1 text-xs">{ui("Supply date")}<Input type="date" value={date || ''} max={today} disabled={preview} onChange={event => setDate(event.target.value)} /></label><Button variant="outline" aria-label={ui("Refresh daily supplies")} disabled={preview || loading} onClick={() => setReload(value => value + 1)}><RefreshCw size={16} /></Button></div></div>
    {preview && <p className="rounded-xl bg-slate-50 p-4 text-sm">{ui("Choose a live Commercial employee to view actual daily supplies and their assigned driver.")}</p>}
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{[[ui("Cash supplies"), summary.cash], [ui("Credit supplies"), summary.credit], [ui("Cash collected"), summary.collected], [ui("Balance at supply"), summary.due]].map(([label, amount]) => <div key={label} className="rounded-xl border bg-white p-4"><p className="text-xs text-slate-500">{label}</p><p className="mt-2 text-lg font-bold">{!data ? '-' : formatXAF(amount)}</p></div>)}</div>
    <p className="text-xs leading-5 text-slate-500">{ui("Recorded sales: ")}{formatXAF(summary.approved)}{ui(". New supplies post immediately when their receipt photo and exact quantities are submitted. ")}{summary.pending > 0 && ui("{0} earlier reports still require review. ", summary.pending)}{ui("Drafts, returned and rejected reports are excluded. Customer balances are shown at the time of supply, before later payments.")}{updatedAt && ui(" Updated {0}; refreshes every 30 seconds while open.", updatedAt)}</p>
    <div className="rounded-2xl border bg-white p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold"><Truck size={18} className="text-slate-700" />{ui("Driver, delivery run & remaining products")}</h3>
      {!loading && !preview && data && !(data.runs || []).length && <p className="mt-2 text-xs leading-5 text-slate-500">{ui("No assigned run for this date. Dispatch management pairs a Commercial and a Driver, then the warehouse loads finished products before departure.")}</p>}
      <div className="mt-3 space-y-3">{(data?.runs || []).map(run => {
        const balances = (data.runBalances || []).filter(balance => balance.dispatch_id === run.id);
        const products = (data.runProducts || []).map(product => ({ ...product, quantity: availableCustody(balances, product.id, date) })).filter(product => product.quantity > 0);
        return <div key={run.id} className="overflow-hidden rounded-xl border border-slate-200">
          <div className="bg-slate-50 p-3 text-xs"><p className="font-semibold">{run.driver_name || ui("Driver not assigned")}</p><p className="mt-1 text-slate-600">{[run.vehicle_name, run.route_name, run.dispatch_number].filter(Boolean).join(' / ')}</p><p className="mt-1 text-slate-500">{run.status?.replaceAll('_', ' ')}{run.stock_warehouse_name ? ` / ${run.stock_warehouse_name}` : ''}</p>{run.stock_error && <p className="mt-2 text-slate-800">{run.stock_error}</p>}</div>
          {products.length ? <div className="grid divide-y sm:grid-cols-2">{products.map(product => <div key={product.id} className="flex items-center gap-2 p-3"><ProductThumb product={product} size={44} /><div className="min-w-0"><p className="text-xs font-medium">{product.name}</p><p className="mt-1 text-xs font-semibold text-emerald-700">{product.quantity} {product.unit_of_measure || product.storage_unit || ui("units")}{ui(" left to supply")}</p></div></div>)}</div> : <p className="p-3 text-xs text-slate-500">{ui("No approved, unexpired finished products remain on this run.")}</p>}
        </div>;
      })}</div>
      {managing && <p className="mt-3 text-xs text-slate-500">{ui("Manage driver pairing and loading in Distribution. Each recorded customer supply reduces the products on its delivery run.")}</p>}
    </div>
    <div className="flex flex-wrap gap-2">{[['all', ui("All supplies")], ['cash', 'Cash'], ['credit', 'Credit']].map(([value, label]) => <Button key={value} variant={filter === value ? 'default' : 'outline'} onClick={() => setFilter(value)}>{label}</Button>)}</div>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{uiMessage(error)}</p>}
    {loading && !data ? <p role="status" className="text-sm text-slate-500">{ui("Loading daily supplies...")}</p> : !preview && data && <div className="divide-y overflow-hidden rounded-2xl border bg-white">{!sales.length && <p className="p-6 text-sm text-slate-500">{ui("No supplies match this date and payment type. Record each supply after delivery.")}</p>}{sales.map(sale => <SupplyRow key={sale.id} readOnly={readOnly} onOpen={onOpenSale ? () => onOpenSale(sale.id) : undefined} className="flex w-full flex-wrap items-center justify-between gap-3 p-4 text-left hover:bg-slate-50"><span><span className="block text-sm font-semibold">{sale.customer_name}</span><span className="mt-1 block text-xs text-slate-500">{[sale.sale_number, sale.location_name, sale.driver_name].filter(Boolean).join(' / ')}</span><span className="mt-2 flex flex-wrap gap-3">{(data?.lines || []).filter(line => line.field_sale_id === sale.id).slice(0, readOnly ? undefined : 3).map(line => <span key={line.id} className="inline-flex items-center gap-1 text-[11px] text-slate-600"><ProductThumb product={(data?.products || []).find(product => product.id === line.product_id) || { name: line.product_name }} size={26} /><span>{line.quantity} {line.unit}<span className="block max-w-36 truncate text-[10px]">{line.product_name}</span></span></span>)}</span><span className="mt-2 block text-xs font-medium text-slate-700">{sale.payment_type === 'credit' ? ui("Credit") : ui("Cash")}{ui(" / Collected ")}{formatXAF(sale.amount_collected || 0)}{ui(" / Due ")}{formatXAF(sale.amount_due || 0)}</span></span><span className="space-y-2 text-right"><span className="block text-sm font-bold">{formatXAF(sale.total)}</span><StatusPill map={SALE_STATUS} value={sale.status} /></span></SupplyRow>)}</div>}
  </section>;
}
