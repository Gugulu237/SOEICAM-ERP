'use client';
import React, { useEffect, useRef, useState } from 'react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { ui, uiMessage } from '@/lib/i18n';
import { useLocaleRender } from '@/lib/localization';
import { notifyRoleChanges } from '@/lib/role-permission-sync';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

export default function EmployeeSignInAction({ employee, onSaved, disabled = false }) {
  useLocaleRender();
  const { role } = useCurrentUser();
  const [open, setOpen] = useState(false), [account, setAccount] = useState(null);
  const [email, setEmail] = useState(''), [reason, setReason] = useState(''), [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const pending = useRef(false), request = useRef(null);
  const endpoint = '/api/admin/employees/' + encodeURIComponent(employee?.id || "") + '/sign-in';
  async function load(signal) {
    setLoading(true); setAccount(null); setError('');
    try {
      const response = await fetch(endpoint, { cache: 'no-store', credentials: 'same-origin', signal });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || ui('Could not load employee sign-in.'));
      if (signal?.aborted) return;
      setAccount(result); setEmail(result.suggestedEmail); setReason(''); setConfirmed(false); request.current = null;
    } catch (cause) { if (!signal?.aborted) setError(cause.message); }
    finally { if (!signal?.aborted) setLoading(false); }
  }
  useEffect(() => {
    if (!open || role !== 'admin') return;
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [open, employee.id, role]);

  async function save() {
    if (pending.current || !account?.canChange || !confirmed || reason.trim().length < 3) return;
    const values = { email: email.trim().toLowerCase(), revision: account.revision, reason: reason.trim(), confirmed: true };
    const signature = JSON.stringify(values);
    if (request.current?.signature !== signature) request.current = { signature, key: crypto.randomUUID() };
    pending.current = true; setSaving(true); setError('');
    try {
      const response = await fetch(endpoint, {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, requestKey: request.current.key }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || ui('Could not change employee sign-in.'));
      notifyRoleChanges(); setOpen(false); onSaved?.(result.employee);
    } catch (cause) { setError(cause.message); }
    finally { pending.current = false; setSaving(false); }
  }

  if (role !== 'admin' || !employee?.id) return null;
  const changed = account && email.trim().toLowerCase() !== (account.email || '').trim().toLowerCase();
  return <>
    <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => setOpen(true)}>{ui('Change sign-in')}</Button>
    <Dialog open={open} onOpenChange={value => { if (!pending.current) setOpen(value); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{ui('Change employee sign-in')}</DialogTitle><DialogDescription className="break-words">{employee.full_name}</DialogDescription></DialogHeader>
        {loading && <p role="status" className="text-sm text-slate-500">{ui('Loading sign-in account...')}</p>}
        {account && <>
          <div className="min-w-0 rounded-lg bg-slate-50 p-3 text-sm"><p className="text-xs text-slate-500">{ui('Current sign-in email')}</p><p className="mt-1 break-all font-medium">{account.email || ui('Not linked')}</p></div>
          {!account.canChange ? <p role="alert" className="text-sm text-amber-800">{uiMessage(account.blockedReason)}</p> : <form onSubmit={event => { event.preventDefault(); return save(); }} className="min-w-0 space-y-4">
            <fieldset disabled={saving} className="min-w-0 space-y-4">
              <label className="block text-sm font-medium">{ui('New sign-in email')}<Input type="email" autoComplete="off" required maxLength={254} value={email} onChange={event => { setEmail(event.target.value); setConfirmed(false); }} className="mt-1 min-w-0" /></label>
              <p className="text-xs leading-5 text-slate-600">{ui('Use an existing staff account email, or a new email that the employee will verify on the sign-in page.')}</p>
              <label className="block text-sm font-medium">{ui('Reason for this change')}<Input required minLength={3} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} className="mt-1" /></label>
              <label className="flex items-start gap-3 rounded-lg border p-3 text-xs leading-5"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-1 h-4 w-4 shrink-0" /><span>{ui('I confirm this login belongs to this employee. The previous login will lose access to this employee dashboard. Roles and transaction history will stay with the employee.')}</span></label>
              <Button type="submit" disabled={saving || !changed || !confirmed || reason.trim().length < 3 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())} className="w-full">{saving ? ui('Saving...') : ui('Save sign-in change')}</Button>
            </fieldset>
          </form>}
          <details className="text-xs leading-5 text-slate-500"><summary className="cursor-pointer">{ui('About employee sign-in')}</summary><p className="mt-2">{ui('The employee keeps the same profile, roles and records. Their contact email is unchanged. Passwords and available sign-in methods are managed by the configured sign-in provider. No invitation is sent by this action; use Invite / check account if a new Clerk invitation is needed.')}</p></details>
        </>}
        {error && <div role="alert" className="space-y-2 text-sm text-red-700"><p className="break-words">{uiMessage(error)}</p><Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => load()}>{ui('Reload account')}</Button></div>}
      </DialogContent>
    </Dialog>
  </>;
}
