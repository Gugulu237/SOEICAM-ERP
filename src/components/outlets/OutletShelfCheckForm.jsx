
/* localized-messages */
import { uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import ProductThumb from '@/components/shared/ProductThumb';
import { invokeFieldOps, errorMessage } from '@/lib/field-ops';
import { OUTLET_ISSUES } from '@/server/domain/outlet-rules.js';
import { formatQuantity } from '@/lib/formatters';

export default function OutletShelfCheckForm({ location, delivery, products, snapshotKey, onClose, onDone }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const selected = products.filter(product => delivery.lines.some(line => line.product_id === product.id));
  const [lines, setLines] = useState(() => selected.map(product => ({ product_id: product.id, quantity: '', issue: 'none' })));
  const [notes, setNotes] = useState(''), [feedback, setFeedback] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [requestKey] = useState(() => crypto.randomUUID());
  const pending = useRef(false);
  const patch = (id, values) => setLines(rows => rows.map(line => line.product_id === id ? { ...line, ...values } : line));
  const valid = lines.length && lines.every(line => line.quantity !== '' && Number.isFinite(Number(line.quantity)) && Number(line.quantity) >= 0 && Number(line.quantity) <= 1e9);
  const submit = async event => {
    event.preventDefault(); if (pending.current || !valid) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const result = await invokeFieldOps({ action: 'submitDeliveryShelfCheck', locationId: location.id, deliveryKey: delivery.key, snapshotKey, requestKey, lines, notes, marketingFeedback: feedback });
      if (result.data.error) throw new Error(result.data.error);
      onDone?.();
    } catch (failure) { setError(errorMessage(failure)); }
    finally { pending.current = false; setBusy(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className="max-h-[92dvh] max-w-2xl overflow-y-auto" onPointerDownOutside={event => event.preventDefault()}><DialogHeader><DialogTitle>{ui("Shelf count after delivery")}</DialogTitle><DialogDescription>{location.customer_name} / {location.name} / {delivery.document_number}{ui(". Count all units now on the shelves for each product below, including stock already there.")}</DialogDescription></DialogHeader>
    <form onSubmit={submit} className="space-y-4"><fieldset disabled={busy} className="space-y-4">{lines.map(line => { const product = selected.find(row => row.id === line.product_id), batches = delivery.lines.filter(row => row.product_id === product.id), total = batches.reduce((sum, row) => sum + row.quantity, 0); return <section key={product.id} className="space-y-3 rounded-xl border bg-slate-50/60 p-4"><div className="flex items-center gap-3"><ProductThumb product={product} size={56} /><div><h3 className="text-sm font-semibold">{product.name}</h3><p className="mt-1 text-xs text-blue-800">{ui("This delivery: ")}{formatQuantity(total)} {product.unit_of_measure || product.storage_unit || ui("units")}</p><p className="mt-1 text-xs text-slate-500">{batches.map(batch => batch.lot_number || ui("Batch not recorded")).join(' / ')}</p></div></div><label className="block space-y-1 text-sm font-medium">{ui("Total remaining on shelves *")}<Input aria-label={'Shelf count for ' + product.name} required type="number" min="0" max="1000000000" step="0.001" value={line.quantity} placeholder={ui("Count the shelf; enter 0 for stock-out")} onChange={event => patch(product.id, { quantity: event.target.value })} /></label><label className="block space-y-1 text-xs">{ui("Concern")}<select value={line.issue} onChange={event => patch(product.id, { issue: event.target.value })} className="h-10 w-full rounded-md border bg-white px-3">{Object.entries(OUTLET_ISSUES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></section>; })}
      <label className="block space-y-1 text-sm">{ui("Stock notes")}<Textarea maxLength={2000} value={notes} onChange={event => setNotes(event.target.value)} placeholder={ui("Explain unexpected extra stock, packaging or refrigeration concerns.")} /></label><label className="block space-y-1 text-sm">{ui("Customer feedback & marketing")}<Textarea maxLength={2000} value={feedback} onChange={event => setFeedback(event.target.value)} placeholder={ui("Customer requests, promotion activity, product feedback or display needs.")} /></label></fieldset>
      <p className="rounded-xl bg-blue-50 p-3 text-xs leading-5 text-blue-900">{ui("Informational shelf check only. This does not create a sale, invoice, stock movement or accounting entry. Submit the day's total units sold separately in the daily report.")}</p>
      {error && <p role="alert" className="text-sm text-red-700">{uiMessage(error)}</p>}<div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={onClose}>{ui("Cancel")}</Button><Button type="submit" disabled={busy || !valid}>{busy ? ui("Submitting...") : ui("Submit shelf count")}</Button></div>
    </form>
  </DialogContent></Dialog>;
}
