import React, { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate } from "react-router-dom";
import { formatXAF, formatDate } from "@/lib/formatters";
import PageHeader from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search } from "lucide-react";

const today = () => new Date().toISOString().slice(0, 10);
const firstOfMonth = () => new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);

export default function GeneralLedger() {
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState([]);
  const [journals, setJournals] = useState([]);
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [accountId, setAccountId] = useState("all");
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      const [a, j, l] = await Promise.all([
        base44.entities.Account.filter({}),
        base44.entities.JournalEntry.filter({ status: "posted" }),
        base44.entities.JournalLine.list("-created_date", 1000),
      ]);
      setAccounts(a);
      setJournals(j);
      setLines(l);
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  const journalMap = useMemo(() => {
    const m = {};
    journals.forEach(j => { m[j.id] = j; });
    return m;
  }, [journals]);

  const accountMap = useMemo(() => {
    const m = {};
    accounts.forEach(a => { m[a.id] = a; });
    return m;
  }, [accounts]);

  const filteredLines = useMemo(() => {
    const f = new Date(from + "T00:00:00Z");
    const t = new Date(to + "T23:59:59Z");
    return lines
      .filter(l => {
        const je = journalMap[l.journal_id];
        if (!je || je.status === "reversed") return false;
        const d = new Date((je.entry_date || "") + "T00:00:00Z");
        if (d < f || d > t) return false;
        if (accountId !== "all" && l.account_id !== accountId) return false;
        return true;
      })
      .sort((a, b) => {
        const da = new Date((journalMap[a.journal_id]?.entry_date || "") + "T00:00:00Z");
        const db = new Date((journalMap[b.journal_id]?.entry_date || "") + "T00:00:00Z");
        return da - db;
      });
  }, [lines, journalMap, accountId, from, to]);

  // Running balance (only meaningful when a single account is selected)
  let running = 0;
  const rowsWithBalance = filteredLines.map(l => {
    const acc = accountMap[l.account_id];
    if (accountId !== "all") {
      const delta = acc?.normal_balance === "debit" ? ((l.debit || 0) - (l.credit || 0)) : ((l.credit || 0) - (l.debit || 0));
      running += delta;
    }
    return { ...l, running, je: journalMap[l.journal_id], acc };
  });

  const periodDebit = filteredLines.reduce((s, l) => s + (l.debit || 0), 0);
  const periodCredit = filteredLines.reduce((s, l) => s + (l.credit || 0), 0);

  if (loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;

  return (
    <div>
      <PageHeader title="General Ledger" subtitle="Posted transactions with running balances — drill down to source" />
      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4 grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div>
          <Label>Account</Label>
          <Select value={accountId} onValueChange={setAccountId} className="w-full">
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Accounts</SelectItem>
              {accounts.filter(a => a.is_active !== false).sort((a, b) => a.account_number.localeCompare(b.account_number)).map(a => (
                <SelectItem key={a.id} value={a.id}>{a.account_number} · {a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div><Label>From</Label><Input type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
        <div><Label>To</Label><Input type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
        <div className="flex items-end"><Button variant="outline" onClick={() => { setAccountId("all"); setFrom(firstOfMonth()); setTo(today()); }}>Reset</Button></div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">Date</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">Journal #</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">Account</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">Description</th>
              <th className="px-4 py-3 text-right font-semibold text-slate-600">Debit</th>
              <th className="px-4 py-3 text-right font-semibold text-slate-600">Credit</th>
              {accountId !== "all" && <th className="px-4 py-3 text-right font-semibold text-slate-600">Balance</th>}
            </tr>
          </thead>
          <tbody>
            {rowsWithBalance.length === 0 ? (
              <tr><td colSpan={accountId !== "all" ? 7 : 6} className="px-4 py-12 text-center text-slate-400">No posted transactions in this range.</td></tr>
            ) : rowsWithBalance.map((l, i) => (
              <tr key={i} onClick={() => navigate(`/accounting/journals/${l.journal_id}`)} className="border-b border-slate-100 last:border-0 cursor-pointer hover:bg-slate-50">
                <td className="px-4 py-2.5">{l.je?.entry_date ? formatDate(l.je.entry_date) : "—"}</td>
                <td className="px-4 py-2.5 font-mono text-xs text-amber-600">{l.je?.journal_number || "—"}</td>
                <td className="px-4 py-2.5"><div className="font-medium">{l.account_number}</div><div className="text-xs text-slate-500">{l.account_name}</div></td>
                <td className="px-4 py-2.5 text-slate-600">{l.description || l.je?.description || "—"}</td>
                <td className="px-4 py-2.5 text-right">{l.debit ? formatXAF(l.debit) : ""}</td>
                <td className="px-4 py-2.5 text-right">{l.credit ? formatXAF(l.credit) : ""}</td>
                {accountId !== "all" && <td className="px-4 py-2.5 text-right font-medium">{formatXAF(l.running)}</td>}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-slate-50 border-t-2 border-slate-200 font-semibold">
              <td colSpan={4} className="px-4 py-3 text-right">Period Totals</td>
              <td className="px-4 py-3 text-right">{formatXAF(periodDebit)}</td>
              <td className="px-4 py-3 text-right">{formatXAF(periodCredit)}</td>
              {accountId !== "all" && <td className="px-4 py-3 text-right">{formatXAF(running)}</td>}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}