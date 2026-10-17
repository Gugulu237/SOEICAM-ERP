// Cash disbursement for approved purchase orders.
// Cash released to a supplier before/at delivery is booked as an advance against
// the supplier payable control account, so the later goods receipt (Dr Inventory,
// Cr Payable) nets the supplier balance back to zero.
//
// No cash leaves the till on the cashier's word alone:
//   prepareCashDisbursement (cashier asks) → approveCashDisbursement (General Manager)
//   → releaseCashDisbursement (cashier hands the money over, the ledger moves).
import { base44 } from "@/api/base44Client";
import { postJournal, round2 } from "@/lib/posting";

const PAYABLE_ACCOUNT_NUMBER = "4010";

function paymentMethodFor(treasuryAccount) {
  if (treasuryAccount.account_type === "bank") return "bank_transfer";
  if (treasuryAccount.account_type === "mobile_money") return "mobile_money";
  return "cash";
}

async function nextPaymentNumber() {
  const settings = (await base44.entities.CompanySettings.filter({}))[0];
  return `PAY-${String(settings?.next_journal_number || 1).padStart(5, "0")}`;
}

// Step 1 — the cashier asks for the cash. Nothing moves yet.
export async function prepareCashDisbursement({ po, treasuryAccount, amount, date, reference = "", notes = "", userId = "" }) {
  amount = round2(amount);
  if (amount <= 0) throw new Error("Amount must be greater than zero");
  if (!treasuryAccount) throw new Error("Select the cash/bank account to pay from");

  const payment = await base44.entities.Payment.create({
    payment_number: await nextPaymentNumber(),
    payment_type: "supplier_payment",
    party_type: "supplier",
    party_id: po.supplier_id,
    party_name: po.supplier_name || "",
    payment_date: date,
    amount,
    payment_method: paymentMethodFor(treasuryAccount),
    reference,
    status: "pending_approval",
    account_id: treasuryAccount.gl_account_id,
    treasury_account_id: treasuryAccount.id,
    treasury_account_name: treasuryAccount.name,
    po_id: po.id,
    prepared_by: userId,
    prepared_at: new Date().toISOString(),
    notes: notes || `Cash disbursement request for ${po.po_number}`,
  });

  await base44.entities.AuditLog.create({
    action: "request_cash_disbursement", module: "cashier", entity_type: "Payment", entity_id: payment.id,
    user_id: userId, description: `Requested ${amount} XAF from ${treasuryAccount.name} for ${po.po_number}`,
  });

  return payment;
}

// Step 2 — the General Manager approves or refuses the request.
export async function approveCashDisbursement({ payment, userId = "" }) {
  if (payment.status !== "pending_approval") throw new Error("This request is not waiting for approval");
  await base44.entities.Payment.update(payment.id, {
    status: "approved", approved_by: userId, approved_at: new Date().toISOString(),
  });
  await base44.entities.AuditLog.create({
    action: "approve_cash_disbursement", module: "cashier", entity_type: "Payment", entity_id: payment.id,
    user_id: userId, description: `Approved cash release ${payment.payment_number} — ${payment.amount} XAF to ${payment.party_name}`,
  });
}

export async function rejectCashDisbursement({ payment, reason = "", userId = "" }) {
  if (payment.status !== "pending_approval") throw new Error("This request is not waiting for approval");
  await base44.entities.Payment.update(payment.id, {
    status: "rejected", rejected_by: userId, rejected_at: new Date().toISOString(), rejection_reason: reason,
  });
  await base44.entities.AuditLog.create({
    action: "reject_cash_disbursement", module: "cashier", entity_type: "Payment", entity_id: payment.id,
    user_id: userId, description: `Refused cash release ${payment.payment_number}${reason ? ` — ${reason}` : ""}`,
  });
}

// Step 3 — the cashier releases approved cash: the ledger and the till move here.
export async function releaseCashDisbursement({ payment, treasuryAccount, userId = "" }) {
  if (payment.status !== "approved") throw new Error("This disbursement has not been approved yet");
  if (!treasuryAccount) throw new Error("The account this payment was requested from no longer exists");
  const po = payment.po_id ? await base44.entities.PurchaseOrder.get(payment.po_id) : null;
  return postCashRelease({ payment, po, treasuryAccount, userId });
}

async function postCashRelease({ payment, po, treasuryAccount, userId }) {
  const amount = round2(payment.amount);
  if (amount > round2(treasuryAccount.balance || 0)) {
    throw new Error(`Insufficient funds in ${treasuryAccount.name} (${treasuryAccount.balance || 0} XAF available)`);
  }

  const accounts = await base44.entities.Account.filter({ account_number: PAYABLE_ACCOUNT_NUMBER });
  const payable = accounts[0];
  if (!payable) throw new Error(`Supplier payable account ${PAYABLE_ACCOUNT_NUMBER} not found in the chart of accounts`);

  const journal = await postJournal({
    entryDate: payment.payment_date,
    description: `Cash purchase payment for ${po?.po_number || payment.payment_number} — ${payment.party_name || "supplier"}`,
    sourceModule: "procurement", sourceDocumentType: "Payment", sourceDocumentId: payment.id,
    userId,
    lines: [
      { account_id: payable.id, account_number: payable.account_number, account_name: payable.name, debit: amount, credit: 0, description: `Paid to ${payment.party_name || "supplier"}`, party_type: "supplier", party_id: payment.party_id },
      { account_id: treasuryAccount.gl_account_id, account_number: treasuryAccount.gl_account_number, account_name: treasuryAccount.gl_account_name, debit: 0, credit: amount, description: `Cash released from ${treasuryAccount.name}` },
    ],
  });

  await base44.entities.Payment.update(payment.id, {
    journal_id: journal.id, status: "posted", disbursed_by: userId, disbursed_at: new Date().toISOString(),
  });
  await base44.entities.TreasuryAccount.update(treasuryAccount.id, { balance: round2((treasuryAccount.balance || 0) - amount) });

  if (payment.party_id) {
    const supplier = await base44.entities.Supplier.get(payment.party_id);
    if (supplier) await base44.entities.Supplier.update(supplier.id, { balance: round2((supplier.balance || 0) - amount) });
  }

  if (po) {
    await base44.entities.PurchaseOrder.update(po.id, {
      cash_disbursed: true,
      cash_treasury_account_id: treasuryAccount.id,
      cash_treasury_account_name: treasuryAccount.name,
      cash_disbursed_at: new Date().toISOString(),
      cash_disbursed_by: userId,
      cash_journal_id: journal.id,
    });
  }

  await base44.entities.AuditLog.create({
    action: "disburse", module: "cashier", entity_type: "Payment", entity_id: payment.id,
    user_id: userId, description: `Released ${amount} XAF from ${treasuryAccount.name} for ${po?.po_number || payment.payment_number}`,
  });

  return payment;
}