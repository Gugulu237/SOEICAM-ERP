import React,{useEffect,useMemo,useState} from 'react';
import {Gift,RotateCcw,Info,RefreshCw,ArrowLeft} from 'lucide-react';
import {ui,uiMessage,getLocale} from '@/lib/i18n';
import {businessDate} from '@/lib/business-date';
import {formatXAF,formatDate,formatQuantity} from '@/lib/formatters';
import {invokeFieldOps,errorMessage} from '@/lib/field-ops';
import {erp} from '@/api/erpClient';
import {readAll} from '@/lib/field-pos';
import {useNavigate} from '@/lib/router';
import {useCurrentUser} from '@/hooks/useCurrentUser';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import CentralDegustationForm from '@/components/distribution/CentralDegustationForm';

export default function PromotionExchangeHistory({readOnly=false,onBack}){
 const today=businessDate(),navigate=useNavigate(),{user,employee,role,principalRole,loading:authLoading}=useCurrentUser();
 const manager=(principalRole||role)==='admin';
 const [month,setMonth]=useState(today.slice(0,7)),[employeeId,setEmployeeId]=useState(''),[customerId,setCustomerId]=useState(''),[kind,setKind]=useState('all'),[result,setResult]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[reload,setReload]=useState(0),[giving,setGiving]=useState(false);
 const validMonth=/^\d{4}-(0[1-9]|1[0-2])$/.test(month)&&month<=today.slice(0,7),from=(validMonth?month:today.slice(0,7))+'-01',last=new Date(Date.UTC(Number(from.slice(0,4)),Number(from.slice(5,7)),0)).toISOString().slice(0,10),to=last>today?today:last;
 const scope=[user?.id,employee?.id,principalRole||role,from,to,reload].join(':'),data=result?.scope===scope?result.data:null;
 useEffect(()=>{
  if(authLoading)return;let active=true;setLoading(true);setError('');setResult(null);
  if(!validMonth){setError(ui('Choose the current month or an earlier valid month.'));setLoading(false);return;}
  Promise.all([
   invokeFieldOps({action:'centralDegustationHistory',from,to,...(manager?{allEmployees:true}:{})}).then(({data:value})=>{if(value?.error)throw Error(value.error);return value;}),
   readAll(erp.entities.SpoilageRecord,{status:'replaced',replacement_date:{$gte:from,$lte:to}},'-replacement_date'),
  ]).then(([history,rows])=>{if(active){const own=history.employeeId||history.employee?.id;setResult({scope,data:{...history,exchanges:manager?rows:rows.filter(row=>row.commercial_id===own||row.recorded_by===own)}});}}).catch(e=>{if(active)setError(errorMessage(e));}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[authLoading,from,to,validMonth,manager,scope]);
 const costs=data?.costs_visible===true,giveaways=data?.records||[],exchanges=data?.exchanges||[];
 const history=useMemo(()=>[
  ...giveaways.map(record=>({...record,kind:'degustation',value:costs?record.cost:undefined,quantity:record.lines.reduce((n,line)=>n+Number(line.quantity||0),0),description:record.lines.map(line=>`${formatQuantity(line.quantity)} × ${line.product_name}`).join(' · ')})),
  ...exchanges.map(row=>({id:row.id,kind:'exchange',customer_id:row.customer_id,customer_name:row.customer_name,employee_id:row.commercial_id||'',employee_name:row.commercial_name,employee_match_ids:[row.commercial_id,row.recorded_by].filter(Boolean),date:row.replacement_date,reference:row.receipt_reference||row.record_number,value:costs?row.replacement_cost:undefined,quantity:row.quantity,description:`${formatQuantity(row.quantity)} × ${row.product_name}`,source_order_id:row.source_order_id})),
 ].sort((a,b)=>String(b.date).localeCompare(String(a.date))),[giveaways,exchanges,costs]);
 const choices=useMemo(()=>{
  const people=new Map((data?.employees||[]).map(row=>[row.id,row])),customers=new Map((data?.customers||[]).map(row=>[row.id,row]));
  for(const row of history){if(row.employee_id&&!people.has(row.employee_id))people.set(row.employee_id,{id:row.employee_id,full_name:row.employee_name||''});if(row.customer_id&&!customers.has(row.customer_id))customers.set(row.customer_id,{id:row.customer_id,business_name:row.customer_name||''});}
  return {employees:[...people.values()].slice(0,500),customers:[...customers.values()].slice(0,500),limited:data?.filter_choices_truncated||people.size>500||customers.size>500};
 },[data,history]);
 const selectedEmployee=manager?employeeId:'',scoped=history.filter(row=>(!selectedEmployee||row.employee_id===selectedEmployee||row.employee_match_ids?.includes(selectedEmployee))&&(!customerId||row.customer_id===customerId)),filtered=scoped.filter(row=>kind==='all'||row.kind===kind);
 const aggregate=manager&&!employeeId,canRecord=!readOnly&&!aggregate;
 const total=type=>{const rows=filtered.filter(row=>row.kind===type);return rows.some(row=>row.value==null)?null:rows.reduce((n,row)=>n+Number(row.value||0),0);};
 return <section data-sleek-promotion-history className="space-y-4 pb-24">
  <header className="flex items-center gap-3"><Button variant="outline" size="icon" className="h-12 w-12 shrink-0 rounded-xl" aria-label={ui('Back')} onClick={()=>onBack?onBack():navigate('/sales?tab=all')}><ArrowLeft size={20}/></Button><div className="min-w-0"><h1 className="text-xl font-bold leading-tight">{ui('Dégustations & exchanges')}</h1><p className="mt-1 text-xs text-muted-foreground">{new Intl.DateTimeFormat(getLocale(),{month:'long',year:'numeric'}).format(new Date(from+'T12:00:00Z'))}</p></div></header>
  <div className="flex items-start gap-2 rounded-lg border border-l-4 border-l-primary bg-secondary px-3 py-2 text-xs font-semibold text-primary"><Info size={16} className="shrink-0"/>{ui('Dégustation costs are recorded as marketing expense.')}</div>
  <div className="grid grid-cols-2 gap-4 rounded-xl border bg-secondary p-4">{[['degustation','Dégustation cost'],['exchange','Replacement cost']].map(([key,label])=><div key={key}><p className="text-xs text-muted-foreground">{ui(costs?label:key==='degustation'?'Dégustation':'Exchanges')}</p><strong className="mt-1 block text-lg tabular-nums">{loading||error||!data?'—':costs?total(key)==null?'—':formatXAF(total(key)):filtered.filter(row=>row.kind===key).length}</strong></div>)}</div>
  <nav aria-label={ui('History types')} className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1">{[['all','All'],['degustation','Dégustation'],['exchange','Exchanges']].map(([key,label])=><button type="button" key={key} aria-pressed={kind===key} onClick={()=>setKind(key)} className={'min-h-11 rounded-lg text-xs font-semibold '+(kind===key?'border bg-white':'text-muted-foreground')}>{ui(label)} · {!data||error?'—':scoped.filter(row=>key==='all'||row.kind===key).length}</button>)}</nav>
  <div className="grid grid-cols-2 gap-2"><label className="text-xs text-muted-foreground">{ui('Period')}<Input type="month" aria-label={ui('Period')} value={month} max={today.slice(0,7)} onChange={e=>{if(e.target.value){setMonth(e.target.value);setEmployeeId('');setCustomerId('');}}} className="mt-1 h-12"/></label><label className="text-xs text-muted-foreground">{ui('Customer')}<select aria-label={ui('Customer')} value={customerId} onChange={e=>setCustomerId(e.target.value)} className="mt-1 h-12 w-full rounded-xl border bg-white px-2 text-sm"><option value="">{ui('All customers')}</option>{choices.customers.map(customer=><option key={customer.id} value={customer.id}>{customer.business_name||ui('Customer')}</option>)}</select></label></div>
  {manager&&data?.canChooseEmployee&&<label className="block text-xs text-muted-foreground">{ui('History employee')}<select aria-label={ui('History employee')} className="mt-1 h-12 w-full rounded-xl border bg-white px-3 text-sm" value={employeeId} onChange={e=>{setEmployeeId(e.target.value);setCustomerId('');}}><option value="">{ui('All employees')}</option>{choices.employees.map(employee=><option key={employee.id} value={employee.id}>{employee.full_name||ui('Employee')}</option>)}</select></label>}
  {aggregate&&data&&<p className="text-xs text-muted-foreground">{ui('All employees · read-only history.')}</p>}
  {manager&&data&&<p className="text-xs text-muted-foreground">{ui('Employee selection filters history only. The Dégustation form separately confirms the recording employee.')}</p>}
  {choices.limited&&<p role="status" className="text-xs text-muted-foreground">{ui('Filter choices are limited to 500 per list. All history rows remain included; narrow the period for more specific choices.')}</p>}
  {data?.employee&&<p className="text-xs text-muted-foreground">{ui('Recorded under profile')}: <strong>{data.employee.full_name}</strong></p>}
  {error&&<p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">{uiMessage(error)} <button className="underline" type="button" onClick={()=>setReload(n=>n+1)}>{ui('Retry')}</button></p>}
  {loading?<p role="status" className="p-6 text-sm text-muted-foreground">{ui('Loading history...')}</p>:!error&&<><h2 className="text-xs font-bold uppercase tracking-wider text-primary">{ui('History')}</h2><div className="space-y-2">{filtered.map(row=><article key={row.kind+row.id} className="flex items-start gap-3 rounded-xl border bg-white p-3"><div className="min-w-0 flex-1"><span className="inline-block rounded-md bg-secondary px-2 py-0.5 text-[11px] font-semibold text-primary">{ui(row.kind==='degustation'?'Dégustation':'Exchange · no sale')}</span><p className="mt-1 text-sm font-semibold">{row.customer_name||ui('No specific customer')}</p><p className="mt-1 break-words text-[11px] leading-5 text-muted-foreground">{row.description} · {formatDate(row.date)} · {row.employee_attribution_missing?ui('Employee not recorded'):row.employee_name||ui('Employee not recorded')}</p>{row.reference&&<p className="mt-1 text-[11px] text-muted-foreground">{row.reference}</p>}</div>{costs&&<strong className="shrink-0 text-xs tabular-nums">{row.value==null?'—':formatXAF(row.value)}</strong>}</article>)}{!filtered.length&&<p className="p-6 text-center text-sm text-muted-foreground">{ui('No records for these filters.')}</p>}</div></>}
  <Button type="button" variant="ghost" disabled={loading} onClick={()=>setReload(n=>n+1)}><RefreshCw size={15} className="mr-2"/>{ui('Refresh')}</Button>
  {canRecord&&<div data-mobile-action-bar className="fixed inset-x-0 bottom-[calc(64px_+_env(safe-area-inset-bottom))] z-30 border-t bg-white p-3 sm:static sm:border-0"><div className="mx-auto grid max-w-lg grid-cols-2 gap-2"><Button variant="outline" className="min-h-14 rounded-xl" onClick={()=>setGiving(true)}><Gift size={18} className="mr-2"/>{ui('Dégustation')}</Button><Button className="min-h-14 rounded-xl" onClick={()=>navigate('/sales/new?purpose=exchange')}><RotateCcw size={18} className="mr-2"/>{ui('Exchange')}</Button></div></div>}
  {giving&&canRecord&&<CentralDegustationForm onClose={()=>setGiving(false)} onSaved={()=>{setGiving(false);setReload(n=>n+1);}}/>}
 </section>;
}
