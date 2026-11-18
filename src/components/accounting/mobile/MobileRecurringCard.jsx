import React from 'react';
import {ui} from '@/lib/i18n';
import {formatXAF,formatDate} from '@/lib/formatters';
import {Button} from '@/components/ui/button';
import {Check,Clock3,HandCoins} from 'lucide-react';
export default function MobileRecurringCard({row,canManage,onSelect}){
 const pending=row.status==='pending',disabled=pending&&row.blocked||row.pending_payment;
 return <article data-mobile-recurring-card className="rounded-xl border bg-card p-3">
  <div className="flex items-start justify-between gap-2">
   <div className="min-w-0 flex-1"><h2 className="break-words text-sm font-semibold">{row.account_name}</h2><p className="mt-1 text-xs text-muted-foreground">{ui('Due')} {formatDate(row.due_date)} · {formatXAF(row.amount)} {ui('/ month')}</p>{row.account_number&&<p className="mt-0.5 text-[11px] text-muted-foreground">{ui('Account')} {row.account_number} · {row.account_name}</p>}</div>
   <span className={'shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold '+(pending?'bg-muted text-foreground':'bg-secondary text-primary')}>{ui(pending?'To review':row.status==='paid'?'Paid':'Accrued')}</span>
  </div>
  <div className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-muted p-2 text-xs"><span className="min-w-0 break-words text-muted-foreground">{row.period} · {row.supplier_name}{!pending&&row.bill_date&&<> · {formatDate(row.bill_date)}</>}</span><strong className="shrink-0 tabular-nums">{formatXAF(row.status==='paid'?row.amount:row.balance)}</strong></div>
  {pending&&row.blocked&&<p className="mt-2 text-xs text-destructive">{ui(row.blocked_reason||(row.payroll_managed?'Salaries are managed in Payroll.':'Reactivate the expense account before posting.'))}</p>}
  {canManage&&(pending||row.balance>0)&&<div className="mt-3 grid grid-cols-2 gap-2"><Button variant={pending?'default':'outline'} className="min-h-12 gap-1 rounded-lg px-2 text-xs" disabled={!pending||disabled} onClick={()=>onSelect({...row,preferredAction:'accrue'})}>{pending?<Clock3 size={16} className="shrink-0"/>:<Check size={16} className="shrink-0"/>}{ui(pending?'Accrue / pay later':'Accrued')}</Button><Button variant={pending?'outline':'default'} className="min-h-12 gap-1 rounded-lg px-2 text-xs" disabled={disabled} onClick={()=>onSelect({...row,preferredAction:'pay'})}><HandCoins size={16} className="shrink-0"/>{ui(row.pending_payment?'Pending':'Pay balance')}</Button></div>}
 </article>;
}
