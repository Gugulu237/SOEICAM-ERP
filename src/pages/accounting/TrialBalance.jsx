import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { formatXAF } from "@/lib/formatters";
import { trialBalanceRows } from "@/lib/accountingReports";
import PageHeader from "@/components/shared/PageHeader";
import { Input } from "@/components/ui/input";

export default function TrialBalance() {
  const [accounts, setAccounts] = useState([]);
  const [journals, setJournals] = useState([]);
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useEffect(() => {
    Promise.all([
      base44.entities.Account.filter({}),
      base44.entities.JournalEntry.list("-entry_date", 500),
      base44.entities.JournalLine.list("-created_date", 1000),
    ]).then(([a, j, l]) => { setAccounts(a); setJournals(j); setLines(l); })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;

  const rows = trialBalanceRows(accounts, journals, lines, from || null, to || null);
  const totalDebit = rows.reduce((s, r) => s + (r.balance > 0 ? r.balance : 0), 0);
  const totalCredit = rows.reduce((s, r) => s + (r.balance < 0 ? -r.balance : 0), 0);
  const balanced = totalDebit === totalCredit;

  return (
    <div>
      <PageHeader title="Trial Balance" subtitle="Derived from posted journal lines — debits must equal credits" />

      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4 flex flex-wrap items-end gap-3">
        <div><label className="text-xs text-slate-500">From</label><div><input type="date" value={from} onChange={e => setFrom(e.target.value)} className="h-9 rounded-md border border-input bg-transparent px-3 text-sm" /></div></div>
        <div><label className="text-xs text-slate-500">To</label><div><input type="date" value={to} onChange={e => setTo(e.target.value)} className="h-9 rounded-md border border-input bg-transparent px-3 text-sm" /></div></div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-slate-50 text-left text-slate-600">
              <th className="px-4 py-3 font-medium">Account #</th>
              <th className="px-4 py-3 font-medium">Account Name</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 text-right font-medium">Debit</th>
              <th className="px-4 py-3 text-right font-medium">Credit</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.account.id} className="border-b last:border-0 hover:bg-slate-50">
                <td className="px-4 py-2 font-mono">{r.account.account_number}</td>
                <td className="px-4 py-2">{r.account.name}</td>
                <td className="px-4 py-2 text-slate-500 capitalize">{r.account.account_type.replace(/_/g, " ")}</td>
                <td className="px-4 py-2 text-right">{r.balance > 0 ? formatXAF(r.balance) : ""}</td>
                <td className="px-4 py-2 text-right">{r.balance < 0 ? formatXAF(-r.balance) : ""}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">No posted transactions</td></tr>}
          </tbody>
          <tfoot>
            <tr className={`font-bold ${balanced ? "bg-emerald-50" : "bg-rose-50"}`}>
              <td colSpan={3} className="px-4 py-3 text-right">Totals</td>
              <td className="px-4 py-3 text-right">{formatXAF(totalDebit)}</td>
              <td className="px-4 py-3 text-right">{formatXAF(totalCredit)}</td>
            </tr>
            <tr><td colSpan={5} className={`px-4 py-2 text-right text-xs ${balanced ? "text-emerald-600" : "text-rose-600"}`}>{balanced ? "✓ Trial balance is balanced" : "✗ Out of balance"}</td></tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}