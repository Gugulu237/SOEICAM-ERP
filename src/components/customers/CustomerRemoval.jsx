import React, { useRef, useState } from 'react';
import { Trash2, RotateCcw, Loader2 } from 'lucide-react';
import { ui, uiMessage } from '@/lib/i18n';
import { invalidateERPReads } from '@/api/erpClient';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';

export default function CustomerRemoval({ customer, onDone, disabled }) {
  const [open, setOpen] = useState(false), [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const posting = useRef(false), requestKey = useRef(null);
  if (!customer) return null;
  const removed = Boolean(customer.customer_removed_at);
  const title = ui(removed ? 'Restore customer' : 'Delete customer');
  const changeOpen = next => { if (posting.current) return; if (next) { setReason(''); setError(''); requestKey.current = crypto.randomUUID(); } setOpen(next); };
  const submit = async event => {
    event.preventDefault();
    if (posting.current || reason.trim().length < 3) return;
    posting.current = true; setBusy(true); setError('');
    try {
      const response = await fetch('/api/customers/' + encodeURIComponent(customer.id) + '/lifecycle', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: removed ? 'restore' : 'remove', revision: Number(customer.customer_lifecycle_revision || 0), reason: reason.trim(), requestKey: requestKey.current }) });
      const data = await response.json();
      if (!response.ok || data.error) throw Error(data.error || 'Customer directory change failed.');
      invalidateERPReads(); setOpen(false); onDone?.(data.customer);
    } catch (failure) { setError(failure.message); }
    finally { posting.current = false; setBusy(false); }
  };
  return <>
    <Button type="button" variant={removed ? 'outline' : 'destructive'} disabled={disabled} onClick={() => changeOpen(true)}>{removed ? <RotateCcw size={16} /> : <Trash2 size={16} />}{title}</Button>
    <Dialog open={open} onOpenChange={changeOpen}><DialogContent onPointerDownOutside={event => { if (busy) event.preventDefault(); }} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}>
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{removed ? ui('Restore this customer and the delivery locations that were active before deletion.') : ui('Remove this customer from the directory. Sales, receipts, acquisition history and accounting records are retained. You can restore the customer from Deleted customers.')}</DialogDescription></DialogHeader>
      <form onSubmit={submit} className="space-y-4"><p className="break-words text-sm font-semibold">{customer.business_name}</p><div><Label htmlFor="customer-removal-reason">{ui('Reason')}</Label><Textarea id="customer-removal-reason" autoFocus required minLength={3} maxLength={1000} value={reason} disabled={busy} onChange={event => setReason(event.target.value)} className="mt-2" /></div>{error && <p role="alert" className="text-sm text-red-700">{uiMessage(error)}</p>}<DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => changeOpen(false)}>{ui('Cancel')}</Button><Button type="submit" variant={removed ? 'default' : 'destructive'} disabled={busy || reason.trim().length < 3}>{busy && <Loader2 size={16} className="animate-spin" />}{busy ? ui('Saving…') : title}</Button></DialogFooter></form>
    </DialogContent></Dialog>
  </>;
}
