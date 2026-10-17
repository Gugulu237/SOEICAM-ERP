// The petty cash desk: the small day-to-day expenses the cashier pays out of the
// float, the reimbursements owed to staff who paid out of their own pocket, and
// the receipts that back them.
//
// A voucher below the custodian's limit is paid on the spot — it still posts a
// balanced journal through the treasury engine (Dr expense, Cr petty-cash GL) and
// is mirrored as a paid expense request, so it lands in the expense register with
// its receipt. Anything above the limit must be approved first.
import { base44 } from "@/api/base44Client";
import { recordExpense } from "@/lib/treasury";
import { round2 } from "@/lib/posting";

// What a custodian may hand over on the spot before approval is required.
export const PETTY_CASH_LIMIT = 50000;

export const isPettyCash = (account) => account?.account_type === "petty_cash";

export function floatHealth(account) {
  const limit = round2(account?.float_limit || 0);
  const balance = round2(account?.balance || 0);
  const ratio = limit > 0 ? balance / limit : 1;
  return { limit, balance, ratio, low: limit > 0 && ratio < 0.25 };
}

const voucherNumber = () => `PV-${Date.now().toString(36).toUpperCase()}`;

// Pay a small expense from the float. The ledger, the till and the expense
// register all move together.
export async function recordPettyCashExpense({
  account, expenseAccount, amount, date, description, payee = "", category = "other",
  department = null, receiptFileUri = "", userId = "", userName = "",
}) {
  amount = round2(amount);
  if (amount <= 0) throw new Error("Enter an amount greater than zero");
  if (amount > PETTY_CASH_LIMIT) {
    throw new Error(
      `${amount.toLocaleString("en-US")} XAF is above the ${PETTY_CASH_LIMIT.toLocaleString("en-US")} XAF petty cash limit — raise an expense request for approval instead`,
    );
  }
  if (!department) throw new Error("Select the cost centre this expense belongs to");

  const voucher = voucherNumber();
  const now = new Date().toISOString();

  const tx = await recordExpense({
    treasuryAccount: account, expenseAccount, amount, date,
    description: payee ? `${description} — ${payee}` : description,
    reference: voucher, userId, category, payee,
    department_id: department.id, department_name: department.name,
    source: "petty_cash", source_document_number: voucher,
  });

  await base44.entities.ExpenseRequest.create({
    request_number: voucher,
    title: description,
    payee,
    petty_cash: true,
    requester_id: userId, requester_name: userName,
    department_id: department.id, department_name: department.name,
    request_date: date,
    amount,
    category,
    status: "paid",
    receipt_url: receiptFileUri,
    receipt_collected_at: receiptFileUri ? now : "",
    expense_account_id: expenseAccount.id,
    expense_account_number: expenseAccount.account_number,
    expense_account_name: expenseAccount.name,
    treasury_account_id: account.id,
    treasury_account_name: account.name,
    treasury_transaction_id: tx.id,
    journal_id: tx.journal_id || "",
    paid_by: userName, paid_at: now,
  });

  return tx;
}

// Receipts come back with the paper voucher: the cashier files them afterwards.
export async function attachReceipt({ request, fileUri, userId = "" }) {
  await base44.entities.ExpenseRequest.update(request.id, {
    receipt_url: fileUri,
    receipt_collected_at: new Date().toISOString(),
  });
  await base44.entities.AuditLog.create({
    action: "collect_receipt", module: "cashier", entity_type: "ExpenseRequest", entity_id: request.id,
    user_id: userId, description: `Receipt filed for ${request.request_number} — ${request.title}`,
  });
}