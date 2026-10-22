// Expense request workflow: submit → approve → pay.
// Payment reuses the treasury engine so every disbursement posts a balanced journal
// (Dr expense account, Cr treasury GL) and consumes the department's budget.
import { erp } from "@/api/erpClient";
import { businessDate } from "@/lib/business-date";
import { round2 } from "@/lib/posting";

export const EXPENSE_CATEGORIES = [
  "travel", "fuel", "office", "utilities", "maintenance", "transport",
  "communication", "cleaning", "medical", "training", "security", "other",
];

export const EXPENSE_APPROVERS = ["admin", "production_manager"];
export const EXPENSE_PAYERS = ["admin", "cashier"];

export const canApproveExpense = (role) => EXPENSE_APPROVERS.includes(role);
export const canPayExpense = (role) => EXPENSE_PAYERS.includes(role);

const nowIso = () => new Date().toISOString();

export async function submitExpense(request) {
  await erp.entities.ExpenseRequest.update(request.id, { status: "pending_approval" });
}

export async function approveExpense(request, userName) {
  await erp.entities.ExpenseRequest.update(request.id, {
    status: "approved", approved_by: userName, approved_at: nowIso(),
  });
  await erp.entities.AuditLog.create({
    action: "approve_expense", module: "accounting", entity_type: "ExpenseRequest", entity_id: request.id,
    description: `Expense ${request.request_number} approved: ${request.title} — ${round2(request.amount)} XAF`,
  });
}

export async function rejectExpense(request, userName, reason) {
  await erp.entities.ExpenseRequest.update(request.id, {
    status: "rejected", rejected_by: userName, rejected_at: nowIso(), rejection_reason: reason,
  });
}

// The budget line covering this department for the period the payment falls in.
export async function findBudgetForRequest(departmentId, date) {
  if (!departmentId) return null;
  const [budgets, periods] = await Promise.all([
    erp.entities.Budget.filter({ department_id: departmentId }),
    erp.entities.AccountingPeriod.filter({}),
  ]);
  const day = String(date).slice(0, 10);
  const period = periods.find(p => day >= p.start_date && day <= p.end_date);
  if (!period) return null;
  return budgets.find(b => b.period_id === period.id) || null;
}

// Disburse an approved request: treasury transaction + journal + budget consumption.
export async function payExpense({ request, treasuryAccount, expenseAccount, requestKey = crypto.randomUUID() }) {
  const { data } = await erp.functions.invoke('fieldOps', { action: 'cashierPayExpense', requestKey, expenseId: request.id, accountId: treasuryAccount?.id, expenseAccountId: expenseAccount?.id, date: businessDate() });
  return data;
}
