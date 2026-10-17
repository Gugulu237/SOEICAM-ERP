import React, { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import BreakdownList from "@/components/finance/BreakdownList";
import { statusLabel, formatXAF } from "@/lib/formatters";
import { buildQuery, loadExpenseReport, loadExpenseTotals, exportExpensesCsv, presetRange } from "@/lib/expense-register";
import { useToast } from "@/components/ui/use-toast";
import ExpenseFilterBar from "./ExpenseFilterBar";
import MonthlySpendTrend from "./MonthlySpendTrend";
import CategoryBadge from "./CategoryBadge";

// Categorised expense reporting for a chosen period, type and source account.
export default function ExpenseReport() {
  const { toast } = useToast();
  const [accounts, setAccounts] = useState([]);
  const [filters, setFilters] = useState({ preset: "year", ...presetRange("year"), category: "all", accountId: "all", search: "" });
  const [report, setReport] = useState(null);
  const [totals, setTotals] = useState({ count: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => { base44.entities.TreasuryAccount.filter({ is_active: true }).then(setAccounts); }, []);

  const query = useMemo(() => buildQuery(filters), [filters]);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadExpenseReport(query), loadExpenseTotals(query)])
      .then(([r, t]) => { setReport(r); setTotals(t); })
      .finally(() => setLoading(false));
  }, [query]);

  async function handleExport() {
    setExporting(true);
    try {
      const n = await exportExpensesCsv(query, filters.preset);
      toast({ title: "Export ready", description: `${n} expenses written to the CSV file` });
    } finally {
      setExporting(false);
    }
  }

  const share = (v) => (totals.total ? `${((v / totals.total) * 100).toFixed(1)}%` : "0%");

  const categoryRows = (report?.categories || []).map(r => ({
    label: `${r.category ? statusLabel(r.category) : "Uncategorised"} · ${share(r.sum_amount || 0)}`,
    value: r.sum_amount || 0,
  }));
  const accountRows = (report?.accounts || []).map(r => ({ label: r.treasury_account_name || "Unassigned", value: r.sum_amount || 0 }));
  const departmentRows = (report?.departments || []).map(r => ({ label: r.department_name || "No department", value: r.sum_amount || 0 }));

  const biggest = (report?.categories || [])[0];
  const average = totals.count ? totals.total / totals.count : 0;

  return (
    <div>
      <ExpenseFilterBar filters={filters} onChange={setFilters} accounts={accounts} onExport={exporting ? undefined : handleExport} />

      {loading || !report ? (
        <div className="flex justify-center py-16"><div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Total Spent</p>
              <p className="text-xl font-bold text-red-600">{formatXAF(totals.total)}</p>
              <p className="text-xs text-slate-400">{totals.count} expenses</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Average per Expense</p>
              <p className="text-xl font-bold text-slate-900">{formatXAF(average)}</p>
              <p className="text-xs text-slate-400">Across the selection</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Biggest Expense Type</p>
              <p className="text-xl font-bold text-slate-900">{biggest ? statusLabel(biggest.category) || "Uncategorised" : "—"}</p>
              <p className="text-xs text-slate-400">{biggest ? formatXAF(biggest.sum_amount) : "No expenses yet"}</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Expense Types Used</p>
              <p className="text-xl font-bold text-slate-900">{categoryRows.length}</p>
              <p className="text-xs text-slate-400">{accountRows.length} accounts funded them</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            <BreakdownList title="Spend by Expense Type" rows={categoryRows} emptyMessage="No expenses in this period." barClass="bg-blue-500" />
            <MonthlySpendTrend rows={report.months} />
            <BreakdownList title="Spend by Account Paid From" rows={accountRows} emptyMessage="No treasury payments in this period." barClass="bg-emerald-500" />
            <BreakdownList title="Spend by Department" rows={departmentRows} emptyMessage="No department was charged in this period." barClass="bg-violet-500" />
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <h3 className="font-semibold text-slate-900 mb-3 text-sm">Category Summary</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-4 py-2 text-left font-semibold text-slate-600">Expense Type</th>
                    <th className="px-4 py-2 text-right font-semibold text-slate-600">Expenses</th>
                    <th className="px-4 py-2 text-right font-semibold text-slate-600">Total</th>
                    <th className="px-4 py-2 text-right font-semibold text-slate-600">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {(report.categories || []).map(r => (
                    <tr key={r.category || "none"} className="border-b border-slate-100 last:border-0">
                      <td className="px-4 py-2"><CategoryBadge category={r.category} /></td>
                      <td className="px-4 py-2 text-right text-slate-600">{r.count}</td>
                      <td className="px-4 py-2 text-right font-semibold text-slate-900">{formatXAF(r.sum_amount)}</td>
                      <td className="px-4 py-2 text-right text-slate-500">{share(r.sum_amount || 0)}</td>
                    </tr>
                  ))}
                  {categoryRows.length === 0 && (
                    <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-400">No expenses in this period.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}