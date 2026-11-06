import React, { useEffect, useState } from 'react';
import { ui, uiMessage } from '@/lib/i18n';
import { useLocaleRender } from '@/lib/localization';
import { invokeFieldOps } from '@/lib/field-ops';
import { useNavigate } from '@/lib/router';
import { watchSalesStock } from '@/lib/sales-stock-refresh';
import { formatQuantity, formatXAF } from '@/lib/formatters';
import PageHeader from '@/components/shared/PageHeader';
import ProductThumb from '@/components/shared/ProductThumb';
import DataTable from '@/components/shared/DataTable';
import DegustationForm from '@/components/distribution/DegustationForm';
import DegustationHistory from '@/components/distribution/DegustationHistory';
import { Button } from '@/components/ui/button';
export default function EmployeeStock() {
  useLocaleRender();
  const navigate = useNavigate(), [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [giveaway, setGiveaway] = useState(false), [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true, pending = false;
    async function load() {
      if (pending) return; pending = true; if (active) setBusy(true);
      try { const { data } = await invokeFieldOps({ action: 'employeeStockWorkspace' }); if (data.error) throw Error(data.error); if (active) { setData(data); setError(''); } }
      catch (e) { if (active) setError(e.message); }
      finally { pending = false; if (active) setBusy(false); }
    }
    load(); const stop = watchSalesStock(load); return () => { active = false; stop(); };
  }, [revision]);
  const canRecord = data?.runs.some(r => r.can_supply) && !error && !busy;
  return <div className="space-y-5">
    <PageHeader title={ui('My issued stock')} subtitle={data?.employeeName || ui('Goods assigned to your employee account')} actions={<div className="flex flex-wrap gap-2"><Button disabled={!canRecord} onClick={() => navigate('/my-stock/new')}>{ui('Record sale')}</Button><Button variant="outline" disabled={!canRecord || !data.balances.some(b => b.degustation_quantity > 0)} onClick={() => setGiveaway(true)}>{ui('Record Dégustation')}</Button></div>}/>
    {error && <p role="alert" className="text-red-700">{uiMessage(error)} <Button variant="outline" onClick={() => setRevision(n => n + 1)}>{ui('Retry')}</Button></p>}
    {!data && busy && <p role="status">{ui('Loading...')}</p>}
    {data && <>
      <p className="text-sm text-slate-500">{ui('Sell from your issued goods. Return unsold quantities to the warehouse for counting. Cash collected must be handed to the cashier for receipt and approval.')}</p>
      {!data.runs.length && <p className="rounded-xl border p-6">{ui('No goods have been issued to you. Ask warehouse management to issue stock to your name.')}</p>}
      {data.runs.map(run => <section key={run.id} className="space-y-3 rounded-xl border bg-white p-4"><h2 className="font-semibold">{run.dispatch_number} · {run.dispatch_date}</h2><p className="text-xs text-slate-500">{run.vehicle_name || ui('Employee-held goods')}{run.driver_name ? ' · ' + run.driver_name : ''}</p>
        {run.stock_error && <p role="alert" className="text-red-700">{uiMessage(run.stock_error)}</p>}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{data.products.map(p => { const balances = data.balances.filter(b => b.dispatch_id === run.id && b.product_id === p.id); return { ...p, sale: balances.reduce((sum, b) => sum + Number(b.usable_quantity || 0), 0), giveaway: balances.reduce((sum, b) => sum + Number(b.degustation_quantity || 0), 0) }; }).filter(p => p.sale > 0 || p.giveaway > 0).map(p => <article key={p.id} className="rounded-xl border p-3"><ProductThumb product={p} size={80}/><h3 className="mt-2 text-sm font-semibold">{p.name}</h3><dl className="mt-2 space-y-1 text-xs"><div className="flex justify-between gap-2"><dt>{ui('For sale')}</dt><dd>{formatQuantity(p.sale)}</dd></div><div className="flex justify-between gap-2 text-emerald-700"><dt>{ui('Dégustation')}</dt><dd>{formatQuantity(p.giveaway)}</dd></div></dl></article>)}</div>
      </section>)}
      <h2 className="font-semibold">{ui('My sales this month')}</h2><DataTable data={data.sales} columns={[{ key: 'order_date', label: ui('Date') }, { key: 'order_number', label: ui('Reference') }, { key: 'customer_name', label: ui('Customer') }, { key: 'payment_type', label: ui('Payment') }, { key: 'total', label: ui('Amount'), render: formatXAF }, { key: 'status', label: ui('Status') }]} emptyMessage={ui('No sales recorded this month')}/>
      <p className="text-sm text-slate-500">{ui('Dégustation recorded this month')}</p><DegustationHistory records={data.degustations}/>
    </>}
    {giveaway && <DegustationForm onClose={() => setGiveaway(false)} onSaved={() => { setGiveaway(false); setRevision(n => n + 1); }}/>}
  </div>;
}
