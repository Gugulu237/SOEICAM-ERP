import React, {useCallback, useEffect, useRef, useState} from 'react';
import {ui, uiMessage} from '@/lib/i18n';
import {useLocaleRender} from '@/lib/localization';
import {invokeFieldOps} from '@/lib/field-ops';
import {formatDate, formatQuantity} from '@/lib/formatters';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';

const invoke = async body => {
  const {data} = await invokeFieldOps(body);
  if (data?.error) throw Error(data.error);
  return data;
};
const statusText = status => ({pending:'Awaiting warehouse receipt', received:'Received by warehouse', rejected:'Return rejected', cancelled:'Return cancelled'})[status] || status;
const sameQuantity = (value, expected) => value !== '' && value !== undefined && Number.isFinite(Number(value)) && Number(value) >= 0 && Math.abs(Number(value) - Number(expected)) < 0.000001;

function LotDetails({row}) {
  return !!row.lots?.length && <details className="mt-1 text-xs text-slate-500"><summary className="cursor-pointer">{ui('Batch details')}</summary><div className="mt-2 space-y-1">{row.lots.map((lot, index) => <p key={index}>{lot.lot_number || ui('No batch recorded')} - {formatQuantity(lot.quantity)} {row.unit}{lot.expiry_date ? ' - ' + ui('Expiry') + ': ' + formatDate(lot.expiry_date) : ''}{lot.qc_status ? ' - ' + ui(lot.qc_status) : ''}</p>)}</div></details>;
}

