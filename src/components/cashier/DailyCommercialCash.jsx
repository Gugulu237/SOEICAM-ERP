
/* localized-messages */
import { sourceMessage, uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useRef, useState } from 'react';
import { invokeFieldOps, errorMessage } from '@/lib/field-ops';
import { formatDate, formatXAF } from '@/lib/formatters';
import { CASH_SETTLEMENT_STATUS } from '@/lib/cash-settlement';
import StatusPill from '@/components/field/StatusPill';
import { WorkspacePanel } from '@/components/home/WorkspaceParts';
import { Button } from '@/components/ui/button';

export default function DailyCommercialCash({ days = [], handovers = [], commercials = [], date, canAct, commercial = '', search = '', onReceive, onRefresh }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const flight = useRef(false), keys = useRef({});
  const [selectedAgent, setSelectedAgent] = useState('');
  async function prepare(day, receive) {
    if (!canAct || flight.current) return;
    flight.current = true; setBusy(true); setError(''); setNotice('');
    try {
      let handover;
      if (day.requestable > 0) {
        keys.current[day.id] ||= crypto.randomUUID();
        const { data } = await invokeFieldOps({ action: 'cashierRequestHandover', date: day.collection_date, commercialId: day.commercial_id,
          collectionIds: day.collection_ids, expectedAmount: day.requestable, requestKey: keys.current[day.id] });
        handover = data.handover; delete keys.current[day.id];
        setNotice(sourceMessage("Handover requested from {0}. Cash remains outstanding until you confirm receipt.", day.commercial_name));
        onRefresh();
      } else {
        handover = handovers.find(h => day.handover_ids.includes(h.id) && ['submitted', 'partially_received', 'disputed'].includes(h.status) && Number(h.expected_amount) > Number(h.received_amount || 0));
      }
      if (receive && handover) onReceive(handover);
      else if (receive) throw Error(ui("Open the handover queue to reconcile this balance, or refresh the cash desk."));
    } catch (err) { setError(errorMessage(err)); }
    finally { flight.current = false; setBusy(false); }
  }
  const agents = [...new Map([...commercials.map(e => [e.id, e.full_name]), ...days.map(day => [day.commercial_id, day.commercial_name])]).entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  const visible = days.filter(day => (!commercial || day.commercial_id === commercial) && (!selectedAgent || day.commercial_id === selectedAgent) && (!search || String(day.commercial_name).toLowerCase().includes(search.toLowerCase().trim())));
  return <WorkspacePanel title={ui("Daily Commercial cash")} subtitle={ui("Customer cash collected on {0}. Request a handover or count and receive it directly; an agent submission is not required.", formatDate(date))}>
    <p className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-900">{ui("Every agent must hand over all cash recorded for the day. Commercial agents cannot pay expenses from sales collections. A shortfall remains due until physically received.")}</p>
    <label className="mb-4 block max-w-md text-xs text-slate-600">{ui("Commercial agent")}<select aria-label={ui("Commercial agent cash collections")} className="mt-1 block h-10 w-full rounded-md border bg-white px-3 text-sm" value={commercial || selectedAgent} disabled={!!commercial || busy} onChange={e => { setSelectedAgent(e.target.value); setError(''); setNotice(''); }}><option value="">{ui("All commercial agents")}</option>{agents.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
    {error && <p role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{uiMessage(error)}</p>}
    {notice && <p role="status" className="mb-3 rounded-lg bg-blue-50 p-3 text-sm text-blue-800">{uiMessage(notice)}</p>}
    {!visible.length ? <p className="py-4 text-sm text-slate-500">{ui("No Commercial cash collections match this date and filter.")}</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm">
      <thead><tr className="border-b bg-slate-50 text-xs text-slate-500">{['Commercial', ui("Recorded cash sales"), ui("Cash to account for"), ui("Cashier received"), ui("Still due"), 'Status', 'Action'].map(label => <th className="whitespace-nowrap px-3 py-3 font-medium" key={label}>{label}</th>)}</tr></thead>
      <tbody>{visible.map(day => <tr key={day.id} className="border-b last:border-0"><td className="px-3 py-3 font-semibold">{day.commercial_name}</td><td className="px-3 py-3">{formatXAF(day.cash_sales_amount ?? day.collected)}<p className="text-xs text-slate-500">{day.cash_sales_count ?? 0}{ui(" posted sale(s)")}</p></td><td className="px-3 py-3">{formatXAF(day.collected)}</td><td className="px-3 py-3">{formatXAF(day.received)}</td><td className="px-3 py-3">{formatXAF(day.outstanding)}</td><td className="px-3 py-3"><StatusPill map={CASH_SETTLEMENT_STATUS} value={day.status}/>{Number(day.cash_sales_variance || 0) !== 0 && <p className="mt-1 text-xs text-red-700">{ui("Cash sale / collection difference: ")}{formatXAF(day.cash_sales_variance)}{ui(". Reconcile before settlement.")}</p>}{day.cash_sales_reconciliation_required && Number(day.cash_sales_variance || 0) === 0 && <p className="mt-1 text-xs text-red-700">{ui("A collection has no matching posted cash sale for this date. Reconcile before settlement.")}</p>}{day.cashier_names?.length > 0 && <p className="mt-1 text-xs text-slate-500">{ui("Received by ")}{day.cashier_names.join(', ')}<br/>{day.receipt_references?.join(', ')}</p>}</td><td className="px-3 py-3"><div className="flex flex-wrap gap-2">{day.requestable > 0 && <Button size="sm" variant="outline" disabled={!canAct || busy || day.disputed} onClick={() => prepare(day, false)}>{ui("Request handover")}</Button>}{day.outstanding > 0 && <Button size="sm" disabled={!canAct || busy || day.disputed} onClick={() => prepare(day, true)}>{ui("Receive daily cash")}</Button>}</div></td></tr>)}</tbody>
    </table></div>}
  </WorkspacePanel>;
}
