import { readAll } from '@/lib/field-pos';
import { businessDate } from '@/lib/business-date';
// Central inventory engine for SOEICAM ERP.
// Every stock change must go through here so StockMovement stays an immutable
// ledger and StockBalance always reflects it (per product / warehouse / lot).
import { erp } from "@/api/erpClient";

export const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const today = businessDate;

async function warehouseName(warehouseId) {
  if (!warehouseId) return "";
  const w = await erp.entities.Warehouse.get(warehouseId);
  return w?.name || "";
}

// Recompute a product's weighted average cost from all remaining stock.
async function refreshProductCost(productId) {
  const balances = await erp.entities.StockBalance.filter({ product_id: productId });
  const qty = balances.reduce((s, b) => s + (b.quantity || 0), 0);
  const value = balances.reduce((s, b) => s + (b.total_value || 0), 0);
  if (qty > 0) await erp.entities.Product.update(productId, { current_cost: round2(value / qty) });
}

async function logMovement(m) {
  return erp.entities.StockMovement.create({
    movement_date: m.movement_date || today(),
    status: "approved",
    ...m,
  });
}

// Stock on hand for a product, optionally in one warehouse.
export async function getStockOnHand(productId, warehouseId = null) {
  const query = warehouseId ? { product_id: productId, warehouse_id: warehouseId } : { product_id: productId };
  const balances = await erp.entities.StockBalance.filter(query);
  return round3(balances.reduce((s, b) => s + (b.quantity || 0), 0));
}

// Add stock into a warehouse lot. Weighted-average cost within the lot.
export async function receiveStock({
  productId, productName, warehouseId, quantity, unitCost = 0,
  lotNumber = "", expiryDate = "", movementType = "purchase_receipt",
  documentType = "", documentId = "", movementDate, reason = "",
  qcStatus = "approved", productionOrderId = "",
}) {
  const qty = round3(quantity);
  if (qty <= 0) throw new Error("Receipt quantity must be greater than zero");
  if (!warehouseId) throw new Error("A destination warehouse is required");

  const whName = await warehouseName(warehouseId);
  const existing = (await erp.entities.StockBalance.filter({
    product_id: productId, warehouse_id: warehouseId, lot_number: lotNumber || "",
    qc_status: qcStatus,
  }))[0];

  if (existing) {
    const newQty = round3((existing.quantity || 0) + qty);
    const newValue = round2((existing.total_value || 0) + qty * unitCost);
    await erp.entities.StockBalance.update(existing.id, {
      quantity: newQty,
      total_value: newValue,
      unit_cost: newQty > 0 ? round2(newValue / newQty) : 0,
      expiry_date: expiryDate || existing.expiry_date || "",
    });
  } else {
    await erp.entities.StockBalance.create({
      product_id: productId, product_name: productName, warehouse_id: warehouseId, warehouse_name: whName,
      lot_number: lotNumber || "", expiry_date: expiryDate || "",
      quantity: qty, unit_cost: round2(unitCost), total_value: round2(qty * unitCost),
      qc_status: qcStatus, production_order_id: productionOrderId || "",
    });
  }

  const movement = await logMovement({
    product_id: productId, product_name: productName, quantity: qty, movement_type: movementType,
    destination_warehouse_id: warehouseId, lot_number: lotNumber || "", expiry_date: expiryDate || "",
    unit_cost: round2(unitCost), total_value: round2(qty * unitCost),
    document_type: documentType, document_id: documentId, reason, movement_date: movementDate,
  });

  await refreshProductCost(productId);
  return movement;
}

