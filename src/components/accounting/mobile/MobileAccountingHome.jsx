import React,{useEffect,useState} from 'react';
import {BarChart3,BookOpen,NotebookPen,Wallet,Building2,CalendarClock,ChevronRight,RefreshCw,ClipboardCheck} from 'lucide-react';
import {Link} from '@/lib/router';
import {ui,uiMessage,getLocale} from '@/lib/i18n';
import {useCurrentUser} from '@/hooks/useCurrentUser';
import {formatXAF} from '@/lib/formatters';
import {businessDate} from '@/lib/business-date';
import {canOpenFieldPath} from '@/lib/permissions';
import {permitsWorkspace} from '@/lib/workspace-navigation';
import {canAdjustInventory} from '@/lib/inventory-adjustment-access';
import {loadMobileAccountingSummary} from '../loadMobileAccountingSummary';
import {recurringExpenseRequest} from '@/lib/recurring-expense-client';
import {Button} from '@/components/ui/button';

export default function MobileAccountingHome(){
  const {role,principalRole,employee,allowedModules}=useCurrentUser();
  const canAdjust=canAdjustInventory(principalRole||role,employee,allowedModules);
  const [data,setData]=useState(null),[charges,setCharges]=useState(null),[error,setError]=useState(''),[version,setVersion]=useState(0);
  useEffect(()=>{let active=true;setError('');loadMobileAccountingSummary().then(v=>{if(active)setData(v);}).catch(e=>{if(active)setError(e.message);});recurringExpenseRequest().then(v=>{if(active)setCharges(v);}).catch(()=>{});return()=>{active=false;};},[version]);
  const today=businessDate(),month=new Date(today+'T12:00:00').toLocaleDateString(getLocale(),{month:'long',year:'numeric'});
  const canOpen=path=>canOpenFieldPath(role,path,allowedModules)&&permitsWorkspace(path,allowedModules);
  const money=v=>v==null?'—':formatXAF(v);
  const links=[...(canAdjust?[["Quantity adjustments",'/accounting/inventory?view=adjustments',ClipboardCheck]]:[]),['Financial Statements','/accounting/statements',BarChart3],['Chart of Accounts','/accounting?tab=accounts',BookOpen],['Journal Entries','/accounting?tab=journals',NotebookPen],['Expenses','/expenses',Wallet],['Fixed Assets','/accounting/assets',Building2],['Recurring expenses','/accounting/recurring-expenses',CalendarClock]];
  return <div data-sleek-accounting-home className="space-y-5">
    <div className="flex items-center justify-between gap-3"><div><h1 className="text-xl font-bold">{ui('Accounting')}</h1><p className="mt-1 text-xs capitalize text-muted-foreground">SOEICAM · {month}</p></div><Button size="icon" variant="outline" aria-label={ui('Refresh')} onClick={()=>setVersion(v=>v+1)}><RefreshCw size={17}/></Button></div>
    {error&&<p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{uiMessage(error)}</p>}
    <section className="rounded-xl border bg-white p-4"><p className="text-xs text-muted-foreground">{ui('Net profit / loss')} · {month}</p><strong className="mt-1 block text-2xl font-bold tabular-nums text-primary">{money(data?.netProfit)}</strong><p className="mt-1 text-[11px] text-muted-foreground">{ui('Posted journals')}</p><div className="mt-4 grid grid-cols-3 gap-2 border-t pt-3">{[['Treasury',data?.treasury],['Payables',data?.payables],['Receivables',data?.receivables]].map(([label,value])=><div key={label} className="min-w-0"><p className="text-[11px] text-muted-foreground">{ui(label)}</p><strong className="mt-1 block break-words text-xs tabular-nums">{money(value)}</strong></div>)}</div></section>
    <section><h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-primary">{ui('Quick access')}</h2><div className="grid grid-cols-3 gap-3">{links.filter(([,path])=>canOpen(path)).map(([label,path,Icon])=><Link key={path} to={path} className="flex min-h-24 min-w-0 flex-col items-center justify-center gap-2 rounded-xl border bg-white p-2 text-center"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-50 text-primary"><Icon size={23}/></span><span className="text-[11px] font-semibold leading-4">{ui(label)}</span></Link>)}</div></section>
    {canOpen('/accounting/recurring-expenses')&&<section><h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-primary">{ui('To review')}</h2><div className="divide-y rounded-xl border bg-white">{charges?.rows?.filter(r=>r.status==='pending'||r.balance>0).slice(0,5).map(row=><Link key={row.id} to="/accounting/recurring-expenses" className="flex min-h-16 items-center gap-3 p-3"><CalendarClock size={20} className="shrink-0 text-primary"/><span className="min-w-0 flex-1"><strong className="block text-sm">{row.account_name}</strong><span className="block text-xs text-muted-foreground">{row.period} · {ui(row.status==='pending'?'To review':'Accrued / unpaid')}</span></span><span className="text-xs font-semibold tabular-nums">{formatXAF(row.balance)}</span><ChevronRight size={15}/></Link>)}{charges&&!charges.rows?.some(r=>r.status==='pending'||r.balance>0)&&<p className="p-4 text-sm text-muted-foreground">{ui('No recurring charges in this view.')}</p>}{!charges&&<p className="p-4 text-xs text-muted-foreground">{ui('Loading recurring expenses...')}</p>}</div></section>}
    <div className="flex flex-wrap gap-2">{[['Payments','/accounting?tab=payments'],['Periods','/accounting?tab=periods'],['Posting Rules','/accounting?tab=rules'],['Opening balances','/accounting/opening-position']].filter(([,path])=>role==='admin'&&canOpen(path)).map(([label,path])=><Link key={path} to={path} className="min-h-11 rounded-lg border px-3 py-3 text-xs font-semibold">{ui(label)}</Link>)}</div>
  </div>;
}
