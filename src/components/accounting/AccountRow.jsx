
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React from "react";
import { formatXAF } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Pencil, Plus, Power, Eye, EyeOff, Trash2 } from "lucide-react";

// Debit-positive balance shown the way an accountant reads it: Dr or Cr.
export function balanceLabel(net) {
  if (!net) return "—";
  return `${formatXAF(Math.abs(net))} ${net > 0 ? "Dr" : "Cr"}`;
}

const TONES = {
  slate: "bg-slate-100 text-slate-600",
  blue: "bg-blue-100 text-blue-700",
  amber: "bg-amber-100 text-amber-800",
  rose: "bg-rose-100 text-rose-700",
};

const Chip = ({ children, tone = "slate" }) => (
  <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${TONES[tone]}`}>
    {children}
  </span>
);

export default function AccountRow({
  node, depth, childrenMap, rollups, entryCounts, collapsed,
  onToggleCollapse, onEdit, onAddChild, onToggleActive, onToggleHidden, onDelete, busy, canManage,
}) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const kids = childrenMap.get(node.id) || [];
  const isCollapsed = collapsed.has(node.id);

  return (
    <>
      <tr className="border-b border-slate-100 hover:bg-slate-50/70">
        <td className="py-2 pl-3 pr-2">
          <div className="flex items-center gap-1.5" style={{ paddingLeft: `${depth * 22}px` }}>
            {kids.length > 0 ? (
              <button type="button" onClick={() => onToggleCollapse(node.id)} className="text-slate-400 hover:text-slate-700">
                {isCollapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
              </button>
            ) : (
              <span className="inline-block w-[15px]" />
            )}
            <span className="font-mono text-xs text-slate-500 tabular-nums">{node.account_number}</span>
            <span className={`font-medium ${node.is_active === false ? "text-slate-400 line-through" : "text-slate-800"}`}>
              {node.name}
            </span>
            {node.is_posting === false && <Chip tone="blue">{ui("Header")}</Chip>}
            {node.is_control_account && <Chip tone="amber">{ui("Control")}</Chip>}
            {node.allow_manual_journal === false && <Chip tone="rose">{ui("No manual entry")}</Chip>}
            {node.is_system && <Chip>{ui("System")}</Chip>}
            {node.is_hidden && <Chip>{ui("Hidden")}</Chip>}
            {node.is_active === false && <Chip tone="rose">{ui("Inactive")}</Chip>}
          </div>
        </td>
        <td className="py-2 pr-2 text-center text-slate-500 tabular-nums">{entryCounts.get(node.id) || ""}</td>
        <td className="py-2 pr-3 text-right font-medium tabular-nums">{balanceLabel(rollups.get(node.id))}</td>
        <td className="py-2 pr-3 text-right whitespace-nowrap">
          {canManage && (
            <div className="flex justify-end gap-1">
              <Button variant="ghost" size="icon" title={ui("Edit account")} onClick={() => onEdit(node)}>
                <Pencil size={14} />
              </Button>
              {node.is_active !== false && (
                <Button variant="ghost" size="icon" title={ui("Add sub-account")} onClick={() => onAddChild(node)}>
                  <Plus size={14} />
                </Button>
              )}
              <Button variant="ghost" size="icon" disabled={busy} title={node.is_hidden?ui("Show account"):ui("Hide account")} aria-label={node.is_hidden?ui("Show account"):ui("Hide account")} onClick={()=>onToggleHidden(node)}>{node.is_hidden?<Eye size={14}/>:<EyeOff size={14}/>}</Button>
              {!node.is_system && !node.is_control_account && !node.is_treasury && !kids.length && !(entryCounts.get(node.id)>0) && !Number(node.balance || 0) && <Button variant="ghost" size="icon" disabled={busy} title={ui("Delete unused account")} aria-label={ui("Delete unused account")} onClick={()=>onDelete(node)}><Trash2 size={14} className="text-red-600"/></Button>}
              {!node.is_system && (
                <Button
                  variant="ghost"
                  size="icon"
                  title={node.is_active === false ? ui("Activate account") : ui("Deactivate account")}
                  onClick={() => onToggleActive(node)}
                >
                  <Power size={14} className={node.is_active === false ? "text-slate-400" : "text-green-600"} />
                </Button>
              )}
            </div>
          )}
        </td>
      </tr>
      {!isCollapsed && kids.map((kid) => (
        <AccountRow
          key={kid.id}
          node={kid}
          depth={depth + 1}
          childrenMap={childrenMap}
          rollups={rollups}
          entryCounts={entryCounts}
          collapsed={collapsed}
          onToggleCollapse={onToggleCollapse}
          onEdit={onEdit}
          onAddChild={onAddChild}
          onToggleActive={onToggleActive}
          onToggleHidden={onToggleHidden}
          onDelete={onDelete}
          busy={busy}
          canManage={canManage}
        />
      ))}
    </>
  );
}