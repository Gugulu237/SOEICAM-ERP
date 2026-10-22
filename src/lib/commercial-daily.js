/* localized-metadata */
import {ui} from './i18n.js';
const reportedStates = new Set(['submitted', 'under_review', 'approved_posted', 'posting_failed']);
const money = value => Math.round(value * 100) / 100;
export function fieldSupplyPayment(sale) {
  const total = money(Number(sale.total)), collected = sale.payment_type === 'credit' ? 0 : money(Number(sale.amount_collected ?? sale.total));
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(collected) || collected < 0 || collected > total) throw new Error('Invalid supply payment amounts');
  return { total, collected, due: money(total - collected) };
}
export function dailySupplySummary(sales, date) {
  const rows = sales.filter(sale => sale.transaction_date === date && reportedStates.has(sale.status));
  const sum = (items, key) => money(items.reduce((total, row) => total + Math.max(0, Number(row[key]) || 0), 0));
  return { count: rows.length, cash: sum(rows.filter(row => row.payment_type === 'cash'), 'total'),
    credit: sum(rows.filter(row => row.payment_type === 'credit'), 'total'), collected: sum(rows, 'amount_collected'),
    due: sum(rows, 'amount_due'), approved: sum(rows.filter(row => row.status === 'approved_posted'), 'total'),
    pending: rows.filter(row => row.status !== 'approved_posted').length };
}
export function commercialGoals(employee, verified, approvedTotal) {
  const target = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
  return [
    { get label(){return ui("Verified new customers");}, actual: verified, target: target(employee?.monthly_customer_target), money: false },
    { get label(){return ui("Recorded supplies including tax");}, actual: approvedTotal, target: target(employee?.monthly_supply_target), money: true },
  ];
}
