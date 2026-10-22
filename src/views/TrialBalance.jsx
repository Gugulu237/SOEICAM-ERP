import ReportExport from '@/components/shared/ReportExport';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState, useEffect, useMemo } from "react";
import { erp } from "@/api/erpClient";
import { readAll } from "@/lib/field-pos";
import { useNavigate } from "@/lib/router";
import { formatXAF, formatDate } from "@/lib/formatters";
import { round2 } from "@/lib/posting";
import PageHeader from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function TrialBalance() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const navigate = useNavigate();
  const [accounts, setAccounts] = useState([]);
  const [journalsById, setJournalsById] = useState({});
  const [allLines, setAllLines] = useState([]);
  const [fromDate, setFromDate] = useState(new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10));
  const [toDate, setToDate] = useState(new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(true);
  const [error,setError] = useState('');

  useEffect(() => {
    Promise.all([
      readAll(erp.entities.Account,{},"account_number"),
      readAll(erp.entities.JournalEntry,{status:"posted"},"-entry_date"),
      readAll(erp.entities.JournalLine,{},"-created_date"),
    ]).then(([accs, journals, lines]) => {
      setAccounts(accs.sort((a, b) => a.account_number.localeCompare(b.account_number)));
      setJournalsById(Object.fromEntries(journals.map((j) => [j.id, j])));
      setAllLines(lines);
    }).catch(e => setError(e.message || 'Could not load the report.')).finally(() => setLoading(false));
  }, []);

  const { rows, totals } = useMemo(() => {
    const byAccount = {};
    for (const l of allLines) {
      const j = journalsById[l.journal_id];
      if (!j) continue;
      const d = j.entry_date || "";
      const acc = byAccount[l.account_id] || (byAccount[l.account_id] = { openDebit: 0, openCredit: 0, periodDebit: 0, periodCredit: 0 });
      if (d < fromDate) { acc.openDebit += round2(l.debit); acc.openCredit += round2(l.credit); }
      else if (d <= toDate) { acc.periodDebit += round2(l.debit); acc.periodCredit += round2(l.credit); }
    }
    const rows = accounts.map((a) => {
      const m = byAccount[a.id] || { openDebit: 0, openCredit: 0, periodDebit: 0, periodCredit: 0 };
      const net = round2(m.openDebit - m.openCredit + m.periodDebit - m.periodCredit);
      const openNet = round2(m.openDebit - m.openCredit);
      return {
        ...a,
        openingDebit: openNet > 0 ? openNet : 0,
        openingCredit: openNet < 0 ? -openNet : 0,
        periodDebit: round2(m.periodDebit),
        periodCredit: round2(m.periodCredit),
        closingDebit: net > 0 ? net : 0,
        closingCredit: net < 0 ? -net : 0,
      };
    }).filter((r) => r.openingDebit || r.openingCredit || r.periodDebit || r.periodCredit);

    const totals = rows.reduce((t, r) => ({
      openingDebit: round2(t.openingDebit + r.openingDebit),
      openingCredit: round2(t.openingCredit + r.openingCredit),
      periodDebit: round2(t.periodDebit + r.periodDebit),
      periodCredit: round2(t.periodCredit + r.periodCredit),
      closingDebit: round2(t.closingDebit + r.closingDebit),
      closingCredit: round2(t.closingCredit + r.closingCredit),
    }), { openingDebit: 0, openingCredit: 0, periodDebit: 0, periodCredit: 0, closingDebit: 0, closingCredit: 0 });

    return { rows, totals };
  }, [accounts, allLines, journalsById, fromDate, toDate]);

  const balanced = totals.closingDebit === totals.closingCredit;

  if (loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;

  if (error) return <p role="alert">{error}</p>;

  return (
    <div>
      <PageHeader
        title={ui("Trial Balance")}
        subtitle={ui("Posted transactions from {0} to {1}", formatDate(fromDate), formatDate(toDate))}
        actions={
          <div className="flex gap-2">
            <ReportExport disabled={!fromDate || !toDate || fromDate>toDate} report={{title:'Trial balance',metadata:[['From',fromDate],['To',toDate],['Basis','Posted journals']],notes:[balanced?'Total debits equal total credits.':`Trial balance does not balance. Difference: ${round2(totals.closingDebit-totals.closingCredit)} XAF.`],sections:[{title:'Trial balance',columns:['Account code','Account name',...['Opening debit','Opening credit','Period debit','Period credit','Closing debit','Closing credit'].map(label=>({label,type:'money'}))],rows:rows.map(r=>[r.account_number,r.name,r.openingDebit,r.openingCredit,r.periodDebit,r.periodCredit,r.closingDebit,r.closingCredit]),totals:[['','Totals',...['openingDebit','openingCredit','periodDebit','periodCredit','closingDebit','closingCredit'].map(k=>totals[k])]]}]}}/>
            <Button variant="outline" onClick={() => navigate("/accounting")}>{ui("Back to Accounting")}</Button>
          </div>
        }
      />

      <div className="bg-white rounded-lg border border-slate-200 p-4 mb-6 flex flex-col sm:flex-row gap-4 items-end">
        <div>
          <Label>{ui("From")}</Label>
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </div>
        <div>
          <Label>{ui("To")}</Label>
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
        <div className={`px-3 py-2 rounded-md text-sm font-medium ${balanced ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
          {balanced ? ui("✓ Total debits equal total credits") : ui("✗ Trial balance does not balance")}
        </div>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-left text-slate-500">
              <th className="px-3 py-3">{ui("Code")}</th>
              <th className="px-3 py-3">{ui("Account")}</th>
              <th className="px-3 py-3 text-right">{ui("Opening Dr")}</th>
              <th className="px-3 py-3 text-right">{ui("Opening Cr")}</th>
              <th className="px-3 py-3 text-right">{ui("Period Dr")}</th>
              <th className="px-3 py-3 text-right">{ui("Period Cr")}</th>
              <th className="px-3 py-3 text-right">{ui("Closing Dr")}</th>
              <th className="px-3 py-3 text-right">{ui("Closing Cr")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">{ui("No posted transactions in this period")}</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer"
                onClick={() => navigate("/accounting/ledger")}>
                <td className="px-3 py-2 font-medium">{r.account_number}</td>
                <td className="px-3 py-2">{r.name}</td>
                <td className="px-3 py-2 text-right">{r.openingDebit ? formatXAF(r.openingDebit) : ""}</td>
                <td className="px-3 py-2 text-right">{r.openingCredit ? formatXAF(r.openingCredit) : ""}</td>
                <td className="px-3 py-2 text-right">{r.periodDebit ? formatXAF(r.periodDebit) : ""}</td>
                <td className="px-3 py-2 text-right">{r.periodCredit ? formatXAF(r.periodCredit) : ""}</td>
                <td className="px-3 py-2 text-right font-medium">{r.closingDebit ? formatXAF(r.closingDebit) : ""}</td>
                <td className="px-3 py-2 text-right font-medium">{r.closingCredit ? formatXAF(r.closingCredit) : ""}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-bold bg-slate-50">
              <td className="px-3 py-3" colSpan={2}>{ui("Totals")}</td>
              <td className="px-3 py-3 text-right">{formatXAF(totals.openingDebit)}</td>
              <td className="px-3 py-3 text-right">{formatXAF(totals.openingCredit)}</td>
              <td className="px-3 py-3 text-right">{formatXAF(totals.periodDebit)}</td>
              <td className="px-3 py-3 text-right">{formatXAF(totals.periodCredit)}</td>
              <td className="px-3 py-3 text-right">{formatXAF(totals.closingDebit)}</td>
              <td className="px-3 py-3 text-right">{formatXAF(totals.closingCredit)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}