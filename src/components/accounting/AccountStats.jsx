import React from "react";
import { formatXAF } from "@/lib/formatters";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

const Card = ({ label, value, hint }) => (
  <div className="rounded-lg border border-slate-200 bg-white p-3">
    <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
    <p className="text-lg font-semibold text-slate-800 tabular-nums">{value}</p>
    {hint && <p className="text-xs text-slate-500">{hint}</p>}
  </div>
);

export default function AccountStats({ accounts, balances, totals }) {
  const posting = accounts.filter((a) => a.is_posting !== false).length;
  const headers = accounts.length - posting;
  const control = accounts.filter((a) => a.is_control_account).length;
  const postings = Object.values(balances || {}).reduce((s, b) => s + (b.entries || 0), 0);
  const balanced = Math.abs(totals.difference) < 0.01;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
      <Card label="Accounts" value={accounts.length} hint={`${posting} posting · ${headers} header`} />
      <Card label="Posted lines" value={postings} hint="Posted journals only" />
      <Card label="Control accounts" value={control} hint="Locked from manual journals" />
      <div className={`rounded-lg border p-3 ${balanced ? "border-green-200 bg-green-50" : "border-amber-200 bg-amber-50"}`}>
        <p className="text-xs uppercase tracking-wide text-slate-500">Ledger integrity</p>
        <div className={`flex items-center gap-1.5 font-semibold ${balanced ? "text-green-700" : "text-amber-800"}`}>
          {balanced ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
          {balanced ? "Debits equal credits" : `Out by ${formatXAF(Math.abs(totals.difference))}`}
        </div>
        <p className="text-xs text-slate-500">Dr {formatXAF(totals.debit)} · Cr {formatXAF(totals.credit)}</p>
      </div>
    </div>
  );
}