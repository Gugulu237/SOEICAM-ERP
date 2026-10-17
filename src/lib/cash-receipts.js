// Cash received from the commercials after a delivery.
//
// A cash sale debits the cash clearing account (1050 Undeposited Funds) at the
// point of sale. The commercial collects the money on the road and hands it over;
// the cashier receives it against the physical receipt the commercial carries,
// and the receipt moves the money from clearing into a real treasury account.
//
// The ledger entry is the deposit; the cash collection record is the proof of
// operation that ties the money to a named commercial, a delivery and a receipt.
import { base44 } from "@/api/base44Client";
import { confirmCustomerReceipt } from "@/lib/customer-receipts";

const isCashSale = (invoice, order) =>
  invoice.payment_type === "cash" || order?.payment_type === "cash";

// Cash sales delivered but not yet handed over: the invoice still carries a balance.
export async function loadCashToCollect() {
  const page = await base44.entities.Invoice.filter(
    { balance: { $gt: 0 }, status: { $ne: "cancelled" } },
    { sort: "-invoice_date", limit: 100 },
  );
  const invoices = page.items;
  const orderIds = [...new Set(invoices.map(i => i.sales_order_id).filter(Boolean))];
  const orders = orderIds.length
    ? (await base44.entities.SalesOrder.filter({ id: { $in: orderIds } }, { limit: 200 })).items
    : [];
  const byId = Object.fromEntries(orders.map(o => [o.id, o]));
  return invoices
    .map(invoice => ({ invoice, order: byId[invoice.sales_order_id] || null }))
    .filter(row => isCashSale(row.invoice, row.order));
}

// Who can be handing the cash over: the commercials named on an outstanding
// delivery, plus the active commercials on the register.
export async function loadOutstandingCommercials(rows = []) {
  const names = new Map();
  rows.forEach(({ order }) => {
    const n = order?.salesperson_name;
    if (n && !names.has(n)) names.set(n, { id: order.salesperson_id || n, name: n });
  });
  const page = await base44.entities.Employee.filter({ role: "commercial", status: "active" }, { limit: 100 });
  (page.items || []).forEach(e => {
    if (!names.has(e.full_name)) names.set(e.full_name, { id: e.id, name: e.full_name });
  });
  return [...names.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadCashReceipts(limit = 50) {
  const page = await base44.entities.CashCollection.filter({ status: "received" }, { sort: "-received_at", limit });
  return page.items;
}

// Cashier confirmation stores the receipt only. GM approval posts the deposit.
export async function receiveCashFromCommercial({ invoice, treasuryAccount, amount, date, receiptReference, receiptFileUris = [], collectedBy = "", notes = "", requestKey }) {
  const payment = await confirmCustomerReceipt({ customerId: invoice.customer_id, treasuryAccountId: treasuryAccount?.id, amount, date, reference: receiptReference, receiptFileUris, collectedBy, notes, commercialReceipt: true, requestKey: requestKey || crypto.randomUUID(), allocations: [{ invoice_id: invoice.id, amount }] });
  return { ...payment, acknowledgement_reference: payment.payment_number };
}