import ReportExport from '@/components/shared/ReportExport';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React from 'react';
import { formatXAF, formatDate } from '@/lib/formatters';
import { financialPosition } from '@/lib/financial-position';

function AccountRows({ title, rows, total }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  return <section className="mb-6"><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
    <div className="space-y-1">{rows.filter(r=>r.amount!==0).map(r=><div key={r.id} className="flex justify-between gap-4 border-b border-slate-100 py-2 text-sm"><span className="min-w-0 text-slate-700"><span className="mr-2 font-mono text-xs text-slate-400">{r.account_number}</span>{r.name}{r.is_active===false&&<span className="ml-2 text-xs text-slate-400">{ui("Inactive")}</span>}</span><strong className={'shrink-0 whitespace-nowrap tabular-nums '+(r.amount<0?'text-red-700':'text-slate-900')}>{formatXAF(r.amount)}</strong></div>)}</div>
    {!rows.some(r=>r.amount!==0)&&<p className="py-4 text-sm text-slate-400">{ui("No posted balance.")}</p>}
    <div className="mt-3 flex justify-between gap-3 border-t border-slate-300 pt-3 text-sm font-semibold"><span>{ui("Total ")}{title.toLowerCase()}</span><span className="whitespace-nowrap tabular-nums">{formatXAF(total)}</span></div>
  </section>;
}
export default function AccountPosition({accounts,balances,date,title=ui("Assets & liabilities")}) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const p=financialPosition(accounts,balances),balanced=p.difference===0&&p.unclassified===0;
  const document={title,metadata:[['As at',date||'Current posted balances']],notes:[balanced?'Assets equal liabilities plus equity.':`Reconciliation difference: ${p.difference} XAF. No balancing amount has been added.`,...(p.unclassified?[`${p.unclassified} balances require account classification.`]:[])],sections:[
    ...[['Assets',p.assets,p.totalAssets],['Liabilities',p.liabilities,p.totalLiabilities],['Equity',[...p.equity,{account_number:'',name:'Current earnings / unclosed profit',amount:p.earnings}],p.totalEquity]].map(([heading,rows,total])=>({title:heading,columns:['Account','Name',{label:'Amount',type:'money'}],rows:rows.filter(r=>r.amount!==0).map(r=>[r.account_number,r.name,r.amount]),totals:[['',`Total ${heading}`,total]]})),
    {title:'Reconciliation',columns:['Measure',{label:'Amount',type:'money'}],rows:[['Assets',p.totalAssets],['Liabilities and equity',p.funding],['Difference',p.difference]]},
  ]};
  return <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white" aria-label={ui("T-shaped financial position")}>
    <header className="flex flex-wrap items-end justify-between gap-3 px-5 py-5 sm:px-7"><div><h2 className="text-xl font-semibold text-slate-900">{title}</h2><p className="mt-1 text-xs text-slate-500">{date?'As at '+formatDate(date)+'. ':''}{ui("Posted ledger balances · XAF")}</p></div><p className="text-xs text-slate-500">{ui("Negative balances reduce their section total.")}</p></header>
    <div className="px-5 pb-4 sm:px-7"><ReportExport report={document}/></div>
    <div className="grid border-t-4 border-slate-800 md:grid-cols-2">
      <div className="flex min-w-0 flex-col p-5 sm:p-7"><div className="mb-6 border-b border-slate-200 pb-5"><p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">{ui("Assets")}</p><p className="mt-2 break-words text-3xl font-bold tabular-nums text-slate-950">{formatXAF(p.totalAssets)}</p><p className="mt-1 text-xs text-slate-500">{ui("What the company owns")}</p></div>
        <AccountRows title={ui("Assets")} rows={p.assets} total={p.totalAssets}/><div className="mt-auto flex justify-between gap-3 border-y-2 border-slate-800 bg-slate-50 px-3 py-4 font-bold"><span>{ui("Total assets")}</span><span className="whitespace-nowrap tabular-nums">{formatXAF(p.totalAssets)}</span></div>
      </div>
      <div className="flex min-w-0 flex-col border-t-2 border-slate-800 p-5 sm:p-7 md:border-l-2 md:border-t-0"><div className="mb-6 border-b border-slate-200 pb-5"><p className="text-xs font-semibold uppercase tracking-wider text-blue-700">{ui("Liabilities & equity")}</p><p className="mt-2 break-words text-3xl font-bold tabular-nums text-slate-950">{formatXAF(p.funding)}</p><p className="mt-1 text-xs text-slate-500">{ui("Liabilities ")}{formatXAF(p.totalLiabilities)}{ui(" · Equity ")}{formatXAF(p.totalEquity)}</p></div>
        <AccountRows title={ui("Liabilities")} rows={p.liabilities} total={p.totalLiabilities}/><AccountRows title={ui("Equity")} rows={[...p.equity,{id:'current-earnings',name:'Current earnings / unclosed profit',account_number:'',amount:p.earnings}]} total={p.totalEquity}/>
        <div className="mt-auto flex justify-between gap-3 border-y-2 border-slate-800 bg-slate-50 px-3 py-4 font-bold"><span>{ui("Total liabilities & equity")}</span><span className="whitespace-nowrap tabular-nums">{formatXAF(p.funding)}</span></div>
      </div>
    </div>
    <footer className={'border-t px-5 py-4 text-sm sm:px-7 '+(balanced?'border-emerald-200 bg-emerald-50 text-emerald-800':'border-amber-200 bg-amber-50 text-amber-900')}><strong>{balanced?ui("Assets equal liabilities plus equity."):'Difference: '+formatXAF(p.difference)}</strong>{!balanced&&<p className="mt-1 text-xs">{ui("Review the ledger and account classifications. No balancing amount has been added.")}</p>}{p.unclassified>0&&<p className="mt-1 text-xs">{p.unclassified}{ui(" posted account balances need a valid account classification.")}</p>}</footer>
  </section>;
}
