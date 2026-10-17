// The approval inbox.
// Every record waiting for a decision is collected here, and each decision runs
// the very same side effects the owning module applies — so approving from the
// inbox and approving inside the module can never diverge.
import { base44 } from "@/api/base44Client";
import { approveDispatchRequest, rejectDispatchRequest } from "@/lib/dispatch-requests";
import { approveExpense, rejectExpense } from "@/lib/expenses";
import { approveCashDisbursement, rejectCashDisbursement } from "@/lib/purchase-payments";

const nowIso = () => new Date().toISOString();

export const APPROVAL_TYPE_LABELS = {
  po: "Purchase Order",
  production: "Production Order",
  dispatch: "Stock Request",
  expense: "Expense Request",
  cash: "Cash Disbursement",
  recipe: "Recipe",
  payroll: "Payroll Run",
};

// Who may decide each type — mirrors the gate inside the owning module.
export const APPROVAL_ROLES = {
  po: ["admin"],
  production: ["admin"],
  dispatch: ["admin", "warehouse_manager"],
  expense: ["admin", "production_manager"],
  cash: ["admin"],
  recipe: ["admin", "production_manager"],
  payroll: ["admin"],
};

// Shown when the signed-in role is not the one that decides this type.
export const APPROVAL_OWNER = {
  po: "the General Manager",
  production: "the General Manager",
  dispatch: "the Warehouse Manager",
  expense: "the General Manager",
  cash: "the General Manager",
  recipe: "the Production Manager",
  payroll: "the General Manager",
};

export const canDecide = (type, role) => (APPROVAL_ROLES[type] || []).includes(role);

export async function loadPendingApprovals() {
  const [pos, production, stockRequests, expenses, cashRequests, recipes, payroll] = await Promise.all([
    base44.entities.PurchaseOrder.filter({ status: "pending_approval" }),
    base44.entities.ProductionOrder.filter({ status: "awaiting_approval" }),
    base44.entities.DispatchRequest.filter({ status: "pending_approval" }),
    base44.entities.ExpenseRequest.filter({ status: "pending_approval" }),
    base44.entities.Payment.filter({ payment_type: "supplier_payment", status: "pending_approval" }),
    base44.entities.Recipe.filter({ status: "draft" }),
    base44.entities.PayrollRun.filter({ status: "calculated" }),
  ]);

  const row = (rec, type, ref, summary, amount, link) => ({
    ...rec, _type: type, _ref: ref, _summary: summary, _amount: amount, _link: link,
  });

  return [
    ...pos.map(p => row(p, "po", p.po_number, [p.supplier_name, p.requested_department_name].filter(Boolean).join(" · "), p.total, `/purchases/${p.id}`)),
    ...production.map(o => row(o, "production", o.order_number, o.product_name, null, `/manufacturing/${o.id}`)),
    ...stockRequests.map(r => row(r, "dispatch", r.request_number, [r.vehicle_name, r.driver_name].filter(Boolean).join(" · "), null, `/distribution/requests/${r.id}`)),
    ...expenses.map(e => row(e, "expense", e.request_number, [e.title, e.requester_name].filter(Boolean).join(" · "), e.amount, "/expenses")),
    ...cashRequests.map(p => row(p, "cash", p.payment_number, p.party_name, p.amount, "/cashier")),
    ...recipes.map(r => row(r, "recipe", `${r.recipe_name} v${r.version || 1}`, r.product_name, null, `/manufacturing/recipes/${r.id}`)),
    ...payroll.map(r => row(r, "payroll", r.period_name, `${r.employee_count || 0} employees`, r.total_net, "/payroll")),
  ].sort((a, b) => String(b.created_date).localeCompare(String(a.created_date)));
}

function logDecision(item, action, userName, userId, reason) {
  const label = APPROVAL_TYPE_LABELS[item._type] || item._type;
  return base44.entities.AuditLog.create({
    action: `${action}_${item._type}`,
    module: "approvals",
    entity_type: label,
    entity_id: item.id,
    user_id: userId || "",
    user_name: userName || "",
    description: `${action === "approve" ? "Approved" : "Rejected"} ${label} ${item._ref}${reason ? ` — ${reason}` : ""}`,
    reason: reason || "",
  });
}

export async function approveItem(item, { userId = "", userName = "", role } = {}) {
  if (!canDecide(item._type, role)) throw new Error(`Only ${APPROVAL_OWNER[item._type] || "an approver"} can approve this item`);

  switch (item._type) {
    case "po":
      await base44.entities.PurchaseOrder.update(item.id, { status: "approved", approved_by: userName, approved_at: nowIso() });
      break;
    case "production":
      await base44.entities.ProductionOrder.update(item.id, { status: "approved", approved_by: userName, approved_at: nowIso() });
      break;
    case "recipe":
      await base44.entities.Recipe.update(item.id, { status: "approved", approved_at: nowIso() });
      break;
    case "payroll":
      await base44.entities.PayrollRun.update(item.id, { status: "approved", approved_at: nowIso() });
      break;
    case "expense":
      await approveExpense(item, userName);
      break;
    case "cash":
      await approveCashDisbursement({ payment: item, userId });
      break;
    case "dispatch":
      // Creates the dispatch, issues the stock and writes its own audit entry.
      await approveDispatchRequest(item, userName, role);
      return;
    default:
      throw new Error("Unknown approval type");
  }
  await logDecision(item, "approve", userName, userId, "");
}

export async function rejectItem(item, { userId = "", userName = "", role, reason = "" } = {}) {
  if (!canDecide(item._type, role)) throw new Error(`Only ${APPROVAL_OWNER[item._type] || "an approver"} can reject this item`);

  switch (item._type) {
    case "dispatch":
      await rejectDispatchRequest(item, userName, reason);
      return;
    case "cash":
      await rejectCashDisbursement({ payment: item, reason, userId });
      return;
    case "expense":
      await rejectExpense(item, userName, reason);
      break;
    case "po":
      await base44.entities.PurchaseOrder.update(item.id, { status: "cancelled" });
      break;
    case "production":
      await base44.entities.ProductionOrder.update(item.id, { status: "rejected" });
      break;
    case "recipe":
      await base44.entities.Recipe.update(item.id, { status: "archived" });
      break;
    case "payroll":
      await base44.entities.PayrollRun.update(item.id, { status: "draft" });
      break;
    default:
      throw new Error("Unknown approval type");
  }
  await logDecision(item, "reject", userName, userId, reason);
}