import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { formatXAF, formatNumber } from "@/lib/formatters";
import PageHeader from "@/components/shared/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

const COLORS = ["#f59e0b", "#3b82f6", "#10b981", "#ef4444", "#8b5cf6", "#ec4899"];

export default function Reports() {
  const [accounts, setAccounts] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [journals, setJournals] = useState([]);
  const [journalLines, setJournalLines] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      base44.entities.Account.filter({}),
      base44.entities.Invoice.filter({}),
      base44.entities.JournalEntry.filter({ status: "posted" }),
      base44.entities.JournalLine.filter({}),
    ]).then(([a, i, j, jl]) => { setAccounts(a); setInvoices(i); setJournals(j); setJournalLines(jl); }).finally(() => setLoading(false));
  }, []);

  // Trial Balance
  const trialBalance = accounts.filter(a => a.balance !== 0).map(a => ({
    account_number: a.account_number, name: a.name, type: a.account_type,
    debit: a.normal_balance === "debit" ? a.balance : 0,
    credit: a.normal_balance === "credit" ? a.balance : 0,
  })).sort((a, b) => a.account_number.localeCompare(b.account_number));

  const totalDebit = trialBalance.reduce((s, r) => s + r.debit, 0);
  const totalCredit = trialBalance.reduce((s, r) => s + r.credit, 0);

  // P&L
  const revenue = accounts.filter(a => a.account_type === "revenue").reduce((s, a) => s + (a.balance || 0), 0);
  const cogs = accounts.filter(a => a.account_type === "cogs").reduce((s, a) => s + (a.balance || 0), 0);
  const expenses = accounts.filter(a => a.account_type === "expense").reduce((s, a) => s + (a.balance || 0), 0);
  const materialMargin = revenue - cogs;
  const operatingProfit = materialMargin - expenses;

  // Balance Sheet
  const totalAssets = accounts.filter(a => a.account_type === "asset").reduce((s, a) => s + (a.balance || 0), 0);
  const totalLiabilities = accounts.filter(a => a.account_type === "liability").reduce((s, a) => s + (a.balance || 0), 0);
  const totalEquity = accounts.filter(a => a.account_type === "equity").reduce((s, a) => s + (a.balance || 0), 0);

  // Sales chart
  const salesByMonth = invoices.reduce((acc, inv) => {
    if (inv.status === "cancelled") return acc;
    const m = (inv.invoice_date || "").substring(0, 7);
    acc[m] = (acc[m] || 0) + (inv.total || 0);
    return acc;
  }, {});
  const salesChartData = Object.entries(salesByMonth).sort().map(([m, v]) => ({ month: m, sales: v }));

  const typeBreakdown = accounts.filter(a => a.account_type === "expense" && a.balance > 0).map(a => ({ name: a.name, value: a.balance }));

  if (loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;

  return (
    <div>
      <PageHeader title="Financial Reports" subtitle="Trial Balance · Income Statement · Balance Sheet" />
      <Tabs defaultValue="pl">
        <TabsList className="flex-wrap">
          <TabsTrigger value="pl">Income Statement</TabsTrigger>
          <TabsTrigger value="bs">Balance Sheet</TabsTrigger>
          <TabsTrigger value="tb">Trial Balance</TabsTrigger>
          <TabsTrigger value="charts">Charts</TabsTrigger>
        </TabsList>

        <TabsContent value="pl" className="mt-4">
          <div className="bg-white rounded-xl border border-slate-200 p-6 max-w-2xl">
            <h2 className="text-lg font-bold mb-4">Income Statement</h2>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between py-2 border-b"><span className="font-semibold">Net Sales Revenue</span><span className="font-bold text-green-700">{formatXAF(revenue)}</span></div>
              <div className="flex justify-between py-2 border-b"><span>Less: Direct Material Cost of Goods Sold</span><span className="text-red-600">({formatXAF(cogs)})</span></div>
              <div className="flex justify-between py-2 border-b bg-amber-50 px-2 rounded"><span className="font-semibold text-amber-800">Material Gross Margin</span><span className="font-bold text-amber-800">{formatXAF(materialMargin)}</span></div>
              {revenue > 0 && <div className="text-right text-xs text-slate-500">Margin: {formatNumber(materialMargin / revenue * 100, 1)}%</div>}
              <div className="flex justify-between py-2 border-b"><span>Less: Operating Expenses</span><span className="text-red-600">({formatXAF(expenses)})</span></div>
              {accounts.filter(a => a.account_type === "expense" && a.balance > 0).map(a => (
                <div key={a.id} className="flex justify-between py-1 pl-6 text-slate-600"><span>{a.name}</span><span>{formatXAF(a.balance)}</span></div>
              ))}
              <div className="flex justify-between py-3 border-t-2 border-slate-900">
                <span className="font-bold text-lg">Operating Profit</span>
                <span className={`font-bold text-lg ${operatingProfit >= 0 ? "text-green-700" : "text-red-700"}`}>{formatXAF(operatingProfit)}</span>
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="bs" className="mt-4">
          <div className="bg-white rounded-xl border border-slate-200 p-6 max-w-2xl">
            <h2 className="text-lg font-bold mb-4">Balance Sheet</h2>
            <div className="space-y-4 text-sm">
              <div>
                <h3 className="font-semibold text-slate-700 mb-2">Assets</h3>
                {accounts.filter(a => a.account_type === "asset" && a.balance > 0).map(a => (
                  <div key={a.id} className="flex justify-between py-1 pl-4"><span>{a.account_number} — {a.name}</span><span>{formatXAF(a.balance)}</span></div>
                ))}
                <div className="flex justify-between py-2 border-t font-bold"><span>Total Assets</span><span>{formatXAF(totalAssets)}</span></div>
              </div>
              <div>
                <h3 className="font-semibold text-slate-700 mb-2">Liabilities</h3>
                {accounts.filter(a => a.account_type === "liability" && a.balance > 0).map(a => (
                  <div key={a.id} className="flex justify-between py-1 pl-4"><span>{a.account_number} — {a.name}</span><span>{formatXAF(a.balance)}</span></div>
                ))}
                <div className="flex justify-between py-2 border-t font-bold"><span>Total Liabilities</span><span>{formatXAF(totalLiabilities)}</span></div>
              </div>
              <div>
                <h3 className="font-semibold text-slate-700 mb-2">Equity</h3>
                {accounts.filter(a => a.account_type === "equity").map(a => (
                  <div key={a.id} className="flex justify-between py-1 pl-4"><span>{a.account_number} — {a.name}</span><span>{formatXAF(a.balance)}</span></div>
                ))}
                <div className="flex justify-between py-1 pl-4"><span>Retained Earnings (Current P&L)</span><span>{formatXAF(operatingProfit)}</span></div>
                <div className="flex justify-between py-2 border-t font-bold"><span>Total Equity</span><span>{formatXAF(totalEquity + operatingProfit)}</span></div>
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="tb" className="mt-4">
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h2 className="text-lg font-bold mb-4">Trial Balance</h2>
            <table className="w-full text-sm">
              <thead><tr className="border-b"><th className="py-2 text-left">Account</th><th className="py-2 text-left">Name</th><th className="py-2 text-right">Debit</th><th className="py-2 text-right">Credit</th></tr></thead>
              <tbody>
                {trialBalance.map((r, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="py-2">{r.account_number}</td>
                    <td className="py-2">{r.name}</td>
                    <td className="py-2 text-right">{r.debit ? formatXAF(r.debit) : ""}</td>
                    <td className="py-2 text-right">{r.credit ? formatXAF(r.credit) : ""}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 font-bold">
                  <td colSpan={2} className="py-2">Total</td>
                  <td className="py-2 text-right">{formatXAF(totalDebit)}</td>
                  <td className="py-2 text-right">{formatXAF(totalCredit)}</td>
                </tr>
              </tfoot>
            </table>
            {Math.abs(totalDebit - totalCredit) > 1 && (
              <p className="mt-2 text-red-600 text-sm font-medium">⚠ Trial balance is out of balance by {formatXAF(Math.abs(totalDebit - totalCredit))}</p>
            )}
          </div>
        </TabsContent>

        <TabsContent value="charts" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl border border-slate-200 p-6">
              <h3 className="font-semibold mb-4">Sales by Month</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={salesChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis tickFormatter={v => `${Math.round(v / 1000)}k`} />
                  <Tooltip formatter={v => formatXAF(v)} />
                  <Bar dataKey="sales" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            {typeBreakdown.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 p-6">
                <h3 className="font-semibold mb-4">Expense Breakdown</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie data={typeBreakdown} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                      {typeBreakdown.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={v => formatXAF(v)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}