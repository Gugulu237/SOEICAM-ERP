/* localized-metadata */
import {ui} from './i18n.js';
export const DASHBOARD_ROLES = [
  { value: 'commercial', get label(){return ui("Commercial Agent");} }, { value: 'driver', get label(){return ui("Driver");} },
  { value: 'cashier', get label(){return ui("Cashier");} }, { value: 'production_manager', get label(){return ui("Operations / Production Manager");} },
  { value: 'supply_chain_manager', get label(){return ui("Supply Chain Manager");} },
  { value: 'hotesse', get label(){return ui("Hotesse");} }, { value: 'admin', get label(){return ui("General Manager");} },
];
const total = (rows, key) => rows.reduce((sum, row) => sum + (Number(row[key]) || 0), 0);
export function cashierSnapshot(data = {}) {
  const movements = (data.movements || []).filter(t => t.transaction_date === data.date);
  const approvedPayments = (data.payments || []).filter(p => p.status === 'approved');
  const cheques = (data.payments || []).filter(p => p.status === 'draft' && p.payment_method === 'cheque' && (!p.cheque_gm_signed_at || !p.cheque_pm_signed_at));
  return { balance: total((data.accounts || []).filter(a => a.is_active !== false), 'balance'),
    receipts: total(movements.filter(t => t.transaction_type === 'receipt'), 'amount'),
    expenses: total(movements.filter(t => t.transaction_type === 'expense'), 'amount'), approvedPayments, cheques,
    readyAmount: total(approvedPayments, 'amount'), handovers: data.handovers || [],
    handoverAmount: (data.handovers || []).reduce((sum, h) => sum + Math.max(0, (Number(h.offered_amount) || 0) - (Number(h.received_amount) || 0)), 0),
  };
}
export function productionSnapshot(data = {}) {
  const orders = data.orders || [], lots = (data.riskLots || []).filter(l => Number(l.quantity) > 0);
  const cutoff = new Date((data.date || '2000-01-01') + 'T12:00:00Z'); cutoff.setUTCDate(cutoff.getUTCDate() + 7);
  return {
    plannedToday: orders.filter(o => o.production_date === data.date && !['cancelled', 'rejected'].includes(o.status)),
    running: orders.filter(o => ['materials_issued', 'in_production'].includes(o.status)),
    awaitingQC: orders.filter(o => o.status === 'awaiting_qc'),
    awaitingGM: orders.filter(o => o.status === 'awaiting_approval'),
    held: lots.filter(l => ['quarantine', 'quarantined', 'rejected'].includes(l.qc_status)),
    expiring: lots.filter(l => l.expiry_date && l.expiry_date >= data.date && l.expiry_date <= cutoff.toISOString().slice(0, 10)),
    expired: lots.filter(l => l.expiry_date && l.expiry_date < data.date),
  };
}
export function managerSnapshot(data = {}) {
  const invoices = (data.invoices || []).filter(i => ['posted', 'partially_paid', 'paid', 'overdue'].includes(i.status) && i.invoice_date <= data.date);
  const monthStart = data.monthStart || (data.date || '').slice(0, 8) + '01';
  const recordedFieldSales = (data.recordedFieldSales || []).filter(sale => {
    const date = sale.transaction_date;
    return sale.status === 'approved_posted' && typeof sale.journal_id === 'string' && sale.journal_id.trim()
      && /^\d{4}-\d{2}-\d{2}$/.test(date || '') && Number.isFinite(Date.parse(date + 'T12:00:00Z'))
      && new Date(date + 'T12:00:00Z').toISOString().slice(0, 10) === date && date <= data.date;
  });
  const receivables = (data.receivables || []).filter(i => ['posted', 'partially_paid', 'overdue'].includes(i.status) && Number(i.balance) > 0);
  const overdue = receivables.filter(i => i.due_date && i.due_date < data.date);
  const trend = Array.from({ length: 7 }, (_, i) => {
    const day = new Date((data.date || '2000-01-01') + 'T12:00:00Z'); day.setUTCDate(day.getUTCDate() - 6 + i);
    const date = day.toISOString().slice(0, 10);
    return { date, value: total(invoices.filter(invoice => invoice.invoice_date === date), 'total') };
  });
  return { today: total(invoices.filter(i => i.invoice_date === data.date), 'total'), month: total(invoices.filter(i => i.invoice_date >= monthStart), 'total'),
    fieldSalesToday: total(recordedFieldSales.filter(sale => sale.transaction_date === data.date), 'total'),
    fieldSalesMonth: total(recordedFieldSales.filter(sale => sale.transaction_date >= monthStart), 'total'),
    receivables: total(receivables, 'balance'), overdue, overdueAmount: total(overdue, 'balance'),
    approvalCount: (data.approvalQueues || []).reduce((sum, q) => sum + (Number(q.count) || 0), 0), trend };
}
export function hotesseSnapshot(data = {}) {
  const locations = data.locations || [], reports = data.reports || [];
  const today = reports.filter(r => r.visit_date === data.date);
  const visited = new Set(today.map(r => r.location_id));
  return { today, visited: locations.filter(l => visited.has(l.id)).length,
    remaining: locations.filter(l => !visited.has(l.id)), concerns: reports.filter(r => r.has_concerns && r.status !== 'reviewed') };
}
