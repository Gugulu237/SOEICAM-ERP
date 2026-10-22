
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React from "react";
import { formatXAF } from "@/lib/formatters";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthLabel(key) {
  const [y, m] = String(key).split("-");
  const idx = Number(m) - 1;
  return MONTHS[idx] ? `${MONTHS[idx]} ${y}` : key;
}

// Chronological bar list of monthly spend (the month bucket key is the date field).
export default function MonthlySpendTrend({ rows = [] }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const sorted = [...rows].sort((a, b) => String(a.transaction_date).localeCompare(String(b.transaction_date)));
  const max = Math.max(...sorted.map(r => r.sum_amount || 0), 1);

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <h3 className="font-semibold text-slate-900 mb-3 text-sm">{ui("Monthly Spend")}</h3>
      {sorted.length === 0 && <p className="text-sm text-slate-400 py-4 text-center">{ui("No expenses in this period.")}</p>}
      <div className="space-y-3">
        {sorted.map(r => (
          <div key={r.transaction_date}>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="font-medium text-slate-700">{monthLabel(r.transaction_date)}</span>
              <span className="text-slate-500">{formatXAF(r.sum_amount)} · {r.count}</span>
            </div>
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full rounded-full bg-blue-500" style={{ width: `${((r.sum_amount || 0) / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}