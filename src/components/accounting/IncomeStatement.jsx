import React from "react";
import { formatXAF } from "@/lib/formatters";
import { round2 } from "@/lib/posting";
import { sectionRows } from "@/lib/statements";
import StatementSection from "@/components/accounting/StatementSection";

export default function IncomeStatement({ accounts, activity }) {
  const sum = (rows) => round2(rows.reduce((s, r) => s + r.amount, 0));

  const revenue = sectionRows(accounts, activity, ["revenue"], -1);
  const otherIncome = sectionRows(accounts, activity, ["other_income"], -1);
  const cogs = sectionRows(accounts, activity, ["cogs"], 1);
  const expenses = sectionRows(accounts, activity, ["expense"], 1);
  const otherExpenses = sectionRows(accounts, activity, ["other_expense"], 1);

  const totalRevenue = sum(revenue);
  const totalCogs = sum(cogs);
  const grossProfit = round2(totalRevenue - totalCogs);
  const totalExpenses = sum(expenses);
  const operatingProfit = round2(grossProfit - totalExpenses);
  const net = round2(operatingProfit + sum(otherIncome) - sum(otherExpenses));

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-6 max-w-3xl">
      <StatementSection title="Revenue" rows={revenue} total={totalRevenue} />
      <StatementSection title="Cost of Goods Sold" rows={cogs} total={totalCogs} />
      <div className="flex justify-between py-2 mb-6 font-bold text-sm bg-slate-50 px-3 rounded">
        <span>Gross Profit</span><span>{formatXAF(grossProfit)}</span>
      </div>
      <StatementSection title="Operating Expenses" rows={expenses} total={totalExpenses} />
      <div className="flex justify-between py-2 mb-6 font-bold text-sm bg-slate-50 px-3 rounded">
        <span>Operating Profit</span><span>{formatXAF(operatingProfit)}</span>
      </div>
      <StatementSection title="Other Income" rows={otherIncome} total={sum(otherIncome)} />
      <StatementSection title="Other Expenses" rows={otherExpenses} total={sum(otherExpenses)} />
      <div className={`flex justify-between py-3 font-bold px-3 rounded ${net >= 0 ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>
        <span>Net {net >= 0 ? "Profit" : "Loss"}</span><span>{formatXAF(net)}</span>
      </div>
    </div>
  );
}