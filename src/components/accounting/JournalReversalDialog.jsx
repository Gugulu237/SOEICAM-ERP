import React,{useEffect,useState,useRef} from 'react';
import {ui,uiMessage} from '@/lib/i18n';
import {useLocaleRender} from '@/lib/localization';
import {businessDate} from '@/lib/business-date';
import {reverseJournal,previewJournalReversal} from '@/lib/posting';
import {formatAccountingXAF as money} from '@/lib/formatters';
import {erp} from '@/api/erpClient';
import {readAll} from '@/lib/field-pos';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter} from '@/components/ui/dialog';

export default function JournalReversalDialog({journal,onClose,onReversed}){
 useLocaleRender();
 const [date,setDate]=useState(businessDate()),[reason,setReason]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[periods,setPeriods]=useState([]),[periodError,setPeriodError]=useState(''),flight=useRef(false);
 const [preview,setPreview]=useState(null),[previewBusy,setPreviewBusy]=useState(false),[previewError,setPreviewError]=useState(''),[reviewRevision,setReviewRevision]=useState(0),[verified,setVerified]=useState({}),[reviewed,setReviewed]=useState(false);
 useEffect(()=>{
  if(!journal)return;let alive=true;setDate(businessDate());setReason('');setError('');setPeriodError('');setPeriods([]);
  readAll(erp.entities.AccountingPeriod,{},'start_date').then(p=>{if(alive)setPeriods(p);}).catch(e=>{if(alive)setPeriodError(e.message);});
  return()=>{alive=false;};
 },[journal?.id]);
 useEffect(()=>{
  if(!journal)return;let alive=true;setPreview(null);setPreviewBusy(true);setPreviewError('');setVerified({});setReviewed(false);
  previewJournalReversal(journal.id).then(p=>{if(!Array.isArray(p.accounts)||!Array.isArray(p.treasury)||!Array.isArray(p.blocked)||typeof p.snapshot!=='string')throw Error('The balance review could not be loaded.');if(alive)setPreview(p);})
   .catch(e=>{if(alive)setPreviewError(e.message);}).finally(()=>{if(alive)setPreviewBusy(false);});
  return()=>{alive=false;};
 },[journal?.id,reviewRevision]);
 const locked=periods.some(p=>p.start_date<=date&&date<=p.end_date&&['closed','locked'].includes(p.status));
 const verifiedAmounts=!!preview&&preview.treasury.every(t=>{const value=verified[t.id];if(typeof value!=='string'||!value.trim())return false;const n=Number(value),c=Math.round(n*100);return Number.isFinite(n)&&Number.isSafeInteger(c)&&Math.abs(n*100-c)<0.0001&&c===Math.round(t.balance_after*100);});
 const reviewReady=!!preview&&!previewBusy&&!preview.blocked.length&&(!preview.requires_review||reviewed&&verifiedAmounts);
 const submit=async e=>{
  e.preventDefault();if(flight.current)return;if(!reviewReady){setError('Complete the balance review before reversing.');return;}
  flight.current=true;setBusy(true);setError('');
  try{
   const treasuryReview=preview.requires_review?{snapshot:preview.snapshot,confirmed:true,verifiedBalances:preview.treasury.map(t=>({treasuryId:t.id,balance:verified[t.id]}))}:undefined;
   const saved=await reverseJournal(journal,{reversalDate:date,reason:reason.trim(),treasuryReview});onReversed(saved);onClose();
  }catch(e){setError(e.message);if(e.status===409)setReviewRevision(n=>n+1);}
  finally{flight.current=false;setBusy(false);}
 };
 return <Dialog open={!!journal} onOpenChange={open=>{if(!open&&!flight.current)onClose();}}><DialogContent onEscapeKeyDown={e=>{if(busy)e.preventDefault();}} onInteractOutside={e=>{if(busy)e.preventDefault();}}>
  <DialogHeader><DialogTitle>{ui('Reverse Journal')}</DialogTitle><DialogDescription>{ui('A new entry will swap the debits and credits. The original journal remains in the audit history.')}</DialogDescription></DialogHeader>
  {journal&&<form onSubmit={submit} className="min-w-0 space-y-4">
   <p className="break-words text-sm font-semibold">{journal.journal_number}</p>
   <label className="block space-y-1 text-sm"><span>{ui('Reversal date')}</span><Input aria-label={ui('Reversal date')} type="date" required min={journal.entry_date} max={businessDate()} value={date} disabled={busy} onChange={e=>setDate(e.target.value)}/></label>
   {locked&&<p role="alert" className="text-xs text-amber-900">{ui('This date is in a closed or locked period. Choose an open posting date.')}</p>}
   {periodError&&<p role="status" className="text-xs text-amber-900">{ui('Period information could not load. The server will validate the posting date.')}</p>}
   {previewBusy&&<p role="status" className="text-sm">{ui('Checking ledger and treasury balances...')}</p>}
   {previewError&&<div role="alert" className="space-y-2 text-sm text-red-700"><p>{uiMessage(previewError)}</p><Button type="button" variant="outline" disabled={busy||previewBusy} onClick={()=>setReviewRevision(n=>n+1)}>{ui('Reload balance review')}</Button></div>}
   {preview&&(preview.requires_review||preview.blocked.length>0)&&<section className="min-w-0 space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">{ui('Review treasury differences')}</h3><Button type="button" size="sm" variant="outline" disabled={busy} onClick={()=>setReviewRevision(n=>n+1)}>{ui('Refresh review')}</Button></div>
    <p className="text-xs">{ui('Saved balances differ from the posted ledger. Check the actual cash or bank balance before confirming this correction.')}</p>
    {preview.treasury.map(t=><div key={t.id} className="space-y-2 rounded-lg border bg-white p-3 text-xs">
     <h4 className="break-words font-semibold">{t.name}</h4>
     <dl className="space-y-1">{[['Saved treasury balance',t.stored_balance],['Posted ledger balance',t.ledger_balance],['Balance after reversal',t.balance_after]].map(([label,value])=><div className="flex flex-wrap justify-between gap-x-3" key={label}><dt>{ui(label)}</dt><dd className="font-medium">{money(value)}</dd></div>)}</dl>
     {t.retains_treasury_balance&&<p>{ui('The saved treasury amount already matches the balance after reversal. This can happen when an older manual journal did not update Treasury.')}</p>}
     {preview.requires_review&&<label className="block space-y-1"><span>{ui('Verified cash or bank balance after correction')}</span><Input aria-label={ui('Verified balance for {0}',t.name)} type="number" inputMode="decimal" step="0.01" min={t.account_type==='bank'?undefined:'0'} value={verified[t.id]??''} required disabled={busy} onChange={e=>setVerified(v=>({...v,[t.id]:e.target.value}))}/></label>}
    </div>)}
    {preview.accounts.some(a=>a.mismatch)&&<details className="text-xs"><summary className="cursor-pointer">{ui('Ledger account balance differences')}</summary>{preview.accounts.filter(a=>a.mismatch).map(a=><dl key={a.id} className="mt-2 space-y-1 rounded border bg-white p-2"><dt className="break-words font-semibold">{a.account_number} {a.name}</dt>{[['Saved account balance',a.stored_balance],['Posted ledger balance',a.ledger_balance],['Balance after reversal',a.balance_after]].map(([label,value])=><div className="flex flex-wrap justify-between gap-2" key={label}><dt>{ui(label)}</dt><dd>{money(value)}</dd></div>)}</dl>)}</details>}
    {preview.requires_review&&<><p className="text-xs">{ui('If an opening balance or transaction is missing, record it first. Do not confirm a balance that differs from your cash count or bank records.')}</p><a className="inline-block min-h-10 py-2 text-xs font-medium underline" href="/accounting/opening-position" target="_blank" rel="noopener noreferrer">{ui('Review opening balances')}</a><label className="flex items-start gap-2 text-xs"><input aria-label={ui('Confirm verified ledger and treasury balances')} className="mt-0.5 h-4 w-4 shrink-0" type="checkbox" checked={reviewed} disabled={busy} onChange={e=>setReviewed(e.target.checked)}/><span>{ui('I verified these balances. Rebuild the displayed saved balances from the ledger while reversing this journal.')}</span></label></>}
    {preview.blocked.map(message=><p key={message} role="alert" className="text-xs text-red-700">{uiMessage(message)}</p>)}
   </section>}
   <label className="block space-y-1 text-sm"><span>{ui('Reason for reversal')}</span><Textarea aria-label={ui('Reason for reversal')} required minLength={3} maxLength={1000} value={reason} disabled={busy} onChange={e=>setReason(e.target.value)}/></label>
   {error&&<p role="alert" className="break-words text-sm text-red-700">{uiMessage(error)}</p>}
   <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={onClose}>{ui('Cancel')}</Button><Button type="submit" variant="destructive" disabled={busy||locked||!reviewReady||reason.trim().length<3||!date}>{ui(busy?'Reversing journal...':'Confirm reversal')}</Button></DialogFooter>
  </form>}
 </DialogContent></Dialog>;
}
