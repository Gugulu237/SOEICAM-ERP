import React, { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate } from "react-router-dom";
import { formatXAF, formatDate } from "@/lib/formatters";
import { round2 } from "@/lib/posting";
import PageHeader from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function TrialBalance() {
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState([]);
  const [journalsById, setJournalsById] = useState({});
  const [allLines, setAllLines] = useState([]);
  const [fromDate, setFromDate] = useState(new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10));
  const [toDate, setToDate] = useState(new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      base44.entities.Account.filter({}, "account_number", 500),
      base44.entities.JournalEntry.filter({ status: "posted" }, "-entry_date", 5000),
      base44.entities.JournalLine.filter({}, "-created_date", 10000),
    ]).then(([accs, journals, lines]) => {
      setAccounts(accs.sort((a, b) => a.account_number.localeCompare(b.account_number)));
      setJournalsById(Object.fromEntries(journals.map((j) => [j.id, j])));
      setAllLines(lines);
    }).finally(() => setLoading(false));
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

  function exportCSV() {
    const header = "Account Code,Account Name,Opening Debit,Opening Credit,Period Debit,Period Credit,Closing Debit,Closing Credit";
    const body = rows.map((r) =>
      [r.account_number, `"${r.name}"`, r.openingDebit, r.openingCredit, r.periodDebit, r.periodCredit, r.closingDebit, r.closingCredit].join(",")
    );
    const csv = [header, ...body].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `trial-balance-${fromDate}-to-${toDate}.csv`;
    a.click();
  }

  if (loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;

  return (
    <div>
      <PageHeader
        title="Trial Balance"
        subtitle={`Posted transactions from ${formatDate(fromDate)} to ${formatDate(toDate)}`}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={exportCSV}>Export CSV</Button>
            <Button variant="outline" onClick={() => navigate("/accounting")}>Back to Accounting</Button>
          </div>
        }
      />

      <div className="bg-white rounded-lg border border-slate-200 p-4 mb-6 flex flex-col sm:flex-row gap-4 items-end">
        <div>
          <Label>From</Label>
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </div>
        <div>
          <Label>To</Label>
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
        <div className={`px-3 py-2 rounded-md text-sm font-medium ${balanced ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
          {balanced ? "✓ Total debits equal total credits" : "✗ Trial balance does not balance"}
        </div>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-left text-slate-500">
              <th className="px-3 py-3">Code</th>
              <th className="px-3 py-3">Account</th>
              <th className="px-3 py-3 text-right">Opening Dr</th>
              <th className="px-3 py-3 text-right">Opening Cr</th>
              <th className="px-3 py-3 text-right">Period Dr</th>
              <th className="px-3 py-3 text-right">Period Cr</th>
              <th className="px-3 py-3 text-right">Closing Dr</th>
              <th className="px-3 py-3 text-right">Closing Cr</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">No posted transactions in this period</td></tr>
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
              <td className="px-3 py-3" colSpan={2}>Totals</td>
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