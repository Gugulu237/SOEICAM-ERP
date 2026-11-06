import React, { useEffect, useRef, useState } from 'react';
import { ui, uiMessage } from '@/lib/i18n';
import { useLocaleRender } from '@/lib/localization';
import { invokeFieldOps } from '@/lib/field-ops';
import { businessDate } from '@/lib/business-date';
import { validProductQuantity } from '@/lib/product-quantity';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import ProductCatalog from '@/components/shared/ProductCatalog';

export default function DegustationForm({ onClose, onSaved }) {
  useLocaleRender();
  const [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [attempt, setAttempt] = useState(0);
  const [form, setForm] = useState({ dispatchId: '', customerId: '', lines: [], notes: '' });
  const request = useRef(null), lock = useRef(false);
  useEffect(() => {
    let active = true; setError('');
    invokeFieldOps({ action: 'degustationWorkspace' }).then(({ data }) => {
      if (!active) return;
      setData(data); setForm(f => ({ ...f, dispatchId: f.dispatchId || data.runs.find(r => r.can_supply)?.id || '' }));
    }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [attempt]);
  const products = (data?.products || []).map(p => ({ ...p, quantity: Math.round(data.balances.filter(b => b.dispatch_id === form.dispatchId && b.product_id === p.id).reduce((sum, b) => sum + Number(b.degustation_quantity || 0), 0) * 1000) / 1000 })).filter(p => p.quantity > 0);
  const run = data?.runs.find(r => r.id === form.dispatchId);
  const valid = run?.can_supply && form.customerId && form.lines.length && form.lines.every(l => validProductQuantity(l.quantity, products.find(p => p.id === l.product_id)?.quantity));
  function quantity(p, value) {
    if (busy) return;
    setForm(f => ({ ...f, lines: value === null ? f.lines.filter(l => l.product_id !== p.id) : f.lines.some(l => l.product_id === p.id) ? f.lines.map(l => l.product_id === p.id ? { ...l, quantity: value } : l) : [...f.lines, { product_id: p.id, quantity: value }] }));
  }
  async function save() {
    if (lock.current || !valid) return;
    lock.current = true; setBusy(true); setError('');
    // Keep the key and date after a lost response, including subsequent edits.
    // The server refuses changed details if this request was already committed.
    if (!request.current) request.current = { key: crypto.randomUUID(), date: businessDate() };
    try {
      await invokeFieldOps({ action: 'recordDegustation', ...form, requestKey: request.current.key, date: request.current.date });
      onSaved();
    } catch (e) { setError(e.message); }
    finally { lock.current = false; setBusy(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className="max-h-[92dvh] max-w-4xl overflow-y-auto" onEscapeKeyDown={e => { if (busy) e.preventDefault(); }} onPointerDownOutside={e => { if (busy) e.preventDefault(); }}>
    <DialogHeader><DialogTitle>{ui('Record Dégustation')}</DialogTitle><DialogDescription>{ui('Record only goods already given to the customer. Their inventory cost becomes a marketing expense.')}</DialogDescription></DialogHeader>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{uiMessage(error)}{!data && <Button variant="outline" onClick={() => setAttempt(n => n + 1)}>{ui('Retry')}</Button>}</p>}
    {!data && !error && <p role="status">{ui('Loading...')}</p>}
    {data && <fieldset disabled={busy} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">{ui('Issued goods')}<select className="mt-1 h-11 w-full rounded-md border px-3" value={form.dispatchId} onChange={e => setForm(f => ({ ...f, dispatchId: e.target.value, lines: [] }))}><option value="">{ui('Choose')}</option>{data.runs.filter(r => r.can_supply).map(r => <option key={r.id} value={r.id}>{r.dispatch_number}</option>)}</select></label>
      <label className="text-sm">{ui('Customer receiving Dégustation')}<select className="mt-1 h-11 w-full rounded-md border px-3" value={form.customerId} onChange={e => setForm(f => ({ ...f, customerId: e.target.value }))}><option value="">{ui('Choose')}</option>{data.customers.map(c => <option key={c.id} value={c.id}>{c.business_name}</option>)}</select></label></div>
      <ProductCatalog products={products} selecting hidePrice lines={form.lines} onQuantityChange={quantity} quantityLabel={ui('Given away')} disabled={busy} emptyMessage={ui('No Dégustation stock remains on this load. Ask warehouse management to reserve giveaway units when issuing goods.')} />
      <label className="block text-sm">{ui('Notes (optional)')}<Input className="mt-1" maxLength={1000} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}/></label>
    </fieldset>}
    <DialogFooter><Button variant="outline" disabled={busy} onClick={onClose}>{ui('Cancel')}</Button><Button disabled={busy || !valid} onClick={save}>{busy ? ui('Saving...') : ui('Confirm Dégustation')}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
