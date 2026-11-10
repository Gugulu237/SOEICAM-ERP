
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React from "react";
import { formatAccountingXAF as formatXAF } from "@/lib/formatters";

// Reusable statement block: titled list of account rows with a subtotal line.
export default function StatementSection({ title, rows, total, totalLabel, bold,onAccountOpen }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  return (
    <div className="mb-6">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-200 pb-1 mb-2">{title}</h4>
      {rows.map((r) => {const Row=onAccountOpen?'button':'div';return (
        <Row key={r.id} {...(onAccountOpen?{type:'button',onClick:()=>onAccountOpen(r),onDoubleClick:()=>onAccountOpen(r),'aria-haspopup':'dialog','aria-label':ui('View journal entries for {0}',r.name)}:{})} className={'flex w-full justify-between gap-3 py-1 text-left text-sm '+(onAccountOpen?'min-h-11 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary hover:bg-slate-50':'')}>
          <span className="min-w-0 break-words text-slate-600">{r.account_number} — {r.name}</span>
          <span className="shrink-0 text-right tabular-nums">{formatXAF(r.amount)}</span>
        </Row>
      );})}
      {rows.length === 0 && <p className="text-sm text-slate-400 py-1">—</p>}
      <div className={`flex justify-between py-2 border-t border-slate-200 text-sm ${bold ? "font-bold" : "font-semibold"}`}>
        <span>{totalLabel || ui("Total {0}", title)}</span>
        <span>{formatXAF(total)}</span>
      </div>
    </div>
  );
}
