'use client';
import React,{useEffect,useState} from 'react';
import {ui,uiMessage} from '@/lib/i18n';
import {useLocaleRender} from '@/lib/localization';
import {invokeFieldOps,errorMessage} from '@/lib/field-ops';
import {statusLabel} from '@/lib/formatters';
import {Button} from '@/components/ui/button';
const labels={pending:'Awaiting review',investigate:'Investigate cause',collect_for_verification:'Collect for verification',monitor:'Monitor next delivery',resolved:'Follow-up completed'};
async function call(body){const {data}=await invokeFieldOps(body);if(data.error)throw Error(data.error);return data;}
export default function CustomerSpoilageReports({customer,reload=0}){
  useLocaleRender();
  const [data,setData]=useState(null),[error,setError]=useState(''),[version,setVersion]=useState(0),[limit,setLimit]=useState(10);
  useEffect(()=>{let active=true;setError('');call({action:'customerSpoilageWorkspace',customerId:customer.id}).then(d=>{if(active)setData(d);}).catch(e=>{if(active)setError(errorMessage(e));});return()=>{active=false;};},[customer.id,reload,version]);
  const pending=data?.reports.filter(r=>r.review_status!=='resolved')||[];
  const causes=Object.entries((data?.reports||[]).reduce((a,r)=>({...a,[r.reason]:(a[r.reason]||0)+1}),{})).sort((a,b)=>b[1]-a[1]);
  return <section aria-label={ui('Spoilage reports and follow-up')} className="space-y-3 rounded-xl border bg-white p-4">
    <h3 className="font-semibold">{ui('Spoilage reports and follow-up')}</h3>
    {error?<p role="alert" className="text-sm text-red-700">{uiMessage(error)} <button className="underline" onClick={()=>setVersion(n=>n+1)}>{ui('Retry')}</button></p>:!data?<p role="status" className="text-sm">{ui('Loading reports...')}</p>:<>
      <div className="grid grid-cols-2 gap-3 text-sm"><div className="rounded-lg bg-amber-50 p-3"><p className="text-xs text-slate-600">{ui('Awaiting follow-up')}</p><strong>{pending.length}</strong></div><div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-600">{ui('Most reported cause')}</p><strong>{causes.length?statusLabel(causes[0][0]):'—'}</strong></div></div>
      {!data.reports.length&&<p className="text-sm text-slate-500">{ui('No spoilage reports for this customer.')}</p>}
      {data.reports.slice(0,limit).map(r=><details key={r.id} className="rounded-lg border p-3">
        <summary className="cursor-pointer text-sm"><strong>{r.product_name}</strong> · {r.quantity} {r.unit}<span className="mt-1 block text-xs text-slate-500">{r.reported_date} · {statusLabel(r.reason)} · {ui(labels[r.review_status]||'Awaiting review')}</span></summary>
        <div className="mt-3 space-y-2 text-sm"><p>{r.location_name}</p><p className="whitespace-pre-wrap">{r.notes}</p><p className="text-xs text-slate-500">{r.record_number} · {ui('Reported by')} {r.recorded_by_name}</p>{(r.batch_number||r.expiry_date)&&<p className="text-xs">{r.batch_number} · {r.expiry_date}</p>}{r.review_note&&<p className="rounded-lg bg-emerald-50 p-3">{r.review_note}<span className="mt-1 block text-xs">{r.reviewed_by_name}</span></p>}
          {data.canReview&&<Review key={r.id+':'+r.review_revision} report={r} customerId={customer.id} onSaved={()=>setVersion(n=>n+1)}/>}
        </div>
      </details>)}
      {data.reports.length>limit&&<Button variant="ghost" onClick={()=>setLimit(n=>n+10)}>{ui('Show more reports')}</Button>}
    </>}
  </section>;
}
function Review({report,customerId,onSaved}){
  const [decision,setDecision]=useState(report.review_status==='pending'?'investigate':report.review_status||'investigate'),[note,setNote]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function save(){if(busy||!note.trim())return;setBusy(true);setError('');try{await call({action:'reviewCustomerSpoilage',customerId,reportId:report.id,revision:Number(report.review_revision||0),decision,note:note.trim()});onSaved();}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}
  return <fieldset disabled={busy} className="space-y-2 border-t pt-3"><label className="block text-xs">{ui('Follow-up decision')}<select aria-label={ui('Follow-up decision')} value={decision} onChange={e=>setDecision(e.target.value)} className="mt-1 h-11 w-full rounded-md border bg-white px-3">{Object.entries(labels).filter(([key])=>key!=='pending').map(([key,label])=><option key={key} value={key}>{ui(label)}</option>)}</select></label><textarea aria-label={ui('Action and responsible person')} placeholder={ui('Action and responsible person')} rows={2} maxLength={2000} className="w-full rounded-md border p-3" value={note} onChange={e=>setNote(e.target.value)}/>{error&&<p role="alert" className="text-sm text-red-700">{uiMessage(error)}</p>}<Button size="sm" disabled={busy||!note.trim()} onClick={save}>{busy?ui('Saving...'):ui('Save follow-up')}</Button></fieldset>;
}

