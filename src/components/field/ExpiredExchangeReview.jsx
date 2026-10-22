import React, { useEffect, useRef, useState } from 'react';
import { ui, uiMessage } from '@/lib/i18n';
import { useLocaleRender } from '@/lib/localization';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { invokeFieldOps, errorMessage, receiptUrl } from '@/lib/field-ops';

export default function ExpiredExchangeReview() {
  useLocaleRender();
  const [rows, setRows] = useState([]), [loading, setLoading] = useState(true), [busy, setBusy] = useState('');
  const [notes, setNotes] = useState({}), [error, setError] = useState(''), [message, setMessage] = useState(''), [reload, setReload] = useState(0);
  const submitting = useRef(false);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    invokeFieldOps({ action: 'expiredReturnReviewQueue' }).then(({ data }) => {
      if (data.error) throw Error(data.error);
      if (active) setRows(data.requests);
    }).catch(failure => { if (active) setError(errorMessage(failure)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reload]);
  const review = async (request, approve) => {
    if (submitting.current) return;
    const reviewNote = (notes[request.id] || '').trim();
    if (!approve && !reviewNote) { setError(ui('Enter a reason before rejecting the request.')); return; }
    submitting.current = true; setBusy(request.id); setError(''); setMessage('');
    try {
      const { data } = await invokeFieldOps({ action: approve ? 'verifyExpiredReturn' : 'rejectExpiredReturn', requestId: request.id, reviewNote });
      if (data.error) throw Error(data.error);
      setRows(previous => previous.filter(row => row.id !== request.id));
      setMessage(approve ? ui('Verified. Inventory and accounting have been updated once.') : ui('Request rejected. Stock and accounting are unchanged.'));
    } catch (failure) { setError(errorMessage(failure)); }
    finally { submitting.current = false; setBusy(''); }
  };
  const photo = async uri => { try { window.open(await receiptUrl(uri), '_blank', 'noopener,noreferrer'); } catch (failure) { setError(errorMessage(failure)); } };
  return <section className="space-y-4"><div className="flex flex-wrap justify-between gap-3"><div><h2 className="text-xl font-semibold">{ui('Expired exchange verification')}</h2><p className="mt-1 text-sm text-slate-500">{ui('Check customer acknowledgement, printed expiry, quantity and replacement request before approving. This decision records your own management account.')}</p></div><Button variant="outline" disabled={loading || !!busy} onClick={() => setReload(value => value + 1)}>{ui('Refresh')}</Button></div>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{uiMessage(error)}</p>}{message && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">{message}</p>}
    {loading ? <p role="status">{ui('Loading requests...')}</p> : !rows.length ? <p className="rounded-xl border bg-white p-5 text-sm text-slate-500">{ui('No expired exchanges await verification.')}</p> : rows.map(row => <article key={row.id} className="space-y-3 rounded-xl border bg-white p-4"><div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">{row.customer_name} / {row.location_name}</h3><span className="text-xs text-slate-500">{row.record_number} / {row.reported_date}</span></div><p className="text-sm">{row.product_name}: <strong>{row.quantity} {row.unit}</strong> / {row.replace_now ? ui('Fresh replacement requested') : ui('Collection only')}</p><p className="text-sm text-slate-600">{row.commercial_name} / {row.driver_name} / {row.vehicle_name}</p><p className="text-sm">{ui('Printed expiry')}: {row.returned_expiry_date} / {ui('Lot')}: {row.returned_lot_number || '-'} / {ui('Receipt')}: {row.receipt_reference}</p>{row.notes && <p className="text-sm">{row.notes}</p>}<div className="flex flex-wrap gap-2">{(row.receipt_file_uris || []).map((uri, index) => <Button key={uri} size="sm" variant="outline" onClick={() => photo(uri)}>{ui('Evidence photo')} {index + 1}</Button>)}</div><label className="block text-sm">{ui('Review note (required for rejection)')}<Textarea maxLength={2000} disabled={!!busy} value={notes[row.id] || ''} onChange={event => setNotes(previous => ({ ...previous, [row.id]: event.target.value }))} /></label><div className="flex flex-wrap gap-2"><Button disabled={!!busy || loading} onClick={() => review(row, true)}>{busy === row.id ? ui('Processing...') : ui('Verify & post')}</Button><Button variant="outline" disabled={!!busy || loading} onClick={() => review(row, false)}>{ui('Reject request')}</Button></div></article>)}
  </section>;
}
