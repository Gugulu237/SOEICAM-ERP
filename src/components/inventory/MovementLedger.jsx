
/* localized-messages */
import { uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useEffect, useState } from 'react';
import { usePageState } from '@/lib/navigation-context';
import { ArrowRight, ArrowDownLeft, ArrowUpRight, ArrowLeftRight, Download, RefreshCw, List, GitBranch } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ProductThumb from '@/components/shared/ProductThumb';
import StatusBadge from '@/components/shared/StatusBadge';
import { stockUnit } from '@/lib/item-units';
import { formatXAF, formatNumber, formatDate } from '@/lib/formatters';
import { defaultMovementFilters, MOVEMENT_TYPES, movementLabel, movementEndpoint, downloadCsv } from '@/lib/warehouse-workspace';

const control = 'mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-800';
function Filter({ label, children }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;
 return <label className="min-w-0 text-xs font-medium text-slate-600">{label}{children}</label>; }
export function MovementRoute({ row, warehouses }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const same = row.source_warehouse_id && row.source_warehouse_id === row.destination_warehouse_id;
  return <div className="flex min-w-52 items-center gap-2 text-sm"><span className="flex-1 rounded-lg bg-slate-50 px-3 py-2 font-medium text-slate-700">{movementEndpoint(row,'from',warehouses)}</span><ArrowRight size={17} className="shrink-0 text-green-600" /><span className="flex-1 rounded-lg bg-green-50 px-3 py-2 font-medium text-green-900">{same ? ui("Same location · status change") : movementEndpoint(row,'to',warehouses)}</span></div>;
}

