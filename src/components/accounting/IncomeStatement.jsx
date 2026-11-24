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
import {statementAccountMembers} from '@/lib/statement-drilldown';
import {salesVatForIncomeStatement,applyIncomeVatBasis} from '@/lib/income-statement-basis';

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

const salesUnavailable='Sales totals are unavailable. Refresh the report before exporting.';

function presentedIncome(input) {
  let evidence;
  try { evidence=salesVatForIncomeStatement(input); }
  catch(error) { evidence={available:false,amount:null,error:error.message}; }
  return applyIncomeVatBasis(summarizeIncome(input.accounts,input.activity),evidence,'vat_included');
}

export function incomeDocument({summary,fromDate,toDate,depreciation,recurring}) {
  const {otherIncome,cogs,expenses,otherExpenses,totalRevenue,totalCogs,grossProfit,totalExpenses,operatingProfit,net}=summary;
  if(!summary.vatAvailable)throw Error(salesUnavailable);
  const sum=rows=>round2(rows.reduce((total,row)=>total+row.amount,0));
  return {title:'Profit and loss',metadata:[['From',fromDate],['To',toDate],['Basis','Recorded sales and expenses'],['Ledger basis','Posted journals'],['Gross margin',totalRevenue?Number(grossProfit/totalRevenue*100).toFixed(2)+'%':'Not available'],['Depreciation checked through',depreciation?.through||'Not checked'],['Unposted depreciation (all completed months)',formatXAF(depreciation?.pending_total||0)],['Depreciation issues',(depreciation?.issues||[]).map(i=>i.asset_name+': '+i.message).join('; ')],['Unposted recurring charges',recurring.error?'Review unavailable':formatXAF(recurring.total)]],sections:[
    {title:'Revenue',columns:['Account','Name',{label:'Amount',type:'money'}],rows:[['','Total Sales Revenue',totalRevenue]],totals:[['','Total Sales Revenue',totalRevenue]]},
    ...[['Cost of goods sold',cogs,totalCogs],['Operating expenses',expenses,totalExpenses],['Other income',otherIncome,sum(otherIncome)],['Other expenses',otherExpenses,sum(otherExpenses)]].map(([title,rows,total])=>({title,columns:['Account','Name',{label:'Amount',type:'money'}],rows:rows.map(r=>[r.account_number,r.name,r.amount]),totals:[['','Total',total]]})),
    {title:'Profit and loss',columns:['Measure',{label:'Amount',type:'money'}],rows:[['Gross profit',grossProfit],['Operating profit',operatingProfit],['Net profit / loss',net]]},
  ]};
}

