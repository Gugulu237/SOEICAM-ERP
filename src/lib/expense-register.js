import { readAll } from '@/lib/field-pos';
import { tableReport, money } from '@/lib/report-models';
import {ui} from './i18n.js';
/* localized-metadata */
// Expense register & reporting.
// Every operating expense is a treasury expense transaction, so the register and
// its reports read the same ledger the Treasury module shows — one source of truth.
import { erp } from "@/api/erpClient";

export { EXPENSE_CATEGORIES } from "@/lib/expenses";

export const PERIOD_PRESETS = [
  { key: "month", get label(){return ui("This Month");} },
  { key: "last_month", get label(){return ui("Last Month");} },
  { key: "quarter", get label(){return ui("This Quarter");} },
  { key: "year", get label(){return ui("This Year");} },
  { key: "all", get label(){return ui("All Time");} },
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
  return erp.entities.TreasuryTransaction.filter(query, { sort: "-transaction_date", limit: 100, cursor });
}

// Period totals for the KPI strip: a single aggregate returns both the count and
// the sum. Aggregate is the most rate-limited call, so it is used exactly once.
export async function loadExpenseTotals(query) {
  const agg = await erp.entities.TreasuryTransaction.aggregate({ query, sum: "amount" });
  const row = agg.rows?.[0] || {};
  return { count: row.count || 0, total: row.sum_amount || 0 };
}

// Every expense matching the query, read in pages.
export async function loadExpenseRows(query) {
  return readAll(erp.entities.TreasuryTransaction,query,'-transaction_date');
}

// Groups expense rows into the report breakdowns: type, month, account and department.
export function summarizeExpenses(rows) {
  const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const group = (field) => {
    const map = new Map();
    rows.forEach(r => {
      const key = r[field] || null;
      const cur = map.get(key) || { count: 0, sum_amount: 0 };
      cur.count += 1;
      cur.sum_amount += Number(r.amount) || 0;
      map.set(key, cur);
    });
    return [...map.entries()]
      .map(([key, v]) => ({ [field]: key, ...v }))
      .sort((a, b) => b.sum_amount - a.sum_amount);
  };
  const months = new Map();
  rows.forEach(r => {
    const key = String(r.transaction_date || "").slice(0, 7);
    const cur = months.get(key) || { count: 0, sum_amount: 0 };
    cur.count += 1;
    cur.sum_amount += Number(r.amount) || 0;
    months.set(key, cur);
  });
  return {
    total,
    count: rows.length,
    categories: group("category"),
    accounts: group("treasury_account_name"),
    departments: group("department_name"),
    months: [...months.entries()].map(([key, v]) => ({ transaction_date: key, ...v })),
  };
}

// Categorisation report — grouped from one filtered read, so it never bursts the
// aggregate rate limit when the filters change.
export async function loadExpenseReport(query) {
  return summarizeExpenses(await loadExpenseRows(query));
}

// Full export of the filtered expenses as a CSV download.
export async function exportExpensesCsv(query, label = "report") {
  const rows = await loadExpenseRows(query);
  const head = ["Date", "Reference", "Expense Type", "Description", "Payee", "Department", "Source", "Paid From", "GL Account", "Amount", "Journal"];
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const body = rows.map(r => [
    r.transaction_date, r.transaction_number, r.category || "uncategorised", r.description, r.payee,
    r.department_name, r.source === "request" ? "Request" : "Direct", r.treasury_account_name,
    r.expense_account_name, r.amount, r.journal_id,
  ].map(esc).join(","));
  const csv = [head.map(value=>ui(value)).map(esc).join(","), ...body].join("\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `expenses-${label}-${iso(new Date())}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  return rows.length;
}

export async function expenseReportDocument(query,filters) {
  const rows=await loadExpenseRows(query),summary=summarizeExpenses(rows);
  const report=tableReport('Operating expense report',[
    {key:'transaction_date',label:'Date'},{key:'transaction_number',label:'Reference'},{key:'category',label:'Category'},
    {key:'description',label:'Description'},{key:'payee',label:'Payee'},{key:'department_name',label:'Department'},
    {key:'treasury_account_name',label:'Paid from'},{key:'expense_account_name',label:'Expense account'},
    {key:'amount',label:'Amount',exportType:'money'},{key:'journal_id',label:'Journal'},
  ],rows,Object.entries(filters));
  report.sections[0].totals=[['Total','','','','','','','',summary.total,'']];
  for(const [title,items,key] of [['By expense type',summary.categories,'category'],['By paid-from account',summary.accounts,'treasury_account_name'],['By department',summary.departments,'department_name'],['By month',summary.months,'transaction_date']]) report.sections.push({title,columns:['Group','Expense count',money('Total')],rows:items.map(r=>[r[key]||'Unassigned',r.count,r.sum_amount])});
  return report;
}
