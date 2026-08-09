import React from "react";
import { formatXAF } from "@/lib/formatters";

const TONE = {
  green: "bg-green-50 text-green-600",
  orange: "bg-orange-50 text-orange-600",
  red: "bg-red-50 text-red-600",
  blue: "bg-blue-50 text-blue-600",
};

// One money-flow metric with an icon, amount, count and share bar.
export default function MoneyFlowCard({ title, amount, count, countLabel, icon: Icon, tone = "blue", share = 0, footer }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex items-start justify-between mb-2">
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{title}</p>
        <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${TONE[tone]}`}>
          <Icon size={16} />
        </span>
      </div>
      <p className="text-xl font-bold text-slate-900">{formatXAF(amount)}</p>
      <p className="text-xs text-slate-500">{count} {countLabel}</p>
      <div className="h-1.5 rounded-full bg-slate-100 mt-3 overflow-hidden">
        <div
          className={`h-full rounded-full ${tone === "green" ? "bg-green-500" : tone === "orange" ? "bg-orange-500" : tone === "red" ? "bg-red-500" : "bg-blue-500"}`}
          style={{ width: `${Math.min(100, Math.max(0, share))}%` }}
        />
      </div>
      {footer && <p className="text-xs text-slate-400 mt-2">{footer}</p>}
    </div>
  );
}