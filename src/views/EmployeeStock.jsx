import React, {useState} from 'react';
import {ui, uiMessage} from '@/lib/i18n';
import {useLocaleRender} from '@/lib/localization';
import {useNavigate} from '@/lib/router';
import {useMyStock} from '@/hooks/useMyStock';
import {formatDateTime, formatXAF} from '@/lib/formatters';
import PageHeader from '@/components/shared/PageHeader';
import DataTable from '@/components/shared/DataTable';
import IssuedStockRows, {currentStockRows} from '@/components/field/IssuedStockRows';
import DegustationForm from '@/components/distribution/DegustationForm';
import DegustationHistory from '@/components/distribution/DegustationHistory';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {RefreshCw} from 'lucide-react';
import CentralStockWorkspace from '@/components/field/CentralStockWorkspace';

export default function EmployeeStock({embedded = false,initialTab='stock'}) {
  useLocaleRender();
  const navigate = useNavigate(), {data, error, busy, enabled, authLoading, role, refresh} = useMyStock({history:true});
  const [giveaway, setGiveaway] = useState(false), [search, setSearch] = useState('');
  if(data?.centralized_inventory?.enabled)return <CentralStockWorkspace data={data} error={error} busy={busy} enabled={enabled} role={role} refresh={refresh} embedded={embedded} initialTab={initialTab}/>;
  const canRecord = enabled && role !== 'driver' && data?.runs.some(run => run.can_supply) && !error && !busy;
  const canGiveaway = canRecord && data.balances.some(balance => balance.degustation_quantity > 0 && data.runs.some(run => run.id === balance.dispatch_id && run.can_supply));
  const match = row => [row.product.name, row.product.sku, row.product.size].filter(Boolean).join(' ').toLowerCase().includes(search.trim().toLowerCase());
  const allRows = currentStockRows(data), runIds = new Set((data?.runs || []).map(run => run.id));
  const needsReview = data?.runs.some(run => run.stock_error) || data?.legacy?.some(location => location.stock_error);
  const otherRows = currentStockRows({...data, balances:data?.balances.filter(balance => !runIds.has(balance.dispatch_id)) || []}).filter(match);
  const actions = <div className="flex min-w-0 flex-wrap gap-2">
    <Button variant="outline" aria-label={ui('Refresh my stock')} disabled={busy || !enabled} onClick={refresh}><RefreshCw size={15} className={'mr-1 ' + (busy ? 'animate-spin' : '')}/>{ui('Refresh')}</Button>
    {enabled && <Button variant="outline" onClick={() => navigate('/my-stock/returns')}>{ui('Return goods')}</Button>}
    {enabled && role !== 'driver' && <><Button disabled={!canRecord} onClick={() => navigate('/my-stock/new')}>{ui('Record sale')}</Button><Button variant="outline" disabled={!canGiveaway} onClick={() => setGiveaway(true)}>{ui('Record Dégustation')}</Button></>}
  </div>;
  return <section aria-label={ui('My current stock')} className="min-w-0 space-y-4">
    {embedded ? actions : <PageHeader title={ui('My current stock')} subtitle={data?.employeeName} actions={actions}/>}
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{ui(data ? 'Stock refresh failed. Showing the last confirmed quantities.' : 'Could not load your current stock.')} {uiMessage(error)} <button disabled={busy} className="underline" onClick={refresh}>{ui('Retry')}</button></p>}
    {authLoading || enabled && !data && !error ? <p role="status" className="p-6 text-sm text-slate-500">{ui('Loading assigned inventory...')}</p> : !enabled && !error ? <p className="rounded-xl border p-5 text-sm text-slate-600">{ui('An active employee account is required to view issued stock.')}</p> : null}
    {data && <>
      <div className="flex flex-wrap items-center justify-between gap-2"><Input className="w-full sm:max-w-sm" aria-label={ui('Search my stock')} placeholder={ui('Search my stock')} value={search} onChange={e => setSearch(e.target.value)}/>{data.updated_at && <p className="text-xs text-slate-500">{ui('Last stock update')}: {formatDateTime(data.updated_at)}</p>}</div>
      <p className="text-xs text-slate-500">{ui('On hand is what you currently hold. Sale quantities exclude Dégustation and held or expired goods.')}</p>
      {!allRows.length && !needsReview && <p className="rounded-xl border border-dashed p-6 text-sm text-slate-500">{ui('No goods currently assigned')}</p>}
      {allRows.length > 0 && !allRows.some(match) && <p className="rounded-xl border p-6 text-sm text-slate-500">{ui('No products match this view.')}</p>}
      {data.runs.map(run => {
        const rows = currentStockRows(data, {dispatchId:run.id}).filter(match);
        if (!rows.length && !run.stock_error && !run.pending_return) return null;
        return <section key={run.id} className="min-w-0 rounded-xl border bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-2"><div><h2 className="text-sm font-semibold">{run.vehicle_name || ui('Employee-held goods')}</h2><p className="mt-1 text-xs text-slate-500">{[run.dispatch_number, run.dispatch_date].filter(Boolean).join(' · ')}</p></div>{run.driver_name && <p className="text-xs text-slate-500">{run.driver_name}</p>}</div>
          {run.pending_return && <p className="mt-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">{ui('Awaiting warehouse receipt. These goods are still in your possession.')}</p>}
          {run.stock_error && <p role="alert" className="mt-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">{uiMessage(run.stock_error)}</p>}
          <IssuedStockRows rows={rows} details/>
        </section>;
      })}
      {data.legacy?.filter(location => location.stock_error).map(location => <p key={location.id} role="alert" className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">{location.name}: {uiMessage(location.stock_error)}</p>)}
      {!!otherRows.length && <section className="rounded-xl border bg-white p-4"><h2 className="text-sm font-semibold">{ui('Other goods in your possession')}</h2><p className="mt-1 text-xs text-slate-500">{ui('Ask warehouse management to reconcile these goods before sale or reissue.')}</p><IssuedStockRows rows={otherRows} details/></section>}
      {role !== 'driver' && <details className="rounded-xl border bg-white px-4"><summary className="cursor-pointer py-4 text-sm font-semibold">{ui('My sales this month')}</summary><DataTable data={data.sales || []} columns={[{key:'order_date',label:ui('Date')},{key:'order_number',label:ui('Reference')},{key:'customer_name',label:ui('Customer')},{key:'payment_type',label:ui('Payment')},{key:'total',label:ui('Amount'),render:formatXAF},{key:'status',label:ui('Status')}]} emptyMessage={ui('No sales recorded this month')}/><p className="my-3 text-sm font-semibold">{ui('Dégustation recorded this month')}</p><DegustationHistory records={data.degustations || []}/></details>}
    </>}
    {giveaway && enabled && role !== 'driver' && <DegustationForm onClose={() => setGiveaway(false)} onSaved={() => {setGiveaway(false); refresh();}}/>}
  </section>;
}
