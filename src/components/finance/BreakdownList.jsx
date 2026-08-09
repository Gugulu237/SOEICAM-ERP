import React from "react";
import { formatXAF } from "@/lib/formatters";

// Simple ranked bar list of the biggest contributors to a total.
export default function BreakdownList({ title, rows, emptyMessage, barClass = "bg-slate-400" }) {
  const max = Math.max(...rows.map(r => r.value), 1);
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <h3 className="font-semibold text-slate-900 mb-3 text-sm">{title}</h3>
      {rows.length === 0 && <p className="text-sm text-slate-400 py-4 text-center">{emptyMessage}</p>}
      <div className="space-y-3">
        {rows.map(r => (
          <div key={r.label}>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="font-medium text-slate-700 truncate pr-2">{r.label}</span>
              <span className="text-slate-500 flex-shrink-0">{formatXAF(r.value)}</span>
            </div>
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
              <div className={`h-full rounded-full ${barClass}`} style={{ width: `${(r.value / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}