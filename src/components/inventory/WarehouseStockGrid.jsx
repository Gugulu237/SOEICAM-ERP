import React from "react";
import { formatNumber } from "@/lib/formatters";

// Pivot of stock on hand: one row per product, one column per warehouse.
export default function WarehouseStockGrid({ products, warehouses, balances }) {
  const activeWarehouses = warehouses.filter(w => balances.some(b => b.warehouse_id === w.id));
  const cellMap = {};
  balances.forEach(b => {
    cellMap[`${b.product_id}|${b.warehouse_id}`] = (cellMap[`${b.product_id}|${b.warehouse_id}`] || 0) + (b.quantity || 0);
  });

  const rows = products.filter(p => balances.some(b => b.product_id === p.id));

  if (!rows.length) {
    return <div className="rounded-lg border border-slate-200 bg-white px-4 py-12 text-center text-slate-400">No stock on hand yet.</div>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200">
            <th className="px-4 py-3 text-left font-semibold text-slate-600 whitespace-nowrap">Product</th>
            {activeWarehouses.map(w => (
              <th key={w.id} className="px-4 py-3 text-right font-semibold text-slate-600 whitespace-nowrap">{w.name}</th>
            ))}
            <th className="px-4 py-3 text-right font-semibold text-slate-900 whitespace-nowrap">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(p => {
            const total = activeWarehouses.reduce((s, w) => s + (cellMap[`${p.id}|${w.id}`] || 0), 0);
            return (
              <tr key={p.id} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-900">{p.name}</div>
                  <div className="text-xs text-slate-500">{p.sku} · {p.storage_unit || ""}</div>
                </td>
                {activeWarehouses.map(w => {
                  const qty = cellMap[`${p.id}|${w.id}`] || 0;
                  return (
                    <td key={w.id} className={`px-4 py-3 text-right ${qty ? "text-slate-800" : "text-slate-300"}`}>
                      {qty ? formatNumber(qty, 2) : "—"}
                    </td>
                  );
                })}
                <td className="px-4 py-3 text-right font-semibold text-slate-900">{formatNumber(total, 2)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}