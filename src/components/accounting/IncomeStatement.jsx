import ReportExport from '@/components/shared/ReportExport';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React from "react";
import {usePhoneLayout} from '@/hooks/usePhoneLayout';
import { formatXAF, formatAccountingXAF } from "@/lib/formatters";
import { round2 } from "@/lib/posting";
import { sectionRows } from "@/lib/statements";
import StatementSection from "@/components/accounting/StatementSection";
import {useRecurringExpenseReview} from './useRecurringExpenseReview';
import {recurringExpenseRequest} from '@/lib/recurring-expense-client';
import {Link} from '@/lib/router';
import IncomeStatementSources from './IncomeStatementSources';
import MobileIncomeStatementBody from './mobile/MobileIncomeStatementBody';

export function summarizeIncome(accounts, activity) {
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

  return {revenue,otherIncome,cogs,expenses,otherExpenses,totalRevenue,totalCogs,grossProfit,totalExpenses,operatingProfit,net};
}

function incomeDocument({summary,fromDate,toDate,depreciation,recurring}) {
  const {revenue,otherIncome,cogs,expenses,otherExpenses,totalRevenue,totalCogs,grossProfit,totalExpenses,operatingProfit,net}=summary;
  const sum=rows=>round2(rows.reduce((total,row)=>total+row.amount,0));
  return {title:'Income statement',metadata:[['From',fromDate],['To',toDate],['Basis','Posted journals'],['Depreciation checked through',depreciation?.through||'Not checked'],['Unposted depreciation (all completed months)',formatXAF(depreciation?.pending_total||0)],['Depreciation issues',(depreciation?.issues||[]).map(i=>i.asset_name+': '+i.message).join('; ')],['Unposted recurring charges',recurring.error?'Review unavailable':formatXAF(recurring.total)]],sections:[
    ...[['Revenue',revenue,totalRevenue],['Cost of goods sold',cogs,totalCogs],['Operating expenses',expenses,totalExpenses],['Other income',otherIncome,sum(otherIncome)],['Other expenses',otherExpenses,sum(otherExpenses)]].map(([title,rows,total])=>({title,columns:['Account','Name',{label:'Amount',type:'money'}],rows:rows.map(r=>[r.account_number,r.name,r.amount]),totals:[['','Total',total]]})),
    {title:'Profit and loss',columns:['Measure',{label:'Amount',type:'money'}],rows:[['Gross profit',grossProfit],['Operating profit',operatingProfit],['Net profit / loss',net]]},
  ]};
}

