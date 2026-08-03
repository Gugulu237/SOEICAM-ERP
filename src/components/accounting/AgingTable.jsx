import React, { useMemo } from "react";
import { formatXAF } from "@/lib/formatters";
import { agingBucket } from "@/lib/ar-ap";

const BUCKETS = [
  ["current", "Current"],
  ["d1_30", "1–30 days"],
  ["d31_60", "31–60 days"],
  ["d61_90", "61–90 days"],
  ["d90_plus", "90+ days"],
];

// docs: [{ party_name, due_date, balance }] — open documents only
export default function AgingTable({ docs }) {
  const { rows, totals } = useMemo(() => {
    const byParty = {};
    const totals = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0, total: 0 };
    for (const d of docs) {
      const bucket = agingBucket(d.due_date);
      const row = byParty[d.party_name] || (byParty[d.party_name] = { party: d.party_name, current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0, total: 0 });
      row[bucket] += d.balance;
      row.total += d.balance;
      totals[bucket] += d.balance;
      totals.total += d.balance;
    }
    return { rows: Object.values(byParty).sort((a, b) => b.total - a.total), totals };
  }, [docs]);

  return (
    <div className="bg-white rounded-lg border border-slate-200 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200 text-left text-slate-500">
            <th className="px-4 py-3">Party</th>
            {BUCKETS.map(([k, label]) => <th key={k} className="px-4 py-3 text-right">{label}</th>)}
            <th className="px-4 py-3 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">Nothing outstanding</td></tr>}
          {rows.map((r) => (
            <tr key={r.party} className="border-b border-slate-100">
              <td className="px-4 py-3 font-medium">{r.party}</td>
              {BUCKETS.map(([k]) => (
                <td key={k} className={`px-4 py-3 text-right ${k === "d90_plus" && r[k] > 0 ? "text-red-600 font-medium" : ""}`}>
                  {r[k] ? formatXAF(r[k]) : ""}
                </td>
              ))}
              <td className="px-4 py-3 text-right font-bold">{formatXAF(r.total)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-bold bg-slate-50">
            <td className="px-4 py-3">Totals</td>
            {BUCKETS.map(([k]) => <td key={k} className="px-4 py-3 text-right">{formatXAF(totals[k])}</td>)}
            <td className="px-4 py-3 text-right">{formatXAF(totals.total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}