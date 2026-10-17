import React, { useEffect, useState } from "react";
import { Loader2, Scale } from "lucide-react";
import { invokeFieldOps } from "@/lib/field-ops";
import { formatXAF } from "@/lib/formatters";

// The exact journal this sale will post, read from the same policy the server uses.
export default function ProposedJournal({ saleId }) {
  const [lines, setLines] = useState(null);
  const [posted, setPosted] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setLines(null);
    setError("");
    invokeFieldOps({ action: "proposedJournal", saleId })
      .then((res) => {
        if (!alive) return;
        setLines(res.data?.lines || []);
        setPosted(!!res.data?.posts);
      })
      .catch((e) => alive && setError(e.message || "The proposed journal could not be prepared"));
    return () => { alive = false; };
  }, [saleId]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!lines) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500 py-4">
        <Loader2 className="w-4 h-4 animate-spin" /> Preparing the proposed journal…
      </div>
    );
  }

  const debit = lines.reduce((s, l) => s + (l.debit || 0), 0);
  const credit = lines.reduce((s, l) => s + (l.credit || 0), 0);

  return (
    <div className="rounded-lg border border-slate-200 overflow-hidden">
      <div className="flex items-center gap-2 bg-slate-50 px-3 py-2 border-b border-slate-200">
        <Scale className="w-4 h-4 text-slate-500" />
        <span className="text-sm font-semibold text-slate-800">
          {posted ? "Posted journal" : "Proposed journal"}
        </span>
        {debit === credit && <span className="ml-auto text-xs text-emerald-600">balanced</span>}
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs uppercase text-slate-500 border-b border-slate-100">
            <th className="text-left px-3 py-2 font-medium">Account</th>
            <th className="text-left px-3 py-2 font-medium hidden sm:table-cell">Description</th>
            <th className="text-right px-3 py-2 font-medium">Debit</th>
            <th className="text-right px-3 py-2 font-medium">Credit</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} className="border-b border-slate-50 last:border-0">
              <td className="px-3 py-2">
                <div className="font-medium text-slate-800">{l.account_number}</div>
                <div className="text-xs text-slate-500">{l.account_name}</div>
              </td>
              <td className="px-3 py-2 text-slate-600 hidden sm:table-cell">{l.description}</td>
              <td className="px-3 py-2 text-right tabular-nums">{l.debit ? formatXAF(l.debit) : "—"}</td>
              <td className="px-3 py-2 text-right tabular-nums">{l.credit ? formatXAF(l.credit) : "—"}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-slate-50 font-semibold">
            <td className="px-3 py-2" colSpan={2}>Total</td>
            <td className="px-3 py-2 text-right tabular-nums">{formatXAF(debit)}</td>
            <td className="px-3 py-2 text-right tabular-nums">{formatXAF(credit)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}