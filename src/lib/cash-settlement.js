/* localized-metadata */
import {ui} from './i18n.js';
const money = value => Math.round(Number(value || 0) * 100) / 100;

export const CASH_SETTLEMENT_STATUS = {
  outstanding: { get label(){return ui("Cash to hand over");}, tone: 'bg-amber-50 text-amber-800 border-amber-200' },
  requested: { get label(){return ui("Requested by cashier");}, tone: 'bg-blue-50 text-blue-700 border-blue-200' },
  deposit_reported: { get label(){return ui("Deposit reported; awaiting cashier");}, tone: 'bg-blue-50 text-blue-700 border-blue-200' },
  awaiting_receipt: { get label(){return ui("Awaiting cashier receipt");}, tone: 'bg-blue-50 text-blue-700 border-blue-200' },
  partial: { get label(){return ui("Partly settled");}, tone: 'bg-orange-50 text-orange-700 border-orange-200' },
  settled: { get label(){return ui("Settled");}, tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  disputed: { get label(){return ui("Needs reconciliation");}, tone: 'bg-red-50 text-red-700 border-red-200' },
};

// Group by the date customers paid, even when the cashier receives the cash later.
// A zero balance alone is not proof of a confirmed receipt.
export function dailyCashSettlements(collections = [], handovers = []) {
  const byHandover = new Map(handovers.map(row => [row.id, row]));
  const days = new Map();
  for (const collection of collections) {
    if (collection.method !== 'cash' || !collection.commercial_id || collection.status === 'cancelled') continue;
    const key = `${collection.commercial_id}:${collection.collection_date}`;
    if (!days.has(key)) days.set(key, { id: key, commercial_id: collection.commercial_id, commercial_name: collection.commercial_name,
      collection_date: collection.collection_date, collected: 0, received: 0, outstanding: 0, requestable: 0, depositable: 0, deposit_reported: 0,
      collection_ids: [], handover_ids: [], receipt_references: [], cashier_names: [], requested: false, confirmed: true, disputed: false });
    const day = days.get(key), total = money(collection.amount_collected), received = money(collection.received_amount);
    const outstanding = money(total - received), handover = byHandover.get(collection.handover_id);
    day.collected = money(day.collected + total); day.received = money(day.received + received);
    day.outstanding = money(day.outstanding + Math.max(0, outstanding));
    if (outstanding > 0) {
      if (collection.agent_deposit_reported_at) day.deposit_reported = money(day.deposit_reported + outstanding);
      else day.depositable = money(day.depositable + outstanding);
    }
    day.confirmed &&= collection.status === 'received' && outstanding === 0 && total > 0;
    day.disputed ||= collection.status === 'disputed' || handover?.status === 'disputed'
      || !Number.isFinite(total + received) || received < 0 || outstanding < 0 || money(collection.outstanding_amount) !== outstanding;
    if (collection.handover_id && !day.handover_ids.includes(collection.handover_id)) day.handover_ids.push(collection.handover_id);
    day.requested ||= !!handover?.requested_by_cashier && handover.status !== 'received';
    if (received > 0) {
      if (handover?.acknowledgement_reference && !day.receipt_references.includes(handover.acknowledgement_reference)) day.receipt_references.push(handover.acknowledgement_reference);
      const cashier = collection.received_by || handover?.cashier_name;
      if (cashier && !day.cashier_names.includes(cashier)) day.cashier_names.push(cashier);
    }
    if (outstanding > 0 && !collection.handover_id && ['held_by_commercial', 'partially_received'].includes(collection.status)) {
      day.requestable = money(day.requestable + outstanding); day.collection_ids.push(collection.id);
    }
  }
  return [...days.values()].map(day => ({ ...day, status: day.disputed ? 'disputed' : day.confirmed ? 'settled'
    : day.deposit_reported > 0 && day.depositable === 0 ? 'deposit_reported' : day.received > 0 ? 'partial' : day.requested ? 'requested' : day.handover_ids.length ? 'awaiting_receipt' : 'outstanding' }))
    .sort((a, b) => String(b.collection_date).localeCompare(String(a.collection_date)) || String(a.commercial_name).localeCompare(String(b.commercial_name)));
}

// Reconcile the actual cash recorded on sales, excluding customer credit and
// without subtracting expenses. Missing collection records stay explicit.
export function reconcileDailyCash(collections = [], handovers = [], sales = []) {
  const days = new Map(dailyCashSettlements(collections, handovers).map(day => [day.id, { ...day, cash_sales_amount: 0, cash_sales_collected: 0, cash_sales_count: 0 }]));
  for (const sale of sales) {
    if (sale.status !== 'approved_posted' || sale.payment_type !== 'cash' || !(Number(sale.amount_collected) > 0)) continue;
    const id = `${sale.commercial_id}:${sale.transaction_date}`;
    if (!days.has(id)) days.set(id, { id, commercial_id: sale.commercial_id, commercial_name: sale.commercial_name, collection_date: sale.transaction_date,
      collected: 0, received: 0, outstanding: 0, requestable: 0, collection_ids: [], handover_ids: [], receipt_references: [], cashier_names: [],
      cash_sales_amount: 0, cash_sales_collected: 0, cash_sales_count: 0, status: 'outstanding', disputed: false });
    const day = days.get(id);
    day.cash_sales_count++;
    day.cash_sales_amount = money(day.cash_sales_amount + Number(sale.amount_collected));
    const linked = collections.filter(c => c.status !== 'cancelled' && c.method === 'cash' && c.commercial_id === sale.commercial_id
      && c.collection_date === sale.transaction_date && (c.field_sale_id === sale.id || (!c.field_sale_id && c.sale_number && c.sale_number === sale.sale_number)));
    day.cash_sales_collected = money(day.cash_sales_collected + linked.reduce((sum, c) => sum + Number(c.amount_collected || 0), 0));
  }
  const saleIds = new Set(sales.filter(sale => sale.status === 'approved_posted' && sale.payment_type === 'cash').map(sale => sale.id));
  return [...days.values()].map(day => {
    const variance = money(day.cash_sales_amount - day.cash_sales_collected);
    const unmatched = collections.some(c => c.status !== 'cancelled' && c.method === 'cash' && c.commercial_id === day.commercial_id && c.collection_date === day.collection_date && c.field_sale_id && !saleIds.has(c.field_sale_id));
    return { ...day, cash_sales_variance: variance, cash_sales_reconciliation_required: variance !== 0 || unmatched, ...(variance !== 0 || unmatched ? { disputed: true, status: 'disputed' } : {}) };
  }).sort((a, b) => String(b.collection_date).localeCompare(String(a.collection_date)) || String(a.commercial_name).localeCompare(String(b.commercial_name)));
}
