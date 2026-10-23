
/* localized-messages */
import { sourceMessage, uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import ProductThumb from '@/components/shared/ProductThumb';
import { invokeFieldOps, errorMessage, uploadReceipt } from '@/lib/field-ops';
import { OUTLET_ISSUES } from '@/server/domain/outlet-rules.js';
import { formatXAF } from '@/lib/formatters';

export default function OutletDailyReportForm({ location, products, snapshotKey, initialProductId, onClose, onDone }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [lines, setLines] = useState(() => products.map(product => ({ product_id: product.id, sold_quantity: '0', damaged_quantity: '0', quantity: '', observed_price: product.retail_price ?? '', issue: 'none' })));
  const [activeProduct, setActiveProduct] = useState(initialProductId || products[0]?.id || '');
  const isComplete = line => {
    if (!line) return false;
    const product = products.find(row => row.id === line.product_id);
    const valid = value => value !== '' && value != null && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 1e9;
    return [line.sold_quantity, line.damaged_quantity, line.quantity].every(valid) && Number(line.sold_quantity) + Number(line.damaged_quantity) <= product.opening_quantity && (line.observed_price === '' || line.observed_price == null || valid(line.observed_price));
  };
  const completed = lines.filter(isComplete).length;
  const [notes, setNotes] = useState(''), [files, setFiles] = useState([]), [uploading, setUploading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [requestKey] = useState(() => crypto.randomUUID());
  const submitting = useRef(false);
  const patch = (id, values) => setLines(rows => rows.map(line => line.product_id === id ? { ...line, ...values } : line));
  const priced = lines.some(line => line.observed_price !== '' && line.observed_price != null) && lines.every(line => Number(line.sold_quantity) === 0 || (line.observed_price !== '' && line.observed_price != null));
  const total = lines.reduce((sum, line) => sum + (Number(line.sold_quantity) || 0) * (Number(line.observed_price) || 0), 0);
  const needsNotes = lines.some(line => {
    const product = products.find(row => row.id === line.product_id);
    return line.issue !== 'none' || Number(line.damaged_quantity) > 0 || (line.quantity !== '' && Math.abs(Number(line.quantity) - product.opening_quantity + Number(line.sold_quantity) + Number(line.damaged_quantity)) > 0.0005);
  });
  const upload = async file => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setError(sourceMessage("Choose a photo under 10 MB.")); return; }
    setUploading(true); setError('');
    try { setFiles(rows => [...rows, '']); const uri = await uploadReceipt(file); setFiles(rows => [...rows.filter(Boolean), uri]); }
    catch (reason) { setFiles(rows => rows.filter(Boolean)); setError(errorMessage(reason)); }
    finally { setUploading(false); }
  };
  const submit = async event => {
    event.preventDefault();
    if (submitting.current || uploading) return;
    submitting.current = true; setBusy(true); setError('');
    try {
      const result = await invokeFieldOps({ action: 'submitOutletVisit', locationId: location.id, snapshotKey, requestKey, lines, notes, fileUris: files, marketingFeedback: feedback });
      if (result.data.error) throw new Error(result.data.error);
      onDone();
    } catch (reason) { setError(errorMessage(reason)); }
    finally { submitting.current = false; setBusy(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !busy && !uploading) onClose(); }}><DialogContent className="max-h-[92dvh] max-w-3xl overflow-y-auto" onPointerDownOutside={event => event.preventDefault()}>
    <DialogHeader><DialogTitle>{ui("Daily sales & closing stock")}</DialogTitle><DialogDescription>{location.customer_name} · {location.name}{ui(". Count every supplied product before submitting.")}</DialogDescription></DialogHeader>
    <form className="space-y-5" onSubmit={submit}><p className="text-xs font-medium text-slate-500">{completed}{ui(" of ")}{products.length}{ui(" products counted · Tap a photo to switch products.")}</p><div className="grid max-h-44 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">{products.map(product => { const done = isComplete(lines.find(line => line.product_id === product.id)); return <button type="button" key={product.id} disabled={busy || uploading} aria-pressed={activeProduct === product.id} onClick={() => setActiveProduct(product.id)} className={'flex items-center gap-2 rounded-xl border p-2 text-left text-[10px] leading-4 ' + (activeProduct === product.id ? 'border-rose-400 bg-rose-50' : 'bg-white')}><ProductThumb product={product} size={35} /><span>{product.name}{done && <span className="block font-medium text-emerald-700">{ui("Counted")}</span>}</span></button>; })}</div><fieldset disabled={busy || uploading} className="space-y-4">
      {lines.filter(line => line.product_id === activeProduct).map(line => { const product = products.find(row => row.id === line.product_id), expected = Math.round((product.opening_quantity - Number(line.sold_quantity) - Number(line.damaged_quantity)) * 1000) / 1000, variance = line.quantity === '' ? null : Math.round((Number(line.quantity) - expected) * 1000) / 1000;
        return <section key={line.product_id} className="space-y-4 rounded-2xl border bg-slate-50/50 p-4"><div className="flex items-center gap-3"><ProductThumb product={product} size={64} /><div><h3 className="text-sm font-semibold">{product.name}</h3><p className="mt-1 text-xs text-slate-500">{ui("Available: ")}<strong>{product.opening_quantity} {product.storage_unit || ui("units")}</strong></p></div></div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3"><label className="space-y-1 text-xs font-medium">{ui("Units sold *")}<Input type="number" min="0" max={product.opening_quantity} step="0.001" required value={line.sold_quantity} onChange={event => patch(line.product_id, { sold_quantity: event.target.value })} /></label><label className="space-y-1 text-xs font-medium">{ui("Closing stock count *")}<Input type="number" min="0" max="1000000000" step="0.001" required placeholder={ui("Count remaining")} value={line.quantity} onChange={event => patch(line.product_id, { quantity: event.target.value })} /></label><label className="col-span-2 space-y-1 text-xs font-medium sm:col-span-1">{ui("Retail price (optional)")}<Input type="number" min="0" max="1000000000" step="0.01" required={false} placeholder={ui("Actual retail price")} value={line.observed_price} onChange={event => patch(line.product_id, { observed_price: event.target.value })} /></label></div>
          <details className="rounded-lg border bg-white p-3"><summary className="cursor-pointer text-xs font-medium text-slate-600">{ui("Damage or another concern")}</summary><div className="mt-3 grid grid-cols-2 gap-3"><label className="space-y-1 text-xs">{ui("Damaged / spoiled quantity")}<Input type="number" min="0" max={product.opening_quantity} step="0.001" required value={line.damaged_quantity} onChange={event => patch(line.product_id, { damaged_quantity: event.target.value })} /></label><label className="space-y-1 text-xs">{ui("Concern")}<select className="h-10 w-full rounded-md border bg-white px-2" value={line.issue} onChange={event => patch(line.product_id, { issue: event.target.value })}>{Object.entries(OUTLET_ISSUES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div></details>
          <div className="flex flex-wrap justify-between gap-2 text-xs"><span className={expected < 0 ? 'text-red-700' : 'text-slate-500'}>{ui("Expected remaining: ")}{expected} {product.storage_unit || ui("units")}</span>{variance != null && <span className={variance ? 'font-medium text-slate-800' : 'text-emerald-700'}>{variance ? 'Count difference: ' + (variance > 0 ? '+' : '') + variance : ui("Stock count matches")}</span>}</div>
        </section>; })}
      {lines.some(line => line.product_id !== activeProduct && !isComplete(line)) && <Button type="button" variant="outline" onClick={() => { const next = lines.find(line => line.product_id !== activeProduct && !isComplete(line)); if (next) setActiveProduct(next.product_id); }}>{ui("Next product to count")}</Button>}
      <div className="rounded-xl bg-rose-50 p-4"><p className="text-xs text-rose-700">{ui("Informational retail report")}</p><p className="mt-1 text-xl font-bold text-rose-900">{priced ? formatXAF(total) : ui("Quantities only")}</p></div>
      <label className="block space-y-2 text-sm font-medium">{ui("Report notes")}{needsNotes ? ' *' : ui(" (optional)")}<Textarea required={needsNotes} value={notes} maxLength={2000} onChange={event => setNotes(event.target.value)} placeholder={ui("Explain any difference, spoilage or restocking need.")} /></label>
      <label className="block space-y-2 text-sm font-medium">{ui("Customer feedback & marketing (optional)")}<Textarea value={feedback} maxLength={2000} onChange={event => setFeedback(event.target.value)} placeholder={ui("Product feedback, promotions, customer requests or display needs.")} /></label>
      <details className="rounded-xl border p-4"><summary className="cursor-pointer text-sm font-medium">{ui("Add photos (optional)")}</summary><input type="file" accept="image/*" capture="environment" className="mt-4 block w-full text-xs" disabled={files.length >= 5} onChange={event => { upload(event.target.files?.[0]); event.target.value = ''; }} /><div className="mt-3 flex flex-wrap gap-2">{files.filter(Boolean).map((uri, index) => <button type="button" key={uri} className="rounded-lg border px-3 py-2 text-xs" onClick={() => setFiles(rows => rows.filter(value => value !== uri))}>{ui("Photo ")}{index + 1}{ui(" · Remove")}</button>)}</div></details>
    </fieldset>
      <p className="text-xs leading-5 text-slate-500">{ui("Submit daily quantities once at the end of the day. This report is for information only: no company sale, invoice, warehouse movement or accounting entry is created.")}</p>
      {uploading && <p role="status" className="text-sm">{ui("Uploading private photo…")}</p>}{error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{uiMessage(error)}</p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy || uploading} onClick={onClose}>{ui("Cancel")}</Button><Button type="submit" disabled={busy || uploading || !lines.length || completed !== products.length}>{busy ? ui("Submitting…") : ui("Submit daily report")}</Button></div>
    </form>
  </DialogContent></Dialog>;
}
