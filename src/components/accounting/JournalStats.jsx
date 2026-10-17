import React from "react";
import { formatXAF } from "@/lib/formatters";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

const Card = ({ label, value, hint }) => (
  <div className="rounded-lg border border-slate-200 bg-white p-3">
    <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
    <p className="text-lg font-semibold tabular-nums text-slate-800">{value}</p>
    {hint && <p className="text-xs text-slate-500">{hint}</p>}
  </div>
);

export default function JournalStats({ report, ledger }) {
  const balanced = ledger ? Math.abs(ledger.difference) < 1 : null;
  const tone = balanced === null
    ? "border-slate-200 bg-white"
    : balanced ? "border-green-200 bg-green-50" : "border-amber-200 bg-amber-50";

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
      <Card
        label="Journals in view"
        value={report.total}
        hint={`${report.counts.posted} posted · ${report.counts.draft} draft`}
      />
      <Card
        label="Value posted"
        value={formatXAF(report.debit)}
        hint={`${report.counts.reversed} reversed journal${report.counts.reversed === 1 ? "" : "s"}`}
      />
      <Card
        label="Journal credits"
        value={formatXAF(report.credit)}
        hint="Header totals of journals in view"
      />
      <div className={`rounded-lg border p-3 ${tone}`}>
        <p className="text-xs uppercase tracking-wide text-slate-500">Posted ledger</p>
        <div className={`flex items-center gap-1.5 font-semibold ${balanced === null ? "text-slate-500" : balanced ? "text-green-700" : "text-amber-800"}`}>
          {balanced === null ? "Checking…" : balanced ? (
            <><CheckCircle2 size={16} /> Debits equal credits</>
          ) : (
            <><AlertTriangle size={16} /> Out by {formatXAF(Math.abs(ledger.difference))}</>
          )}
        </div>
        <p className="text-xs text-slate-500">
          {ledger ? `Dr ${formatXAF(ledger.debit)} · Cr ${formatXAF(ledger.credit)}` : "From posted journal lines"}
        </p>
      </div>
    </div>
  );
}