export default function MovementLedger({ warehouses, products = [], warehouseId = '', refreshKey = 0, reportMode = false }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [draft,setDraft] = usePageState('movements:draft:' + warehouseId, () => defaultMovementFilters(warehouseId));
  const [filters,setFilters] = usePageState('movements:filters:' + warehouseId, () => defaultMovementFilters(warehouseId));
  const [page,setPage] = usePageState('movements:page:' + warehouseId, 1), [view,setView] = usePageState('movements:view:' + warehouseId, reportMode ? 'routes' : 'ledger');
  const [result,setResult] = useState(null), [error,setError] = useState(''), [loading,setLoading] = useState(true), [downloading,setDownloading] = useState(false), [reload,setReload] = useState(0);
  const query = new URLSearchParams({...filters,page:String(page)}).toString();
  const data = result?.query === query ? result.data : null;
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    fetch('/api/inventory/movements?'+query,{cache:'no-store',signal:controller.signal}).then(async response => {
      const value = await response.json(); if (!response.ok) throw Error(value.error || ui("Could not load stock movements."));
      setResult({query,data:value});
    }).catch(e => { if (e.name !== 'AbortError') setError(e.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  },[query,refreshKey,reload]);
  const set = (key,value) => setDraft(previous => ({...previous,[key]:value}));
  function run(event) { event?.preventDefault(); setFilters({...draft}); setPage(1); setReload(n => n+1); }
  async function exportReport() {
    setDownloading(true); setError('');
    try {
      const response = await fetch('/api/inventory/movements?'+new URLSearchParams({...filters,export:'1'}),{cache:'no-store'});
      const value = await response.json(); if (!response.ok) throw Error(value.error || ui("Could not export the report."));
      const location = warehouses.find(w => w.id === filters.warehouse);
      downloadCsv('SOEICAM-movements-'+filters.from+'-'+filters.to+'.csv',[
        [ui("SOEICAM warehouse movement report")],['Warehouse',location?.name || ui("All warehouses")],['Period',filters.from,filters.to],['Status',filters.status],[ui("Generated at"),value.exportedAt],
        ['Date','Item','From','To','Movement',ui("Batch / lot"),'Quantity',ui("Stock U/M"),ui("Unit cost (XAF)"),ui("Recorded value (XAF)"),'Status',ui("Document type"),ui("Document reference"),'Reason'],
        ...value.rows.map(row => [row.movement_date,row.product_name,movementEndpoint(row,'from',warehouses),movementEndpoint(row,'to',warehouses),movementLabel(row.movement_type),row.batch_number || row.lot_number,Number(row.quantity),stockUnit(products.find(p => p.id === row.product_id) || {}),Number(row.unit_cost || 0),Number(row.total_value || 0),row.status,row.document_type,row.document_id,row.reason]),
      ]);
    } catch(e) { setError(e.message); } finally { setDownloading(false); }
  }
  return <div className="space-y-4">
    <form onSubmit={run} className="rounded-2xl border bg-white p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">{reportMode ? ui("Warehouse activity report") : ui("Stock movement history")}</h2><p className="mt-1 text-xs text-slate-500">{ui("Choose a period and follow each item from its source to its destination.")}</p></div><Button type="button" variant="outline" size="sm" onClick={() => setReload(n => n+1)} disabled={loading}><RefreshCw size={14} className="mr-2" />{ui("Refresh")}</Button></div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Filter label={ui("Warehouse")}><select className={control} value={draft.warehouse} disabled={!!warehouseId} onChange={e => set('warehouse',e.target.value)}><option value="">{ui("All warehouses")}</option>{warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Filter>
        <Filter label={ui("Source")}><select className={control} value={draft.source} onChange={e => set('source',e.target.value)}><option value="">{ui("All sources")}</option><option value="__none__">{ui("External / unrecorded")}</option>{warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Filter>
        <Filter label={ui("Destination")}><select className={control} value={draft.destination} onChange={e => set('destination',e.target.value)}><option value="">{ui("All destinations")}</option><option value="__none__">{ui("External / unrecorded")}</option>{warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Filter>
        <Filter label={ui("Item")}><select className={control} value={draft.product} onChange={e => set('product',e.target.value)}><option value="">{ui("All items")}</option>{products.filter(p => p.inventory_type !== 'service').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Filter>
        <Filter label={ui("Start date")}><input className={control} type="date" required value={draft.from} onChange={e => set('from',e.target.value)} /></Filter>
        <Filter label={ui("End date")}><input className={control} type="date" required value={draft.to} min={draft.from} onChange={e => set('to',e.target.value)} /></Filter>
        <Filter label={ui("Movement type")}><select className={control} value={draft.type} onChange={e => set('type',e.target.value)}><option value="">{ui("All movements")}</option>{MOVEMENT_TYPES.map(type => <option key={type} value={type}>{movementLabel(type)}</option>)}</select></Filter>
        <Filter label={ui("Status")}><select className={control} value={draft.status} onChange={e => set('status',e.target.value)}>{['approved','all','pending','reversed'].map(status => <option key={status} value={status}>{status === 'approved' ? ui("Approved / recorded") : movementLabel(status)}</option>)}</select></Filter>
      </div>
      <div className="mt-4 flex flex-wrap gap-2"><Button type="submit" disabled={loading}>{ui("Run report")}</Button><Button type="button" variant="ghost" onClick={() => {const reset=defaultMovementFilters(warehouseId);setDraft(reset);setFilters(reset);setPage(1);}}>{ui("Reset filters")}</Button><Button type="button" className="sm:ml-auto" variant="outline" disabled={downloading || loading || !data} onClick={exportReport}><Download size={15} className="mr-2" />{downloading ? ui("Preparing...") : ui("Export report (CSV)")}</Button></div>
    </form>
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{uiMessage(error)}</p>}
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{[
      [ui("Approved entries"),'approved',List],[ui("Between warehouses"),'transfers',ArrowLeftRight],[filters.warehouse ? ui("Incoming entries") : ui("Receipt entries"),'incoming',ArrowDownLeft],[filters.warehouse ? ui("Outgoing entries") : ui("Issue entries"),'outgoing',ArrowUpRight],
    ].map(([label,key,Icon]) => <div key={key} className="rounded-xl border bg-white p-4"><Icon className="mb-2 text-green-700" size={18} /><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-2xl font-bold">{data?.summary?.[key] ?? '—'}</p></div>)}</div>
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex gap-2"><Button variant={view === 'ledger' ? 'default' : 'outline'} size="sm" onClick={() => setView('ledger')}><List size={15} className="mr-2" />{ui("Activity")}</Button><Button variant={view === 'routes' ? 'default' : 'outline'} size="sm" onClick={() => setView('routes')}><GitBranch size={15} className="mr-2" />{ui("Movement routes")}</Button></div><span className="text-xs text-slate-500">{filters.from} → {filters.to} · {data?.total ?? '—'}{ui(" ledger entries")}</span></div>
    {loading && <p role="status" className="text-sm text-slate-500">{ui("Loading movements...")}</p>}
    {view === 'routes' ? <div className="grid gap-3 lg:grid-cols-2">{(data?.flows || []).map((flow,index) => <button type="button" key={index} onClick={() => { const next={...filters,source:flow.source_warehouse_id || '__none__',destination:flow.destination_warehouse_id || '__none__',type:flow.movement_type,status:'approved'};setDraft(next);setFilters(next);setPage(1);setView('ledger'); }} className="rounded-2xl border bg-white p-4 text-left transition hover:border-green-400"><MovementRoute row={flow} warehouses={warehouses} /><div className="mt-3 flex flex-wrap justify-between gap-2 text-xs"><span className="capitalize text-slate-500">{movementLabel(flow.movement_type)}</span><strong>{flow.count}{ui(" entries · ")}{formatXAF(flow.value)}</strong></div><div className="mt-3 h-1.5 rounded-full bg-green-50"><div className="h-1.5 rounded-full bg-green-500" style={{width:Math.max(5,100*flow.count/Math.max(1,data.flows[0]?.count))+'%'}} /></div></button>)}{!loading && !data?.flows?.length && <p className="rounded-xl border bg-white p-5 text-sm text-slate-500">{ui("No approved activity for this selection.")}</p>}</div> : <div className="overflow-x-auto rounded-2xl border bg-white"><table className="w-full text-left text-sm"><thead className="border-b bg-slate-50 text-xs text-slate-500"><tr>{[ui("Date / activity"),ui("Item / batch"),ui("Source → destination"),'Quantity','Details'].map(label => <th key={label} className="px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody>{(data?.rows || []).map(row => {const product=products.find(p => p.id === row.product_id);return <tr key={row.id} className="border-b last:border-0"><td className="min-w-36 px-4 py-4 align-top"><p>{formatDate(row.movement_date)}</p><p className="mt-1 text-xs capitalize text-slate-500">{movementLabel(row.movement_type)}</p><div className="mt-2"><StatusBadge status={row.status} /></div></td><td className="min-w-44 px-4 py-4 align-top"><div className="flex gap-2"><ProductThumb product={product} name={row.product_name} size={42} /><div><p className="font-medium">{row.product_name}</p><p className="mt-1 text-xs text-slate-500">{row.batch_number || row.lot_number || ui("No batch recorded")}</p></div></div></td><td className="min-w-80 px-4 py-4 align-top"><MovementRoute row={row} warehouses={warehouses} /></td><td className="whitespace-nowrap px-4 py-4 align-top text-right font-semibold">{formatNumber(row.quantity,3)} <span className="font-normal text-slate-500">{stockUnit(product || {})}</span></td><td className="min-w-40 px-4 py-4 align-top"><details><summary className="cursor-pointer text-green-800">{formatXAF(row.total_value || 0)}</summary><div className="mt-2 max-w-64 space-y-1 break-words text-xs text-slate-500"><p>{ui("Unit cost: ")}{formatXAF(row.unit_cost || 0)}</p><p>{row.document_type} {row.document_id}</p><p>{row.reason || ui("No additional note")}</p>{row.expiry_date && <p>{ui("Expiry: ")}{formatDate(row.expiry_date)}</p>}</div></details></td></tr>;})}</tbody></table>{!loading && !data?.rows?.length && <p className="p-8 text-sm text-slate-500">{ui("No movements match these filters.")}</p>}</div>}
    {view === 'ledger' && <div className="flex items-center justify-end gap-3"><Button variant="outline" size="sm" disabled={loading || page === 1} onClick={() => setPage(n => n-1)}>{ui("Previous")}</Button><span className="text-xs text-slate-500">{ui("Page ")}{page}{ui(" of ")}{Math.max(1,Math.ceil((data?.total || 0)/40))}</span><Button variant="outline" size="sm" disabled={loading || !data?.hasMore} onClick={() => setPage(n => n+1)}>{ui("Next")}</Button></div>}
    <p className="text-xs leading-5 text-slate-500">{ui("Summary cards and the 12 busiest routes count approved ledger entries, not total units. Quantities stay with each item and U/M. Same-location quality changes are not transfers. Older entries without a recorded source or destination keep that gap visible.")}</p>
  </div>;
}
