import React from 'react';
import {ui,getLocale} from '@/lib/i18n';
import {formatDate} from '@/lib/formatters';
import {Button} from '@/components/ui/button';
const money=value=>new Intl.NumberFormat(getLocale(),{maximumFractionDigits:2}).format(Number(value))+' XAF';

export default function PayrollSettlementPanel({lines,payments,selectedId,onSelect,onPay,canPay,disabled}) {
 const selected=lines.find(line=>line.id===selectedId),installments=selected?payments.filter(payment=>payment.payroll_line_id===selected.id).sort((a,b)=>String(b.payment_date).localeCompare(String(a.payment_date))||String(b.posted_at||'').localeCompare(String(a.posted_at||''))):[];
 return <section data-payroll-installments className="space-y-3 rounded-[22px] border bg-white p-4">
  <div><h2 className="font-semibold">{ui('Employee installments')}</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">{ui('Pay employees at different times. Each actual installment reduces that employee’s outstanding salary and the selected treasury balance.')}</p></div>
  <div className="flex flex-col gap-2 sm:flex-row sm:items-end"><label className="min-w-0 flex-1 space-y-1 text-xs font-semibold"><span>{ui('Employee settlement')}</span><select aria-label={ui('Employee settlement')} value={selectedId} onChange={event=>onSelect(event.target.value)} disabled={disabled} className="h-12 w-full rounded-xl border bg-white px-3 text-sm"><option value="">{ui('Choose an employee')}</option>{lines.map(line=><option key={line.id} value={line.id}>{line.employee_current_name||line.employee_name} · {ui('Outstanding')} {money(line.outstanding_amount)}</option>)}</select></label>{canPay&&<Button className="min-h-12" disabled={disabled||!selected||Number(selected.outstanding_amount)<=0} onClick={()=>onPay(selected)}>{ui('Pay selected')}</Button>}</div>
  {selected&&<>
   <dl className="grid grid-cols-3 gap-3 rounded-xl bg-secondary p-3 text-xs">{[['Approved net',selected.net_pay],['Already paid',selected.amount_paid],['Still payable',selected.outstanding_amount]].map(([label,value])=><div key={label} className="min-w-0"><dt className="text-muted-foreground">{ui(label)}</dt><dd className="mt-1 break-words font-semibold tabular-nums">{money(value)}</dd></div>)}</dl>
   <div className="space-y-2"><h3 className="text-xs font-semibold">{ui('Recorded installments')}</h3>{installments.map(payment=><div key={payment.id} className="flex items-start justify-between gap-3 rounded-xl border p-3 text-xs"><div className="min-w-0"><strong className="block">{formatDate(payment.payment_date)} · {payment.treasury_account_name}</strong><p className="mt-1 break-words text-muted-foreground">{payment.reference} · {payment.payment_number}</p></div><strong className="shrink-0 tabular-nums">{money(payment.amount)}</strong></div>)}{!installments.length&&<p className="text-xs text-muted-foreground">{ui('No salary installments recorded for this employee in this run.')}</p>}</div>
  </>}
 </section>;
}
