// The petty cash desk: the small day-to-day expenses the cashier pays out of the
// float, the reimbursements owed to staff who paid out of their own pocket, and
// the receipts that back them.
//
// A voucher below the custodian's limit is paid on the spot — it still posts a
// balanced journal through the treasury engine (Dr expense, Cr petty-cash GL) and
// is mirrored as a paid expense request, so it lands in the expense register with
// its receipt. Anything above the limit must be approved first.
import { erp } from "@/api/erpClient";
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


// Pay a small expense from the float. The ledger, the till and the expense
// register all move together.
export async function recordPettyCashExpense({ account, expenseAccount, amount, date, description, payee = '', category = 'other', department, receiptFileUri = '', requestKey = crypto.randomUUID() }) {
  const { data } = await erp.functions.invoke('fieldOps', { action: 'cashierPettyExpense', requestKey, accountId: account?.id, expenseAccountId: expenseAccount?.id, amount, date, description, payee, category, departmentId: department?.id, receiptFileUri });
  return data.transaction;
}


export async function attachReceipt({ request, fileUri, userId = "" }) {
  await erp.entities.ExpenseRequest.update(request.id, {
    receipt_url: fileUri,
    receipt_collected_at: new Date().toISOString(),
  });
  await erp.entities.AuditLog.create({
    action: "collect_receipt", module: "cashier", entity_type: "ExpenseRequest", entity_id: request.id,
    user_id: userId, description: `Receipt filed for ${request.request_number} — ${request.title}`,
  });
}