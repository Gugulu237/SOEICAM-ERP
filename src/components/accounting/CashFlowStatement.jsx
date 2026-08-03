import React, { useMemo } from "react";
import { formatXAF } from "@/lib/formatters";
import { round2 } from "@/lib/posting";

const MODULE_LABELS = {
  sales: "Sales & customer receipts",
  payments: "Customer / supplier payments",
  purchases: "Purchases & procurement",
  production: "Production",
  treasury: "Treasury & petty cash",
  payroll: "Payroll",
  manual: "Manual journals",
};

// Direct-method cash flow over the cash pool (treasury-linked GL accounts).
export default function CashFlowStatement({ cashAccountIds, journalsById, lines, fromDate, toDate }) {
  const { opening, groups, totalIn, totalOut, closing } = useMemo(() => {
    const cashSet = new Set(cashAccountIds);
    let opening = 0;
    const groups = {};
    let totalIn = 0, totalOut = 0;

    // Group journal lines by journal to detect internal transfers (all-cash journals)
    const byJournal = {};
    for (const l of lines) {
      if (!journalsById[l.journal_id]) continue;
      (byJournal[l.journal_id] = byJournal[l.journal_id] || []).push(l);
    }

    for (const [jid, jLines] of Object.entries(byJournal)) {
      const j = journalsById[jid];
      const d = j.entry_date || "";
      const cashLines = jLines.filter((l) => cashSet.has(l.account_id));
      if (!cashLines.length) continue;
      const net = round2(cashLines.reduce((s, l) => s + round2(l.debit) - round2(l.credit), 0));
      if (d < fromDate) { opening = round2(opening + net); continue; }
      if (d > toDate) continue;
      const internal = cashLines.length === jLines.length; // pure cash-to-cash transfer
      if (internal || net === 0) continue;
      const key = j.source_module || "manual";
      const g = groups[key] || (groups[key] = { inflow: 0, outflow: 0 });
      if (net > 0) { g.inflow = round2(g.inflow + net); totalIn = round2(totalIn + net); }
      else { g.outflow = round2(g.outflow - net); totalOut = round2(totalOut - net); }
    }
    const closing = round2(opening + totalIn - totalOut);
    return { opening, groups, totalIn, totalOut, closing };
  }, [cashAccountIds, journalsById, lines, fromDate, toDate]);

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-6 max-w-3xl">
      <div className="flex justify-between py-2 font-semibold text-sm border-b border-slate-200 mb-4">
        <span>Opening cash & equivalents</span><span>{formatXAF(opening)}</span>
      </div>
      <table className="w-full text-sm mb-4">
        <thead>
          <tr className="text-left text-slate-500 border-b border-slate-200">
            <th className="py-2">Activity</th>
            <th className="py-2 text-right">Inflows</th>
            <th className="py-2 text-right">Outflows</th>
            <th className="py-2 text-right">Net</th>
          </tr>
        </thead>
        <tbody>
          {Object.keys(groups).length === 0 && (
            <tr><td colSpan={4} className="py-6 text-center text-slate-400">No cash movements in this period</td></tr>
          )}
          {Object.entries(groups).map(([key, g]) => (
            <tr key={key} className="border-b border-slate-100">
              <td className="py-2">{MODULE_LABELS[key] || key}</td>
              <td className="py-2 text-right text-green-700">{g.inflow ? formatXAF(g.inflow) : ""}</td>
              <td className="py-2 text-right text-red-600">{g.outflow ? formatXAF(g.outflow) : ""}</td>
              <td className="py-2 text-right font-medium">{formatXAF(round2(g.inflow - g.outflow))}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-semibold">
            <td className="py-2">Total</td>
            <td className="py-2 text-right text-green-700">{formatXAF(totalIn)}</td>
            <td className="py-2 text-right text-red-600">{formatXAF(totalOut)}</td>
            <td className="py-2 text-right">{formatXAF(round2(totalIn - totalOut))}</td>
          </tr>
        </tfoot>
      </table>
      <div className="flex justify-between py-3 font-bold px-3 rounded bg-slate-50">
        <span>Closing cash & equivalents</span><span>{formatXAF(closing)}</span>
      </div>
      <p className="text-xs text-slate-400 mt-3">Direct method over cash, bank and mobile-money GL accounts. Internal transfers between cash accounts are excluded.</p>
    </div>
  );
}