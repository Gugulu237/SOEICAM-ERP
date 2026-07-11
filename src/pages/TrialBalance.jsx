import React, { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate } from "react-router-dom";
import { formatXAF } from "@/lib/formatters";
import PageHeader from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle2, AlertTriangle, Download } from "lucide-react";

const firstOfMonth = () => new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);

const TYPE_ORDER = ["asset", "liability", "equity", "revenue", "cogs", "expense", "other_income", "other_expense"];
const TYPE_LABELS = { asset: "Assets", liability: "Liabilities", equity: "Equity", revenue: "Revenue", cogs: "Cost of Goods Sold", expense: "Expenses", other_income: "Other Income", other_expense: "Other Expense" };

export default function TrialBalance() {
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState([]);
  const [journals, setJournals] = useState([]);
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      const [a, j, l] = await Promise.all([
        base44.entities.Account.filter({}),
        base44.entities.JournalEntry.filter({ status: "posted" }),
        base44.entities.JournalLine.list("-created_date", 2000),
      ]);
      setAccounts(a.sort((x, y) => x.account_number.localeCompare(y.account_number)));
      setJournals(j);
      setLines(l);
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  const journalMap = useMemo(() => { const m = {}; journals.forEach(j => { if (j.status === "posted") m[j.id] = j; }); return m; }, [journals]);

  const totalsByAccount = useMemo(() => {
    const f = new Date(from + "T00:00:00Z");
    const t = new Date(to + "T23:59:59Z");
    const map = {};
    lines.forEach(l => {
      const je = journalMap[l.journal_id];
      if (!je || je.status === "reversed") return;
      const d = new Date((je.entry_date || "") + "T00:00:00Z");
      if (d < f || d > t) return;
      if (!map[l.account_id]) map[l.account_id] = { debit: 0, credit: 0 };
      map[l.account_id].debit += (l.debit || 0);
      map[l.account_id].credit += (l.credit || 0);
    });
    return map;
  }, [lines, journalMap, from, to]);

  const rows = accounts.map(a => {
    const t = totalsByAccount[a.id] || { debit: 0, credit: 0 };
    const net = a.normal_balance === "debit" ? (t.debit - t.credit) : (t.credit - t.debit);
    return { ...a, period_debit: t.debit, period_credit: t.credit, net };
  }).filter(r => Math.abs(r.period_debit) > 0.001 || Math.abs(r.period_credit) > 0.001 || Math.abs(r.net) > 0.001);

  const grouped = useMemo(() => {
    const g = {};
    rows.forEach(r => { (g[r.account_type] = g[r.account_type] || []).push(r); });
    return g;
  }, [rows]);

  const totalDebit = rows.reduce((s, r) => s + r.period_debit, 0);
  const totalCredit = rows.reduce((s, r) => s + r.period_credit, 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.01;

  function exportCSV() {
    let csv = "Account,Name,Type,Debit,Credit\n";
    rows.forEach(r => { csv += `${r.account_number},"${r.name}",${r.account_type},${r.period_debit.toFixed(2)},${r.period_credit.toFixed(2)}\n`; });
    csv += `,,TOTAL,${totalDebit.toFixed(2)},${totalCredit.toFixed(2)}\n`;
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `trial-balance-${from}-to-${to}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;

  return (
    <div>
      <PageHeader
        title="Trial Balance"
        subtitle="Computed from posted journal lines — the ledger is the source of truth"
        actions={<Button variant="outline" onClick={exportCSV}><Download size={16} className="mr-1" /> Export CSV</Button>}
      />
      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div><Label>From Date</Label><Input type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
        <div><Label>To Date</Label><Input type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
        <div className="flex items-end"><div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${balanced ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
          {balanced ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
          <span className="text-sm font-medium">{balanced ? "Balanced" : "Out of balance"}</span>
        </div></div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">Code</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">Account</th>
              <th className="px-4 py-3 text-right font-semibold text-slate-600">Period Debit</th>
              <th className="px-4 py-3 text-right font-semibold text-slate-600">Period Credit</th>
              <th className="px-4 py-3 text-right font-semibold text-slate-600">Net Balance</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-12 text-center text-slate-400">No posted transactions in this period. Post a journal entry to see the trial balance.</td></tr>
            ) : TYPE_ORDER.filter(t => grouped[t]).map(type => (
              <React.Fragment key={type}>
                <tr className="bg-slate-100/60">
                  <td colSpan={5} className="px-4 py-2 font-semibold text-slate-700 uppercase text-xs tracking-wide">{TYPE_LABELS[type]}</td>
                </tr>
                {grouped[type].map(r => (
                  <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 cursor-pointer" onClick={() => navigate("/accounting/general-ledger")}>
                    <td className="px-4 py-2.5 font-mono text-xs">{r.account_number}</td>
                    <td className="px-4 py-2.5">{r.name}</td>
                    <td className="px-4 py-2.5 text-right">{r.period_debit ? formatXAF(r.period_debit) : ""}</td>
                    <td className="px-4 py-2.5 text-right">{r.period_credit ? formatXAF(r.period_credit) : ""}</td>
                    <td className="px-4 py-2.5 text-right font-medium">{r.net ? formatXAF(Math.abs(r.net)) : ""}{r.net ? <span className="text-xs text-slate-400 ml-1">{r.normal_balance}</span> : ""}</td>
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-slate-900 text-white font-semibold">
              <td colSpan={2} className="px-4 py-3 text-right">TOTAL</td>
              <td className="px-4 py-3 text-right">{formatXAF(totalDebit)}</td>
              <td className="px-4 py-3 text-right">{formatXAF(totalCredit)}</td>
              <td className="px-4 py-3 text-right">{balanced ? formatXAF(0) : formatXAF(Math.abs(totalDebit - totalCredit))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}