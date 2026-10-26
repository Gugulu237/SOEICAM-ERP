/* localized-metadata */
import {isOpeningRecord} from './opening-records.js';
import {ui} from './i18n.js';
// Aggregates a quick financial health snapshot for a chosen period.
import { erp } from "@/api/erpClient";

export const PERIODS = [
  { key: "today", get label(){return ui("Today");} },
  { key: "week", get label(){return ui("This Week");} },
  { key: "month", get label(){return ui("This Month");} },
  { key: "quarter", get label(){return ui("This Quarter");} },
  { key: "year", get label(){return ui("This Year");} },
];

const SPOILAGE_TYPES = ["damage", "expiry"];

export function periodRange(key, ref = new Date()) {
  const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  let start;
  if (key === "today") start = d;
  else if (key === "week") { start = new Date(d); start.setDate(d.getDate() - ((d.getDay() + 6) % 7)); }
  else if (key === "month") start = new Date(d.getFullYear(), d.getMonth(), 1);
  else if (key === "quarter") start = new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);
  else start = new Date(d.getFullYear(), 0, 1);
  const end = new Date(d);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function iso(date) {
  return date.toISOString().slice(0, 10);
}

function inRange(dateStr, start, end) {
  if (!dateStr) return false;
  const v = String(dateStr).slice(0, 10);
  return v >= iso(start) && v < iso(end);
}

function sum(rows, field) {
  return rows.reduce((s, r) => s + (Number(r[field]) || 0), 0);
}

// Returns cash position plus period totals for sales, purchases, expenses and spoilage.
export async function getFinancePulse(periodKey) {
  const { start, end } = periodRange(periodKey);

  const [accounts, invoices, purchases, treasuryTx, movements] = await Promise.all([
    erp.entities.TreasuryAccount.filter({ is_active: true }),
    erp.entities.Invoice.list("-invoice_date", 1000),
    erp.entities.PurchaseOrder.list("-order_date", 1000),
    erp.entities.TreasuryTransaction.list("-transaction_date", 1000),
    erp.entities.StockMovement.list("-created_date", 1000),
  ]);

  const periodInvoices = invoices.filter(i =>
    !isOpeningRecord(i) && i.status !== "cancelled" && i.status !== "draft" && inRange(i.invoice_date, start, end)
  );
  const periodPurchases = purchases.filter(p =>
    !["draft", "cancelled"].includes(p.status) && inRange(p.order_date, start, end)
  );
  const periodExpenses = treasuryTx.filter(t =>
    t.transaction_type === "expense" && inRange(t.transaction_date, start, end)
  );
  const periodSpoilage = movements.filter(m =>
    SPOILAGE_TYPES.includes(m.movement_type) &&
    m.status !== "reversed" &&
    inRange(m.movement_date || m.created_date, start, end)
  );

  const cashByType = {};
  accounts.forEach(a => { cashByType[a.account_type] = (cashByType[a.account_type] || 0) + (a.balance || 0); });

  const sales = sum(periodInvoices, "total");
  const collected = sum(periodInvoices, "amount_paid");
  const purchasesTotal = sum(periodPurchases, "total");
  const expenses = sum(periodExpenses, "amount");
  const spoilage = sum(periodSpoilage, "total_value");

  return {
    start, end,
    cashTotal: accounts.reduce((s, a) => s + (a.balance || 0), 0),
    accounts,
    cashByType,
    sales,
    collected,
    outstanding: sales - collected,
    salesCount: periodInvoices.length,
    purchases: purchasesTotal,
    purchasesCount: periodPurchases.length,
    expenses,
    expensesCount: periodExpenses.length,
    spoilage,
    spoilageCount: periodSpoilage.length,
    spoilageLines: periodSpoilage,
    expenseLines: periodExpenses,
    netPosition: sales - purchasesTotal - expenses - spoilage,
  };
}

// Groups a set of rows by a label field and returns the biggest contributors.
export function topBy(rows, labelField, valueField, limit = 5) {
  const map = {};
  rows.forEach(r => {
    const key = r[labelField] || "Unspecified";
    map[key] = (map[key] || 0) + (Number(r[valueField]) || 0);
  });
  return Object.entries(map)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}