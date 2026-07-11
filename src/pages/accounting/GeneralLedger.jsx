import React, { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { formatXAF, formatDate } from "@/lib/formatters";
import PageHeader from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { computeAccountTotals } from "@/lib/accountingReports";

export default function GeneralLedger() {
  const [accounts, setAccounts] = useState([]);
  const [journals, setJournals] = useState([]);
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [accountId, setAccountId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useEffect(() => {
    Promise.all([
      base44.entities.Account.filter({ is_active: true }),
      base44.entities.JournalEntry.list("-entry_date", 500),
      base44.entities.JournalLine.list("-created_date", 1000),
    ]).then(([a, j, l]) => { setAccounts(a); setJournals(j); setLines(l); })
      .finally(() => setLoading(false));
  }, []);

  const accountById = useMemo(() => { const m = {}; for (const a of accounts) m[a.id] = a; return m; }, [accounts]);
  const journalById = useMemo(() => { const m = {}; for (const j of journals) m[j.id] = j; return m; }, [journals]);
  const postedIds = useMemo(() => new Set(journals.filter(j => j.status === "posted").map(j => j.id)), [journals]);

  const accountLines = useMemo(() => {
    return lines
      .filter(l => l.account_id === accountId && postedIds.has(l.journal_id))
      .filter(l => {
        if (!from && !to) return true;
        const d = journalById[l.journal_id]?.entry_date;
        if (!d) return false;
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
      })
      .sort((a, b) => (journalById[a.journal_id]?.entry_date || "").localeCompare(journalById[b.journal_id]?.entry_date || ""));
  }, [lines, accountId, postedIds, journalById, from, to]);

  const opening = useMemo(() => {
    const totals = computeAccountTotals(accounts, journals, lines, null, from ? new Date(new Date(from).getTime() - 86400000).toISOString().split("T")[0] : null);
    const acc = accountById[accountId];
    if (!acc) return 0;
    const t = totals[accountId] || { debit: 0, credit: 0 };
    const net = (t.debit || 0) - (t.credit || 0);
    return acc.normal_balance === "credit" ? -net : net;
  }, [accounts, journals, lines, accountId, from, accountById]);

  let running = opening;
  const sortedAccounts = [...accounts].sort((a, b) => (a.account_number || "").localeCompare(b.account_number || ""));

  if (loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;

  return (
    <div>
      <PageHeader title="General Ledger" subtitle="Account-level ledger from posted journal lines" />

      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[240px]">
          <label className="text-xs text-slate-500">Account</label>
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
            <SelectContent>
              {sortedAccounts.filter(a => a.is_posting !== false).map(a => <SelectItem key={a.id} value={a.id}>{a.account_number} — {a.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div><label className="text-xs text-slate-500">From</label><div><input type="date" value={from} onChange={e => setFrom(e.target.value)} className="h-9 rounded-md border border-input bg-transparent px-3 text-sm" /></div></div>
        <div><label className="text-xs text-slate-500">To</label><div><input type="date" value={to} onChange={e => setTo(e.target.value)} className="h-9 rounded-md border border-input bg-transparent px-3 text-sm" /></div></div>
      </div>

      {!accountId ? (
        <div className="text-center text-slate-400 py-16">Select an account to view its ledger</div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-left text-slate-600">
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Journal #</th>
                <th className="px-4 py-3 font-medium">Description</th>
                <th className="px-4 py-3 text-right font-medium">Debit</th>
                <th className="px-4 py-3 text-right font-medium">Credit</th>
                <th className="px-4 py-3 text-right font-medium">Balance</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b bg-slate-50/50 font-medium">
                <td colSpan={3} className="px-4 py-2 text-slate-500">Opening balance</td>
                <td className="px-4 py-2 text-right"></td>
                <td className="px-4 py-2 text-right"></td>
                <td className="px-4 py-2 text-right">{formatXAF(opening)}</td>
              </tr>
              {accountLines.map(l => {
                const acc = accountById[l.account_id];
                const normal = acc?.normal_balance || "debit";
                const movement = normal === "debit" ? ((Number(l.debit) || 0) - (Number(l.credit) || 0)) : ((Number(l.credit) || 0) - (Number(l.debit) || 0));
                running += movement;
                const j = journalById[l.journal_id];
                return (
                  <tr key={l.id} className="border-b last:border-0 hover:bg-slate-50">
                    <td className="px-4 py-2">{formatDate(j?.entry_date)}</td>
                    <td className="px-4 py-2 font-medium text-blue-600">{j?.journal_number}</td>
                    <td className="px-4 py-2">{l.description || j?.description}</td>
                    <td className="px-4 py-2 text-right">{l.debit ? formatXAF(l.debit) : ""}</td>
                    <td className="px-4 py-2 text-right">{l.credit ? formatXAF(l.credit) : ""}</td>
                    <td className="px-4 py-2 text-right font-medium">{formatXAF(running)}</td>
                  </tr>
                );
              })}
              {accountLines.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">No transactions in this range</td></tr>}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 font-bold">
                <td colSpan={5} className="px-4 py-3 text-right">Closing balance</td>
                <td className="px-4 py-3 text-right">{formatXAF(running)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}