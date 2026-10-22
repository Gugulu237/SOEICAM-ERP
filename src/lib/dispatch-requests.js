// Driver-initiated stock requests.
// A driver asks for goods, a manager approves, and approval automatically moves the
// stock from the finished-goods store to the vehicle through the inventory engine.
import { erp } from "@/api/erpClient";
import { round3 } from "@/lib/inventory";
import { canApproveDispatch } from "@/lib/dispatch";
import { invokeFieldOps } from "@/lib/field-ops";
import { readAll } from "@/lib/field-pos";
import { businessDate } from "@/lib/business-date";

const nowIso = () => new Date().toISOString();

// Available finished goods in the source store, keyed by product.
export async function getWarehouseAvailability(warehouseId) {
  if (!warehouseId) return {};
  const todayStr = businessDate();
  const balances = await readAll(erp.entities.StockBalance, { warehouse_id: warehouseId }, 'created_date');
  const map = {};
  // Only QC-released, in-date stock counts as available to load.
  balances
    .filter((b) => Number(b.quantity) > 0 && (b.qc_status || "approved") === "approved" && (!b.expiry_date || b.expiry_date >= todayStr))
    .forEach((b) => { map[b.product_id] = round3((map[b.product_id] || 0) + Number(b.quantity)); });
  return map;
}

// Block any request that asks for more than what is physically in the store.
export async function validateRequestStock(items, warehouseId) {
  const cleaned = (items || []).filter((i) => i.product_id && Number(i.quantity) > 0);
  if (!cleaned.length) throw new Error("Add at least one product with a quantity");
  const available = await getWarehouseAvailability(warehouseId);
  const shortages = cleaned
    .filter((i) => Number(i.quantity) > (available[i.product_id] || 0))
    .map((i) => `${i.product_name}: requested ${i.quantity}, only ${available[i.product_id] || 0} in stock`);
  if (shortages.length) throw new Error(`Not enough finished goods in stock — ${shortages.join("; ")}`);
  return cleaned;
}

export async function submitDispatchRequest(request) {
  const items = await validateRequestStock(request.items, request.source_warehouse_id);
  return erp.entities.DispatchRequest.update(request.id, { items, status: "pending_approval" });
}

// Approving the request creates the dispatch and issues the stock in one move.
export async function approveDispatchRequest(request, _userName, role, assignment = {}) {
  if (!canApproveDispatch(role)) throw new Error("Only a warehouse manager or the GM can approve stock requests");
  if (!request?.id) throw new Error("Select a stock request to approve");
  const { data } = await invokeFieldOps({
    action: "approveDispatchRequest", requestId: request.id,
    driverId: assignment.driverId || request.driver_id || undefined,
    commercialId: assignment.commercialId || request.commercial_id || request.salesperson_id || undefined,
  });
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function rejectDispatchRequest(request, userName, reason) {
  await erp.entities.DispatchRequest.update(request.id, {
    status: "rejected",
    rejected_by: userName,
    rejected_at: nowIso(),
    rejection_reason: reason || "",
  });
  await erp.entities.AuditLog.create({
    action: "reject_dispatch_request", module: "distribution",
    entity_type: "DispatchRequest", entity_id: request.id,
    description: `Stock request ${request.request_number} rejected: ${reason || "no reason given"}`,
  });
}
