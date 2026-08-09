import React from "react";
import { formatDate, formatNumber, formatXAF } from "@/lib/formatters";

const LANES = [
  { key: "expired", label: "Expired — Write Off", risks: ["expired"], head: "bg-red-600", card: "border-red-200 bg-red-50/40" },
  { key: "critical", label: "Sell Today", risks: ["critical"], head: "bg-orange-500", card: "border-orange-200 bg-orange-50/40" },
  { key: "warning", label: "Prioritise This Week", risks: ["warning"], head: "bg-amber-500", card: "border-amber-200 bg-amber-50/40" },
  { key: "held", label: "Held by Quality", risks: ["held", "rejected"], head: "bg-blue-600", card: "border-blue-200 bg-blue-50/40" },
];

// Triage board of at-risk batches grouped by urgency lane.
export default function ExpiryTriage({ rows }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {LANES.map(lane => {
        const items = rows.filter(r => lane.risks.includes(r.risk));
        const value = items.reduce((s, r) => s + (r.total_value || 0), 0);
        return (
          <div key={lane.key} className="bg-slate-100/70 rounded-xl overflow-hidden">
            <div className={`${lane.head} text-white px-3 py-2 flex items-center justify-between`}>
              <p className="text-xs font-bold uppercase tracking-wide">{lane.label}</p>
              <span className="text-xs font-bold">{items.length}</span>
            </div>
            <p className="text-xs text-slate-500 px-3 py-2">{formatXAF(value)} at stake</p>
            <div className="p-3 pt-0 space-y-2 max-h-[32rem] overflow-y-auto">
              {items.map(r => (
                <div key={r.id || `${r.lot_number}-${r.warehouse_name}`} className={`border rounded-lg p-3 bg-white ${lane.card}`}>
                  <p className="font-medium text-slate-900 text-sm">{r.product_name}</p>
                  <p className="text-xs text-slate-500 font-mono">{r.lot_number || "No lot"} · {r.warehouse_name}</p>
                  <div className="flex items-center justify-between mt-2 text-xs">
                    <span className="font-semibold text-slate-700">{formatNumber(r.quantity, 2)} units</span>
                    <span className="text-slate-500">
                      {r.days_left === null || r.days_left === undefined
                        ? "—"
                        : r.days_left < 0 ? `${Math.abs(r.days_left)}d overdue` : `${r.days_left}d left`}
                    </span>
                  </div>
                  {r.expiry_date && <p className="text-[11px] text-slate-400 mt-1">Expires {formatDate(r.expiry_date)}</p>}
                </div>
              ))}
              {items.length === 0 && <p className="text-xs text-slate-400 text-center py-6">Nothing in this lane</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}