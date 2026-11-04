'use client';
import React,{useCallback,useEffect,useRef,useState} from 'react';
import {ui,uiMessage} from '@/lib/i18n';
import {useLocaleRender} from '@/lib/localization';
import {useNavigate} from '@/lib/router';
import {businessDate} from '@/lib/business-date';
import {formatXAF,formatDate} from '@/lib/formatters';
import {recurringExpenseRequest} from '@/lib/recurring-expense-client';
import PageHeader from '@/components/shared/PageHeader';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogFooter} from '@/components/ui/dialog';
import {CalendarClock,Search,Settings2,RefreshCw} from 'lucide-react';

export function ChargeDialog({row,data,onClose,onDone}){
  const [action,setAction]=useState(row.status==='pending'?'accrue':'pay'),[amount,setAmount]=useState(row.balance),[date,setDate]=useState(data.date),[treasury,setTreasury]=useState(''),[reference,setReference]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const running=useRef(false),requestKey=useRef(crypto.randomUUID());
  async function submit(event){
    event.preventDefault();if(running.current)return;running.current=true;setBusy(true);setError('');
    try{
      await recurringExpenseRequest({action,requestKey:requestKey.current,accountId:row.account_id,period:row.period,token:row.token,...(action==='pay'?{amount:Number(amount),date,treasuryAccountId:treasury,reference:reference.trim()}:{})});
      onDone();
    }catch(e){setError(e.message);}finally{running.current=false;setBusy(false);}
  }
  return <Dialog open onOpenChange={open=>{if(!open&&!running.current)onClose();}}><DialogContent className="w-[calc(100%-1rem)] max-w-md max-h-[90dvh] overflow-y-auto p-4 sm:p-6">
    <DialogHeader><DialogTitle className="break-words">{row.account_name}</DialogTitle><p className="text-sm text-slate-500">{row.period} · {row.supplier_name}</p></DialogHeader>
    <form onSubmit={submit} className="min-w-0 space-y-4"><fieldset disabled={busy} className="min-w-0 space-y-4">
      <p className="text-xl font-semibold">{formatXAF(row.balance)}</p>
      {row.status==='pending'&&<div className="grid grid-cols-2 gap-2"><Button type="button" variant={action==='accrue'?'default':'outline'} aria-pressed={action==='accrue'} onClick={()=>setAction('accrue')}>{ui('Accrue / pay later')}</Button><Button type="button" variant={action==='pay'?'default':'outline'} aria-pressed={action==='pay'} onClick={()=>setAction('pay')}>{ui('Pay now')}</Button></div>}
      <p className="text-xs text-slate-600">{ui(row.status==='pending'?'The expense is recorded once for this month. Any unpaid amount remains in Accounts Payable.':'This payment clears the payable. The expense will not be charged again.')}</p>
      {action==='pay'&&<>
        <label className="block text-sm">{ui('Pay from')}<select className="mt-1 h-11 w-full min-w-0 rounded-md border bg-white px-2" value={treasury} required onChange={e=>setTreasury(e.target.value)}><option value="">{ui('Choose...')}</option>{data.treasury.map(t=><option key={t.id} value={t.id}>{t.name} — {formatXAF(t.balance)}</option>)}</select></label>
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2"><label className="min-w-0 text-sm">{ui('Amount (XAF)')}<Input type="number" inputMode="decimal" required min="0.01" max={row.balance} step="0.01" value={amount} onChange={e=>setAmount(e.target.value)}/></label><label className="min-w-0 text-sm">{ui('Payment date')}<Input className="w-full min-w-0" type="date" required min={row.bill_date} max={data.date} value={date} onChange={e=>setDate(e.target.value)}/></label></div>
        <label className="block text-sm">{ui('Payment reference')}<Input required maxLength={200} value={reference} onChange={e=>setReference(e.target.value)}/></label>
      </>}
      {error&&<p role="alert" className="text-sm text-red-700">{uiMessage(error)}</p>}
      <DialogFooter className="gap-2"><Button variant="outline" type="button" onClick={onClose}>{ui('Cancel')}</Button><Button type="submit">{ui(busy?'Saving...':action==='pay'?'Confirm payment':'Confirm accrual')}</Button></DialogFooter>
    </fieldset></form>
  </DialogContent></Dialog>;
}

