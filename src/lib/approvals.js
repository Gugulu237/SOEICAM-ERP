import {ui} from './i18n.js';
import {isYogurt} from './yogurt-production.js';
// The approval inbox.
// Every record waiting for a decision is collected here, and each decision runs
// the very same side effects the owning module applies — so approving from the
// inbox and approving inside the module can never diverge.
import { erp } from "@/api/erpClient";
import { approveDispatchRequest, rejectDispatchRequest } from "@/lib/dispatch-requests";
import { approveExpense, rejectExpense } from "@/lib/expenses";
import { approveCashDisbursement, rejectCashDisbursement } from "@/lib/purchase-payments";
import { customerReceiptAction } from '@/lib/customer-receipts';

const nowIso = () => new Date().toISOString();

export const APPROVAL_TYPE_LABELS = {
  get po(){return ui("Purchase Order");},
  get production(){return ui("Production Order");},
  get dispatch(){return ui("Stock Request");},
  get expense(){return ui("Expense Request");},
  get cash(){return ui("Cash Disbursement");},
  get customer_receipt(){return ui("Customer Receipt");},
  get recipe(){return ui("Recipe");},
  get payroll(){return ui("Payroll Run");},
};

// Who may decide each type — mirrors the gate inside the owning module.
export const APPROVAL_ROLES = {
  po: ["admin"],
  production: ["admin"],
  dispatch: ["admin", "warehouse_manager", "production_manager"],
  expense: ["admin", "production_manager"],
  cash: ["admin"],
  customer_receipt: ['admin'],
  recipe: ["admin", "production_manager"],
  payroll: ["admin"],
};

// Shown when the signed-in role is not the one that decides this type.
export const APPROVAL_OWNER = {
  po: "the General Manager",
  production: "the General Manager",
  dispatch: "Operations or Warehouse Management",
  expense: "the General Manager",
  cash: "the General Manager",
  customer_receipt: 'the General Manager',
  recipe: "the Operations / Production Manager",
  payroll: "the General Manager",
};

export const canDecide = (type, role) => (APPROVAL_ROLES[type] || []).includes(role);

export async function loadPendingApprovals(role = 'admin') {
  const [pos, production, stockRequests, expenses, cashRequests, recipes, payroll, customerReceipts] = await Promise.all([
    erp.entities.PurchaseOrder.filter({ status: "pending_approval" }),
    ['admin', 'production_manager', 'warehouse_manager'].includes(role) ? erp.entities.ProductionOrder.filter({ status: "awaiting_approval" }) : [],
    canDecide('dispatch', role) ? erp.entities.DispatchRequest.filter({ status: "pending_approval" }) : [],
    canDecide('expense', role) ? erp.entities.ExpenseRequest.filter({ status: "pending_approval" }) : [],
    canDecide('cash', role) ? erp.entities.Payment.filter({ payment_type: "supplier_payment", status: "pending_approval" }) : [],
    canDecide('recipe', role) ? erp.entities.Recipe.filter({ status: "draft" }) : [],
    canDecide('payroll', role) ? erp.entities.PayrollRun.filter({ status: "calculated" }) : [],
    canDecide('customer_receipt', role) ? erp.entities.Payment.filter({ payment_type: 'customer_payment', status: { $in: ['pending_approval', 'approved'] } }, { sort: '-created_date', limit: 50 }) : { items: [] },
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
    ...payroll.map(r => row(r, "payroll", r.period_name, `${r.employee_count || 0} employees`, r.total_net, "/team-workspaces?section=payroll&run="+encodeURIComponent(r.id))),
    ...customerReceipts.items.map(p => row(p, 'customer_receipt', p.payment_number, `${p.party_name} · ${p.invoice_numbers || ''} · Cashier: ${p.cashier_confirmed_name || 'Not confirmed'}`, p.amount, '/accounting?tab=payments')),
  ].sort((a, b) => String(b.created_date).localeCompare(String(a.created_date)));
}

function logDecision(item, action, userName, userId, reason) {
  const label = APPROVAL_TYPE_LABELS[item._type] || item._type;
  return erp.entities.AuditLog.create({
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
    case 'customer_receipt':
      await customerReceiptAction('approve', { paymentId: item.id });
      return;
    case "po":
      await erp.functions.invoke('fieldOps',{action:'approveSupplierOrder',orderId:item.id});
      return;
    case "production": {
      const {data}=await erp.functions.invoke('fieldOps',{action:'approveProductionOrder',orderId:item.id});
      return data;
    }
    case "recipe":
      if(isYogurt(item))return (await erp.functions.invoke('fieldOps',{action:'approveYogurtRecipe',recipeId:item.id})).data;
      await erp.entities.Recipe.update(item.id, { status: "approved", approved_at: nowIso() });
      break;
    case "payroll":
      return erp.accounting.payroll({action:'approve',runId:item.id,revision:Number(item.payroll_revision || 0)});
    case "expense":
      await approveExpense(item, userName);
      break;
    case "cash":
      await approveCashDisbursement({ payment: item, userId });
      return;
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
    case 'customer_receipt':
      await customerReceiptAction('reject', { paymentId: item.id, reason });
      return;
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
      await erp.functions.invoke('fieldOps',{action:'rejectSupplierOrder',orderId:item.id,reason});
      return;
    case "production":
      await erp.functions.invoke('fieldOps',{action:'rejectProductionOrder',orderId:item.id,reason});
      return;
    case "recipe":
      if(isYogurt(item))return (await erp.functions.invoke('fieldOps',{action:'rejectYogurtRecipe',recipeId:item.id,reason})).data;
      await erp.entities.Recipe.update(item.id, { status: "archived" });
      break;
    case "payroll":
      return erp.accounting.payroll({action:'reject',runId:item.id,revision:Number(item.payroll_revision || 0),reason});
    default:
      throw new Error("Unknown approval type");
  }
  await logDecision(item, "reject", userName, userId, reason);
}