export default function IncomeStatement({ accounts, activity, fromDate, toDate, depreciation, refreshStatement, journalsById, lines, postingRules, canCorrectSetup = false,onAccountOpen }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;
  const phone=usePhoneLayout();
  const recurring=useRecurringExpenseReview(fromDate,toDate);
  const summary=presentedIncome({accounts,activity,postingRules,journalsById,lines,fromDate,toDate});
  const salesBlocked=!summary.vatAvailable;
  const showAmount=value=>value==null?'—':formatXAF(value);
  const grossLabel='Gross Profit',operatingLabel='Operating Profit',resultLabel='Net profit / loss';
  const {revenue,otherIncome,cogs,expenses,otherExpenses,totalRevenue,totalCogs,grossProfit,totalExpenses,operatingProfit,net}=summary;
  const sum=rows=>round2(rows.reduce((total,row)=>total+row.amount,0));
  const openAccount=onAccountOpen?(row,{sign,expectedAmount=row.amount}={})=>onAccountOpen({title:[row.account_number,row.name].filter(Boolean).join(' · '),accountIds:statementAccountMembers(accounts,row.id,[row.account_type]),basis:'period',sign:sign??(['revenue','other_income'].includes(row.account_type)?-1:1),expectedAmount}):undefined;
  const document=salesBlocked?undefined:incomeDocument({summary,fromDate,toDate,depreciation,recurring});
  const getReport=refreshStatement?async()=>{
    // Capture the chosen report period before any await, even if the person
    // changes the visible dates while the printable report is being prepared.
    const range={fromDate,toDate};
    const [snapshot,charges]=await Promise.all([
      refreshStatement(range),
      recurringExpenseRequest(null,{from:range.fromDate,to:range.toDate,summary:'1'}),
    ]);
    return incomeDocument({...range,summary:presentedIncome({...snapshot,...range}),depreciation:snapshot.depreciation,recurring:{total:charges.pending_total}});
  }:undefined;
  return (
    <div data-sleek-income-statement className={phone?'max-w-3xl':'bg-white rounded-lg border border-slate-200 p-3 sm:p-6 max-w-3xl'}>
      {salesBlocked&&<p role="alert" className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{ui(salesUnavailable)}</p>}
      <section className="mb-5 rounded-xl border bg-secondary p-4 sm:hidden"><p className="text-xs text-muted-foreground">{ui(resultLabel)}</p><strong className="mt-1 block text-2xl font-bold tabular-nums text-primary">{showAmount(net)}</strong><div className="mt-3 grid grid-cols-2 gap-3 border-t pt-3"><div><p className="text-[11px] text-muted-foreground">{ui('Total Sales Revenue')}</p><strong className="text-xs tabular-nums">{showAmount(totalRevenue)}</strong></div><div><p className="text-[11px] text-muted-foreground">{ui('Gross margin')}</p><strong className="text-xs tabular-nums">{totalRevenue?Number(grossProfit/totalRevenue*100).toFixed(1)+'%':'-'}</strong></div></div></section>
      {(recurring.loading||recurring.error||recurring.count>0)&&<div role="status" className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{ui(recurring.loading?'Checking recurring expenses...':recurring.error?'Recurring expense review is unavailable. Refresh before finalizing this report.':'Recurring charges awaiting recognition: {0}. These are not yet deducted from the reported profit.',formatXAF(recurring.total))}{!recurring.loading&&recurring.canReview&&<Link className="mt-2 block font-medium underline" to="/accounting/recurring-expenses">{ui('Review recurring expenses')}</Link>}</div>}
      {!phone&&<div className="mb-5"><ReportExport report={document} getReport={getReport} disabled={recurring.loading||!!recurring.error||salesBlocked}/></div>}
      {onAccountOpen&&<p className="mb-3 text-xs text-muted-foreground">{ui('Tap or double-click an account to view its journal entries.')}</p>}
      {phone?<MobileIncomeStatementBody summary={summary} onAccountOpen={openAccount}/>:<><div className="mb-6 flex justify-between gap-3 border-b border-slate-200 py-3 text-sm font-bold"><span>{ui('Total Sales Revenue')}</span><span className="shrink-0 tabular-nums">{showAmount(totalRevenue)}</span></div>
      <StatementSection title={ui("Cost of Goods Sold")} rows={cogs} total={totalCogs} onAccountOpen={openAccount}/>
      <div className="flex justify-between py-2 font-bold text-sm bg-slate-50 px-3 rounded">
        <span>{ui(grossLabel)}</span><span>{showAmount(grossProfit)}</span>
      </div>
      <p className="mb-6 mt-2 break-words text-xs text-slate-500">{ui('Gross profit = Revenue − Cost of goods sold')}: {totalRevenue==null?'—':formatAccountingXAF(totalRevenue)} − ({formatAccountingXAF(totalCogs)}) = {grossProfit==null?'—':formatAccountingXAF(grossProfit)}</p>
      <p className="mb-4 text-xs text-slate-600">{ui('Gross margin')}: {totalRevenue?Number(grossProfit/totalRevenue*100).toFixed(1)+'%':'—'}</p>
      <StatementSection title={ui("Operating Expenses")} rows={expenses} total={totalExpenses} onAccountOpen={openAccount}/>
      <div className="flex justify-between py-2 mb-6 font-bold text-sm bg-slate-50 px-3 rounded">
        <span>{ui(operatingLabel)}</span><span>{showAmount(operatingProfit)}</span>
      </div>
      <StatementSection title={ui("Other Income")} rows={otherIncome} total={sum(otherIncome)} onAccountOpen={openAccount}/>
      <StatementSection title={ui("Other Expenses")} rows={otherExpenses} total={sum(otherExpenses)} onAccountOpen={openAccount}/>
      <div className={`flex justify-between py-3 font-bold px-3 rounded ${net==null?"bg-slate-50 text-slate-600":net >= 0 ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>
        <span>{ui(resultLabel)}</span><span>{showAmount(net)}</span>
      </div><details className="mt-4 rounded-xl border p-3"><summary className="min-h-8 cursor-pointer text-xs font-semibold">{ui('Ledger account details')}</summary><div className="mt-3"><StatementSection title={ui('Revenue')} rows={revenue} total={summary.bookRevenue} onAccountOpen={openAccount}/></div></details></>}
      {phone&&<div data-statement-export className="mt-5 [&_button]:min-h-14 [&_button]:flex-1 [&_button]:rounded-xl [&_button]:text-xs [&_button:first-child]:bg-primary [&_button:first-child]:text-primary-foreground"><ReportExport report={document} getReport={getReport} disabled={recurring.loading||!!recurring.error||salesBlocked}/></div>}
      {phone?<details className="mt-4 rounded-xl border p-3"><summary className="min-h-8 cursor-pointer text-xs font-semibold">{ui('Statement sources & controls')}</summary>      {journalsById && Array.isArray(lines) && <IncomeStatementSources accounts={accounts} activity={activity} journalsById={journalsById} lines={lines} fromDate={fromDate} toDate={toDate} canCorrectSetup={canCorrectSetup} />}</details>:<>      {journalsById && Array.isArray(lines) && <IncomeStatementSources accounts={accounts} activity={activity} journalsById={journalsById} lines={lines} fromDate={fromDate} toDate={toDate} canCorrectSetup={canCorrectSetup} />}</>}

    </div>
  );
}
