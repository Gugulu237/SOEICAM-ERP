import React from "react";
import { formatDate, formatNumber, formatXAF } from "@/lib/formatters";
import StatusBadge from "@/components/shared/StatusBadge";

const STAGE = {
  draft: { label: "Planning", pct: 5 },
  awaiting_approval: { label: "Awaiting Approval", pct: 15 },
  approved: { label: "Approved", pct: 25 },
  materials_reserved: { label: "Materials Reserved", pct: 35 },
  materials_issued: { label: "Materials Issued", pct: 50 },
  in_production: { label: "In Production", pct: 65 },
  awaiting_qc: { label: "Awaiting QC", pct: 85 },
  completed: { label: "Completed", pct: 100 },
  released: { label: "Released", pct: 100 },
  rejected: { label: "Rejected", pct: 100 },
};

const BAR = {
  awaiting_qc: "bg-orange-400",
  rejected: "bg-red-500",
  completed: "bg-green-500",
  released: "bg-green-500",
};

// Visual card representing one production batch.
export default function BatchCard({ order, onClick }) {
  const stage = STAGE[order.status] || { label: order.status, pct: 0 };
  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-white border border-slate-200 rounded-xl p-4 hover:shadow-md hover:border-purple-300 transition-all"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <p className="font-semibold text-slate-900 text-sm truncate">{order.product_name}</p>
          <p className="text-xs text-slate-500 font-mono">{order.batch_number || order.order_number || "No batch #"}</p>
        </div>
        <StatusBadge status={order.status} />
      </div>
      <div className="h-2 rounded-full bg-slate-100 overflow-hidden mb-2">
        <div
          className={`h-full rounded-full ${BAR[order.status] || "bg-purple-500"} transition-all`}
          style={{ width: `${stage.pct}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>{stage.label}</span>
        <span>{stage.pct}%</span>
      </div>
      <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
        <div>
          <p className="text-slate-400">Planned</p>
          <p className="font-medium text-slate-700">{formatNumber(order.planned_output)} units</p>
        </div>
        <div>
          <p className="text-slate-400">{order.actual_output ? "Actual" : "Date"}</p>
          <p className="font-medium text-slate-700">
            {order.actual_output ? `${formatNumber(order.actual_output)} units` : formatDate(order.production_date)}
          </p>
        </div>
        {order.actual_cost_per_unit > 0 && (
          <div>
            <p className="text-slate-400">Cost / unit</p>
            <p className="font-medium text-slate-700">{formatXAF(order.actual_cost_per_unit)}</p>
          </div>
        )}
        {order.expiry_date && (
          <div>
            <p className="text-slate-400">Expiry</p>
            <p className="font-medium text-slate-700">{formatDate(order.expiry_date)}</p>
          </div>
        )}
      </div>
    </button>
  );
}