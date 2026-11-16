import { readAll } from '@/lib/field-pos';
import { businessDate } from '@/lib/business-date';
import { stockQuantityTotal } from '@/lib/stock-balance';
import { erp } from "@/api/erpClient";

export const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const today = businessDate;

export async function getStockOnHand(productId, warehouseId = null) {
  const query = warehouseId ? { product_id: productId, warehouse_id: warehouseId } : { product_id: productId };
  const balances = await readAll(erp.entities.StockBalance, query, 'id');
  return stockQuantityTotal(balances.map(balance => balance.quantity));
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