export default function RecurringExpenses(){
  useLocaleRender();const navigate=useNavigate(),[data,setData]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[query,setQuery]=useState(''),[filter,setFilter]=useState('pending'),[selected,setSelected]=useState(null);
  const alive=useRef(false),loadingRef=useRef(false);
  const load=useCallback(async()=>{if(loadingRef.current)return;loadingRef.current=true;setLoading(true);setError('');try{const value=await recurringExpenseRequest();if(alive.current)setData(value);}catch(e){if(alive.current)setError(e.message);}finally{loadingRef.current=false;if(alive.current)setLoading(false);}},[]);
  useEffect(()=>{alive.current=true;load();let day=businessDate();const check=()=>{const current=businessDate();if(current!==day){day=current;load();}};const timer=setInterval(check,60000);window.addEventListener('focus',check);return()=>{alive.current=false;clearInterval(timer);window.removeEventListener('focus',check);};},[load]);
  const rows=(data?.rows||[]).filter(r=>(filter==='all'||filter==='pending'&&r.status==='pending'||filter==='unpaid'&&r.status!=='pending'&&r.balance>0)&&[r.account_name,r.supplier_name,r.period].join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <main className="min-w-0 space-y-4">
    <PageHeader title={ui('Recurring expenses')} actions={<div className="flex flex-wrap gap-2"><Button variant="outline" onClick={load} disabled={loading} aria-label={ui('Refresh')}><RefreshCw size={16}/></Button>{data?.can_manage&&<Button variant="outline" onClick={()=>navigate('/accounting?tab=accounts')}><Settings2 size={16} className="mr-2"/>{ui('Expense accounts')}</Button>}</div>}/>
    {error&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{uiMessage(error)}</p>}
    {data&&<div className="rounded-xl border bg-white p-3"><span className="text-sm text-slate-600">{ui('Awaiting expense recognition')}</span><strong className="mt-1 block text-xl">{formatXAF(data.pending_total)}</strong><p className="mt-1 text-xs text-slate-500">{ui('Pending charges are not yet included in profit and loss. Pay or accrue them to complete the month.')}</p></div>}
    <div className="flex min-w-0 flex-wrap gap-2"><div className="relative min-w-0 flex-1"><Search size={16} className="absolute left-3 top-3 text-slate-400"/><Input aria-label={ui('Search recurring expenses')} className="pl-9" placeholder={ui('Search recurring expenses')} value={query} onChange={e=>setQuery(e.target.value)}/></div><select aria-label={ui('Expense status')} value={filter} onChange={e=>setFilter(e.target.value)} className="h-10 max-w-full rounded-md border bg-white px-2 text-sm"><option value="pending">{ui('To review')}</option><option value="unpaid">{ui('Accrued / unpaid')}</option><option value="all">{ui('All months')}</option></select></div>
    {loading?<p role="status">{ui('Loading...')}</p>:<div className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-3">{rows.map(row=><article key={row.id} className="min-w-0 rounded-xl border bg-white p-3"><div className="flex gap-3"><CalendarClock size={22} className="mt-1 shrink-0 text-emerald-700"/><div className="min-w-0 flex-1"><h2 className="break-words font-semibold">{row.account_name}</h2><p className="truncate text-xs text-slate-500">{row.supplier_name} · {row.period}</p></div></div><div className="mt-3 flex flex-wrap items-center justify-between gap-2"><strong>{formatXAF(row.status==='paid'?row.amount:row.balance)}</strong><span className="text-xs text-slate-500">{ui(row.status==='pending'?'To review':row.status==='paid'?'Paid':'Accrued / unpaid')}</span></div><p className="mt-1 text-xs text-slate-500">{ui('Due')} {formatDate(row.due_date)}</p>{row.status==='pending'&&row.blocked&&<p className="mt-2 text-xs text-red-700">{ui('Reactivate the expense account before posting.')}</p>}{data.can_manage&&(row.status==='pending'||row.balance>0)&&<Button className="mt-3 w-full" variant={row.status==='pending'?'default':'outline'} disabled={row.status==='pending'&&row.blocked||row.pending_payment} onClick={()=>setSelected(row)}>{ui(row.pending_payment?'Payment awaiting processing':row.status==='pending'?'Review charge':'Pay balance')}</Button>}</article>)}{!rows.length&&<p className="col-span-full rounded-xl border border-dashed p-6 text-center text-sm text-slate-500">{ui(data?.accounts?.some(a=>a.recurring_expense)?'No recurring charges in this view.':'Set a monthly rate on an expense account to get started.')}</p>}</div>}
    {selected&&<ChargeDialog row={selected} data={data} onClose={()=>setSelected(null)} onDone={()=>{setSelected(null);load();}}/>}
  </main>;
}
