import React from "react";
import { formatXAF } from "@/lib/formatters";
import { round2 } from "@/lib/posting";
import { sectionRows, netProfit } from "@/lib/statements";
import StatementSection from "@/components/accounting/StatementSection";

export default function BalanceSheet({ accounts, activity }) {
  const sum = (rows) => round2(rows.reduce((s, r) => s + r.amount, 0));

  const assets = sectionRows(accounts, activity, ["asset"], 1, "closing");
  const liabilities = sectionRows(accounts, activity, ["liability"], -1, "closing");
  const equity = sectionRows(accounts, activity, ["equity"], -1, "closing");
  const retainedEarnings = netProfit(accounts, activity, "closing");

  const totalAssets = sum(assets);
  const totalLiabilities = sum(liabilities);
  const totalEquity = round2(sum(equity) + retainedEarnings);
  const totalLiabEquity = round2(totalLiabilities + totalEquity);
  const balanced = totalAssets === totalLiabEquity;

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-6 max-w-3xl">
      <StatementSection title="Assets" rows={assets} total={totalAssets} bold />
      <StatementSection title="Liabilities" rows={liabilities} total={totalLiabilities} />
      <StatementSection title="Equity" rows={[...equity, { id: "_re", account_number: "", name: "Retained Earnings / Current Profit", amount: retainedEarnings }]} total={totalEquity} />
      <div className="flex justify-between py-2 font-bold text-sm bg-slate-50 px-3 rounded mb-3">
        <span>Total Liabilities & Equity</span><span>{formatXAF(totalLiabEquity)}</span>
      </div>
      <div className={`text-sm font-medium px-3 py-2 rounded ${balanced ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
        {balanced ? "✓ Assets equal liabilities plus equity" : `✗ Out of balance by ${formatXAF(Math.abs(round2(totalAssets - totalLiabEquity)))}`}
      </div>
    </div>
  );
}