export default function IncomeStatement({ accounts, activity, fromDate, toDate, depreciation, refreshStatement, journalsById, lines, canCorrectSetup = false }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;
  const phone=usePhoneLayout();
  const recurring=useRecurringExpenseReview(fromDate,toDate);
  const summary=summarizeIncome(accounts,activity);
  const {revenue,otherIncome,cogs,expenses,otherExpenses,totalRevenue,totalCogs,grossProfit,totalExpenses,operatingProfit,net}=summary;
  const sum=rows=>round2(rows.reduce((total,row)=>total+row.amount,0));
  const document=incomeDocument({summary,fromDate,toDate,depreciation,recurring});
  const getReport=refreshStatement?async()=>{
    // Capture the chosen report period before any await, even if the person
    // changes the visible dates while the printable report is being prepared.
    const range={fromDate,toDate};
    const [snapshot,charges]=await Promise.all([
      refreshStatement(range),
      recurringExpenseRequest(null,{from:range.fromDate,to:range.toDate,summary:'1'}),
    ]);
    return incomeDocument({...range,summary:summarizeIncome(snapshot.accounts,snapshot.activity),depreciation:snapshot.depreciation,recurring:{total:charges.pending_total}});
  }:undefined;
  return (
    <div data-sleek-income-statement className={phone?'max-w-3xl':'bg-white rounded-lg border border-slate-200 p-3 sm:p-6 max-w-3xl'}>
      <section className="mb-5 rounded-xl border bg-white p-4 sm:hidden"><p className="text-xs text-muted-foreground">{ui('Net profit / loss')}</p><strong className="mt-1 block text-2xl font-bold tabular-nums text-primary">{formatXAF(net)}</strong><div className="mt-3 grid grid-cols-2 gap-3 border-t pt-3"><div><p className="text-[11px] text-muted-foreground">{ui('Revenue')}</p><strong className="text-xs tabular-nums">{formatXAF(totalRevenue)}</strong></div><div><p className="text-[11px] text-muted-foreground">{ui('Gross margin')}</p><strong className="text-xs tabular-nums">{totalRevenue?Number(grossProfit/totalRevenue*100).toFixed(1)+'%':'—'}</strong></div></div></section>
      {(recurring.loading||recurring.error||recurring.count>0)&&<div role="status" className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{ui(recurring.loading?'Checking recurring expenses...':recurring.error?'Recurring expense review is unavailable. Refresh before finalizing this report.':'Recurring charges awaiting recognition: {0}. These are not yet deducted from the reported profit.',formatXAF(recurring.total))}{!recurring.loading&&recurring.canReview&&<Link className="mt-2 block font-medium underline" to="/accounting/recurring-expenses">{ui('Review recurring expenses')}</Link>}</div>}
      {!phone&&<div className="mb-5"><ReportExport report={document} getReport={getReport} disabled={recurring.loading||!!recurring.error}/></div>}
      {phone?<MobileIncomeStatementBody summary={summary}/>:<><StatementSection title={ui("Revenue")} rows={revenue} total={totalRevenue} />
      <StatementSection title={ui("Cost of Goods Sold")} rows={cogs} total={totalCogs} />
      <div className="flex justify-between py-2 font-bold text-sm bg-slate-50 px-3 rounded">
        <span>{ui("Gross Profit")}</span><span>{formatXAF(grossProfit)}</span>
      </div>
      <p className="mb-6 mt-2 break-words text-xs text-slate-500">{ui('Gross profit = Revenue − Cost of goods sold')}: {formatAccountingXAF(totalRevenue)} − ({formatAccountingXAF(totalCogs)}) = {formatAccountingXAF(grossProfit)}</p>
      <StatementSection title={ui("Operating Expenses")} rows={expenses} total={totalExpenses} />
      <div className="flex justify-between py-2 mb-6 font-bold text-sm bg-slate-50 px-3 rounded">
        <span>{ui("Operating Profit")}</span><span>{formatXAF(operatingProfit)}</span>
      </div>
      <StatementSection title={ui("Other Income")} rows={otherIncome} total={sum(otherIncome)} />
      <StatementSection title={ui("Other Expenses")} rows={otherExpenses} total={sum(otherExpenses)} />
      <div className={`flex justify-between py-3 font-bold px-3 rounded ${net >= 0 ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>
        <span>{ui("Net ")}{net >= 0 ? ui("Profit") : ui("Loss")}</span><span>{formatXAF(net)}</span>
      </div></>}
      {phone&&<div data-statement-export className="mt-5 [&_button]:min-h-14 [&_button]:flex-1 [&_button]:rounded-xl [&_button]:text-xs [&_button:first-child]:bg-primary [&_button:first-child]:text-primary-foreground"><ReportExport report={document} getReport={getReport} disabled={recurring.loading||!!recurring.error}/></div>}
      {phone?<details className="mt-4 rounded-xl border p-3"><summary className="min-h-8 cursor-pointer text-xs font-semibold">{ui('Statement sources & controls')}</summary>      {journalsById && Array.isArray(lines) && <IncomeStatementSources accounts={accounts} activity={activity} journalsById={journalsById} lines={lines} fromDate={fromDate} toDate={toDate} canCorrectSetup={canCorrectSetup} />}</details>:<>      {journalsById && Array.isArray(lines) && <IncomeStatementSources accounts={accounts} activity={activity} journalsById={journalsById} lines={lines} fromDate={fromDate} toDate={toDate} canCorrectSetup={canCorrectSetup} />}</>}

    </div>
  );
}
