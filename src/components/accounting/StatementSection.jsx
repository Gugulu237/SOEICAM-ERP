
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React from "react";
import { formatXAF } from "@/lib/formatters";

// Reusable statement block: titled list of account rows with a subtotal line.
export default function StatementSection({ title, rows, total, totalLabel, bold }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  return (
    <div className="mb-6">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-200 pb-1 mb-2">{title}</h4>
      {rows.map((r) => (
        <div key={r.id} className="flex justify-between py-1 text-sm">
          <span className="text-slate-600">{r.account_number} — {r.name}</span>
          <span>{formatXAF(r.amount)}</span>
        </div>
      ))}
      {rows.length === 0 && <p className="text-sm text-slate-400 py-1">—</p>}
      <div className={`flex justify-between py-2 border-t border-slate-200 text-sm ${bold ? "font-bold" : "font-semibold"}`}>
        <span>{totalLabel || ui("Total {0}", title)}</span>
        <span>{formatXAF(total)}</span>
      </div>
    </div>
  );
}