
/* localized-messages */
import { uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useEffect, useRef, useState } from 'react';
import { erp } from '@/api/erpClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { sortProductRows } from '@/lib/product-sorting';
import ProductSortSelect from '@/components/shared/ProductSortSelect';
import { ProductPhoto } from '@/components/shared/ProductThumb';
import PickerPopdown from '@/components/ui/picker-popdown';
import { RefreshCw, Truck, AlertTriangle, CircleAlert, X } from 'lucide-react';

const qty = v => v == null ? '—' : Number(v).toLocaleString('en-CM', { maximumFractionDigits: 3 });
export default function FieldInventoryCards({ employeeId, enabled = true }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [result, setResult] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(false), [reload, setReload] = useState(0), [search, setSearch] = useState('');
  const [sort, setSort] = useState('name');
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
  const filtered = rows => sortProductRows(rows.filter(row => `${row.product.name} ${row.product.sku || ''}`.toLowerCase().includes(search.trim().toLowerCase())), sort, row => row.product);
  return <section aria-label={ui('Goods in my possession')} className="space-y-3">
    <div className="flex min-w-0 items-center gap-1">
      <Input className="min-w-0 flex-1" aria-label={ui('Search goods in my possession')} placeholder={ui('Find a product in your load...')} value={search} onChange={e=>setSearch(e.target.value)}/>
      <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label={ui('Refresh quantities')} title={ui('Refresh quantities')} disabled={loading||!enabled} onClick={()=>setReload(n=>n+1)}><RefreshCw size={17} className={loading?'animate-spin':''}/></Button>
      <StockInfo title={ui('Stock information')}><p>{ui('Recorded stock by vehicle and product. Driver and Commercial see the same shared load.')}</p>{data&&<p>{ui('Updated ')}{new Date(data.updated_at).toLocaleString()}{ui(" · Quantities remain in each product's stock unit.")}</p>}</StockInfo>
    </div>
    <ProductSortSelect value={sort} onChange={setSort} className="sm:max-w-xs"/>
    {error&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{ui('Refresh failed. ')}{data?ui('The figures below are from the last successful refresh. '):''}{uiMessage(error)}</p>}
    {!data?<p role="status" className="p-6 text-sm text-slate-500">{loading?ui('Loading assigned inventory...'):ui('Select an active employee to see inventory.')}</p>:<>
      {!data.runs.length&&!data.legacy.length&&<div className="rounded-2xl border border-dashed p-6 text-center"><Truck className="mx-auto mb-3 text-slate-400" size={28}/><h3 className="text-sm font-semibold">{ui('No goods currently assigned')}</h3><StockInfo title={ui('No goods currently assigned')}><p>{ui('Warehouse staff issue your goods to the assigned delivery vehicle. The recorded transfer appears here.')}</p></StockInfo></div>}
      {data.runs.map(run=><section key={run.id} className="space-y-2 rounded-xl border bg-white p-2.5 sm:p-4">
        <div className="flex min-w-0 items-center gap-1"><div className="flex min-w-0 flex-1 flex-wrap items-center gap-2"><h3 className="flex min-w-0 items-center gap-2 break-words text-sm font-semibold"><Truck className="shrink-0 text-primary" size={16}/>{run.vehicle_name}</h3><span className="rounded-full bg-secondary px-2 py-1 text-[11px] font-medium">{run.planned?ui('Approved - not yet issued'):run.back_at_base?ui('At base - awaiting warehouse receipt'):run.status==='in_transit'?ui('On delivery'):ui('Loaded')}</span></div>
          <StockInfo title={ui('Vehicle details')}><p>{run.dispatch_number}</p><p>{run.driver_name} / {run.salesperson_name}</p></StockInfo>
        </div>
        {run.error?<p role="alert" className="rounded-xl bg-slate-50 p-3 text-sm text-slate-900">{uiMessage(run.error)}</p>:<div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 xl:grid-cols-4">{filtered(run.rows).map(row=><InventoryProductCard key={row.product.id} row={row} planned={run.planned}/>)}</div>}
        {!run.error&&!filtered(run.rows).length&&<p className="text-sm text-slate-500">{ui('No products match this view.')}</p>}
        {!!run.expired_returns?.length&&<details className="rounded-lg border bg-slate-50 px-3"><summary className="cursor-pointer py-3 text-xs font-semibold text-slate-900"><AlertTriangle size={14} className="mr-1 inline" aria-hidden="true"/>{ui('Expired customer collections - keep separate')} ({run.expired_returns.length})</summary><div className="space-y-2 pb-3 text-xs">{run.expired_returns.map(r=><p key={r.id}>{r.product_name}: {qty(r.quantity)} {r.unit}{ui(' · Batch ')}{r.returned_lot_number||ui('unrecorded')}</p>)}<p className="text-slate-500">{ui('Awaiting warehouse quarantine receipt. These quantities are separate from the fresh vehicle load.')}</p></div></details>}
      </section>)}
      {data.legacy.map(location=><section key={location.id} className="space-y-2 rounded-xl border bg-slate-50/40 p-2.5 sm:p-4"><div className="flex items-center gap-1"><h3 className="min-w-0 flex-1 break-words text-sm font-semibold">{ui('Older individual custody: ')}{location.name}</h3><StockInfo title={ui('Stock information')}><p>{ui('These goods remain attributed to you. Ask Distribution to recover and reconcile them before reissue.')}</p></StockInfo></div><div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 xl:grid-cols-4">{filtered(location.rows).map(row=><InventoryProductCard key={row.product.id} row={row} legacy/>)}</div></section>)}
    </>}
  </section>;
}

function StockInfo({title,children}) {
  const [open,setOpen]=useState(false),anchor=useRef(null);
  return <div className="shrink-0">
    <button ref={anchor} type="button" aria-label={ui('More information: {0}',title)} aria-haspopup="dialog" aria-expanded={open} onClick={()=>setOpen(value=>!value)} className="inline-flex h-11 w-11 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><CircleAlert size={16} aria-hidden="true"/></button>
    {open&&<PickerPopdown compact anchorRef={anchor} onOpenChange={setOpen} label={title} focusSelector="[data-stock-info-close]"><div className="flex shrink-0 items-center gap-2"><h4 className="min-w-0 flex-1 break-words text-xs font-semibold">{title}</h4><button type="button" data-stock-info-close aria-label={ui('Close')} onClick={()=>setOpen(false)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><X size={16} aria-hidden="true"/></button></div><div className="min-h-0 space-y-2 overflow-y-auto overscroll-contain px-1 pb-1 text-xs leading-5 text-slate-600">{children}</div></PickerPopdown>}
  </div>;
}

export function InventoryProductCard({ row, planned = false, legacy = false }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;
  const [open,setOpen]=useState(false),anchor=useRef(null);
  const label=ui('Quick view: {0}',row.product.name);
  return <article className="min-w-0">
    <button ref={anchor} type="button" aria-label={label} aria-haspopup="dialog" aria-expanded={open} onClick={()=>setOpen(value=>!value)}
      className="flex h-full w-full min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-left transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
      <ProductPhoto product={row.product} className="h-16 w-full bg-slate-50/70 sm:h-20" sizes="(max-width: 639px) 96px, 128px" imageClassName="p-1.5" />
      <span className="flex w-full min-w-0 flex-1 flex-col gap-2 p-2.5 sm:p-3">
        <span className="min-h-10 break-words text-sm font-semibold leading-5">{row.product.name}</span>
        <span className="mt-auto"><span className="block text-[11px] leading-4 text-slate-500">{planned?ui('Approved for collection'):ui('Available')}</span><span className="block break-words text-lg font-bold leading-6 text-primary">{qty(planned?row.loaded:row.usable)} <span className="text-xs font-medium">{row.unit}</span></span></span>
      </span>
    </button>
    {open&&<PickerPopdown compact anchorRef={anchor} onOpenChange={setOpen} label={label} focusSelector="[data-stock-quickview-close]">
      <div className="flex shrink-0 items-start gap-2 border-b pb-2 pl-1">
        <div className="min-w-0 flex-1 self-center"><h4 className="break-words text-xs font-semibold leading-4">{row.product.name}</h4></div>
        <button type="button" data-stock-quickview-close aria-label={ui('Close quick view')} onClick={()=>setOpen(false)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><X size={18} aria-hidden="true"/></button>
      </div>
      <div className="min-h-0 overflow-y-auto overscroll-contain px-1 pb-1"><InventoryProductDetails row={row} planned={planned} legacy={legacy}/></div>
    </PickerPopdown>}
  </article>;
}

export function InventoryProductDetails({row,planned=false,legacy=false}) {
  const values=planned?[['Approved for collection',row.loaded]]:[['Available',row.usable],['On hand',row.on_hand],...(row.held>0?[['Held / expired',row.held]]:[])];
  const movements=!planned&&!legacy?[['Loaded',row.loaded],['Supplied',row.supplied],['Returned',row.returned],['Replaced free',row.replaced]]:[];
  const difference=row.variance!=null&&row.variance!==0;
  return <div className="space-y-2">
    <dl className="space-y-1">{values.map(([label,value])=><div key={label} className="grid grid-cols-2 items-start gap-2"><dt className="text-xs leading-5 text-slate-500">{ui(label)}</dt><dd className={'break-words text-right text-sm font-semibold leading-5 '+(label==='Available'?'text-primary':'text-slate-900')}>{qty(value)} {row.unit}</dd></div>)}</dl>
    {difference&&<p role="alert" className="rounded-lg bg-red-50 px-2 py-1 text-xs text-red-800">{ui('Stock difference: ')}{qty(row.variance)} {row.unit}</p>}
    {(movements.length>0||!!row.lots?.length||difference)&&<details className="border-t"><summary className="cursor-pointer py-3 text-xs font-semibold text-primary">{ui('More stock details')}</summary><div className="space-y-3 pb-1">
      {!!movements.length&&<dl className="grid grid-cols-2 gap-2">{movements.map(([label,value])=><div key={label} className="min-w-0"><dt className="text-[11px] leading-4 text-slate-500">{ui(label)}</dt><dd className="break-words text-xs font-semibold">{qty(value)} {row.unit}</dd></div>)}</dl>}
      {difference&&<p className="text-xs text-red-800">{ui('. Report this to Distribution for reconciliation.')}</p>}
      {!!row.lots?.length&&<section className="space-y-2 border-t pt-2"><h5 className="text-xs font-semibold">{ui('Batches')} ({row.lots.length})</h5>{row.lots.map(lot=><div key={lot.id} className="text-xs"><p className="break-words font-semibold">{lot.lot_number||ui('No lot label')} · {qty(lot.quantity)} {row.unit}</p><p className="mt-0.5 break-words text-[11px] capitalize text-slate-500">{lot.qc_status||ui('approved')} · {lot.expiry_date?'Expiry '+lot.expiry_date:ui('No expiry recorded')}</p></div>)}</section>}
    </div></details>}
  </div>;
}
