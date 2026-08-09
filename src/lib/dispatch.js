// Dispatch & mobile-sales engine.
// Finished goods only leave the warehouse through an approved Dispatch, and all
// stock movement goes through the central inventory engine so the ledger stays whole.
import { base44 } from "@/api/base44Client";
import { transferStock, getStockOnHand, round2, round3 } from "@/lib/inventory";

export const DISPATCH_APPROVERS = ["admin", "warehouse_manager"];

export function canApproveDispatch(role) {
  return DISPATCH_APPROVERS.includes(role);
}

const nowIso = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);

// The vehicle's own warehouse holds the stock while it is on the road.
export async function resolveVehicleWarehouse(vehicleId) {
  const vehicle = await base44.entities.Vehicle.get(vehicleId);
  if (!vehicle?.warehouse_id) {
    throw new Error(`Vehicle ${vehicle?.name || ""} has no stock location. Assign a vehicle warehouse in Administration first.`);
  }
  return vehicle.warehouse_id;
}

// Load an approved dispatch: finished goods → vehicle warehouse.
export async function loadDispatch(dispatch, userName = "") {
  if (dispatch.status !== "approved") {
    throw new Error("Stock can only be loaded once the dispatch has been approved");
  }
  if (!dispatch.warehouse_id) throw new Error("Select the finished-goods warehouse to load from");

  const vehicleWarehouseId = dispatch.vehicle_warehouse_id || (await resolveVehicleWarehouse(dispatch.vehicle_id));
  const lines = await base44.entities.DispatchLine.filter({ dispatch_id: dispatch.id });
  const toLoad = lines.filter((l) => Number(l.loaded_quantity || l.requested_quantity) > 0);
  if (!toLoad.length) throw new Error("Add at least one product with a quantity to load");

  let totalValue = 0;
  for (const line of toLoad) {
    const qty = round3(line.loaded_quantity || line.requested_quantity);
    const { totalValue: lineValue } = await transferStock({
      productId: line.product_id,
      productName: line.product_name,
      fromWarehouseId: dispatch.warehouse_id,
      toWarehouseId: vehicleWarehouseId,
      quantity: qty,
      movementType: "vehicle_load",
      saleableOnly: true,
      documentType: "Dispatch",
      documentId: dispatch.id,
      movementDate: dispatch.dispatch_date || today(),
      reason: `Loaded to ${dispatch.vehicle_name || "vehicle"} — ${dispatch.dispatch_number || ""}`,
    });
    totalValue += lineValue;
    await base44.entities.DispatchLine.update(line.id, {
      loaded_quantity: qty,
      unit_cost: qty > 0 ? round2(lineValue / qty) : 0,
      loaded_value: round2(lineValue),
    });
  }

  await base44.entities.Dispatch.update(dispatch.id, {
    status: "loaded",
    vehicle_warehouse_id: vehicleWarehouseId,
    total_loaded_value: round2(totalValue),
    loaded_by: userName,
    loaded_at: nowIso(),
    departure_date: dispatch.departure_date || nowIso(),
  });

  await base44.entities.AuditLog.create({
    action: "load_dispatch", module: "distribution", entity_type: "Dispatch", entity_id: dispatch.id,
    description: `Dispatch ${dispatch.dispatch_number} loaded onto ${dispatch.vehicle_name}: ${toLoad.length} products, value ${round2(totalValue)}`,
  });

  return { totalValue: round2(totalValue), vehicleWarehouseId };
}

// What is loaded, what was sold, and what is physically left on the vehicle.
export async function getDispatchReconciliation(dispatch) {
  const vehicleWarehouseId = dispatch.vehicle_warehouse_id;
  const [lines, orders, balances] = await Promise.all([
    base44.entities.DispatchLine.filter({ dispatch_id: dispatch.id }),
    base44.entities.SalesOrder.filter({ dispatch_id: dispatch.id }),
    vehicleWarehouseId ? base44.entities.StockBalance.filter({ warehouse_id: vehicleWarehouseId }) : Promise.resolve([]),
  ]);

  const soldQty = {};
  const soldValue = {};
  let cashSales = 0;
  let creditSales = 0;
  for (const order of orders) {
    if (order.status === "cancelled") continue;
    if ((order.payment_type || "cash") === "cash") cashSales += order.total || 0;
    else creditSales += order.total || 0;
    const orderLines = await base44.entities.SalesOrderLine.filter({ order_id: order.id });
    orderLines.forEach((l) => {
      soldQty[l.product_id] = round3((soldQty[l.product_id] || 0) + (l.quantity || 0));
      soldValue[l.product_id] = round2((soldValue[l.product_id] || 0) + (l.total || 0));
    });
  }

  const onHand = {};
  balances.forEach((b) => { onHand[b.product_id] = round3((onHand[b.product_id] || 0) + (b.quantity || 0)); });

  const rows = lines.map((l) => {
    const loaded = round3(l.loaded_quantity || 0);
    const sold = soldQty[l.product_id] || 0;
    const expected = round3(loaded - sold);
    const actual = onHand[l.product_id] || 0;
    return {
      ...l,
      loaded,
      sold,
      expected,
      actual,
      variance: round3(actual - expected),
      sales_value: soldValue[l.product_id] || 0,
    };
  });

  return {
    rows,
    orders,
    cashSales: round2(cashSales),
    creditSales: round2(creditSales),
    totalSales: round2(cashSales + creditSales),
    hasVariance: rows.some((r) => r.variance !== 0),
    remainingQty: round3(rows.reduce((s, r) => s + r.actual, 0)),
  };
}

