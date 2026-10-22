import ReportExport from '@/components/shared/ReportExport';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { erp } from "@/api/erpClient";
import { useNavigate } from "@/lib/router";
import DataTable from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { formatXAF, formatDate } from "@/lib/formatters";
import { buildQuery, loadExpenses, loadExpenseTotals, expenseReportDocument, presetRange } from "@/lib/expense-register";
import ExpenseDialog from "@/components/treasury/ExpenseDialog";
import ExpenseFilterBar from "./ExpenseFilterBar";
import CategoryBadge from "./CategoryBadge";
import { Plus, Wallet, Landmark } from "lucide-react";

// The single register of every expense paid out of a treasury account.
export default function ExpenseRegister() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const navigate = useNavigate();
  const [accounts, setAccounts] = useState([]);
  const [filters, setFilters] = useState({ preset: "month", ...presetRange("month"), category: "all", accountId: "all", search: "" });
  const [debounced, setDebounced] = useState(filters);
  const [rows, setRows] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [totals, setTotals] = useState({ count: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [recordOpen, setRecordOpen] = useState(false);

  useEffect(() => { erp.entities.TreasuryAccount.filter({ is_active: true }).then(setAccounts); }, []);

  // Each filter change re-queries the server (short debounce keeps typing smooth).
  useEffect(() => {
    const t = setTimeout(() => setDebounced(filters), 350);
    return () => clearTimeout(t);
  }, [filters]);

  const query = useMemo(() => buildQuery(debounced), [debounced]);

  const load = useCallback(async () => {
    setLoading(true);
    const [page, t] = await Promise.all([loadExpenses(query), loadExpenseTotals(query)]);
    setRows(page.items);
    setCursor(page.next_cursor);
    setHasMore(page.has_more);
    setTotals(t);
    setLoading(false);
  }, [query]);

  useEffect(() => { load(); }, [load]);

  async function loadMore() {
    const page = await loadExpenses(query, cursor);
    setRows(r => [...r, ...page.items]);
    setCursor(page.next_cursor);
    setHasMore(page.has_more);
  }

  const average = totals.count ? totals.total / totals.count : 0;

  const cols = [
    { key: "transaction_date", label: ui("Date"), render: v => formatDate(v) },
    {
      key: "transaction_number", label: ui("Ref #"),
      render: (v, r) => r.journal_id
        ? <button className="font-medium text-blue-600 hover:underline" onClick={() => navigate(`/accounting/journals/${r.journal_id}`)}>{v}</button>
        : <span className="font-medium">{v}</span>,
    },
    { key: "category", label: ui("Type"), render: v => <CategoryBadge category={v} /> },
    {
      key: "description", label: ui("Description"),
      render: (v, r) => (
        <div>
          <p className="text-slate-900">{v}</p>
          <p className="text-xs text-slate-400">{r.payee ? ui("Paid to {0}", r.payee) : r.expense_account_name}{r.department_name ? ` · ${r.department_name}` : ""}</p>
        </div>
      ),
    },
    {
      key: "source", label: ui("Source"),
      render: v => (
        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${v === "request" ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-600"}`}>
          {v === "request" ? ui("Approved request") : ui("Direct")}
        </span>
      ),
    },
    { key: "treasury_account_name", label: ui("Paid From") },
    { key: "amount", label: ui("Amount"), className: "text-right", render: v => <span className="font-semibold text-red-600">−{formatXAF(v)}</span> },
  ];

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">{ui("Total Spent")}</p>
          <p className="text-xl font-bold text-red-600">{formatXAF(totals.total)}</p>
          <p className="text-xs text-slate-400">{totals.count}{ui(" expenses in the selected period")}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">{ui("Number of Expenses")}</p>
          <p className="text-xl font-bold text-slate-900">{totals.count}</p>
          <p className="text-xs text-slate-400">{ui("Recorded against treasury")}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">{ui("Average per Expense")}</p>
          <p className="text-xl font-bold text-slate-900">{formatXAF(average)}</p>
          <p className="text-xs text-slate-400">{ui("Across the selected filters")}</p>
        </div>
      </div>

      <ExpenseFilterBar filters={filters} onChange={setFilters} accounts={accounts} />
      <div className="mb-4"><ReportExport disabled={loading || JSON.stringify(filters)!==JSON.stringify(debounced) || !!(filters.from && filters.to && filters.from>filters.to)} getReport={()=>expenseReportDocument(query,debounced)}/></div>

      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <p className="text-xs text-slate-500 flex items-center gap-1.5">
          <Landmark size={14} className="text-slate-400" />{ui("Every expense here is money paid out of a treasury account and posted to the ledger.")}</p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate("/accounting/treasury")}><Wallet size={16} className="mr-1" />{ui(" Open Treasury")}</Button>
          <Button onClick={() => setRecordOpen(true)}><Plus size={16} className="mr-1" />{ui(" Small Operating Expense")}</Button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>
      ) : (
        <>
          <DataTable columns={cols} data={rows} pageSize={25} emptyMessage={ui("No expenses match these filters")} />
          {hasMore && (
            <div className="flex justify-center mt-4">
              <Button variant="outline" onClick={loadMore}>{ui("Load more expenses")}</Button>
            </div>
          )}
        </>
      )}

      {recordOpen && (
        <ExpenseDialog accounts={accounts} onClose={() => setRecordOpen(false)} onDone={() => { setRecordOpen(false); load(); }} />
      )}
    </div>
  );
}
