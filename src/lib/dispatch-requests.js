// Driver-initiated stock requests.
// A driver asks for goods, a manager approves, and approval automatically moves the
// stock from the finished-goods store to the vehicle through the inventory engine.
import { base44 } from "@/api/base44Client";
import { round3 } from "@/lib/inventory";
import { loadDispatch, resolveVehicleWarehouse, canApproveDispatch } from "@/lib/dispatch";

const nowIso = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);

// Available finished goods in the source store, keyed by product.
export async function getWarehouseAvailability(warehouseId) {
  if (!warehouseId) return {};
  const balances = await base44.entities.StockBalance.filter({ warehouse_id: warehouseId });
  const map = {};
  balances.forEach((b) => { map[b.product_id] = round3((map[b.product_id] || 0) + (b.quantity || 0)); });
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
  return base44.entities.DispatchRequest.update(request.id, { items, status: "pending_approval" });
}

// Approving the request creates the dispatch and issues the stock in one move.
export async function approveDispatchRequest(request, userName, role) {
  if (!canApproveDispatch(role)) throw new Error("Only a warehouse manager or the GM can approve stock requests");
  if (request.status !== "pending_approval") throw new Error("This request is not awaiting approval");

  // Re-check availability at approval time — stock may have moved since the request.
  const items = await validateRequestStock(request.items, request.source_warehouse_id);
  const vehicleWarehouseId = await resolveVehicleWarehouse(request.vehicle_id);

  const dispatch = await base44.entities.Dispatch.create({
    dispatch_number: `DSP-${Date.now().toString(36).toUpperCase()}`,
    dispatch_date: request.request_date || today(),
    source: "driver_request",
    request_id: request.id,
    vehicle_id: request.vehicle_id,
    vehicle_name: request.vehicle_name || "",
    vehicle_warehouse_id: vehicleWarehouseId,
    driver_id: request.driver_id || "",
    driver_name: request.driver_name || "",
    salesperson_id: request.driver_id || "",
    salesperson_name: request.driver_name || "",
    route_id: request.route_id || "",
    route_name: request.route_name || "",
    warehouse_id: request.source_warehouse_id,
    warehouse_name: request.source_warehouse_name || "",
    status: "approved",
    approved_by: userName,
    approved_at: nowIso(),
    notes: request.notes || "",
  });

  for (const item of items) {
    await base44.entities.DispatchLine.create({
      dispatch_id: dispatch.id,
      product_id: item.product_id,
      product_name: item.product_name || "",
      unit: item.unit || "unit",
      requested_quantity: Number(item.quantity),
      loaded_quantity: Number(item.quantity),
      unit_price: Number(item.unit_price) || 0,
    });
  }

  const result = await loadDispatch({ ...dispatch, status: "approved" }, userName);

  await base44.entities.DispatchRequest.update(request.id, {
    status: "processed",
    dispatch_id: dispatch.id,
    approved_by: userName,
    approved_at: nowIso(),
  });

  await base44.entities.AuditLog.create({
    action: "approve_dispatch_request", module: "distribution",
    entity_type: "DispatchRequest", entity_id: request.id,
    description: `Stock request ${request.request_number} approved — ${items.length} products issued to ${request.vehicle_name}`,
  });

  return { dispatch, ...result };
}

export async function rejectDispatchRequest(request, userName, reason) {
  await base44.entities.DispatchRequest.update(request.id, {
    status: "rejected",
    rejected_by: userName,
    rejected_at: nowIso(),
    rejection_reason: reason || "",
  });
  await base44.entities.AuditLog.create({
    action: "reject_dispatch_request", module: "distribution",
    entity_type: "DispatchRequest", entity_id: request.id,
    description: `Stock request ${request.request_number} rejected: ${reason || "no reason given"}`,
  });
}