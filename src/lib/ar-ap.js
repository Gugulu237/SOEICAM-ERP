// Receivables / Payables subledger operations.
// All GL postings go through the central posting engine and configurable posting rules.
import { base44 } from "@/api/base44Client";
import { postJournal, resolveRuleAccount, round2 } from "@/lib/posting";

const METHOD_RULE = { cash: "cash", bank_transfer: "bank", mobile_money: "mobile_money", cheque: "bank" };

export function agingBucket(dueDate, asOf = new Date().toISOString().slice(0, 10)) {
  if (!dueDate || dueDate >= asOf) return "current";
  const days = Math.floor((new Date(asOf) - new Date(dueDate)) / 86400000);
  if (days <= 30) return "d1_30";
  if (days <= 60) return "d31_60";
  if (days <= 90) return "d61_90";
  return "d90_plus";
}

async function applyAllocations({ payment, entityName, docs, allocations, partyType, party }) {
  const records = [];
  for (const doc of docs) {
    const amt = round2(allocations[doc.id] || 0);
    if (amt <= 0) continue;
    if (amt > round2(doc.balance) + 0.01) throw new Error(`Allocation to ${doc.invoice_number || doc.bill_number} exceeds its balance`);
    const newPaid = round2((doc.amount_paid || 0) + amt);
    const newBal = round2((doc.total || 0) - newPaid);
    await base44.entities[entityName].update(doc.id, {
      amount_paid: newPaid,
      balance: newBal,
      status: newBal <= 0 ? "paid" : "partially_paid",
    });
    records.push({
      payment_id: payment.id,
      payment_number: payment.payment_number,
      document_type: entityName === "Invoice" ? "invoice" : "bill",
      document_id: doc.id,
      document_number: doc.invoice_number || doc.bill_number || "",
      party_type: partyType,
      party_id: party.id,
      party_name: party.business_name || party.name || "",
      amount: amt,
      allocation_date: payment.payment_date,
    });
  }
  if (records.length) await base44.entities.PaymentAllocation.bulkCreate(records);
}

// Customer payment: Dr Cash/Bank, Cr AR control; allocate to selected invoices.
export async function recordCustomerPayment({ customer, amount, paymentDate, method, reference, allocations = {}, openInvoices = [], userId = "" }) {
  amount = round2(amount);
  if (amount <= 0) throw new Error("Amount must be greater than zero");
  const allocated = round2(Object.values(allocations).reduce((s, v) => s + round2(v), 0));
  if (allocated > amount + 0.01) throw new Error("Allocated total exceeds payment amount");

  const cashRule = await resolveRuleAccount(METHOD_RULE[method] || "cash");
  const arRule = await resolveRuleAccount("customer_receivable");

  const payment = await base44.entities.Payment.create({
    payment_number: `PMT-${Date.now().toString(36).toUpperCase()}`,
    payment_type: "customer_payment", party_type: "customer",
    party_id: customer.id, party_name: customer.business_name || "",
    payment_date: paymentDate, amount, payment_method: method,
    reference: reference || "", status: "posted",
  });

  await applyAllocations({ payment, entityName: "Invoice", docs: openInvoices, allocations, partyType: "customer", party: customer });

  await base44.entities.Customer.update(customer.id, { balance: round2((customer.balance || 0) - amount) });

  const journal = await postJournal({
    entryDate: paymentDate,
    description: `Customer payment from ${customer.business_name} (${method})`,
    sourceModule: "payments", sourceDocumentType: "Payment", sourceDocumentId: payment.id,
    userId,
    lines: [
      { account_id: cashRule.account_id, account_number: cashRule.account_number, account_name: cashRule.account_name, debit: amount, credit: 0, description: `Payment received — ${reference || method}` },
      { account_id: arRule.account_id, account_number: arRule.account_number, account_name: arRule.account_name, debit: 0, credit: amount, description: `Receivable cleared — ${customer.business_name}`, party_type: "customer", party_id: customer.id },
    ],
  });
  await base44.entities.Payment.update(payment.id, { journal_id: journal.id });

  await base44.entities.AuditLog.create({
    action: "receive_payment", module: "receivables", entity_type: "Payment", entity_id: payment.id,
    user_id: userId, description: `Received ${amount} XAF from ${customer.business_name}, allocated ${allocated} XAF to invoices`,
  });
  return payment;
}

