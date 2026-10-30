import React, { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, CheckCircle2, MapPin, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ui, uiMessage } from '@/lib/i18n';
import { invokeFieldOps, errorMessage } from '@/lib/field-ops';
import { deliveryPointKey, driverLoadSnapshot, latestDriverPlan } from '@/lib/driver-deliveries';
import CustomerMapLinks from '@/components/customers/CustomerMapLinks';

export function DriverLoadReceipt({ data, run, preview, onRefresh }) {
  const [checked, setChecked] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const pending = useRef(false), requestKey = useRef(crypto.randomUUID());
  const snapshot = driverLoadSnapshot(run, data.manifest);
  const receipt = (data.activities || []).find(row => row.dispatch_id === run.id && row.type === 'stock_received' && row.load_snapshot === snapshot);
  const loaded = (data.manifest || []).some(line => line.dispatch_id === run.id && Number(line.loaded_quantity) > 0);
  if (!loaded || !['loaded', 'in_transit'].includes(run.status) || (data.activities || []).some(row => row.dispatch_id === run.id && row.type === 'trip_returned')) return null;
  const receive = async () => {
    if (pending.current || !checked || preview) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const result = await invokeFieldOps({ action: 'driverReceiveLoad', dispatchId: run.id, loadSnapshot: snapshot, requestKey: requestKey.current });
      if (result.data.error) throw Error(result.data.error);
      requestKey.current = crypto.randomUUID(); setChecked(false); onRefresh?.();
    } catch (failure) { setError(errorMessage(failure)); }
    finally { pending.current = false; setBusy(false); }
  };
  return <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-4">
    {receipt ? <p className="flex items-center gap-2 text-sm font-medium text-green-900"><CheckCircle2 size={18} />{ui('Load receipt confirmed')}</p> : <>
      <label className="flex min-h-11 items-start gap-3 text-sm"><input className="mt-1 h-4 w-4 shrink-0" type="checkbox" checked={checked} disabled={preview || busy} onChange={event => setChecked(event.target.checked)} />{ui('I checked the loaded products and quantities and received them for delivery.')}</label>
      <Button className="mt-3" disabled={preview || busy || !checked} onClick={receive}>{busy ? ui('Saving...') : ui('Confirm load receipt')}</Button>
    </>}
    <p className="mt-2 text-xs text-green-900">{ui('Warehouse staff issue the goods. Your receipt confirms custody of this load.')}</p>
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{uiMessage(error)}</p>}
  </div>;
}

export default function DriverDeliveryPlanner({ data, preview, onRefresh }) {
  const runs = (data.dispatches || []).filter(run => ['approved', 'loaded', 'in_transit'].includes(run.status) && !(data.activities || []).some(row => row.dispatch_id === run.id && row.type === 'trip_returned'));
  const [selected, setSelected] = useState(runs[0]?.id || '');
  const run = runs.find(row => row.id === selected) || runs[0];
  return <section className="space-y-4"><h2 className="text-lg font-semibold">{ui('Plan deliveries & view customers')}</h2>
    {!run ? <p className="rounded-xl border bg-white p-5 text-sm text-slate-500">{ui('Your delivery customers appear when a run is assigned to you.')}</p> : <>
      <label className="block space-y-2 text-sm font-medium">{ui('My delivery run')}<select className="h-11 w-full rounded-md border bg-white px-3" value={run.id} onChange={event => setSelected(event.target.value)}>{runs.map(row => <option key={row.id} value={row.id}>{row.dispatch_number} / {row.vehicle_name} / {row.dispatch_date}</option>)}</select></label>
      <RunPlan key={run.id} data={data} run={run} preview={preview} onRefresh={onRefresh} />
    </>}
  </section>;
}

