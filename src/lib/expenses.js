// Expense request workflow: submit → approve → pay.
// Payment reuses the treasury engine so every disbursement posts a balanced journal
// (Dr expense account, Cr treasury GL) and consumes the department's budget.
import { base44 } from "@/api/base44Client";
import { recordExpense } from "@/lib/treasury";
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
  await base44.entities.ExpenseRequest.update(request.id, { status: "pending_approval" });
}

export async function approveExpense(request, userName) {
  await base44.entities.ExpenseRequest.update(request.id, {
    status: "approved", approved_by: userName, approved_at: nowIso(),
  });
  await base44.entities.AuditLog.create({
    action: "approve_expense", module: "accounting", entity_type: "ExpenseRequest", entity_id: request.id,
    description: `Expense ${request.request_number} approved: ${request.title} — ${round2(request.amount)} XAF`,
  });
}

export async function rejectExpense(request, userName, reason) {
  await base44.entities.ExpenseRequest.update(request.id, {
    status: "rejected", rejected_by: userName, rejected_at: nowIso(), rejection_reason: reason,
  });
}

// The budget line covering this department for the period the payment falls in.
export async function findBudgetForRequest(departmentId, date) {
  if (!departmentId) return null;
  const [budgets, periods] = await Promise.all([
    base44.entities.Budget.filter({ department_id: departmentId }),
    base44.entities.AccountingPeriod.filter({}),
  ]);
  const day = String(date).slice(0, 10);
  const period = periods.find(p => day >= p.start_date && day <= p.end_date);
  if (!period) return null;
  return budgets.find(b => b.period_id === period.id) || null;
}

// Disburse an approved request: treasury transaction + journal + budget consumption.
export async function payExpense({ request, treasuryAccount, expenseAccount, userId = "", userName = "" }) {
  if (request.status !== "approved") throw new Error("Only approved requests can be paid");
  const amount = round2(request.amount);
  const date = new Date().toISOString().slice(0, 10);

  const tx = await recordExpense({
    treasuryAccount,
    expenseAccount,
    amount,
    date,
    description: `${request.title} — ${request.request_number}`,
    reference: request.request_number,
    userId,
  });

  const budget = await findBudgetForRequest(request.department_id, date);
  if (budget) {
    const spent = round2((budget.actual_spent || 0) + amount);
    await base44.entities.Budget.update(budget.id, {
      actual_spent: spent,
      remaining_amount: round2((budget.budget_amount || 0) - spent),
    });
  }

  await base44.entities.ExpenseRequest.update(request.id, {
    status: "paid",
    treasury_account_id: treasuryAccount.id,
    treasury_account_name: treasuryAccount.name,
    expense_account_id: expenseAccount.id,
    expense_account_number: expenseAccount.account_number,
    expense_account_name: expenseAccount.name,
    treasury_transaction_id: tx.id,
    journal_id: tx.journal_id || "",
    budget_id: budget?.id || "",
    paid_by: userName,
    paid_at: nowIso(),
  });

  return { transaction: tx, budget };
}