// Supplier payment: Dr AP control, Cr Cash/Bank; allocate to selected bills.
export async function recordSupplierPayment({ supplier, amount, paymentDate, method, reference, allocations = {}, openBills = [], userId = "" }) {
  amount = round2(amount);
  if (amount <= 0) throw new Error("Amount must be greater than zero");
  const allocated = round2(Object.values(allocations).reduce((s, v) => s + round2(v), 0));
  if (allocated > amount + 0.01) throw new Error("Allocated total exceeds payment amount");

  const cashRule = await resolveRuleAccount(METHOD_RULE[method] || "cash");
  const apRule = await resolveRuleAccount("supplier_payable");

  const payment = await base44.entities.Payment.create({
    payment_number: `PMT-${Date.now().toString(36).toUpperCase()}`,
    payment_type: "supplier_payment", party_type: "supplier",
    party_id: supplier.id, party_name: supplier.name || "",
    payment_date: paymentDate, amount, payment_method: method,
    reference: reference || "", status: "posted",
  });

  await applyAllocations({ payment, entityName: "Bill", docs: openBills, allocations, partyType: "supplier", party: supplier });

  await base44.entities.Supplier.update(supplier.id, { balance: round2((supplier.balance || 0) - amount) });

  const journal = await postJournal({
    entryDate: paymentDate,
    description: `Supplier payment to ${supplier.name} (${method})`,
    sourceModule: "payments", sourceDocumentType: "Payment", sourceDocumentId: payment.id,
    userId,
    lines: [
      { account_id: apRule.account_id, account_number: apRule.account_number, account_name: apRule.account_name, debit: amount, credit: 0, description: `Payable settled — ${supplier.name}`, party_type: "supplier", party_id: supplier.id },
      { account_id: cashRule.account_id, account_number: cashRule.account_number, account_name: cashRule.account_name, debit: 0, credit: amount, description: `Payment made — ${reference || method}` },
    ],
  });
  await base44.entities.Payment.update(payment.id, { journal_id: journal.id });

  await base44.entities.AuditLog.create({
    action: "pay_supplier", module: "payables", entity_type: "Payment", entity_id: payment.id,
    user_id: userId, description: `Paid ${amount} XAF to ${supplier.name}, allocated ${allocated} XAF to bills`,
  });
  return payment;
}

// Register a supplier bill from a received PO: Dr Inventory, Cr AP control.
export async function createBillFromPO({ po, billDate, dueDate, userId = "" }) {
  const existing = await base44.entities.Bill.filter({ po_id: po.id });
  if (existing.some((b) => b.status !== "cancelled")) throw new Error("A bill already exists for this purchase order");

  const invRule = await resolveRuleAccount("raw_material_inventory");
  const apRule = await resolveRuleAccount("supplier_payable");
  const total = round2(po.total);

  const bill = await base44.entities.Bill.create({
    bill_number: `BILL-${Date.now().toString(36).toUpperCase()}`,
    supplier_id: po.supplier_id, supplier_name: po.supplier_name || "",
    po_id: po.id, po_number: po.po_number || "",
    bill_date: billDate, due_date: dueDate,
    total, amount_paid: 0, balance: total, status: "open",
  });

  const journal = await postJournal({
    entryDate: billDate,
    description: `Supplier bill ${bill.bill_number} — ${po.supplier_name} (${po.po_number})`,
    sourceModule: "purchases", sourceDocumentType: "Bill", sourceDocumentId: bill.id,
    userId,
    lines: [
      { account_id: invRule.account_id, account_number: invRule.account_number, account_name: invRule.account_name, debit: total, credit: 0, description: `Goods received — ${po.po_number}` },
      { account_id: apRule.account_id, account_number: apRule.account_number, account_name: apRule.account_name, debit: 0, credit: total, description: `Payable to ${po.supplier_name}`, party_type: "supplier", party_id: po.supplier_id },
    ],
  });
  await base44.entities.Bill.update(bill.id, { journal_id: journal.id });

  const supplier = await base44.entities.Supplier.get(po.supplier_id);
  await base44.entities.Supplier.update(supplier.id, { balance: round2((supplier.balance || 0) + total) });
  await base44.entities.PurchaseOrder.update(po.id, { status: "billed" });

  await base44.entities.AuditLog.create({
    action: "create_bill", module: "payables", entity_type: "Bill", entity_id: bill.id,
    user_id: userId, description: `Bill ${bill.bill_number} for ${total} XAF — ${po.supplier_name} (${po.po_number})`,
  });
  return bill;
}