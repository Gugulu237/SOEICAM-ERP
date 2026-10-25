
/* localized-messages */
import { uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import MobileInfo from '@/components/shared/MobileInfo';
import React, { useState } from 'react';
import { formatDate, formatXAF } from '@/lib/formatters';
import { CASH_SETTLEMENT_STATUS } from '@/lib/cash-settlement';
import StatusPill from './StatusPill';
import AgentCashDepositDialog from './AgentCashDepositDialog';
import { Button } from '@/components/ui/button';

export default function CommercialCashSettlement({ days = [], ready = false, commercialId, commercialName, preview = false, managing = false, onRefresh }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [selected, setSelected] = useState(null), [notice, setNotice] = useState('');
  return <section className="relative rounded-2xl border bg-white p-4 sm:p-5" aria-label={ui("Daily cash settlement")}>
    <h2 className="pr-10 font-semibold text-slate-900">{ui("Daily cash settlement")}</h2><MobileInfo title={ui("Daily cash settlement")} className="absolute right-2 top-1 sm:static"><p className="mt-2 text-xs leading-5 text-slate-800 sm:text-sm sm:font-medium">{managing ? ui("Review reported collections against cashier-confirmed receipts. Employee deposit reports must be submitted from their own account.") : ui("Hand over all sales cash to the cashier each day. Expenses must never be paid or deducted from sales collections.")}</p>
    <p className="mt-1 text-xs leading-5 text-slate-500">{ui("This month, earlier outstanding cash and recently settled days. Your day becomes Settled after the cashier confirms receipt of all collected cash. Updates with your dashboard.")}</p></MobileInfo>
    {notice && <p role="status" className="mt-3 rounded-lg bg-blue-50 p-3 text-sm text-blue-900">{uiMessage(notice)}</p>}
    {!ready ? <p role="status" className="py-4 text-sm text-slate-500">{ui("Loading cash settlement...")}</p> : !days.length ? <p className="py-3 text-xs text-slate-500"><span className="sm:hidden">{ui("No cash to hand over")}</span><span className="hidden sm:inline">{ui("No cash collections recorded for this period.")}</span></p> : <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm">
      <thead><tr className="border-b text-xs text-slate-500">{[ui("Collection date"), ui("Cash collected"), ui("Cashier received"), ui("Awaiting clearance"), 'Status', 'Action'].map(label => <th className="whitespace-nowrap px-3 py-3 font-medium" key={label}>{label}</th>)}</tr></thead>
      <tbody>{days.map(day => <tr key={day.id} className="border-b last:border-0"><td className="px-3 py-3">{formatDate(day.collection_date)}</td><td className="px-3 py-3">{formatXAF(day.collected)}</td><td className="px-3 py-3">{formatXAF(day.received)}</td><td className="px-3 py-3 font-semibold">{formatXAF(day.outstanding)}</td><td className="px-3 py-3"><StatusPill map={CASH_SETTLEMENT_STATUS} value={day.status}/>{day.cashier_names?.length > 0 && <p className="mt-1 text-xs text-slate-500">{ui("Cash receipt confirmed by ")}{day.cashier_names.join(', ')}<br/>{day.receipt_references?.join(', ')}</p>}{day.requested && day.status !== 'requested' && <p className="mt-1 text-xs text-blue-700">{ui("Cashier requested handover")}</p>}</td><td className="px-3 py-3">{!managing && Number(day.depositable || 0) > 0 ? <Button size="sm" disabled={!ready || preview || !commercialId || day.disputed} onClick={() => { setNotice(''); setSelected(day); }}>{ui("Mark cash as deposited")}</Button> : day.status === 'deposit_reported' ? <span className="text-xs text-blue-700">{ui("Awaiting cashier confirmation")}</span> : day.status === 'settled' ? <span className="text-xs text-emerald-700">{ui("Cashier confirmed")}</span> : null}</td></tr>)}</tbody>
    </table></div>}
    {selected && !managing && !preview && <AgentCashDepositDialog day={selected} commercialId={commercialId} commercialName={commercialName} managing={managing} onClose={() => setSelected(null)} onDone={result => { setSelected(null); setNotice(`Deposit of ${formatXAF(result.amount)} reported to ${result.cashierName || 'the cashier'}. Awaiting cashier confirmation.`); onRefresh?.(); }}/>}
  </section>;
}
