// Batch genealogy: trace a finished yogurt batch backward to its ingredients,
// and trace any batch forward to the customers who received it.
import { base44 } from "@/api/base44Client";

// Everything the ledger knows about one lot number.
export async function getBatchMovements(lotNumber) {
  if (!lotNumber) return [];
  return base44.entities.StockMovement.filter({ lot_number: lotNumber }, "movement_date");
}

// Finished batch -> production order -> recipe -> raw material lots -> suppliers.
export async function traceBackward(lotNumber) {
  const order = (await base44.entities.ProductionOrder.filter({ batch_number: lotNumber }))[0];
  if (!order) return null;

  const [materials, recipe] = await Promise.all([
    base44.entities.ProductionMaterial.filter({ production_order_id: order.id }),
    order.recipe_id ? base44.entities.Recipe.get(order.recipe_id).catch(() => null) : null,
  ]);

  // Where each consumed material lot came from (goods receipt / supplier).
  const ingredients = [];
  for (const m of materials) {
    let supplier = "";
    if (m.lot_number) {
      const receipts = await base44.entities.StockMovement.filter({
        lot_number: m.lot_number, movement_type: "purchase_receipt",
      });
      supplier = receipts[0]?.reason || "";
    }
    ingredients.push({ ...m, supplier });
  }

  return { order, recipe, ingredients };
}

// Any batch -> where the stock went: warehouses, vehicles, customers.
export async function traceForward(lotNumber) {
  const movements = await getBatchMovements(lotNumber);
  const [warehouses, balances] = await Promise.all([
    base44.entities.Warehouse.filter({}),
    base44.entities.StockBalance.filter({ lot_number: lotNumber }),
  ]);
  const whName = (id) => warehouses.find((w) => w.id === id)?.name || "";

  const produced = movements
    .filter((m) => m.movement_type === "production_output")
    .reduce((s, m) => s + (m.quantity || 0), 0);

  const deliveries = movements.filter((m) => m.movement_type === "customer_delivery");
  const returned = movements
    .filter((m) => m.movement_type === "customer_return")
    .reduce((s, m) => s + (m.quantity || 0), 0);

  // Which customers received this batch (via the delivery's sales order).
  const customers = [];
  for (const d of deliveries) {
    let customerName = d.reason || "Unknown customer";
    let orderNumber = "";
    if (d.document_type === "SalesOrder" && d.document_id) {
      const so = await base44.entities.SalesOrder.get(d.document_id).catch(() => null);
      if (so) { customerName = so.customer_name || customerName; orderNumber = so.order_number || ""; }
    }
    customers.push({
      customer_name: customerName, order_number: orderNumber,
      quantity: d.quantity || 0, date: d.movement_date,
    });
  }

  const onHand = balances.map((b) => ({
    location: b.warehouse_name || whName(b.warehouse_id),
    quantity: b.quantity || 0, qc_status: b.qc_status || "approved", expiry_date: b.expiry_date,
  })).filter((b) => b.quantity > 0);

  return {
    movements: movements.map((m) => ({
      ...m,
      source_name: whName(m.source_warehouse_id),
      destination_name: whName(m.destination_warehouse_id),
    })),
    produced,
    delivered: deliveries.reduce((s, d) => s + (d.quantity || 0), 0),
    returned,
    onHand,
    customers,
  };
}

// Search batches by lot number across production and stock.
export async function searchBatches(term) {
  const [orders, balances] = await Promise.all([
    base44.entities.ProductionOrder.list("-production_date", 200),
    base44.entities.StockBalance.list("-created_date", 300),
  ]);
  const lots = new Map();
  orders.forEach((o) => o.batch_number && lots.set(o.batch_number, {
    lot_number: o.batch_number, product_name: o.product_name, expiry_date: o.expiry_date, status: o.status,
  }));
  balances.forEach((b) => b.lot_number && !lots.has(b.lot_number) && lots.set(b.lot_number, {
    lot_number: b.lot_number, product_name: b.product_name, expiry_date: b.expiry_date, status: b.qc_status || "approved",
  }));
  const all = [...lots.values()];
  if (!term) return all.slice(0, 30);
  const q = term.toLowerCase();
  return all.filter((l) => `${l.lot_number} ${l.product_name}`.toLowerCase().includes(q)).slice(0, 30);
}