import React from "react";
import ExpenseCard from "./ExpenseCard";
import { formatXAF } from "@/lib/formatters";

const COLUMNS = [
  { key: "draft", label: "Draft", tone: "bg-slate-100 text-slate-600" },
  { key: "pending_approval", label: "Pending Approval", tone: "bg-yellow-100 text-yellow-800" },
  { key: "approved", label: "Approved — To Pay", tone: "bg-blue-100 text-blue-800" },
  { key: "paid", label: "Paid", tone: "bg-green-100 text-green-800" },
];

// Kanban of expense requests across their lifecycle.
export default function ExpenseBoard({ requests, ...actions }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
      {COLUMNS.map(col => {
        const items = requests.filter(r => r.status === col.key);
        const total = items.reduce((s, r) => s + (r.amount || 0), 0);
        return (
          <div key={col.key} className="bg-slate-50 rounded-xl p-3">
            <div className="flex items-center justify-between mb-3">
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${col.tone}`}>{col.label}</span>
              <span className="text-xs text-slate-500">{items.length}</span>
            </div>
            <p className="text-xs text-slate-500 mb-3">{formatXAF(total)}</p>
            <div className="space-y-2">
              {items.map(r => <ExpenseCard key={r.id} request={r} {...actions} isOwner={actions.isOwner(r)} />)}
              {items.length === 0 && <p className="text-xs text-slate-400 text-center py-6">Nothing here</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}