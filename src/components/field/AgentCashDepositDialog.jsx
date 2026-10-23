
/* localized-messages */
import { sourceMessage, uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useEffect, useRef, useState } from 'react';
import { invokeFieldOps, errorMessage } from '@/lib/field-ops';
import { businessDate } from '@/lib/business-date';
import { formatDate, formatXAF } from '@/lib/formatters';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

export default function AgentCashDepositDialog({ day, commercialId, commercialName, managing = false, onClose, onDone }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [cashiers, setCashiers] = useState([]), [cashierId, setCashierId] = useState('');
  const [depositedDate, setDepositedDate] = useState(businessDate), [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [reload, setReload] = useState(0);
  const requestKey = useRef(null), flight = useRef(false);
  useEffect(() => {
    let active = true; setLoading(true); setError('');
    invokeFieldOps({ action: 'commercialCashiers' }).then(({ data }) => {
      if (!active) return;
      setCashiers(data.cashiers); if (data.cashiers.length === 1) setCashierId(data.cashiers[0].id);
    }).catch(e => { if (active) setError(errorMessage(e)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reload]);
  async function submit(event) {
    event.preventDefault(); if (flight.current) return;
    if (!confirmed || !cashierId) { setError(sourceMessage("Select the receiving cashier and confirm the physical handover.")); return; }
    flight.current = true; setBusy(true); setError(''); requestKey.current ||= crypto.randomUUID();
    try {
      const { data } = await invokeFieldOps({ action: 'commercialDepositCash', commercialId, date: day.collection_date,
        depositedDate, cashierId, amount: day.depositable, requestKey: requestKey.current });
      onDone(data);
    } catch (e) { setError(errorMessage(e)); }
    finally { flight.current = false; setBusy(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>{ui("Mark cash as deposited")}</DialogTitle></DialogHeader>
    <form onSubmit={submit} className="space-y-4">
      <div className="rounded-xl bg-slate-50 p-4 text-sm"><strong>{commercialName}</strong><p className="mt-1 text-slate-500">{ui("Cash collected on ")}{formatDate(day.collection_date)}</p><p className="mt-3 text-xl font-bold">{formatXAF(day.depositable)}</p><p className="mt-1 text-xs text-slate-500">{ui("Full cash not yet reported as handed over. No expense deduction.")}</p></div>
      {managing && <p className="text-xs text-blue-800">{ui("You are recording this for the selected agent. Your General Manager account is retained in the audit record.")}</p>}
      <label className="block space-y-1 text-sm">{ui("Receiving cashier")}<select aria-label={ui("Receiving cashier")} required disabled={loading || busy} value={cashierId} onChange={e => { setCashierId(e.target.value); requestKey.current = null; }} className="block h-10 w-full rounded-md border bg-white px-3"><option value="">{loading ? ui("Loading cashiers...") : ui("Select cashier")}</option>{cashiers.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}</select></label>
      <label className="block space-y-1 text-sm">{ui("Date handed to cashier")}<Input aria-label={ui("Cash deposit date")} required type="date" min={day.collection_date} max={businessDate()} value={depositedDate} disabled={busy} onChange={e => { setDepositedDate(e.target.value); requestKey.current = null; }}/></label>
      <label className="flex items-start gap-2 text-sm"><input aria-label={ui("Confirm physical cash handover")} type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)}/><span>{ui("I confirm this full amount has physically been handed to the selected cashier.")}</span></label>
      <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">{ui("The cashier will see your deposit report. The balance remains pending until the cashier counts and confirms receipt.")}</p>
      {!loading && !cashiers.length && <p role="alert" className="text-sm text-slate-800">{ui("No active Cashier is configured. Ask the General Manager to configure the receiving cashier.")}</p>}
      {error && <p role="alert" className="text-sm text-red-700">{uiMessage(error)}<button type="button" className="ml-2 underline" disabled={busy} onClick={() => setReload(n => n + 1)}>{ui("Reload cashiers")}</button></p>}
      <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={onClose}>{ui("Cancel")}</Button><Button type="submit" disabled={busy || loading || !cashierId || !confirmed}>{busy ? ui("Reporting deposit...") : ui("Confirm deposit report")}</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}
