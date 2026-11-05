import ReportExport from '@/components/shared/ReportExport';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React from "react";
import { formatXAF } from "@/lib/formatters";
import { round2 } from "@/lib/posting";
import { sectionRows } from "@/lib/statements";
import StatementSection from "@/components/accounting/StatementSection";
import {useRecurringExpenseReview} from './useRecurringExpenseReview';
import {Link} from '@/lib/router';

export default function IncomeStatement({ accounts, activity, fromDate, toDate, depreciation }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;
  const recurring=useRecurringExpenseReview(fromDate,toDate);

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

  const document={title:'Income statement',metadata:[['From',fromDate],['To',toDate],['Basis','Posted journals'],['Depreciation checked through',depreciation?.through||'Not checked'],['Unposted depreciation (all completed months)',formatXAF(depreciation?.pending_total||0)],['Depreciation issues',(depreciation?.issues||[]).map(i=>i.asset_name+': '+i.message).join('; ')],['Unposted recurring charges',recurring.error?'Review unavailable':formatXAF(recurring.total)]],sections:[
    ...[['Revenue',revenue,totalRevenue],['Cost of goods sold',cogs,totalCogs],['Operating expenses',expenses,totalExpenses],['Other income',otherIncome,sum(otherIncome)],['Other expenses',otherExpenses,sum(otherExpenses)]].map(([title,rows,total])=>({title,columns:['Account','Name',{label:'Amount',type:'money'}],rows:rows.map(r=>[r.account_number,r.name,r.amount]),totals:[['','Total',total]]})),
    {title:'Profit and loss',columns:['Measure',{label:'Amount',type:'money'}],rows:[['Gross profit',grossProfit],['Operating profit',operatingProfit],['Net profit / loss',net]]},
  ]};
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-3 sm:p-6 max-w-3xl">
      {(recurring.loading||recurring.error||recurring.count>0)&&<div role="status" className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{ui(recurring.loading?'Checking recurring expenses...':recurring.error?'Recurring expense review is unavailable. Refresh before finalizing this report.':'Recurring charges awaiting recognition: {0}. These are not yet deducted from the reported profit.',formatXAF(recurring.total))}{!recurring.loading&&recurring.canReview&&<Link className="mt-2 block font-medium underline" to="/accounting/recurring-expenses">{ui('Review recurring expenses')}</Link>}</div>}
      <div className="mb-5"><ReportExport report={document} disabled={recurring.loading||!!recurring.error}/></div>
      <StatementSection title={ui("Revenue")} rows={revenue} total={totalRevenue} />
      <StatementSection title={ui("Cost of Goods Sold")} rows={cogs} total={totalCogs} />
      <div className="flex justify-between py-2 mb-6 font-bold text-sm bg-slate-50 px-3 rounded">
        <span>{ui("Gross Profit")}</span><span>{formatXAF(grossProfit)}</span>
      </div>
      <StatementSection title={ui("Operating Expenses")} rows={expenses} total={totalExpenses} />
      <div className="flex justify-between py-2 mb-6 font-bold text-sm bg-slate-50 px-3 rounded">
        <span>{ui("Operating Profit")}</span><span>{formatXAF(operatingProfit)}</span>
      </div>
      <StatementSection title={ui("Other Income")} rows={otherIncome} total={sum(otherIncome)} />
      <StatementSection title={ui("Other Expenses")} rows={otherExpenses} total={sum(otherExpenses)} />
      <div className={`flex justify-between py-3 font-bold px-3 rounded ${net >= 0 ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>
        <span>{ui("Net ")}{net >= 0 ? ui("Profit") : ui("Loss")}</span><span>{formatXAF(net)}</span>
      </div>
    </div>
  );
}
