// Cash sales flow through a cash clearing account (1050 Undeposited Funds).
// The invoice debits clearing at the point of sale; the cashier later banks the
// money and the deposit moves it from clearing into a real treasury account.
import { base44 } from "@/api/base44Client";
import { postJournal, round2 } from "@/lib/posting";

export const CASH_CLEARING_ACCOUNT_NUMBER = "1050";

export async function getCashClearingAccount() {
  const accounts = await base44.entities.Account.filter({ account_number: CASH_CLEARING_ACCOUNT_NUMBER });
  const acc = accounts[0];
  if (!acc) throw new Error(`Cash clearing account ${CASH_CLEARING_ACCOUNT_NUMBER} not found in the chart of accounts`);
  return acc;
}

// Cashier banks collected cash: Dr treasury GL, Cr cash clearing.
export async function depositCashSale({ invoice, treasuryAccount, amount, date, reference = "", notes = "", userId = "" }) {
  amount = round2(amount);
  if (amount <= 0) throw new Error("Amount must be greater than zero");
  if (!treasuryAccount) throw new Error("Select the account to deposit into");
  if (amount > round2(invoice.balance || 0)) throw new Error("Amount exceeds the outstanding invoice balance");

  const clearing = await getCashClearingAccount();
  const settings = (await base44.entities.CompanySettings.filter({}))[0];
  const num = settings?.next_journal_number || 1;

  const payment = await base44.entities.Payment.create({
    payment_number: `RCP-${String(num).padStart(5, "0")}`,
    payment_type: "customer_payment",
    party_type: "customer",
    party_id: invoice.customer_id,
    party_name: invoice.customer_name || "",
    payment_date: date,
    amount,
    payment_method: treasuryAccount.account_type === "bank" ? "bank_transfer"
      : treasuryAccount.account_type === "mobile_money" ? "mobile_money" : "cash",
    reference,
    status: "posted",
    account_id: treasuryAccount.gl_account_id,
    disbursed_by: userId,
    disbursed_at: new Date().toISOString(),
    notes: notes || `Cash sale deposit for ${invoice.invoice_number}`,
    allocated_to_invoices: invoice.id,
  });

  const journal = await postJournal({
    entryDate: date,
    description: `Cash sale deposit — ${invoice.invoice_number} into ${treasuryAccount.name}`,
    sourceModule: "treasury", sourceDocumentType: "Payment", sourceDocumentId: payment.id,
    userId,
    lines: [
      { account_id: treasuryAccount.gl_account_id, account_number: treasuryAccount.gl_account_number, account_name: treasuryAccount.gl_account_name, debit: amount, credit: 0, description: `Deposited into ${treasuryAccount.name}` },
      { account_id: clearing.id, account_number: clearing.account_number, account_name: clearing.name, debit: 0, credit: amount, description: `Cash cleared for ${invoice.invoice_number}` },
    ],
  });

  await base44.entities.Payment.update(payment.id, { journal_id: journal.id });
  await base44.entities.TreasuryAccount.update(treasuryAccount.id, { balance: round2((treasuryAccount.balance || 0) + amount) });

  const paid = round2((invoice.amount_paid || 0) + amount);
  const balance = round2((invoice.total || 0) - paid);
  await base44.entities.Invoice.update(invoice.id, {
    amount_paid: paid,
    balance,
    status: balance <= 0 ? "paid" : "partially_paid",
    cash_deposited: balance <= 0,
    deposit_treasury_account_id: treasuryAccount.id,
    deposit_treasury_account_name: treasuryAccount.name,
    deposited_at: new Date().toISOString(),
    deposited_by: userId,
    deposit_journal_id: journal.id,
  });

  await base44.entities.AuditLog.create({
    action: "deposit_cash_sale", module: "cashier", entity_type: "Invoice", entity_id: invoice.id,
    user_id: userId, description: `Deposited ${amount} XAF from ${invoice.invoice_number} into ${treasuryAccount.name}`,
  });

  return payment;
}