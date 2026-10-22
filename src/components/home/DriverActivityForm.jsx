
/* localized-messages */
import { sourceMessage, uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { invokeFieldOps, errorMessage, uploadReceipt } from '@/lib/field-ops';

export default function DriverActivityForm({ task, onClose, onDone }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [type, setType] = useState(task.type);
  const [receiver, setReceiver] = useState('');
  const [notes, setNotes] = useState('');
  const [reference, setReference] = useState('');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const requestKey = useRef(crypto.randomUUID());
  const delivery = !!task.order;
  const upload = async (file) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setError(sourceMessage("Choose a photo or PDF under 10 MB.")); return; }
    setUploading(true); setError('');
    try { const uri = await uploadReceipt(file); setFiles((rows) => [...rows, uri]); }
    catch (e) { setError(errorMessage(e)); }
    finally { setUploading(false); }
  };
  const submit = async (event) => {
    event.preventDefault();
    if (submitting.current || uploading) return;
    submitting.current = true; setBusy(true); setError('');
    try {
      const res = await invokeFieldOps({ action: 'driverActivity', dispatchId: task.dispatch.id, orderId: task.order?.id,
        type, receiver, notes, receiptReference: reference, fileUris: files, requestKey: requestKey.current });
      if (res.data.error) throw new Error(res.data.error);
      onDone();
    } catch (e) { setError(errorMessage(e)); }
    finally { submitting.current = false; setBusy(false); }
  };
  return <Dialog open onOpenChange={(open) => { if (!open && !busy && !uploading) onClose(); }}><DialogContent className="max-h-[90dvh] overflow-y-auto" onPointerDownOutside={(e) => e.preventDefault()}>
    <DialogHeader><DialogTitle>{delivery ? task.order.customer_name : type === 'trip_started' ? ui("Start this run") : type === 'trip_returned' ? ui("Report your return to base") : ui("Report an incident")}</DialogTitle><DialogDescription>{task.dispatch.dispatch_number} · {task.dispatch.vehicle_name}</DialogDescription></DialogHeader>
    <form onSubmit={submit} className="space-y-4"><fieldset disabled={busy || uploading} className="space-y-4">
      {delivery && <><label className="block space-y-2 text-sm font-medium">{ui("Delivery outcome")}<select className="h-11 w-full rounded-md border bg-white px-3" value={type} onChange={(e) => setType(e.target.value)}><option value="delivery_completed">{ui("Goods received in full")}</option><option value="delivery_partial">{ui("Partially received")}</option><option value="delivery_failed">{ui("Could not deliver")}</option></select></label>
        {type !== 'delivery_failed' && <label className="block space-y-2 text-sm font-medium">{ui("Received by *")}<Input value={receiver} maxLength={200} required onChange={(e) => setReceiver(e.target.value)} placeholder={ui("Customer or recipient name")} /></label>}</>}
      {type === 'trip_started' && <p className="text-sm text-slate-600">{ui("Confirm that the warehouse has loaded the vehicle and you are departing on this assigned run.")}</p>}
      {type === 'trip_returned' && <p className="text-sm text-slate-600">{ui("Confirm you are back at base. The warehouse will count returned goods and reconcile this run.")}</p>}
      <label className="block space-y-2 text-sm font-medium">{['delivery_partial', 'delivery_failed', 'incident'].includes(type) ? ui("What happened? *") : ui("Notes (optional)")}<Textarea value={notes} maxLength={2000} required={['delivery_partial', 'delivery_failed', 'incident'].includes(type)} onChange={(e) => setNotes(e.target.value)} placeholder={type === 'delivery_partial' ? ui("List the products and quantities accepted, refused or missing.") : ui("Add useful details for dispatch.")} /></label>
      {delivery && <><label className="block space-y-2 text-sm font-medium">{ui("Delivery note reference")}<Input value={reference} maxLength={200} onChange={(e) => setReference(e.target.value)} /></label><label className="block space-y-2 text-sm font-medium">{ui("Delivery photo / signed note (optional)")}<input aria-label={ui("Attach delivery evidence")} className="block w-full text-sm" type="file" accept="image/*,application/pdf" capture="environment" disabled={files.length >= 8} onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} /></label>
        <p className="text-xs text-slate-500">{uploading ? ui("Uploading evidence…") : ui("{0} private attachment(s)", files.length)}</p></>}
    </fieldset>
      {delivery && <p className="text-xs text-slate-500">{ui("Your report is sent to dispatch for reconciliation. Stock and invoice updates remain with the responsible staff.")}</p>}
      {error && <p role="alert" className="text-sm text-red-700">{uiMessage(error)}</p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy || uploading} onClick={onClose}>{ui("Cancel")}</Button><Button type="submit" disabled={busy || uploading}>{busy ? ui("Saving…") : ui("Confirm report")}</Button></div>
    </form>
  </DialogContent></Dialog>;
}
