'use client';
import React,{useEffect,useState} from 'react';
import {ui} from '@/lib/i18n';
import {useLocaleRender} from '@/lib/localization';
import {useCurrentUser} from '@/hooks/useCurrentUser';
import {Link} from '@/lib/router';
import {invokeFieldOps,errorMessage} from '@/lib/field-ops';
import {businessDate} from '@/lib/business-date';
import {formatXAF,formatNumber,formatDate} from '@/lib/formatters';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import HelpNotice from '@/components/shared/HelpNotice';
import {RefreshCw,ArrowUpRight} from 'lucide-react';
export default function Reports(){
 useLocaleRender();const {role,loading:authLoading}=useCurrentUser(),today=businessDate();
 const [range,setRange]=useState({from:today.slice(0,8)+'01',to:today}),[draft,setDraft]=useState(range),[data,setData]=useState(null),[busy,setBusy]=useState(true),[error,setError]=useState(''),[version,setVersion]=useState(0);
 useEffect(()=>{if(authLoading||role!=='admin')return;let active=true;setBusy(true);setError('');invokeFieldOps({action:'businessOverview',...range}).then(r=>{if(active)setData(r.data);}).catch(e=>{if(active)setError(errorMessage(e));}).finally(()=>{if(active)setBusy(false);});return()=>{active=false;};},[authLoading,role,range,version]);
 if(authLoading)return <p role="status">{ui('Loading reports...')}</p>;
 if(role!=='admin')return <p role="alert">{ui('Company reports are restricted to administrators.')}</p>;
 const cards=data?[['Sales revenue',data.sales],['Operating expenses',data.expenses],['Net profit',data.profit],['Available treasury balance',data.cash]]:[];
 const shortcuts=[['/sales','Sales report'],['/expenses','Expense report'],['/accounting/statements','Financial Statements'],['/accounting/cash-flow','Cash Flow & History'],['/accounting/receivables','Receivables'],['/accounting/payables','Payables'],['/sales?tab=outlets','Outlet Reports']];
 return <main className="min-w-0 space-y-5">
 <header className="flex items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-2"><h1 className="text-2xl font-bold">{ui('Reports')}</h1><HelpNotice title={ui('Company overview')}><p>{ui('Revenue, costs and profit use posted journals in the selected period. Drafts and rejected transactions are excluded. Profit includes posted payroll and other income. Unpaid invoices, supplier bills, inventory and treasury balances show the current position.')}</p><p>{ui('Purchases and cash payments are not subtracted a second time from posted profit. Open the detailed statements to review accounting entries.')}</p></HelpNotice></div><Button variant="outline" disabled={busy} onClick={()=>setVersion(v=>v+1)}><RefreshCw size={16} className={busy?'animate-spin':''}/><span className="ml-2">{ui('Refresh')}</span></Button></header>
 <form className="flex flex-wrap items-end gap-3" onSubmit={e=>{e.preventDefault();if(draft.from>draft.to){setError(ui('Choose a valid report period.'));return;}setRange({...draft});}}><label className="min-w-0 text-xs">{ui('From')}<Input type="date" max={today} required value={draft.from} onChange={e=>setDraft(d=>({...d,from:e.target.value}))}/></label><label className="min-w-0 text-xs">{ui('To')}<Input type="date" max={today} required value={draft.to} onChange={e=>setDraft(d=>({...d,to:e.target.value}))}/></label><Button disabled={busy} type="submit">{ui('Apply')}</Button></form>
 {error&&<p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
 {busy&&<p role="status" className="text-sm text-slate-500">{ui('Loading reports...')}</p>}
 {data&&<div aria-busy={busy} className={busy?'pointer-events-none space-y-5 opacity-60':'space-y-5'}>
 <section aria-label={ui('Company situation')} className="grid grid-cols-2 gap-3 xl:grid-cols-4">{cards.map(([title,value])=><div key={title} className="min-w-0 rounded-2xl border bg-white p-4"><p className="text-xs text-slate-500">{ui(title)}</p><p className={'mt-2 break-words text-xl font-bold '+(title==='Net profit'?(value<0?'text-red-700':'text-green-800'):'text-slate-900')}>{formatXAF(value)}</p>{title==='Sales revenue'&&<p className="mt-1 text-xs text-slate-500">{ui('Cost of sales: {0}',formatXAF(data.cogs))}</p>}{title==='Net profit'&&data.margin!==null&&<p className="mt-1 text-xs text-slate-500">{ui('Margin: {0}%',formatNumber(data.margin,1))}</p>}{title==='Net profit'&&data.other_income!==0&&<p className="mt-1 text-xs text-slate-500">{ui('Other income: {0}',formatXAF(data.other_income))}</p>}</div>)}</section>
 <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">{[['Unpaid invoices',data.unpaid_invoices.amount],['Overdue invoices',data.overdue_invoices.amount],['Unpaid supplier bills',data.unpaid_bills.amount],['Inventory value',data.inventory.amount]].map(([title,value])=><div key={title} className="min-w-0 rounded-xl border bg-white p-4"><p className="text-xs text-slate-500">{ui(title)}</p><p className="mt-2 break-words font-semibold">{formatXAF(value)}</p></div>)}</section>
 <div className="grid gap-4 lg:grid-cols-2"><section className="rounded-2xl border bg-white p-4"><h2 className="mb-3 font-semibold">{ui('Needs attention')}</h2><div className="divide-y">{[['/accounting/receivables','Overdue invoices',data.overdue_invoices.count],['/approvals','Expense approvals',data.pending_expenses.count],['/cashier','Commercial cash outstanding',formatXAF(data.commercial_cash.amount)],['/manufacturing','Active Production',data.active_production]].map(([to,title,value])=><Link key={title} to={to} className="flex min-h-12 items-center justify-between gap-3 py-3 text-sm"><span>{ui(title)}</span><span className="flex shrink-0 items-center gap-2 font-semibold">{value}<ArrowUpRight size={15}/></span></Link>)}</div></section>
 <section className="rounded-2xl border bg-white p-4"><h2 className="mb-3 font-semibold">{ui('Expense breakdown')}</h2>{data.expense_breakdown.length?data.expense_breakdown.map(row=><div key={row.name} className="flex justify-between gap-3 border-b py-3 text-sm last:border-0"><span className="min-w-0">{row.name}</span><span className="shrink-0 font-medium">{formatXAF(row.amount)}</span></div>):<p className="text-sm text-slate-500">{ui('No posted expenses in this period.')}</p>}</section></div>
 <section className="rounded-2xl border bg-white p-4"><h2 className="mb-3 font-semibold">{ui('Sales by day')}</h2>{data.sales_trend.length?<div className="max-h-64 divide-y overflow-y-auto">{data.sales_trend.map(row=><div key={row.date} className="flex justify-between gap-3 py-2 text-sm"><span>{formatDate(row.date)}</span><span className="font-medium">{formatXAF(row.amount)}</span></div>)}</div>:<p className="text-sm text-slate-500">{ui('No posted sales in this period.')}</p>}</section>
 <nav aria-label={ui('Detailed reports')} className="grid grid-cols-2 gap-2 sm:grid-cols-3">{shortcuts.map(([to,label])=><Link key={to} to={to} className="flex min-h-12 items-center justify-between gap-2 rounded-xl border bg-white p-3 text-sm font-medium">{ui(label)}<ArrowUpRight size={15} className="shrink-0"/></Link>)}</nav>
 </div>}
 </main>;
}
