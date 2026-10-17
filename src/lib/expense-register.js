// Expense register & reporting.
// Every operating expense is a treasury expense transaction, so the register and
// its reports read the same ledger the Treasury module shows — one source of truth.
import { base44 } from "@/api/base44Client";

export { EXPENSE_CATEGORIES } from "@/lib/expenses";

export const PERIOD_PRESETS = [
  { key: "month", label: "This Month" },
  { key: "last_month", label: "Last Month" },
  { key: "quarter", label: "This Quarter" },
  { key: "year", label: "This Year" },
  { key: "all", label: "All Time" },
];

const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Date range for a quick period button.
export function presetRange(key) {
  const today = new Date();
  const y = today.getFullYear(), m = today.getMonth();
  if (key === "month") return { from: iso(new Date(y, m, 1)), to: iso(today) };
  if (key === "last_month") return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
  if (key === "quarter") return { from: iso(new Date(y, Math.floor(m / 3) * 3, 1)), to: iso(today) };
  if (key === "year") return { from: iso(new Date(y, 0, 1)), to: iso(today) };
  return { from: "", to: "" };
}

// Server-side query for the expense ledger: period, type and account.
export function buildQuery({ from, to, category, accountId, search } = {}) {
  const query = { transaction_type: "expense" };
  const range = {};
  if (from) range.$gte = from;
  if (to) range.$lte = to;
  if (Object.keys(range).length) query.transaction_date = range;
  if (category && category !== "all") query.category = category;
  if (accountId && accountId !== "all") query.treasury_account_id = accountId;
  const term = (search || "").trim();
  if (term) {
    query.$or = ["description", "payee", "reference", "expense_account_name", "transaction_number"]
      .map(f => ({ [f]: { $regex: term, $options: "i" } }));
  }
  return query;
}

// One page of expenses (the register shows a page, "load more" fetches the next).
export async function loadExpenses(query, cursor) {
  return base44.entities.TreasuryTransaction.filter(query, { sort: "-transaction_date", limit: 100, cursor });
}

// Period totals for the KPI strip — computed by the server, not from the loaded page.
export async function loadExpenseTotals(query) {
  const [count, agg] = await Promise.all([
    base44.entities.TreasuryTransaction.count(query),
    base44.entities.TreasuryTransaction.aggregate({ query, sum: "amount" }),
  ]);
  return { count, total: agg.rows?.[0]?.sum_amount || 0 };
}

// Categorisation report: by expense type, by month, by account paid from, by department.
export async function loadExpenseReport(query) {
  const [categories, months, accounts, departments] = await Promise.all([
    base44.entities.TreasuryTransaction.aggregate({ query, groupBy: "category", sum: "amount", sort: "-sum_amount" }),
    base44.entities.TreasuryTransaction.aggregate({ query, dateBucket: { field: "transaction_date", unit: "month" }, sum: "amount" }),
    base44.entities.TreasuryTransaction.aggregate({ query, groupBy: "treasury_account_name", sum: "amount", sort: "-sum_amount" }),
    base44.entities.TreasuryTransaction.aggregate({ query, groupBy: "department_name", sum: "amount", sort: "-sum_amount" }),
  ]);
  return {
    categories: categories.rows || [],
    months: months.rows || [],
    accounts: accounts.rows || [],
    departments: departments.rows || [],
  };
}

// Full export of the filtered expenses as a CSV download.
export async function exportExpensesCsv(query, label = "report") {
  const rows = [];
  let cursor;
  for (let i = 0; i < 40; i++) {
    const page = await base44.entities.TreasuryTransaction.filter(query, { sort: "-transaction_date", limit: 500, cursor });
    rows.push(...page.items);
    if (!page.has_more) break;
    cursor = page.next_cursor;
  }
  const head = ["Date", "Reference", "Expense Type", "Description", "Payee", "Department", "Source", "Paid From", "GL Account", "Amount", "Journal"];
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const body = rows.map(r => [
    r.transaction_date, r.transaction_number, r.category || "uncategorised", r.description, r.payee,
    r.department_name, r.source === "request" ? "Request" : "Direct", r.treasury_account_name,
    r.expense_account_name, r.amount, r.journal_id,
  ].map(esc).join(","));
  const csv = [head.map(esc).join(","), ...body].join("\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `expenses-${label}-${iso(new Date())}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  return rows.length;
}