// Remove stock from a warehouse, consuming lots FEFO (first-expiry-first-out).
// Returns the consumed layers so callers can value the issue correctly.
export async function issueStock({
  productId, productName, warehouseId, quantity,
  movementType = "production_issue", documentType = "", documentId = "",
  movementDate, reason = "", allowNegative = false, saleableOnly = false,
}) {
  let remaining = round3(quantity);
  if (remaining <= 0) throw new Error("Issue quantity must be greater than zero");
  if (!warehouseId) throw new Error("A source warehouse is required");

  const all = await erp.entities.StockBalance.filter({ product_id: productId, warehouse_id: warehouseId });
  // Only released, in-date stock may leave for a customer or a delivery vehicle.
  const balances = all
    .filter((b) => (b.quantity || 0) > 0)
    .filter((b) => !saleableOnly || (
      (b.qc_status || "approved") === "approved" &&
      (!b.expiry_date || b.expiry_date >= today())
    ))
    .sort((a, b) => (a.expiry_date || "9999-12-31").localeCompare(b.expiry_date || "9999-12-31"));

  const available = round3(balances.reduce((s, b) => s + (b.quantity || 0), 0));
  if (available < remaining && !allowNegative) {
    const blocked = round3(all.reduce((s, b) => s + (b.quantity || 0), 0) - available);
    throw new Error(
      `Insufficient saleable stock for ${productName || "product"}: ${available} available, ${remaining} required` +
      (saleableOnly && blocked > 0 ? ` (${blocked} blocked — expired, quarantined or awaiting QC release)` : "")
    );
  }

  const layers = [];
  for (const b of balances) {
    if (remaining <= 0) break;
    const take = Math.min(round3(b.quantity), remaining);
    const newQty = round3(b.quantity - take);
    await erp.entities.StockBalance.update(b.id, {
      quantity: newQty,
      total_value: round2(newQty * (b.unit_cost || 0)),
    });
    layers.push({
      lotNumber: b.lot_number || "", expiryDate: b.expiry_date || "", quantity: take,
      unitCost: b.unit_cost || 0, qcStatus: b.qc_status || "approved",
    });
    remaining = round3(remaining - take);
  }
  if (remaining > 0) {
    layers.push({ lotNumber: "", expiryDate: "", quantity: remaining, unitCost: 0 });
  }

  const movements = [];
  for (const l of layers) {
    movements.push(await logMovement({
      product_id: productId, product_name: productName, quantity: l.quantity, movement_type: movementType,
      source_warehouse_id: warehouseId, lot_number: l.lotNumber, expiry_date: l.expiryDate,
      unit_cost: round2(l.unitCost), total_value: round2(l.quantity * l.unitCost),
      document_type: documentType, document_id: documentId, reason, movement_date: movementDate,
    }));
  }

  const totalValue = round2(layers.reduce((s, l) => s + l.quantity * l.unitCost, 0));
  return { layers, movements, totalValue };
}

// Move stock between warehouses (store → production, production → finished goods,
// finished goods → delivery vehicle). Cost travels with the goods.
export async function transferStock({
  productId, productName, fromWarehouseId, toWarehouseId, quantity,
  movementType = "warehouse_transfer", documentType = "", documentId = "",
  movementDate, reason = "", saleableOnly = false,
}) {
  if (!fromWarehouseId || !toWarehouseId) throw new Error("Both source and destination warehouses are required");
  if (fromWarehouseId === toWarehouseId) throw new Error("Source and destination warehouses must differ");

  const { layers, totalValue } = await issueStock({
    productId, productName, warehouseId: fromWarehouseId, quantity,
    movementType, documentType, documentId, movementDate, reason, saleableOnly,
  });

  for (const l of layers) {
    await receiveStock({
      productId, productName, warehouseId: toWarehouseId, quantity: l.quantity, unitCost: l.unitCost,
      lotNumber: l.lotNumber, expiryDate: l.expiryDate, movementType,
      documentType, documentId, movementDate, reason, qcStatus: l.qcStatus || "approved",
    });
  }

  // The issue leg already logged source movements; tag them with the destination.
  return { quantity: round3(quantity), totalValue };
}

