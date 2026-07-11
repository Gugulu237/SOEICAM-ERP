import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate } from "react-router-dom";
import { formatXAF, formatDate } from "@/lib/formatters";
import { trialBalanceRows, sumBalancesBy } from "@/lib/accountingReports";
import PageHeader from "@/components/shared/PageHeader";
import StatusBadge from "@/components/shared/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Wallet, Banknote, Users, Truck, Package, AlertCircle } from "lucide-react";

export default function FinancialCommandCentre() {
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState([]);
  const [journals, setJournals] = useState([]);
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      base44.entities.Account.filter({}),
      base44.entities.JournalEntry.list("-entry_date", 500),
      base44.entities.JournalLine.list("-created_date", 1000),
    ]).then(([a, j, l]) => { setAccounts(a); setJournals(j); setLines(l); })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;

  const rows = trialBalanceRows(accounts, journals, lines);
  const monthStart = new Date(); monthStart.setDate(1);
  const from = monthStart.toISOString().split("T")[0];
  const periodRows = trialBalanceRows(accounts, journals, lines, from);

  const cash = sumBalancesBy(rows, a => a.is_treasury);
  const receivables = sumBalancesBy(rows, a => a.account_number === "1200");
  const payables = sumBalancesBy(rows, a => a.account_number === "4000");
  const inventory = sumBalancesBy(rows, a => (a.account_number || "").startsWith("13"));
  const loans = sumBalancesBy(rows, a => (a.account_number || "").startsWith("43"));

  const sales = sumBalancesBy(periodRows, a => a.account_type === "revenue");
  const cogs = sumBalancesBy(periodRows, a => a.account_type === "cogs");
  const expenses = sumBalancesBy(periodRows, a => a.account_type === "expense");
  const grossMargin = sales + cogs; // revenue positive, cogs negative
  const netProfit = grossMargin + expenses; // expenses negative

  const draftJournals = journals.filter(j => j.status === "draft" || j.status === "awaiting_review");
  const recentJournals = journals.slice(0, 8);

  const kpis = [
    { label: "Cash & Equivalents", value: formatXAF(cash), icon: Wallet, tone: "emerald" },
    { label: "Customer Receivables", value: formatXAF(receivables), icon: Users, tone: "blue" },
    { label: "Supplier Payables", value: formatXAF(-payables), icon: Truck, tone: "amber" },
    { label: "Inventory Value", value: formatXAF(inventory), icon: Package, tone: "indigo" },
    { label: "Loans Outstanding", value: formatXAF(-loans), icon: Banknote, tone: "rose" },
  ];

  const periodKpis = [
    { label: "Net Sales (MTD)", value: formatXAF(sales), icon: TrendingUp, tone: "emerald" },
    { label: "Material Gross Margin", value: formatXAF(grossMargin), icon: TrendingUp, tone: "blue" },
    { label: "Operating Expenses", value: formatXAF(-expenses), icon: TrendingDown, tone: "rose" },
    { label: "Net Profit (MTD)", value: formatXAF(netProfit), icon: netProfit >= 0 ? TrendingUp : TrendingDown, tone: netProfit >= 0 ? "emerald" : "rose" },
  ];

  const toneClass = { emerald: "bg-emerald-50 text-emerald-700", blue: "bg-blue-50 text-blue-700", amber: "bg-amber-50 text-amber-700", indigo: "bg-indigo-50 text-indigo-700", rose: "bg-rose-50 text-rose-700" };

  return (
    <div>
      <PageHeader title="Financial Command Centre" subtitle="Live figures from posted general-ledger transactions" />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
        {kpis.map(k => (
          <Card key={k.label}>
            <CardContent className="p-4">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${toneClass[k.tone]}`}><k.icon size={16} /></div>
              <p className="text-xs text-slate-500">{k.label}</p>
              <p className="text-sm font-bold text-slate-900 mt-0.5">{k.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {periodKpis.map(k => (
          <Card key={k.label}>
            <CardContent className="p-4">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${toneClass[k.tone]}`}><k.icon size={16} /></div>
              <p className="text-xs text-slate-500">{k.label}</p>
              <p className="text-sm font-bold text-slate-900 mt-0.5">{k.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {draftJournals.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-6 flex items-center gap-2 text-amber-800 text-sm">
          <AlertCircle size={16} /> {draftJournals.length} journal(s) awaiting review/approval.
        </div>
      )}

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm">Recent Journal Entries</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-left text-slate-600">
                <th className="px-4 py-2 font-medium">Journal #</th>
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Description</th>
                <th className="px-4 py-2 font-medium">Source</th>
                <th className="px-4 py-2 text-right font-medium">Debit</th>
                <th className="px-4 py-2 text-right font-medium">Credit</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {recentJournals.map(j => (
                <tr key={j.id} className="border-b last:border-0 hover:bg-slate-50 cursor-pointer" onClick={() => navigate(`/accounting/journals/${j.id}`)}>
                  <td className="px-4 py-2 font-medium">{j.journal_number}</td>
                  <td className="px-4 py-2">{formatDate(j.entry_date)}</td>
                  <td className="px-4 py-2 max-w-xs truncate">{j.description}</td>
                  <td className="px-4 py-2 text-slate-500">{j.source_module}</td>
                  <td className="px-4 py-2 text-right">{formatXAF(j.total_debit)}</td>
                  <td className="px-4 py-2 text-right">{formatXAF(j.total_credit)}</td>
                  <td className="px-4 py-2"><StatusBadge status={j.status} /></td>
                </tr>
              ))}
              {recentJournals.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">No journals posted yet</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}