import React,{useEffect,useRef,useState} from 'react';
import {ui,uiMessage,getLocale} from '@/lib/i18n';
import {invalidateERPReads} from '@/api/erpClient';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';

const amount=value=>new Intl.NumberFormat(getLocale(),{maximumFractionDigits:2}).format(Number(value))+' XAF';
export default function SupplierHistoricalSettlement({supplier,onClose,onSaved}){
  const [data,setData]=useState(null),[form,setForm]=useState({billIds:[],date:'',offsetAccountId:'',reference:''}),[review,setReview]=useState(null),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const flight=useRef(false),key=useRef('');
  const url='/api/suppliers/'+encodeURIComponent(supplier.id)+'/historical-settlement';
  useEffect(()=>{
    const controller=new AbortController();
    fetch(url,{credentials:'same-origin',cache:'no-store',signal:controller.signal}).then(async r=>{const value=await r.json();if(!r.ok)throw Error(value.error||'Unable to load supplier correction.');return value;}).then(value=>{setData(value);setForm(f=>({...f,date:value.date}));}).catch(e=>{if(e.name!=='AbortError')setError(e.message);});
    return()=>controller.abort();
  },[url]);
  const change=patch=>{setForm(f=>({...f,...patch}));setReview(null);setConfirmed(false);setError('');};
  async function submit(action){
    if(flight.current)return;flight.current=true;setBusy(true);setError('');
    try{
      const r=await fetch(url,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({...form,action,...(action==='post'?{token:review.token,requestKey:key.current,confirmed}: {})})});
      const value=await r.json();if(!r.ok)throw Error(value.error||'Supplier correction failed.');
      if(action==='preview'){key.current=crypto.randomUUID();setReview(value);setConfirmed(false);}
      else{invalidateERPReads();onSaved(value);onClose();}
    }catch(e){setError(e.message);}finally{flight.current=false;setBusy(false);}
  }
  return <Dialog open onOpenChange={open=>{if(!open&&!flight.current)onClose();}}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl"><DialogHeader><DialogTitle>{ui('Correct bills paid before migration')}</DialogTitle><DialogDescription>{supplier.name}</DialogDescription></DialogHeader>
    <p className="text-sm text-slate-600">{ui('Use once for supplier bills already paid before the new records began. This clears the payable through migration equity clearing without another cash payment, expense or stock movement.')}</p>
    {error&&<p role="alert" className="text-sm text-red-700">{uiMessage(error)}</p>}
    {!data&&!error&&<p>{ui('Loading supplier records...')}</p>}
    {data?.completed&&<p>{ui('This supplier already has a historical settlement correction.')}</p>}
    {data&&!data.completed&&!review&&<div className="space-y-4">
      <fieldset disabled={busy} className="space-y-3"><legend className="mb-2 text-sm font-semibold">{ui('Select bills already paid')}</legend>{data.bills.map(b=><label key={b.id} className="flex min-h-11 items-center gap-3 rounded border p-3 text-sm"><input type="checkbox" checked={form.billIds.includes(b.id)} disabled={!b.eligible} onChange={e=>change({billIds:e.target.checked?[...form.billIds,b.id]:form.billIds.filter(id=>id!==b.id)})}/><span className="flex-1">{b.number}<span className="block text-xs text-slate-500">{b.date}{!b.eligible?' · '+ui('Requires separate reconciliation'):''}</span></span><strong>{amount(b.balance)}</strong></label>)}</fieldset>
      {!data.bills.length&&<p>{ui('No unpaid registered bills.')}</p>}
      <label className="block space-y-1 text-sm"><span>{ui('Correction date')}</span><Input type="date" value={form.date} max={data.date} disabled={busy} onChange={e=>change({date:e.target.value})}/></label>
      <label className="block space-y-1 text-sm"><span>{ui('Migration equity clearing account')}</span><select className="min-h-11 w-full rounded-md border bg-white px-3" value={form.offsetAccountId} disabled={busy} onChange={e=>change({offsetAccountId:e.target.value})}><option value="">{ui('Select account')}</option>{data.accounts.map(a=><option key={a.id} value={a.id}>{a.number} · {a.name}</option>)}</select></label>
      <label className="block space-y-1 text-sm"><span>{ui('Previous payment or migration reference')}</span><Input value={form.reference} maxLength={500} disabled={busy} onChange={e=>change({reference:e.target.value})}/></label>
      <Button disabled={busy||!form.billIds.length||!form.date||!form.offsetAccountId||form.reference.trim().length<3} onClick={()=>submit('preview')}>{ui('Review correction')}</Button>
    </div>}
    {review&&<div className="space-y-4">
      <p className="text-sm font-semibold">{ui('Historical amount to clear')}: {amount(review.total)}</p>
      <ul className="space-y-1 text-sm">{review.bills.map(b=><li key={b.id}>{b.number}: {amount(b.balance)}</li>)}</ul>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><th className="text-left">{ui('Account')}</th><th>{ui('Debit')}</th><th>{ui('Credit')}</th></tr></thead><tbody>{review.lines.map(l=><tr key={l.account_id}><td className="py-2">{l.account}</td><td className="px-2 text-right">{amount(l.debit)}</td><td className="px-2 text-right">{amount(l.credit)}</td></tr>)}</tbody></table></div>
      <p className="text-xs text-slate-600">{review.date} · {review.reference}</p>
      <label className="flex items-start gap-3 text-sm"><input className="mt-1" type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/><span>{ui('I confirm these bills were already paid before ERP recording and no supplier debt remains. The clearing account will be reconciled with the complete opening trial balance.')}</span></label>
      <div className="flex flex-wrap gap-2"><Button disabled={busy||!confirmed} onClick={()=>submit('post')}>{ui(busy?'Saving...':'Confirm historical settlement')}</Button><Button variant="outline" disabled={busy} onClick={()=>{setReview(null);setConfirmed(false);}}>{ui('Back')}</Button></div>
    </div>}
    <Button variant="outline" disabled={busy} onClick={onClose}>{ui('Close')}</Button>
  </DialogContent></Dialog>;
}