// Return everything still on the vehicle back to the finished-goods warehouse.
export async function returnDispatchStock(dispatch, userName = "") {
  if (!dispatch.vehicle_warehouse_id) throw new Error("This dispatch has no vehicle stock to return");
  const balances = (await base44.entities.StockBalance.filter({ warehouse_id: dispatch.vehicle_warehouse_id }))
    .filter((b) => (b.quantity || 0) > 0);
  if (!balances.length) throw new Error("The vehicle is already empty — nothing to return");

  const lines = await base44.entities.DispatchLine.filter({ dispatch_id: dispatch.id });
  const byProduct = {};
  balances.forEach((b) => { byProduct[b.product_id] = round3((byProduct[b.product_id] || 0) + b.quantity); });

  let totalValue = 0;
  for (const [productId, qty] of Object.entries(byProduct)) {
    const line = lines.find((l) => l.product_id === productId);
    const { totalValue: lineValue } = await transferStock({
      productId,
      productName: line?.product_name || balances.find((b) => b.product_id === productId)?.product_name,
      fromWarehouseId: dispatch.vehicle_warehouse_id,
      toWarehouseId: dispatch.warehouse_id,
      quantity: qty,
      movementType: "warehouse_transfer",
      documentType: "Dispatch",
      documentId: dispatch.id,
      movementDate: today(),
      reason: `Unsold stock returned from ${dispatch.vehicle_name || "vehicle"} — ${dispatch.dispatch_number || ""}`,
    });
    totalValue += lineValue;
    if (line) {
      await base44.entities.DispatchLine.update(line.id, {
        returned_quantity: round3((line.returned_quantity || 0) + qty),
      });
    }
  }

  const recon = await getDispatchReconciliation({ ...dispatch });
  await base44.entities.Dispatch.update(dispatch.id, {
    status: "returned",
    total_returned_value: round2(totalValue),
    total_delivered_value: recon.totalSales,
    total_cash_collected: recon.cashSales,
    total_credit_sales: recon.creditSales,
    return_date: nowIso(),
  });

  await base44.entities.AuditLog.create({
    action: "return_dispatch_stock", module: "distribution", entity_type: "Dispatch", entity_id: dispatch.id,
    description: `Unsold stock returned from ${dispatch.vehicle_name} on dispatch ${dispatch.dispatch_number}: value ${round2(totalValue)}`,
  });

  return { totalValue: round2(totalValue) };
}

// Stock available on a vehicle for live mobile selling.
export async function getVehicleStock(vehicleWarehouseId) {
  if (!vehicleWarehouseId) return [];
  const balances = await base44.entities.StockBalance.filter({ warehouse_id: vehicleWarehouseId });
  const byProduct = {};
  balances.forEach((b) => {
    if (!byProduct[b.product_id]) byProduct[b.product_id] = { product_id: b.product_id, product_name: b.product_name, quantity: 0 };
    byProduct[b.product_id].quantity = round3(byProduct[b.product_id].quantity + (b.quantity || 0));
  });
  return Object.values(byProduct).filter((p) => p.quantity > 0);
}

// All dispatches currently out on the road, for picking which vehicle made a sale.
export async function getLoadedDispatches() {
  return base44.entities.Dispatch.filter({ status: "loaded" });
}

// The open dispatch a salesperson/driver is currently selling from.
export async function getActiveDispatchForUser(employeeId) {
  if (!employeeId) return null;
  const all = await base44.entities.Dispatch.filter({ status: "loaded" });
  return all.find((d) => d.salesperson_id === employeeId || d.driver_id === employeeId) || null;
}

export { getStockOnHand };