export default function UnsoldStockReturns({mode = 'own', onChanged}) {
  useLocaleRender();
  const [data, setData] = useState(null), [loading, setLoading] = useState(true), [loadError, setLoadError] = useState('');
  const [selected, setSelected] = useState(null), [counts, setCounts] = useState({}), [note, setNote] = useState(''), [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const sequence = useRef(0), lock = useRef(false), requestKey = useRef('');
  const reset = useCallback(() => {setSelected(null); setCounts({}); setNote(''); setConfirmed(false); setError(''); requestKey.current = '';}, []);
  const load = useCallback(async () => {
    const current = ++sequence.current; setLoading(true); setLoadError('');
    try {const value = await invoke({action:'unsoldReturnWorkspace', mode}); if (current === sequence.current) {setData(value); reset();}}
    catch (e) {if (current === sequence.current) setLoadError(e.message);}
    finally {if (current === sequence.current) setLoading(false);}
  }, [mode, reset]);
  useEffect(() => {setData(null); reset(); load(); return () => {sequence.current++;};}, [load, reset]);
  const receiving = mode === 'receive';
  const record = selected?.kind === 'run' ? data?.runs.find(row => row.id === selected.id) : data?.requests.find(row => row.id === selected?.id);
  const rows = record?.rows || [], countReady = rows.length > 0 && rows.every(row => sameQuantity(counts[row.product_id], row.quantity));
  const countTouched = rows.some(row => counts[row.product_id] !== undefined && counts[row.product_id] !== '');
  function choose(kind, id) {
    if (busy || loading) return;
    setSelected({kind, id}); setCounts({}); setNote(''); setConfirmed(false); setError(''); setNotice(''); requestKey.current = crypto.randomUUID();
  }
  async function save(action) {
    if (lock.current || !record) return;
    if (['requestUnsoldReturn', 'receiveUnsoldReturn'].includes(action) && (!countReady || !confirmed)) return;
    if (action === 'rejectUnsoldReturn' && !note.trim()) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    const countedLines = rows.map(row => ({product_id:row.product_id, quantity:Number(counts[row.product_id])}));
    const body = action === 'requestUnsoldReturn'
      ? {action, dispatchId:record.id, token:record.token, countedLines, notes:note, requestKey:requestKey.current, confirmed:true}
      : action === 'receiveUnsoldReturn' ? {action, requestId:record.id, token:record.token, countedLines, confirmed:true, note:note.trim()}
      : {action, requestId:record.id, note:note.trim()};
    try {
      const result = await invoke(body);
      reset(); setNotice(action === 'requestUnsoldReturn' ? 'Return sent to warehouse. This load is reserved until it is received or the request is cancelled or rejected.' : action === 'receiveUnsoldReturn' ? 'Unsold goods received into the warehouse.' : action === 'rejectUnsoldReturn' ? 'Return rejected. The load is available to its holder again.' : 'Return cancelled. The load is available to its holder again.');
      onChanged?.(result); await load();
    } catch (e) {setError(e.message);}
    finally {lock.current = false; setBusy(false);}
  }
  return <section className="min-w-0 space-y-4">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">{ui(receiving ? 'Receive unsold goods' : 'Return all unsold goods')}</h2><p className="mt-1 max-w-2xl text-sm text-slate-500">{ui(receiving ? 'Count the complete remaining load before accepting it into the warehouse.' : 'Count all goods left in your assigned load and ask the warehouse to receive them.')}</p></div><Button variant="outline" disabled={busy || loading} onClick={load}>{ui('Refresh')}</Button></header>
    <p className="text-xs text-slate-500">{ui('Returning unsold goods creates no sale or cash payment. The recorded batches, expiry dates, quality status and cost are retained.')}</p>
    {loading && <p role="status" className="text-sm text-slate-500">{ui('Loading stock returns...')}</p>}
    {loadError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{uiMessage(loadError)}</p>}
    {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{ui(notice)}</p>}
    {data && !selected && <>
      {!receiving && <div className="grid gap-3 md:grid-cols-2">{data.runs.map(run => <article key={run.id} className="space-y-3 rounded-xl border bg-white p-4"><div><h3 className="font-semibold">{run.dispatch_number || ui('Assigned load')}</h3><p className="mt-1 text-sm text-slate-500">{run.holder_name}{run.driver_name ? ' - ' + run.driver_name : ''}</p><p className="mt-1 text-xs text-slate-500">{run.vehicle_name || ui('Employee-held goods')} - {formatDate(run.dispatch_date)}</p><p className="mt-1 text-xs text-slate-500">{ui('Receiving warehouse')}: {run.warehouse_name}</p></div><div className="space-y-1 text-sm">{run.rows.map(row => <p key={row.product_id} className="flex justify-between gap-3"><span>{row.product_name}</span><span className="shrink-0 font-medium">{formatQuantity(row.quantity)} {row.unit}</span></p>)}</div>{run.error && <p role="alert" className="text-sm text-red-700">{uiMessage(run.error)}</p>}{run.pending_request_id ? <p className="text-sm text-amber-800">{ui('Awaiting warehouse receipt')}</p> : <Button variant="outline" disabled={busy || loading || !!run.error || !run.rows.length} aria-label={ui('Count unsold goods') + ': ' + (run.dispatch_number || run.id)} onClick={() => choose('run', run.id)}>{ui('Count unsold goods')}</Button>}</article>)}</div>}
      {data.requests.length > 0 && <div className="space-y-3"><h3 className="text-sm font-semibold">{ui(receiving ? 'Warehouse return requests' : 'My return requests')}</h3>{data.requests.map(request => <article key={request.id} className="rounded-xl border bg-white p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div><h4 className="font-semibold">{request.dispatch_number || ui('Assigned load')}</h4><p className="mt-1 text-xs text-slate-500">{request.holder_name}{request.driver_name ? ' - ' + request.driver_name : ''} - {request.warehouse_name}</p><p className="mt-1 text-xs text-slate-500">{formatDate(request.requested_at)}</p></div><span className="text-xs font-medium">{ui(statusText(request.status))}</span></div>{request.review_note && <p className="mt-2 text-sm text-slate-600">{request.review_note}</p>}{request.error && <p role="alert" className="mt-2 text-sm text-red-700">{uiMessage(request.error)}</p>}<Button className="mt-3" variant="outline" disabled={busy || loading} aria-label={ui('Review return') + ': ' + (request.dispatch_number || request.id)} onClick={() => choose('request', request.id)}>{ui('Review return')}</Button></article>)}</div>}
      {!data.requests.length && (receiving || !data.runs.length) && <p className="rounded-xl border bg-white p-6 text-sm text-slate-500">{ui(receiving ? 'No unsold goods are awaiting warehouse receipt.' : 'No issued load or return request is available.')}</p>}
    </>}
    {record && <article className="space-y-4 rounded-xl border bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{record.dispatch_number || ui('Assigned load')}</h3><p className="mt-1 text-sm text-slate-500">{ui('Receiving warehouse')}: {record.warehouse_name}</p>{selected.kind === 'request' && <p className="mt-1 text-xs font-medium">{ui(statusText(record.status))}</p>}</div><Button variant="ghost" disabled={busy} onClick={reset}>{ui('Back')}</Button></div>
      {selected.kind === 'run' && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{ui('This request returns the entire remaining load. Sales and further issues from it pause until warehouse receipt, cancellation or rejection.')}</p>}
      {record.notes && <p className="text-sm text-slate-600">{record.notes}</p>}
      {record.review_note && <p className="text-sm text-slate-600">{record.review_note}</p>}
      {record.error && <p role="alert" className="text-sm text-red-700">{uiMessage(record.error)}</p>}
      <fieldset disabled={busy || loading} className="space-y-4">
        <div className="overflow-x-auto"><table className="mobile-table-cards w-full text-sm"><thead><tr className="border-b text-left text-xs text-slate-500"><th className="py-2 pr-3">{ui('Product')}</th><th className="py-2 pr-3 text-right">{ui('Recorded remaining quantity')}</th>{(selected.kind === 'run' || receiving && record.can_receive) && <th className="py-2 text-right">{ui('Counted return')}</th>}</tr></thead><tbody>{rows.map(row => <tr key={row.product_id} className="border-b last:border-0"><td data-label={ui('Product')} className="py-3 pr-3"><span className="font-medium">{row.product_name}</span><LotDetails row={row}/></td><td data-label={ui('Recorded remaining quantity')} className="py-3 pr-3 text-right">{formatQuantity(row.quantity)} {row.unit}</td>{(selected.kind === 'run' || receiving && record.can_receive) && <td data-label={ui('Counted return')} className="py-3"><Input className="ml-auto w-32 max-w-full" type="number" min="0" max={row.quantity} step="0.001" aria-label={ui('Counted return') + ': ' + row.product_name} value={counts[row.product_id] ?? ''} onChange={e => {setCounts(current => ({...current, [row.product_id]:e.target.value})); setConfirmed(false);}}/></td>}</tr>)}</tbody></table></div>
        {!!record.collections?.length && <div className="space-y-2 rounded-lg bg-slate-50 p-3"><h4 className="text-sm font-semibold">{ui('Collected customer returns')}</h4><p className="text-xs text-slate-500">{ui('These collected goods are received separately into quarantine. They are not added to the unsold product quantities above.')}</p>{record.collections.map((collection, index) => <div key={index} className="flex flex-wrap justify-between gap-2 border-t pt-2 text-sm"><div><p>{collection.product_name}</p><p className="text-xs text-slate-500">{collection.returned_lot_number || ui('No batch recorded')}{collection.returned_expiry_date ? ' - ' + ui('Expiry') + ': ' + formatDate(collection.returned_expiry_date) : ''}</p></div><span>{formatQuantity(collection.quantity)} {collection.unit}</span></div>)}</div>}
        {(selected.kind === 'run' || receiving && record.can_receive) && <>
          {countTouched && !countReady && <p role="alert" className="text-sm text-amber-800">{ui('Enter every physical count, including zero. Counts must match the whole remaining load; ask warehouse management to reconcile any difference.')}</p>}
          <label className="flex items-start gap-2 text-sm"><input className="mt-1" type="checkbox" checked={confirmed} aria-label={ui('Confirm complete physical count')} onChange={e => setConfirmed(e.target.checked)}/><span>{ui(receiving ? 'I have physically received and counted all unsold goods and any collected customer returns shown above.' : 'I have physically counted all unsold goods and any collected customer returns shown above for return to the warehouse.')}</span></label>
        </>}
        {(selected.kind === 'run' || record.status === 'pending' && (record.can_cancel || receiving && record.can_receive)) && <label className="block space-y-1 text-sm">{ui(receiving ? 'Receipt note / rejection reason' : 'Return note (optional)')}<textarea className="min-h-20 w-full rounded-md border p-3 text-sm" aria-label={ui('Return note')} maxLength={2000} value={note} onChange={e => setNote(e.target.value)}/></label>}
      </fieldset>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{uiMessage(error)}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        {selected.kind === 'run' && <Button disabled={busy || loading || !!record.error || !countReady || !confirmed} onClick={() => save('requestUnsoldReturn')}>{busy ? ui('Sending...') : ui('Send return request')}</Button>}
        {selected.kind === 'request' && record.status === 'pending' && !receiving && record.can_cancel && <Button variant="outline" disabled={busy || loading} onClick={() => save('cancelUnsoldReturn')}>{busy ? ui('Saving...') : ui('Cancel return request')}</Button>}
        {selected.kind === 'request' && record.status === 'pending' && receiving && record.can_receive && <><Button variant="outline" disabled={busy || loading || !note.trim()} onClick={() => save('rejectUnsoldReturn')}>{ui('Reject return')}</Button><Button disabled={busy || loading || !!record.error || !countReady || !confirmed} onClick={() => save('receiveUnsoldReturn')}>{busy ? ui('Receiving...') : ui('Confirm warehouse receipt')}</Button></>}
      </div>
    </article>}
  </section>;
}