function RunPlan({ data, run, preview, onRefresh }) {
  const points = (data.deliveryCustomers || []).filter(point => point.dispatch_id === run.id);
  const saved = latestDriverPlan(data.activities, run.id);
  const [selection, setSelection] = useState(() => (saved?.planned_stops || []).filter(point => points.some(candidate => deliveryPointKey(candidate) === deliveryPointKey(point))).map(deliveryPointKey));
  const [search, setSearch] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const pending = useRef(false), requestKey = useRef(crypto.randomUUID());
  const change = next => { setSelection(next); requestKey.current = crypto.randomUUID(); setMessage(''); setError(''); };
  const move = (index, offset) => { const next = [...selection]; [next[index], next[index + offset]] = [next[index + offset], next[index]]; change(next); };
  const save = async () => {
    if (pending.current || preview) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const result = await invokeFieldOps({ action: 'driverSaveDeliveryPlan', dispatchId: run.id, requestKey: requestKey.current,
        stops: selection.map(key => { const point = points.find(candidate => deliveryPointKey(candidate) === key); return { customer_id: point.customer_id, location_id: point.location_id }; }) });
      if (result.data.error) throw Error(result.data.error);
      requestKey.current = crypto.randomUUID(); setMessage(ui('Delivery plan saved')); onRefresh?.();
    } catch (failure) { setError(errorMessage(failure)); }
    finally { pending.current = false; setBusy(false); }
  };
  const visible = points.filter(point => [point.customer_name, point.name, point.address, point.neighbourhood, point.town].join(' ').toLowerCase().includes(search.toLowerCase()));
  return <div className="space-y-5">
    <div className="rounded-xl border bg-white p-4"><h3 className="font-semibold">{ui('Planned stop order')}</h3>
      {!selection.length && <p className="mt-3 text-sm text-slate-500">{ui('Select customers below, then arrange your delivery order.')}</p>}
      <ol className="mt-3 space-y-2">{selection.map((key, index) => { const point = points.find(candidate => deliveryPointKey(candidate) === key); return <li key={key} className="flex items-center gap-2 rounded-lg bg-slate-50 p-2"><span className="w-6 shrink-0 text-sm font-semibold">{index + 1}.</span><span className="min-w-0 flex-1 text-sm">{point?.customer_name} {point?.location_id ? '/ ' + point.name : ''}</span><Button size="icon" variant="outline" aria-label={ui('Move stop up')} disabled={preview || busy || index === 0} onClick={() => move(index, -1)}><ArrowUp size={16} /></Button><Button size="icon" variant="outline" aria-label={ui('Move stop down')} disabled={preview || busy || index === selection.length - 1} onClick={() => move(index, 1)}><ArrowDown size={16} /></Button></li>; })}</ol>
      <Button className="mt-4" disabled={preview || busy} onClick={save}>{busy ? ui('Saving...') : ui('Save delivery plan')}</Button>
      <p className="mt-2 text-xs text-slate-500">{ui('This plan organizes visits. The commercial agent records sales from the assigned stock.')}</p>
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{uiMessage(error)}</p>}{message && <p role="status" className="mt-3 text-sm text-green-700">{message}</p>}
    </div>
    <input className="h-11 w-full rounded-md border px-3 text-sm" aria-label={ui('Find a delivery customer')} placeholder={ui('Find customer or address.')} value={search} onChange={event => setSearch(event.target.value)} />
    <div className="grid gap-4 lg:grid-cols-2">{visible.map(point => { const key = deliveryPointKey(point), included = selection.includes(key); return <article key={key} className="space-y-3 rounded-xl border bg-white p-4">
      <label className="flex min-h-11 items-start gap-3 text-sm font-medium"><input className="mt-1 h-4 w-4 shrink-0" type="checkbox" checked={included} disabled={preview || busy || !included && selection.length >= 100} onChange={() => change(included ? selection.filter(value => value !== key) : [...selection, key])} /><span>{point.customer_name}{point.location_id && <span className="mt-1 block font-normal text-slate-500">{point.name}</span>}</span></label>
      <p className="flex gap-2 text-sm text-slate-600"><MapPin size={16} className="shrink-0" />{[point.address, point.neighbourhood, point.town].filter(Boolean).join(', ') || ui('Address not recorded')}</p>
      {point.delivery_instructions && <p className="rounded-lg bg-slate-50 p-3 text-sm">{point.delivery_instructions}</p>}
      <div className="flex flex-wrap items-center gap-3"><CustomerMapLinks customer={point} />{point.phone && <a className="inline-flex min-h-11 items-center gap-2 text-sm text-blue-700" href={'tel:' + point.phone.replace(/[^+\d]/g, '')}><Phone size={15} />{point.contact_person || point.phone}</a>}</div>
    </article>; })}</div>
    {!visible.length && <p className="text-sm text-slate-500">{ui('No assigned customers match this search.')}</p>}
  </div>;
}
