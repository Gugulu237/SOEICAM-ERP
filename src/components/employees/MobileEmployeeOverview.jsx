import React,{useEffect,useState} from 'react';
import {Link} from '@/lib/router';
import {ui,uiMessage,getLocale} from '@/lib/i18n';
import {businessDate} from '@/lib/business-date';
import {invokeFieldOps,errorMessage} from '@/lib/field-ops';
import {formatDate,formatAccountingXAF} from '@/lib/formatters';
import {Phone,PhoneCall,Mail,Pencil,FileText,ChevronLeft,ChevronRight,Info,CalendarDays} from 'lucide-react';

const validMonth=(value,current)=>/^\d{4}-(0[1-9]|1[0-2])$/.test(value)&&value<=current;
const amount=value=>typeof value==='number'&&Number.isFinite(value)?formatAccountingXAF(value):'—';
// Same exact-decimal percentage rounding used by the commission report. These
// per-customer figures are display-only estimates; the report owns the total.
export function employeeCustomerCommission(customer,agent){
 if(!agent?.configured||agent.commission_rate_percent==null||customer?.eligible_for_commission!==true)return null;
 const cents=Math.round(Number(customer.net_sales)*100),rate=Number(agent.commission_rate_percent);
 if(!Number.isSafeInteger(cents)||!Number.isFinite(rate)||rate<0||rate>100)return null;
 const [coefficient,exponentText='0']=String(rate).toLowerCase().split('e'),[whole,fraction='']=coefficient.split('.');
 let numerator=BigInt(whole+fraction),denominator=100n;const power=fraction.length-Number(exponentText);
 if(power>=0)denominator*=10n**BigInt(power);else numerator*=10n**BigInt(-power);
 const sign=cents<0?-1n:1n,value=BigInt(Math.abs(cents))*numerator;
 return Number(sign*((value+denominator/2n)/denominator))/100;
}

