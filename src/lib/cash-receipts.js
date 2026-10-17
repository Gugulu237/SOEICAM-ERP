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
import { depositCashSale } from "@/lib/cash-sales";
import { round2 } from "@/lib/posting";

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

// The cashier receives the cash and files the receipt. The deposit posts
// Dr treasury / Cr cash clearing; the collection record keeps the evidence.
export async function receiveCashFromCommercial({
  invoice, order, treasuryAccount, amount, date, receiptReference,
  receiptFileUris = [], collectedBy = "", notes = "", userId = "", userName = "",
}) {
  amount = round2(amount);
  if (amount <= 0) throw new Error("Enter the amount of cash received");
  if (!treasuryAccount) throw new Error("Select the account the cash is received into");
  if (!String(receiptReference || "").trim()) {
    throw new Error("Enter the physical receipt number the commercial handed over");
  }
  if (amount > round2(invoice.balance || 0) + 0.01) {
    throw new Error(`Amount exceeds the ${invoice.invoice_number} balance of ${invoice.balance} XAF`);
  }

  const due = round2(invoice.balance || 0);
  const payment = await depositCashSale({
    invoice, treasuryAccount, amount, date,
    reference: receiptReference, notes, userId,
  });
  // The journal is attached to the payment after it is written, so read it back.
  const posted = await base44.entities.Payment.get(payment.id);

  const settings = (await base44.entities.CompanySettings.filter({}))[0];
  const num = settings?.next_collection_number || 1;
  if (settings) await base44.entities.CompanySettings.update(settings.id, { next_collection_number: num + 1 });
  const serial = String(num).padStart(5, "0");

  const collection = await base44.entities.CashCollection.create({
    collection_number: `COL-${serial}`,
    sale_number: order?.order_number || invoice.invoice_number,
    invoice_id: invoice.id,
    invoice_number: invoice.invoice_number,
    customer_id: invoice.customer_id,
    customer_name: invoice.customer_name || "",
    commercial_id: order?.salesperson_id || "",
    commercial_name: collectedBy || order?.salesperson_name || "",
    driver_name: order?.driver_name || "",
    vehicle_name: order?.vehicle_name || "",
    payment_type: "cash",
    amount_due: due,
    amount_collected: amount,
    collection_date: date,
    method: treasuryAccount.account_type === "mobile_money" ? "mobile_money" : "cash",
    reference: receiptReference,
    receipt_reference: receiptReference,
    receipt_file_uris: receiptFileUris,
    status: "received",
    handed_over_amount: amount,
    received_amount: amount,
    outstanding_amount: 0,
    treasury_account_id: treasuryAccount.id,
    treasury_account_name: treasuryAccount.name,
    received_by: userName,
    received_at: new Date().toISOString(),
    acknowledgement_reference: `ACK-${serial}`,
    journal_id: posted.journal_id || "",
    notes,
    idempotency_key: `${invoice.id}-${Date.now().toString(36)}`,
  });

  await base44.entities.AuditLog.create({
    action: "receive_cash_from_commercial", module: "cashier", entity_type: "CashCollection", entity_id: collection.id,
    user_id: userId,
    description: `Received ${amount} XAF from ${order?.salesperson_name || collectedBy || "the field"} for ${invoice.invoice_number} — receipt ${receiptReference}`,
  });

  return collection;
}