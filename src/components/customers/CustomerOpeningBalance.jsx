'use client';
import React,{useEffect,useRef,useState} from 'react';
import {ui,uiMessage} from '@/lib/i18n';
import {useLocaleRender} from '@/lib/localization';
import {useCurrentUser} from '@/hooks/useCurrentUser';
import {invalidateERPReads} from '@/api/erpClient';
import {formatXAF} from '@/lib/formatters';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {BookOpen} from 'lucide-react';

async function call(id,body){
  const response=await fetch('/api/customers/'+encodeURIComponent(id)+'/opening-balance',{method:body?'POST':'GET',cache:'no-store',...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
  const data=await response.json();if(!response.ok||data.error)throw Error(data.error||'Opening balance could not be saved.');return data;
}
export default function CustomerOpeningBalance({customer,onSaved,disabled=false}){
  useLocaleRender();
  const {role,allowedModules,loading}=useCurrentUser(),[open,setOpen]=useState(false);
  if(loading||role!=='admin'||allowedModules&&!allowedModules.includes('accounting'))return null;
  return <div className="my-3"><Button type="button" variant="outline" disabled={disabled} onClick={()=>setOpen(true)}><BookOpen size={16} className="mr-2"/>{ui('Customer opening balance')}</Button>{open&&<OpeningDialog key={customer.id} customer={customer} onClose={()=>setOpen(false)} onSaved={onSaved}/>}</div>;
}
export function OpeningDialog({customer,onClose,onSaved}){
  const [data,setData]=useState(null),[loadError,setLoadError]=useState(''),[reload,setReload]=useState(0);
  const [amount,setAmount]=useState(''),[date,setDate]=useState(''),[due,setDue]=useState(''),[reference,setReference]=useState(''),[offset,setOffset]=useState('');
  const [review,setReview]=useState(false),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(null);
  const pending=useRef(false),key=useRef(crypto.randomUUID()),attempt=useRef(null);
  useEffect(()=>{let active=true;setData(null);setLoadError('');call(customer.id).then(d=>{if(active){setData(d);setDate(d.date);setDue(d.date);}}).catch(e=>{if(active)setLoadError(e.message);});return()=>{active=false;};},[customer.id,reload]);
  const valid=!!data?.can_enter&&Number(amount)>0&&Number(amount)<=1e12&&Number.isFinite(Number(amount))&&Math.abs(Number(amount)*100-Math.round(Number(amount)*100))<0.0001&&reference.trim()&&date&&date<=data.max_date&&due&&(data.mode==='attach'?Number(amount)<=data.available:!!offset);
  async function save(){
    if(pending.current||!valid||!confirmed||!review||saved)return;
    const fields={date,due_date:due,amount:Number(amount),reference:reference.trim(),mode:data.mode,account_id:data.account_id,offset_account_id:data.mode==='post'?offset:'',confirmed:true};
    const signature=JSON.stringify(fields);if(attempt.current&&attempt.current!==signature)key.current=crypto.randomUUID();attempt.current=signature;
    pending.current=true;setBusy(true);setError('');
    try{const result=await call(customer.id,{...fields,requestKey:key.current});setSaved(result);invalidateERPReads();onSaved?.(result);}
    catch(e){setError(e.message);}finally{pending.current=false;setBusy(false);}
  }
  return <Dialog open onOpenChange={value=>{if(!value&&!pending.current)onClose();}}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg" aria-describedby="customer-opening-description">
    <DialogHeader><DialogTitle>{ui('Customer opening balance')}</DialogTitle><DialogDescription id="customer-opening-description">{customer.business_name}</DialogDescription></DialogHeader>
    {loadError?<p role="alert" className="text-sm text-red-700">{uiMessage(loadError)} <button className="underline" onClick={()=>setReload(n=>n+1)}>{ui('Retry')}</button></p>:!data?<p role="status">{ui('Loading opening balance...')}</p>:saved?<div role="status" className="space-y-2 rounded-xl bg-green-50 p-4 text-sm"><p className="font-semibold">{ui('Opening balance recorded.')}</p><p>{formatXAF(saved.amount)} / {saved.date}</p><p>{ui('This customer cannot receive another opening balance. Collect payments through Receive payments.')}</p></div>:data.recorded?<div className="space-y-2 rounded-xl bg-slate-50 p-4 text-sm"><p className="font-semibold">{ui('Opening balance already recorded')}</p>{data.amount!=null&&<p>{formatXAF(data.amount)}</p>}{data.entries.map(entry=><p key={entry.id} className="text-xs">{entry.reference} / {formatXAF(entry.amount)} / {entry.date}</p>)}<p>{ui('This customer cannot receive another opening balance. Collect payments through Receive payments.')}</p></div>:!data.can_enter?<p role="alert" className="text-sm text-slate-700">{uiMessage(data.reason)}</p>:<>
      <p className="text-xs leading-5 text-slate-600">{ui('Enter the total this customer owed before using SOEICAM. This is recorded once and does not create a new sale or cash receipt.')}</p>
      {data.mode==='attach'&&<p className="rounded-lg bg-blue-50 p-3 text-xs">{ui('This balance will use the existing ledger opening amount, without posting it again. Remaining: {0}',formatXAF(data.available))}</p>}
      <fieldset disabled={busy||review} className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">{ui('Amount customer owes (XAF)')}<Input aria-label={ui('Amount customer owes (XAF)')} type="number" inputMode="decimal" min="0.01" step="0.01" max={data.mode==='attach'?data.available:1e12} value={amount} onChange={e=>setAmount(e.target.value)}/></label>
        <label className="text-sm">{ui('Opening date')}<Input aria-label={ui('Opening date')} type="date" value={date} max={data.max_date} disabled={data.date_locked} onChange={e=>{if(due===date)setDue(e.target.value);setDate(e.target.value);}}/></label>
        <label className="text-sm">{ui('Payment due date')}<Input aria-label={ui('Payment due date')} type="date" value={due} onChange={e=>setDue(e.target.value)}/></label>
        <label className="text-sm sm:col-span-2">{ui('Previous system reference')}<Input aria-label={ui('Previous system reference')} maxLength={100} value={reference} onChange={e=>setReference(e.target.value)}/></label>
        {data.mode==='post'&&<label className="min-w-0 text-sm sm:col-span-2">{ui('Opening counterpart account')}<select aria-label={ui('Opening counterpart account')} value={offset} onChange={e=>setOffset(e.target.value)} className="mt-1 h-11 w-full min-w-0 rounded-lg border bg-white px-2 text-sm"><option value="">{ui('Choose account')}</option>{data.offsets.map(a=><option key={a.id} value={a.id}>{a.number} / {a.name}</option>)}</select></label>}
      </fieldset>
      {review&&<div className="space-y-3 rounded-lg border p-3 text-sm"><p className="font-semibold">{customer.business_name} / {formatXAF(Number(amount))}</p><p>{date} / {reference}</p><p className="text-xs">{ui('Payment due date')}: {due}</p>{data.mode==='post'&&<p className="text-xs">{ui('Opening counterpart account')}: {data.offsets.find(a=>a.id===offset)?.name}</p>}<label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/><span>{ui('I confirm this is the full opening debt for this customer and has not already been entered.')}</span></label></div>}
    </>}
    {error&&<p role="alert" className="text-sm text-red-700">{uiMessage(error)}</p>}
    <div className="flex flex-wrap justify-end gap-2 border-t pt-3"><Button type="button" variant="outline" disabled={busy} onClick={onClose}>{ui(saved||data?.recorded?'Close':'Cancel')}</Button>{data?.can_enter&&!saved&&(review?<><Button type="button" variant="outline" disabled={busy} onClick={()=>{setReview(false);setConfirmed(false);}}>{ui('Back to edit')}</Button><Button type="button" disabled={busy||!valid||!confirmed} onClick={save}>{ui(busy?'Posting...':'Record opening balance')}</Button></>:<Button type="button" disabled={!valid} onClick={()=>setReview(true)}>{ui('Review before posting')}</Button>)}</div>
  </DialogContent></Dialog>;
}
