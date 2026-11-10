import React from 'react';
import { ChevronRight } from 'lucide-react';
import { ui,getLocale } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
const money=value=>new Intl.NumberFormat(getLocale(),{maximumFractionDigits:2}).format(Number(value||0))+' XAF';
export default function MobilePayslipCard({line,posted,editable,canPay,disabled,onOpen,onPay}) {
  const name=line.employee_current_name||line.employee_name||ui('Employee');
  const base=Number(line.requested_base_salary??line.base_salary??0),difference=Number(line.net_pay||0)-base;
  return <article className="rounded-xl border bg-white p-3"><button type="button" disabled={disabled} onClick={onOpen} className="flex w-full min-w-0 items-center gap-3 text-left"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-bold text-primary">{name.split(/\s+/).map(part=>part[0]).slice(0,2).join('')}</span><span className="min-w-0 flex-1"><span className="block break-words text-sm font-semibold">{name}</span><span className="mt-1 block text-xs text-muted-foreground">{ui(line.employee_role_label||'')} · {ui('Base')} {money(base)}</span></span><span className="max-w-[36%] shrink-0 text-right"><strong className="block break-words text-sm tabular-nums">{money(line.net_pay)}</strong><span className="text-[11px] text-muted-foreground">{ui('Net payable')}</span></span><ChevronRight size={16} className="shrink-0 text-muted-foreground"/></button>
    {(difference!==0||line.adjustment_reason)&&<div className="mt-3 rounded-lg bg-secondary px-3 py-2 text-xs"><strong className={difference<0?'text-red-700':'text-primary'}>{difference>0?'+':''}{money(difference)}</strong><span className="text-muted-foreground"> · {line.adjustment_reason||ui('Net change from requested base')}</span></div>}
    <div className="mt-3 flex flex-wrap gap-2 text-[11px]"><span className="rounded-md border px-2 py-1 font-semibold">{posted?ui('Approved'):line.payroll_reviewed_by?ui('Reviewed'):ui('Review required')}</span><span className="rounded-md bg-secondary px-2 py-1 text-muted-foreground">{posted?Number(line.outstanding_amount)===0?ui('Paid'):ui('Awaiting payment'):ui('Not paid')}</span></div>
    <div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={disabled} onClick={onOpen}>{editable?ui('Review payslip'):ui('View payslip')}</Button>{canPay&&Number(line.outstanding_amount)>0&&<Button size="sm" disabled={disabled} onClick={onPay}>{ui('Pay salary')}</Button>}</div>
  </article>;
}
