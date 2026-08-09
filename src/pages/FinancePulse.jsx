import React, { useState, useEffect } from "react";
import { getFinancePulse, topBy, PERIODS } from "@/lib/finance-pulse";
import { formatXAF, formatDate } from "@/lib/formatters";
import PageHeader from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import CashPositionCard from "@/components/finance/CashPositionCard";
import MoneyFlowCard from "@/components/finance/MoneyFlowCard";
import BreakdownList from "@/components/finance/BreakdownList";
import { Receipt, ShoppingCart, Wallet, Trash2, TrendingUp, TrendingDown } from "lucide-react";

export default function FinancePulse() {
  const [period, setPeriod] = useState("month");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getFinancePulse(period).then(setData).finally(() => setLoading(false));
  }, [period]);

  const periodLabel = PERIODS.find(p => p.key === period)?.label || "";
  const scale = data ? Math.max(data.sales, data.purchases, data.expenses, data.spoilage, 1) : 1;

  return (
    <div>
      <PageHeader
        title="Finance Pulse"
        subtitle={data ? `${periodLabel} · ${formatDate(data.start)} to today` : "Quick financial health check"}
        actions={
          <div className="flex flex-wrap gap-1">
            {PERIODS.map(p => (
              <Button key={p.key} size="sm" variant={period === p.key ? "default" : "outline"} onClick={() => setPeriod(p.key)}>
                {p.label}
              </Button>
            ))}
          </div>
        }
      />

      {loading || !data ? (
        <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
            <CashPositionCard total={data.cashTotal} cashByType={data.cashByType} accounts={data.accounts} />

            <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <MoneyFlowCard
                title="Sales" amount={data.sales} count={data.salesCount} countLabel="invoices"
                icon={Receipt} tone="green" share={(data.sales / scale) * 100}
                footer={`${formatXAF(data.collected)} collected · ${formatXAF(data.outstanding)} still owed`}
              />
              <MoneyFlowCard
                title="Purchases" amount={data.purchases} count={data.purchasesCount} countLabel="purchase orders"
                icon={ShoppingCart} tone="orange" share={(data.purchases / scale) * 100}
                footer="Materials, packaging & supplies ordered"
              />
              <MoneyFlowCard
                title="Operating Expenses" amount={data.expenses} count={data.expensesCount} countLabel="payments"
                icon={Wallet} tone="blue" share={(data.expenses / scale) * 100}
                footer="Cash paid out from treasury accounts"
              />
              <MoneyFlowCard
                title="Spoilage & Losses" amount={data.spoilage} count={data.spoilageCount} countLabel="write-offs"
                icon={Trash2} tone="red" share={(data.spoilage / scale) * 100}
                footer={data.sales > 0 ? `${((data.spoilage / data.sales) * 100).toFixed(1)}% of sales value` : "Damaged & expired stock"}
              />
            </div>
          </div>

          <div className={`rounded-xl p-5 mb-4 border ${data.netPosition >= 0 ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"}`}>
            <div className="flex items-center gap-3">
              <span className={`w-11 h-11 rounded-lg flex items-center justify-center ${data.netPosition >= 0 ? "bg-green-100 text-green-600" : "bg-red-100 text-red-600"}`}>
                {data.netPosition >= 0 ? <TrendingUp size={22} /> : <TrendingDown size={22} />}
              </span>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Net Position · {periodLabel}</p>
                <p className={`text-2xl font-bold ${data.netPosition >= 0 ? "text-green-700" : "text-red-700"}`}>
                  {formatXAF(data.netPosition)}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Sales {formatXAF(data.sales)} − Purchases {formatXAF(data.purchases)} − Expenses {formatXAF(data.expenses)} − Spoilage {formatXAF(data.spoilage)}
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <BreakdownList
              title="Where Expenses Went"
              rows={topBy(data.expenseLines, "expense_account_name", "amount")}
              emptyMessage="No expenses recorded in this period."
              barClass="bg-blue-500"
            />
            <BreakdownList
              title="Biggest Spoilage Losses"
              rows={topBy(data.spoilageLines, "product_name", "total_value")}
              emptyMessage="No spoilage in this period — nothing lost."
              barClass="bg-red-500"
            />
          </div>
        </>
      )}
    </div>
  );
}