// Reconcile a counted quantity against a lot balance (physical stock count).
export async function adjustStock({
  balanceId, countedQuantity, reason = "", movementDate, movementType = "stock_adjustment",
}) {
  const balance = await erp.entities.StockBalance.get(balanceId);
  if (!balance) throw new Error("Stock balance not found");
  const counted = round3(countedQuantity);
  const diff = round3(counted - (balance.quantity || 0));
  if (diff === 0) throw new Error("Counted quantity matches the system quantity — nothing to adjust");

  await erp.entities.StockBalance.update(balance.id, {
    quantity: counted,
    total_value: round2(counted * (balance.unit_cost || 0)),
  });

  const movement = await logMovement({
    product_id: balance.product_id, product_name: balance.product_name,
    quantity: Math.abs(diff), movement_type: movementType,
    source_warehouse_id: diff < 0 ? balance.warehouse_id : "",
    destination_warehouse_id: diff > 0 ? balance.warehouse_id : "",
    lot_number: balance.lot_number || "", expiry_date: balance.expiry_date || "",
    unit_cost: round2(balance.unit_cost || 0), total_value: round2(Math.abs(diff) * (balance.unit_cost || 0)),
    reason: reason || (diff > 0 ? "Count surplus" : "Count shortage"), movement_date: movementDate,
  });

  await refreshProductCost(balance.product_id);
  return { difference: diff, movement };
}

// Quality gate: release a lot for sale, quarantine it, or reject it outright.
// The change is logged in the ledger so batch release is fully auditable.
export async function setLotQcStatus({ balanceId, status, userName = "", notes = "" }) {
  const balance = await erp.entities.StockBalance.get(balanceId);
  if (!balance) throw new Error("Stock lot not found");
  if (!["approved", "quarantine", "rejected", "pending"].includes(status)) throw new Error("Unknown quality status");

  await erp.entities.StockBalance.update(balanceId, {
    qc_status: status,
    qc_notes: notes,
    qc_released_by: status === "approved" ? userName : balance.qc_released_by || "",
    qc_released_at: status === "approved" ? new Date().toISOString() : balance.qc_released_at || "",
  });

  await logMovement({
    product_id: balance.product_id, product_name: balance.product_name,
    quantity: balance.quantity || 0,
    movement_type: status === "approved" ? "quality_release" : "quality_quarantine",
    source_warehouse_id: balance.warehouse_id, destination_warehouse_id: balance.warehouse_id,
    lot_number: balance.lot_number || "", expiry_date: balance.expiry_date || "",
    unit_cost: balance.unit_cost || 0, total_value: balance.total_value || 0,
    reason: `${status} by ${userName || "user"}${notes ? ` — ${notes}` : ""}`,
  });

  await erp.entities.AuditLog.create({
    action: `batch_${status}`, module: "quality", entity_type: "StockBalance", entity_id: balanceId,
    description: `Batch ${balance.lot_number || "(no lot)"} of ${balance.product_name} set to ${status}${notes ? `: ${notes}` : ""}`,
  });

  return status;
}

// Lots at risk: expiring within `days`, already expired, or held by quality.
export async function getExpiryRisk(days = 30) {
  const balances = await readAll(erp.entities.StockBalance, {}, "expiry_date");
  const now = new Date(today());
  return balances
    .filter((b) => (b.quantity || 0) > 0)
    .map((b) => {
      const daysLeft = b.expiry_date
        ? Math.round((new Date(b.expiry_date) - now) / 86400000)
        : null;
      const qc = b.qc_status || "approved";
      let risk = "ok";
      if (daysLeft !== null && daysLeft < 0) risk = "expired";
      else if (qc === "rejected") risk = "rejected";
      else if (qc !== "approved") risk = "held";
      else if (daysLeft !== null && daysLeft <= 3) risk = "critical";
      else if (daysLeft !== null && daysLeft <= days) risk = "warning";
      return { ...b, days_left: daysLeft, risk };
    })
    .filter((b) => b.risk !== "ok")
    .sort((a, b) => (a.days_left ?? 9999) - (b.days_left ?? 9999));
}

// Write off damaged or expired stock from a lot.
export async function writeOffStock({ balanceId, quantity, movementType = "damage", reason = "", movementDate }) {
  const balance = await erp.entities.StockBalance.get(balanceId);
  if (!balance) throw new Error("Stock balance not found");
  const qty = round3(quantity);
  if (qty <= 0 || qty > (balance.quantity || 0)) throw new Error("Write-off quantity exceeds the stock in this lot");
  return adjustStock({
    balanceId, countedQuantity: round3(balance.quantity - qty),
    reason: reason || movementType, movementDate, movementType,
  });
}