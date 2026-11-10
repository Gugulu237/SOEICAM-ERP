import React from 'react';
import {getLocale,ui} from '@/lib/i18n';

// Use the posted-ledger classifications supplied by summarizeIncome. Do not
// guess which account names represent rent, payroll or depreciation.
export default function MobileIncomeStatementBody({summary}){
 const {revenue,cogs,expenses,otherIncome,otherExpenses,totalRevenue,totalCogs,grossProfit,totalExpenses,operatingProfit,net}=summary;
 const number=value=>Number(value).toLocaleString(getLocale(),{maximumFractionDigits:2});
 const row=(key,label,value,{bold=false,accent=false}={})=><div key={key} className={'flex min-h-12 items-center justify-between gap-3 px-3 py-2 text-sm '+(accent?'bg-slate-50 text-primary ':'')+(bold?'font-bold':'')}><span className="min-w-0 break-words">{label}</span><span className="shrink-0 text-right font-semibold tabular-nums">{number(value)}</span></div>;
 const group=(label,rows)=>rows.some(r=>r.amount!==0)&&<React.Fragment key={label}><p className="px-3 pb-1 pt-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{ui(label)}</p>{rows.filter(r=>r.amount!==0).map(r=>row(r.id,r.name,-r.amount))}</React.Fragment>;
 return <section><h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-primary">{ui('Income Statement')}</h2><div className="divide-y overflow-hidden rounded-xl border bg-white">
  {row('revenue',ui('Revenue'),totalRevenue,{bold:true})}
  {row('cogs',ui('Cost of Goods Sold'),-totalCogs)}
  {row('gross',ui('Gross Profit'),grossProfit,{bold:true,accent:true})}
  {group('Operating Expenses',expenses)}
  {row('expenses',ui('Total operating expenses'),-totalExpenses,{bold:true})}
  {(otherIncome.some(r=>r.amount!==0)||otherExpenses.some(r=>r.amount!==0))&&row('operating',ui('Operating Profit'),operatingProfit,{bold:true})}
  {otherIncome.some(r=>r.amount!==0)&&<><p className="px-3 pb-1 pt-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{ui('Other Income')}</p>{otherIncome.filter(r=>r.amount!==0).map(r=>row(r.id,r.name,r.amount))}</>}
  {group('Other Expenses',otherExpenses)}
  {row('net',ui('Net profit / loss'),net,{bold:true,accent:true})}
 </div><details className="mt-3 rounded-xl border bg-white p-3"><summary className="min-h-8 cursor-pointer text-xs font-semibold">{ui('Revenue & cost details')}</summary><div className="mt-2 divide-y">{[...revenue.map(r=>({...r,shown:r.amount})),...cogs.map(r=>({...r,shown:-r.amount}))].filter(r=>r.shown!==0).map(r=>row(r.id,`${r.account_number} · ${r.name}`,r.shown))}<p className="py-2 text-xs text-muted-foreground">{ui('Gross profit = Revenue − Cost of goods sold')}: {number(totalRevenue)} − ({number(totalCogs)}) = {number(grossProfit)}</p></div></details></section>;
}
