import React from "react";
import AccountRow, { balanceLabel } from "@/components/accounting/AccountRow";
import { Layers } from "lucide-react";

export default function AccountTree({
  sections, childrenMap, rollups, entryCounts, collapsed,
  onToggleCollapse, onEdit, onAddChild, onToggleActive, canManage,
}) {
  return (
    <div className="space-y-5">
      {sections.map((section) => (
        <div key={section.value} className="rounded-lg border border-slate-200 overflow-hidden bg-white">
          <div className="flex items-center justify-between px-3 py-2 bg-slate-100 border-b border-slate-200">
            <div className="flex items-center gap-2">
              <Layers size={15} className="text-slate-500" />
              <span className="font-semibold text-slate-700">{section.label}</span>
              <span className="text-xs text-slate-500">
                {section.count} account{section.count === 1 ? "" : "s"}
              </span>
            </div>
            <span className="text-sm font-semibold text-slate-700 tabular-nums">{balanceLabel(section.net)}</span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="py-2 pl-3 font-medium">Account</th>
                <th className="py-2 font-medium text-center w-20">Postings</th>
                <th className="py-2 pr-3 font-medium text-right w-40">Balance</th>
                <th className="w-28" />
              </tr>
            </thead>
            <tbody>
              {section.roots.map((root) => (
                <AccountRow
                  key={root.id}
                  node={root}
                  depth={0}
                  childrenMap={childrenMap}
                  rollups={rollups}
                  entryCounts={entryCounts}
                  collapsed={collapsed}
                  onToggleCollapse={onToggleCollapse}
                  onEdit={onEdit}
                  onAddChild={onAddChild}
                  onToggleActive={onToggleActive}
                  canManage={canManage}
                />
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}