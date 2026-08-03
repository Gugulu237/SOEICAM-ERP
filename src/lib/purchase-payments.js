// Cash disbursement for approved purchase orders.
// Cash released to a supplier before/at delivery is booked as an advance against
// the supplier payable control account, so the later goods receipt (Dr Inventory,
// Cr Payable) nets the supplier balance back to zero.
import { base44 } from "@/api/base44Client";
import { postJournal, round2 } from "@/lib/posting";

const PAYABLE_ACCOUNT_NUMBER = "4010";

export async function disburseCashForPO({ po, treasuryAccount, amount, date, reference = "", notes = "", userId = "" }) {
  amount = round2(amount);
  if (amount <= 0) throw new Error("Amount must be greater than zero");
  if (!treasuryAccount) throw new Error("Select the cash/bank account to pay from");
  if (amount > round2(treasuryAccount.balance || 0)) {
    throw new Error(`Insufficient funds in ${treasuryAccount.name} (${treasuryAccount.balance || 0} XAF available)`);
  }

  const accounts = await base44.entities.Account.filter({ account_number: PAYABLE_ACCOUNT_NUMBER });
  const payable = accounts[0];
  if (!payable) throw new Error(`Supplier payable account ${PAYABLE_ACCOUNT_NUMBER} not found in the chart of accounts`);

  const settings = (await base44.entities.CompanySettings.filter({}))[0];
  const num = settings?.next_journal_number || 1;

  const payment = await base44.entities.Payment.create({
    payment_number: `PAY-${String(num).padStart(5, "0")}`,
    payment_type: "supplier_payment",
    party_type: "supplier",
    party_id: po.supplier_id,
    party_name: po.supplier_name || "",
    payment_date: date,
    amount,
    payment_method: treasuryAccount.account_type === "bank" ? "bank_transfer"
      : treasuryAccount.account_type === "mobile_money" ? "mobile_money" : "cash",
    reference,
    status: "posted",
    account_id: treasuryAccount.gl_account_id,
    po_id: po.id,
    disbursed_by: userId,
    disbursed_at: new Date().toISOString(),
    notes: notes || `Cash purchase payment for ${po.po_number}`,
  });

  const journal = await postJournal({
    entryDate: date,
    description: `Cash purchase payment for ${po.po_number} — ${po.supplier_name || "supplier"}`,
    sourceModule: "procurement", sourceDocumentType: "Payment", sourceDocumentId: payment.id,
    userId,
    lines: [
      { account_id: payable.id, account_number: payable.account_number, account_name: payable.name, debit: amount, credit: 0, description: `Paid to ${po.supplier_name || "supplier"}`, party_type: "supplier", party_id: po.supplier_id },
      { account_id: treasuryAccount.gl_account_id, account_number: treasuryAccount.gl_account_number, account_name: treasuryAccount.gl_account_name, debit: 0, credit: amount, description: `Cash released from ${treasuryAccount.name}` },
    ],
  });

  await base44.entities.Payment.update(payment.id, { journal_id: journal.id });
  await base44.entities.TreasuryAccount.update(treasuryAccount.id, { balance: round2((treasuryAccount.balance || 0) - amount) });

  const supplier = await base44.entities.Supplier.get(po.supplier_id);
  if (supplier) await base44.entities.Supplier.update(supplier.id, { balance: round2((supplier.balance || 0) - amount) });

  await base44.entities.PurchaseOrder.update(po.id, {
    cash_disbursed: true,
    cash_treasury_account_id: treasuryAccount.id,
    cash_treasury_account_name: treasuryAccount.name,
    cash_disbursed_at: new Date().toISOString(),
    cash_disbursed_by: userId,
    cash_journal_id: journal.id,
  });

  await base44.entities.AuditLog.create({
    action: "disburse", module: "cashier", entity_type: "PurchaseOrder", entity_id: po.id,
    user_id: userId, description: `Released ${amount} XAF from ${treasuryAccount.name} for ${po.po_number}`,
  });

  return payment;
}