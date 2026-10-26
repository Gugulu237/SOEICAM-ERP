import ReportExport from '@/components/shared/ReportExport';
import { cashFlowDocument } from '@/lib/report-models';

/* localized-messages */
import { sourceMessage, uiMessage } from '@/lib/i18n';

/* localized-interface */
import { getLocale, ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { erp } from '@/api/erpClient';
import { Link } from '@/lib/router';
import { businessDate } from '@/lib/business-date';
import { cashFlowCsv, cashFlowDates, CASH_FLOW_ACTIVITIES } from '@/lib/cash-flow';
import { formatDate } from '@/lib/formatters';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Download, RefreshCw } from 'lucide-react';

const selectClass = 'h-10 rounded-md border border-slate-200 bg-white px-3 text-sm';
const amount = value => <span className="whitespace-nowrap tabular-nums">{Number(value).toLocaleString(getLocale(), { maximumFractionDigits: 2 })}{ui(" XAF")}</span>;
export default function CashFlowStatement() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const initialRange = useMemo(() => { const to = businessDate(); return { from: to.slice(0, 4) + '-01-01', to }; }, []);
  const [range, setRange] = useState(initialRange), [report, setReport] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const [search, setSearch] = useState(''), [account, setAccount] = useState('all'), [activity, setActivity] = useState('all'), [page, setPage] = useState(1);
  const request = useRef(0);
  const run = useCallback(async dates => {
    const version = ++request.current;
    setError(''); setLoading(true);
    try {
      cashFlowDates(dates.from, dates.to);
      const { data } = await erp.functions.invoke('fieldOps', { action: 'cashFlowReport', ...dates });
      if (version !== request.current) return;
      setReport(data); setPage(1); setAccount('all'); setActivity('all'); setSearch('');
    } catch (e) { if (version === request.current) { setError(e.message || sourceMessage("Cash flow could not be loaded")); setReport(null); } }
    finally { if (version === request.current) setLoading(false); }
  }, []);
  useEffect(() => { run(initialRange); return () => { request.current++; }; }, [initialRange, run]);
  const history = useMemo(() => (report?.history || []).filter(h => {
    const q = search.trim().toLowerCase();
    return (account === 'all' || h.cash_account_ids.includes(account)) && (activity === 'all' || (activity === 'transfer' ? h.internal_transfer > 0 : h.allocations.some(a => a.activity === activity))) && (!q || [h.journal_number, h.description, h.reference, ...h.cash_accounts, ...h.counterpart_accounts].join(' ').toLowerCase().includes(q));
  }), [report, search, account, activity]);
  const pages = Math.max(1, Math.ceil(history.length / 50)), shown = history.slice((page - 1) * 50, page * 50);
  const changed = report && (range.from !== report.from || range.to !== report.to);
  const download = () => {
    const url = URL.createObjectURL(new Blob([cashFlowCsv(report)], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a'); link.href = url; link.download = `SOEICAM-Cash-Flow-${report.from}-to-${report.to}.csv`; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <div className="space-y-5">
    <form className="flex flex-wrap items-end gap-3 rounded-lg border bg-white p-4 print:hidden" onSubmit={e => { e.preventDefault(); run(range); }}>
      <div><Label htmlFor="cashflow-from">{ui("From")}</Label><Input id="cashflow-from" type="date" required disabled={loading} value={range.from} onChange={e => setRange({ ...range, from: e.target.value })} /></div>
      <div><Label htmlFor="cashflow-to">{ui("To")}</Label><Input id="cashflow-to" type="date" required disabled={loading} value={range.to} onChange={e => setRange({ ...range, to: e.target.value })} /></div>
      <Button type="submit" disabled={loading}><RefreshCw size={15} className={`mr-2 ${loading ? 'animate-spin' : ''}`} />{loading ? ui("Running report...") : ui("Run cash flow")}</Button>
      <Button type="button" variant="outline" disabled={!report || loading || changed} onClick={download}><Download size={15} className="mr-2" />{ui("Export statement & history")}</Button>
      <ReportExport disabled={!report || loading || !!error || changed} getReport={() => cashFlowDocument(report)} />
      {changed && <p className="w-full text-sm text-slate-700">{ui("Dates changed. Run cash flow to update the report.")}</p>}
    </form>
    {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">{uiMessage(error)} <span>{ui("Correct the issue and choose Run cash flow to retry.")}</span></div>}
    {loading && <p role="status" className="text-sm text-slate-500">{ui("Reading the posted cash ledger and checking balances...")}</p>}
    {report && !loading && <>
      <div><h2 className="text-xl font-semibold text-slate-900">{ui("Cash-flow statement")}</h2><p className="text-sm text-slate-600">{formatDate(report.from)} – {formatDate(report.to)}{ui(" · Direct method · XAF")}</p><p className="mt-1 text-xs text-slate-500">{ui("Generated ")}{new Date(report.generated_at).toLocaleString()}{ui(" · All company cash, bank, mobile money and commercial cash in transit")}</p></div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[[ui("Opening cash"), report.opening], [ui("External receipts"), report.inflow], [ui("External payments"), report.outflow], [ui("Closing cash"), report.closing]].map(([label, value]) => <div key={label} className="rounded-lg border bg-white p-4"><p className="text-sm text-slate-500">{label}</p><p className="mt-1 text-xl font-semibold">{amount(value)}</p></div>)}
      </div>
      {!!report.opening_adjustments&&<p className="rounded-lg border bg-white p-3 text-sm">{ui('Opening balance imports')}: {amount(report.opening_adjustments)}. {ui('These migration balances are excluded from operating cash receipts and payments.')}</p>}
      {!!report.issues.length && <details open className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-900"><summary className="cursor-pointer font-semibold">{ui("Review required — ")}{report.issues.length}{ui(" issue")}{report.issues.length === 1 ? '' : 's'}</summary><p className="mt-2">{ui("Resolve these items before relying on this report as a complete cash statement. The General Manager can set account activity under Accounting → Chart of Accounts → Account list.")}</p><ul className="mt-2 list-disc space-y-1 pl-5">{report.issues.slice(0, 20).map((issue, index) => <li key={index}>{uiMessage(issue)}</li>)}</ul>{report.issues.length > 20 && <p className="mt-2">{ui("Showing the first 20 issues. Export the statement for the complete review list.")}</p>}</details>}
      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm"><caption className="sr-only">{ui("Cash receipts and payments by activity and account")}</caption><thead className="bg-slate-50 text-slate-600"><tr><th className="p-3 text-left">{ui("Activity / account")}</th><th className="p-3 text-right">{ui("Receipts")}</th><th className="p-3 text-right">{ui("Payments")}</th><th className="p-3 text-right">{ui("Net cash")}</th></tr></thead>
          <tbody>{report.activities.filter(a => a.key !== 'unclassified' || a.rows.length).map(a => <React.Fragment key={a.key}>
            <tr className={a.key === 'unclassified' ? 'bg-slate-50 font-semibold' : 'bg-slate-50 font-semibold'}><th className="p-3 text-left" scope="row">{ui(a.label)}</th><td className="p-3 text-right">{amount(a.inflow)}</td><td className="p-3 text-right">{amount(a.outflow)}</td><td className="p-3 text-right">{amount(a.net)}</td></tr>
            {a.rows.map((r, i) => <tr key={i} className="border-t border-slate-100"><td className="p-3 pl-6">{ui(r.label)}<p className="text-xs text-slate-500">{r.account_number} {r.account_name === 'Source document' ? ui("Cash amount from sales / asset source documents") : r.account_name}</p></td><td className="p-3 text-right text-green-700">{amount(r.inflow)}</td><td className="p-3 text-right text-red-700">{amount(r.outflow)}</td><td className="p-3 text-right">{amount(r.net)}</td></tr>)}
            {!a.rows.length && <tr><td colSpan={4} className="p-3 pl-6 text-slate-400">{ui("No cash movements")}</td></tr>}
          </React.Fragment>)}</tbody>
          <tfoot className="border-t-2 font-semibold"><tr><th className="p-3 text-left">{ui("Net change in cash")}</th><td className="p-3 text-right">{amount(report.inflow)}</td><td className="p-3 text-right">{amount(report.outflow)}</td><td className="p-3 text-right">{amount(report.net)}</td></tr></tfoot>
        </table>
      </div>
      <div className="rounded-lg border bg-white p-4 text-sm"><p><strong>{ui("Reconciliation:")}</strong> {amount(report.opening)}{ui(" opening + ")}{amount(report.net)}{ui(" net movement")}{!!report.opening_adjustments&&<>{ui(' + opening balance imports ')}{amount(report.opening_adjustments)}</>}{ui(' = ')}{amount(report.closing)}{ui(" closing. Difference: ")}{amount(report.reconciliation_difference)}.</p><p className="mt-2 text-slate-600">{ui("Internal transfers of ")}{amount(report.internal_transfers)}{ui(" are excluded from external receipts and payments. These include cashier handovers, transfers between treasury accounts and asset replacement savings.")}</p></div>
      <div className="overflow-x-auto rounded-lg border bg-white"><table className="w-full text-sm"><caption className="p-4 text-left font-semibold">{ui("Cash account reconciliation")}</caption><thead className="bg-slate-50"><tr><th className="p-3 text-left">{ui("Cash account")}</th><th className="p-3 text-right">{ui("Opening")}</th>{report.components.some(a=>a.opening_adjustments)&&<th className="p-3 text-right">{ui("Opening balance imports")}</th>}<th className="p-3 text-right">{ui("Cash debits")}</th><th className="p-3 text-right">{ui("Cash credits")}</th><th className="p-3 text-right">{ui("Closing")}</th></tr></thead><tbody>{report.components.map(a => <tr key={a.account_id} className="border-t"><th className="p-3 text-left font-normal">{a.number} · {a.name}</th><td className="p-3 text-right">{amount(a.opening)}</td>{report.components.some(c=>c.opening_adjustments)&&<td className="p-3 text-right">{amount(a.opening_adjustments||0)}</td>}<td className="p-3 text-right">{amount(a.inflow)}</td><td className="p-3 text-right">{amount(a.outflow)}</td><td className="p-3 text-right font-medium">{amount(a.closing)}</td></tr>)}</tbody></table><p className="p-4 text-xs text-slate-500">{ui("Account debits and credits include internal transfers. Opening and closing amounts come from dated journals; unposted treasury opening balances are not invented as cash receipts.")}</p></div>
      <p className="text-xs leading-relaxed text-slate-500">{ui("Report basis: posted journals, including originals and their dated reversals. Unpaid invoices, depreciation and other non-cash journals do not enter cash totals. Supplier settlements use their payable account’s activity; use a separate investing payable for asset purchases on credit. Interest defaults to operating and can be configured in the chart of accounts. This is an internal management report; classifications and reconciliation issues require accounting review.")}</p>
      <section className="rounded-lg border bg-white p-4 print:hidden">
        <h3 className="font-semibold">{ui("Cash movement history")}</h3><p className="mb-3 text-xs text-slate-500">{ui("Filters below affect history only. The statement above always covers all company cash. Exports include the complete statement and unfiltered history.")}</p>
        <div className="mb-4 flex flex-wrap gap-3">
          <Input aria-label={ui("Search cash history")} className="max-w-xs" placeholder={ui("Search journal, reference, purpose, account...")} value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
          <select aria-label={ui("Filter history by cash account")} className={selectClass} value={account} onChange={e => { setAccount(e.target.value); setPage(1); }}><option value="all">{ui("All cash accounts")}</option>{report.components.map(a => <option key={a.account_id} value={a.account_id}>{a.number} · {a.name}</option>)}</select>
          <select aria-label={ui("Filter history by activity")} className={selectClass} value={activity} onChange={e => { setActivity(e.target.value); setPage(1); }}><option value="all">{ui("All movements")}</option>{Object.entries(CASH_FLOW_ACTIVITIES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}<option value="transfer">{ui("Internal transfers")}</option></select>
        </div>
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50"><tr><th className="p-2 text-left">{ui("Date / journal")}</th><th className="p-2 text-left">{ui("Purpose and accounts")}</th><th className="p-2 text-left">{ui("Activity")}</th><th className="p-2 text-right">{ui("Cash debits")}</th><th className="p-2 text-right">{ui("Cash credits")}</th></tr></thead><tbody>
          {shown.map(h => <tr key={h.id} className="border-b align-top"><td className="p-2 whitespace-nowrap">{formatDate(h.date)}<br /><Link className="font-medium text-blue-700 underline" to={`/accounting/journals/${encodeURIComponent(h.id)}`}>{h.journal_number}</Link></td><td className="max-w-md p-2"><p>{h.description || ui("Cash movement")}</p><p className="text-xs text-slate-500">{h.cash_accounts.join(' ↔ ')}</p><details className="mt-1 text-xs"><summary className="cursor-pointer text-blue-700">{ui("Reference and counterpart accounts")}</summary><p className="break-all">{h.reference || ui("No reference")} · {h.source}</p>{h.counterpart_accounts.map(a => <p key={a}>{a}</p>)}</details></td><td className="p-2 text-xs">{h.allocations.map((a, i) => <p key={i}>{CASH_FLOW_ACTIVITIES[a.activity]} · {ui(a.label)}: {amount(a.inflow || -a.outflow)}</p>)}{h.internal_transfer > 0 && <p className="text-blue-700">{ui("Internal transfer · ")}{amount(h.internal_transfer)}</p>}{h.review && <p className="mt-1 text-slate-700">{h.review}</p>}</td><td className="p-2 text-right">{amount(h.inflow)}</td><td className="p-2 text-right">{amount(h.outflow)}</td></tr>)}
          {!shown.length && <tr><td colSpan={5} className="p-8 text-center text-slate-500">{ui("No cash movements match this period and filter.")}</td></tr>}
        </tbody></table></div>
        <div className="mt-3 flex items-center justify-between gap-2 text-sm"><span>{history.length}{ui(" movements · Page ")}{page}{ui(" of ")}{pages}</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>{ui("Previous")}</Button><Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>{ui("Next")}</Button></div></div>
      </section>
    </>}
  </div>;
}