// équipe-et-profil.tsx, connected to checked monthly reports and the existing
// employee editor. Read-only status presentation never changes login access.
export default function MobileEmployeeOverview({employee,roleName,onEdit,accountLabel}){
 const current=businessDate(),[month,setMonth]=useState(()=>current.slice(0,7)),[report,setReport]=useState(null),[sales,setSales]=useState(null),[error,setError]=useState(''),[salesError,setSalesError]=useState(''),[loading,setLoading]=useState(false),[retry,setRetry]=useState(0);
 const commercial=employee.role==='commercial'||employee.assigned_role==='commercial',valid=validMonth(month,current.slice(0,7));
 useEffect(()=>{
  if(!commercial||!valid)return;let active=true;setLoading(true);setError('');setSalesError('');setReport(null);setSales(null);
  const from=month+'-01',last=new Date(Number(month.slice(0,4)),Number(month.slice(5,7)),0).getDate(),to=month===current.slice(0,7)?current:month+'-'+last;
  const invoke=async input=>{const response=await invokeFieldOps(input);if(response.data?.error)throw Error(response.data.error);return response.data;};
  Promise.allSettled([invoke({action:'customerCommissions',month,commercialId:employee.id}),invoke({action:'companySales',from,to})]).then(([commissionResult,salesResult])=>{
   if(!active)return;
   if(commissionResult.status==='fulfilled')setReport(commissionResult.value);else setError(errorMessage(commissionResult.reason));
   if(salesResult.status==='fulfilled')setSales(salesResult.value);else setSalesError(errorMessage(salesResult.reason));
   setLoading(false);
  });return()=>{active=false;};
 },[employee.id,commercial,month,current,valid,retry]);
 const agent=report?.agents?.find(row=>row.id===employee.id),customers=(report?.customers||[]).filter(row=>row.agent_id===employee.id);
 const approvedSupplies=sales?.rows?.filter(row=>row.commercial_id===employee.id&&row.source==='Commercial supply').reduce((total,row)=>total+Number(row.total||0),0);
 const target=Number(employee.monthly_supply_target),hasTarget=employee.monthly_supply_target!=null&&Number.isFinite(target)&&target>0;
 const progress=hasTarget&&approvedSupplies!=null?Math.min(100,Math.max(0,approvedSupplies/target*100)):null;
 const monthLabel=valid?new Date(month+'-01T12:00:00Z').toLocaleDateString(getLocale(),{month:'long',year:'numeric'}):'';
 const isActive=employee.status==='active',employmentLabel=isActive?ui('Active employee'):employee.status==='inactive'?ui('Inactive employee'):employee.status?ui('Employment status: {0}',ui(employee.status)):ui('Employment status not recorded');
 return <div data-sleek-screen="employee-profile" className="space-y-5 sm:hidden">
  <header className="flex items-center gap-3"><Link to="/team-workspaces?section=people" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border bg-white" aria-label={ui('All employees')}><ChevronLeft size={20}/></Link><div className="min-w-0"><h1 className="text-xl font-bold leading-tight">{ui('Team')}</h1><p className="text-xs text-muted-foreground">{ui('Employee profile')}</p></div></header>
  <section className="rounded-[22px] border bg-white p-4">
   <div className="flex items-center gap-3"><span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-secondary text-lg font-bold text-primary">{employee.full_name?.split(' ').filter(Boolean).map(word=>word[0]).slice(0,2).join('').toUpperCase()}</span><div className="min-w-0 flex-1"><h2 className="break-words text-lg font-bold">{employee.full_name}</h2><p className="text-sm font-semibold text-primary">{[ui(roleName),employee.department_name].filter(Boolean).join(' · ')}</p><p className="mt-1 text-xs text-muted-foreground">{employee.start_date?ui('Hired on {0}',formatDate(employee.start_date)):employee.employee_number||ui('Start date not recorded')}</p></div></div>
   <div className="mt-4 flex min-h-12 items-center justify-between gap-3 rounded-xl bg-secondary px-3"><span className="min-w-0"><strong className="block text-sm">{employmentLabel}</strong><span className="block text-[10px] text-muted-foreground">{accountLabel||ui('Not available')}</span></span><span aria-label={ui('Employment status: {0}',ui(employee.status||'Not recorded'))} role="img" className={'flex h-7 w-12 shrink-0 items-center rounded-full px-1 '+(isActive?'justify-end bg-primary':'bg-muted')}><span className="h-5 w-5 rounded-full border bg-white"/></span></div>
   <div className="mt-3 divide-y"><div className="flex min-h-14 items-center gap-3 py-2"><Phone size={20} className="shrink-0 text-muted-foreground"/><span className="min-w-0 flex-1"><span className="block text-xs text-muted-foreground">{ui('Phone')}</span><strong className="break-words text-sm tabular-nums">{employee.phone||ui('Not recorded')}</strong></span>{employee.phone&&<a href={'tel:'+employee.phone} aria-label={ui('Call employee')} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border"><PhoneCall size={18}/></a>}</div><div className="flex min-h-14 items-center gap-3 py-2"><Mail size={20} className="shrink-0 text-muted-foreground"/><span className="min-w-0"><span className="block text-xs text-muted-foreground">{ui('Email')}</span>{employee.email?<a href={'mailto:'+employee.email} className="break-all text-sm font-semibold">{employee.email}</a>:<strong className="text-sm">{ui('Not recorded')}</strong>}</span></div></div>
  </section>
  {commercial&&<>
   <div className="flex items-center justify-between gap-3"><h2 className="text-xs font-bold uppercase tracking-wide text-primary">{ui('Performance')} · {monthLabel}</h2><label className="relative flex h-12 min-w-0 shrink-0 items-center gap-2 rounded-xl border bg-white px-2 text-xs focus-within:ring-2 focus-within:ring-primary"><span aria-hidden="true" className="whitespace-nowrap">{valid?new Date(month+'-01T12:00:00').toLocaleDateString(getLocale(),{month:'short',year:'numeric'}):'—'}</span><CalendarDays size={16} aria-hidden="true" className="shrink-0"/><input type="month" aria-label={ui('Commission month')} max={current.slice(0,7)} value={month} onChange={event=>setMonth(event.target.value)} className="absolute inset-0 h-full w-full min-w-0 opacity-0"/></label></div>
   {!valid?<p role="alert" className="text-sm text-red-700">{ui('Choose the current month or an earlier valid month.')}</p>:loading?<p role="status" className="text-sm text-muted-foreground">{ui('Loading monthly commissions...')}</p>:<>
    <section className="space-y-3 rounded-[22px] border bg-white p-4"><div className="flex items-end justify-between gap-3"><div className="min-w-0"><p className="text-xs text-muted-foreground">{ui('Approved supplies this month')}</p><strong className="block break-words text-xl tabular-nums">{amount(approvedSupplies)}</strong></div>{progress!==null&&<strong className="text-sm text-primary tabular-nums">{Math.round(progress)} %</strong>}</div>{progress!==null&&<div className="h-2 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-label={ui('Monthly approved supplies target')} aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}><div className="h-full rounded-full bg-primary" style={{width:progress+'%'}}/></div>}<p className="text-xs text-muted-foreground">{hasTarget?ui('Monthly approved supplies target: {0}',amount(target)):ui('No monthly sales target configured')}</p>{salesError&&<p role="alert" className="text-xs text-red-700">{uiMessage(salesError)}</p>}<dl className="grid grid-cols-2 gap-3 border-t pt-3 text-sm"><div><dt className="text-[11px] text-muted-foreground">{ui('Customers acquired this month')}</dt><dd className="font-bold">{agent?.registered_customers??'—'}</dd></div><div><dt className="text-[11px] text-muted-foreground">{ui('Commission rate')}</dt><dd className="font-bold">{agent?.commission_rate_percent==null?ui('Not configured'):agent.commission_rate_percent.toLocaleString(getLocale())+' %'}</dd></div></dl></section>
    <section className="space-y-2"><div className="flex items-center justify-between gap-2"><h2 className="text-xs font-bold uppercase tracking-wide text-primary">{ui('Commissions on acquired customers')}</h2><span className="flex items-center gap-1 text-[11px] font-semibold text-amber-700"><Info size={14}/>{ui('Estimate')}</span></div>{error?<p role="alert" className="rounded-xl border p-3 text-sm text-red-700">{uiMessage(error)} <button type="button" className="min-h-11 font-semibold underline" onClick={()=>setRetry(value=>value+1)}>{ui('Retry')}</button></p>:<div className="overflow-hidden rounded-[22px] border bg-white"><div className="divide-y">{customers.map(customer=><div key={customer.report_key||customer.id} className="flex min-h-14 items-center justify-between gap-3 p-3"><span className="min-w-0 flex-1"><strong className="block break-words text-sm">{customer.business_name}</strong><span className="mt-1 block text-xs text-muted-foreground">{ui('Eligible net sales')}: {amount(customer.eligible_for_commission?customer.net_sales:0)}</span></span><strong className="shrink-0 text-sm tabular-nums">{amount(employeeCustomerCommission(customer,agent))}</strong></div>)}{!customers.length&&<p className="p-4 text-sm text-muted-foreground">{ui('No linked customers for this selection.')}</p>}{agent?.customer_bonus_estimate!=null&&agent.customer_bonus_estimate!==0&&<div className="flex min-h-14 items-center justify-between gap-3 p-3 text-sm"><span>{ui('Estimated customer bonus')}</span><strong>{amount(agent.customer_bonus_estimate)}</strong></div>}</div><div className="flex min-h-14 items-center justify-between gap-3 border-t bg-secondary p-3 text-sm font-bold text-primary"><span>{ui('Estimated total')}</span><strong className="tabular-nums">{amount(agent?.estimated_total)}</strong></div></div>}<p className="text-[11px] leading-4 text-muted-foreground">{ui('Estimate only. Management review is required before payroll or payment.')}</p></section>
   </>}
  </>}
  <div className="grid gap-2"><Link to={'/team-workspaces?section=payroll&employee='+encodeURIComponent(employee.id)} className="flex min-h-14 items-center justify-between gap-3 rounded-[22px] border bg-white px-4 text-sm font-semibold"><span className="flex items-center gap-2"><FileText size={20} className="text-primary"/>{ui('Employee payslips')}</span><ChevronRight size={18} className="text-muted-foreground"/></Link><button type="button" onClick={onEdit} className="flex min-h-12 items-center justify-center gap-2 rounded-[22px] border bg-white text-sm font-semibold"><Pencil size={18}/>{ui('Edit employee')}</button></div>
 </div>;
}
