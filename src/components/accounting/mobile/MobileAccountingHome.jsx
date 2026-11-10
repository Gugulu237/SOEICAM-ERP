import React,{useEffect,useState} from 'react';
import {BarChart3,BookOpen,NotebookPen,Wallet,Building2,CalendarClock,ChevronRight,RefreshCw,ClipboardCheck,ArrowLeft,HandCoins} from 'lucide-react';
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
import {canReadCashConfirmations,loadCashConfirmations} from '@/lib/cash-confirmations';

export default function MobileAccountingHome({preview=false}){
  const {role,principalRole,employee,allowedModules}=useCurrentUser();
  const canAdjust=canAdjustInventory(principalRole||role,employee,allowedModules);
  const today=businessDate(),month=new Date(today+'T12:00:00').toLocaleDateString(getLocale(),{month:'long',year:'numeric'});
  const canOpen=path=>canOpenFieldPath(role,path,allowedModules)&&permitsWorkspace(path,allowedModules);
  const financeEnabled=!preview&&canOpen('/accounting'),chargesEnabled=!preview&&['admin','cashier'].includes(role)&&canOpen('/accounting/recurring-expenses');
  const cashEnabled=!preview&&canOpen('/cashier')&&canReadCashConfirmations({principalRole,role,employee,allowedModules});
  const [data,setData]=useState(null),[charges,setCharges]=useState(null),[error,setError]=useState(''),[chargesError,setChargesError]=useState(''),[version,setVersion]=useState(0),[cash,setCash]=useState({data:null,error:''});
  useEffect(()=>{if(!financeEnabled)return;let active=true;setError('');setData(null);loadMobileAccountingSummary().then(v=>{if(active)setData(v);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[version,financeEnabled]);
  useEffect(()=>{if(!chargesEnabled)return;let active=true;setCharges(null);setChargesError('');recurringExpenseRequest().then(v=>{if(active)setCharges(v);}).catch(e=>{if(active)setChargesError(e.message);});return()=>{active=false;};},[version,chargesEnabled]);
  useEffect(()=>{if(!cashEnabled)return;let active=true;setCash({data:null,error:''});loadCashConfirmations({principalRole,role,employee,allowedModules},{date:today}).then(value=>{if(active)setCash({data:value,error:''});}).catch(cause=>{if(active)setCash({data:null,error:cause.message});});return()=>{active=false;};},[version,cashEnabled,today,principalRole,role,employee,allowedModules]);
  const reviewCharges=chargesEnabled?(charges?.rows||[]).filter(r=>r.status==='pending'||r.balance>0):[],cashRows=cashEnabled?cash.data?.rows||[]:[];
  const money=v=>v==null?'—':formatXAF(v);
  const links=[...(canAdjust?[["Quantity adjustments",'/accounting/inventory?view=adjustments',ClipboardCheck]]:[]),['Financial Statements','/accounting/statements',BarChart3],['Chart of Accounts','/accounting?tab=accounts',BookOpen],['Journal Entries','/accounting?tab=journals',NotebookPen],['Expenses','/expenses',Wallet],['Fixed Assets','/accounting/assets',Building2],['Recurring expenses','/accounting/recurring-expenses',CalendarClock]];
  return <div data-sleek-accounting-home className="space-y-5">
    <header className="flex items-center gap-3"><Link to="/" aria-label={ui('Return to your dashboard')} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border bg-white"><ArrowLeft size={20}/></Link><div className="min-w-0 flex-1"><h1 className="text-xl font-bold">{ui('Accounting')}</h1><p className="mt-1 text-xs capitalize text-muted-foreground">SOEICAM · {month}</p></div><Button variant="outline" className="min-h-10 max-w-28 gap-1 rounded-lg px-2 text-xs capitalize" aria-label={ui('Refresh')} onClick={()=>setVersion(v=>v+1)}><span className="truncate">{new Date(today+'T12:00:00').toLocaleDateString(getLocale(),{month:'long'})}</span><RefreshCw size={13} className="shrink-0"/></Button></header>
    {financeEnabled&&error&&<p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{uiMessage(error)}</p>}
    <section className="rounded-xl border bg-white p-4"><p className="text-xs text-muted-foreground">{ui('Net profit / loss')} · {month}</p><strong className="mt-1 block text-2xl font-bold tabular-nums text-primary">{money(financeEnabled?data?.netProfit:null)}</strong><p className="mt-1 text-[11px] text-muted-foreground">{ui('Posted journals')}</p><div className="mt-4 grid grid-cols-3 gap-2 border-t pt-3">{[['Treasury',data?.treasury],['Payables',data?.payables],['Receivables',data?.receivables]].map(([label,value])=><div key={label} className="min-w-0"><p className="text-[11px] text-muted-foreground">{ui(label)}</p><strong className="mt-1 block break-words text-xs tabular-nums">{money(financeEnabled?value:null)}</strong></div>)}</div></section>
    <section><h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-primary">{ui('Quick access')}</h2><div className="grid grid-cols-3 gap-3">{links.filter(([,path])=>canOpen(path)).map(([label,path,Icon])=><Link key={path} to={path} className="flex min-h-24 min-w-0 flex-col items-center justify-center gap-2 rounded-xl border bg-white p-2 text-center"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-50 text-primary"><Icon size={23}/></span><span className="text-[11px] font-semibold leading-4">{ui(label)}</span></Link>)}</div></section>
    {(chargesEnabled||cashEnabled)&&<section><h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-primary">{ui('To review')}</h2><div className="divide-y rounded-xl border bg-white">
      {cashRows.slice(0,3).map(row=><Link key={row.id} to="/cashier?section=handovers" className="flex min-h-16 items-center gap-3 p-3"><HandCoins size={20} className="shrink-0 text-primary"/><span className="min-w-0 flex-1"><strong className="block text-sm">{ui('Cash awaiting confirmation')}</strong><span className="block break-words text-xs text-muted-foreground">{row.name} · {row.reference}</span></span><span className="shrink-0 text-xs font-semibold tabular-nums">{formatXAF(row.amount)}</span><ChevronRight size={15}/></Link>)}
      {cashEnabled&&cashRows.length>3&&<Link to="/cashier?section=handovers" className="block min-h-11 p-3 text-xs font-semibold text-primary">{ui('Review cash receipts')} · {cashRows.length}</Link>}
      {cashEnabled&&!cash.data&&!cash.error&&<p role="status" className="p-4 text-xs text-muted-foreground">{ui('Loading cash confirmations...')}</p>}
      {cashEnabled&&cash.error&&<p role="alert" className="p-4 text-xs text-red-700">{uiMessage(cash.error)}</p>}
      {reviewCharges.slice(0,5).map(row=><Link key={row.id} to="/accounting/recurring-expenses" className="flex min-h-16 items-center gap-3 p-3"><CalendarClock size={20} className="shrink-0 text-primary"/><span className="min-w-0 flex-1"><strong className="block text-sm">{row.account_name}</strong><span className="block text-xs text-muted-foreground">{row.period} · {ui(row.status==='pending'?'To review':'Accrued / unpaid')}</span></span><span className="text-xs font-semibold tabular-nums">{formatXAF(row.balance)}</span><ChevronRight size={15}/></Link>)}
      {chargesEnabled&&chargesError&&<p role="alert" className="p-4 text-xs text-red-700">{uiMessage(chargesError)}</p>}
      {chargesEnabled&&!charges&&!chargesError&&<p role="status" className="p-4 text-xs text-muted-foreground">{ui('Loading recurring expenses...')}</p>}
      {chargesEnabled&&charges&&!reviewCharges.length&&<p className="p-4 text-sm text-muted-foreground">{ui('No recurring charges in this view.')}</p>}
      {cashEnabled&&cash.data&&!cashRows.length&&<p className="p-4 text-xs text-muted-foreground">{ui('No cash awaiting confirmation.')}</p>}
    </div></section>}
    <div className="flex flex-wrap gap-2">{[['Payments','/accounting?tab=payments'],['Periods','/accounting?tab=periods'],['Posting Rules','/accounting?tab=rules'],['Opening balances','/accounting/opening-position']].filter(([,path])=>role==='admin'&&canOpen(path)).map(([label,path])=><Link key={path} to={path} className="min-h-11 rounded-lg border px-3 py-3 text-xs font-semibold">{ui(label)}</Link>)}</div>
  </div>;
}
