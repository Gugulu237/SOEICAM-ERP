import React,{useEffect,useState,useRef} from 'react';
import {ui,uiMessage} from '@/lib/i18n';
import {useLocaleRender} from '@/lib/localization';
import {businessDate} from '@/lib/business-date';
import {reverseJournal} from '@/lib/posting';
import {erp} from '@/api/erpClient';
import {readAll} from '@/lib/field-pos';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter} from '@/components/ui/dialog';

export default function JournalReversalDialog({journal,onClose,onReversed}){
 useLocaleRender();
 const [date,setDate]=useState(businessDate()),[reason,setReason]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[periods,setPeriods]=useState([]),[periodError,setPeriodError]=useState(''),flight=useRef(false);
 useEffect(()=>{if(!journal)return;let alive=true;setDate(businessDate());setReason('');setError('');setPeriodError('');setPeriods([]);readAll(erp.entities.AccountingPeriod,{},'start_date').then(p=>{if(alive)setPeriods(p);}).catch(e=>{if(alive)setPeriodError(e.message);});return()=>{alive=false;};},[journal?.id]);
 const locked=periods.some(p=>p.start_date<=date&&date<=p.end_date&&['closed','locked'].includes(p.status));
 const submit=async e=>{e.preventDefault();if(flight.current)return;flight.current=true;setBusy(true);setError('');try{const saved=await reverseJournal(journal,{reversalDate:date,reason:reason.trim()});onReversed(saved);onClose();}catch(e){setError(e.message);}finally{flight.current=false;setBusy(false);}};
 return <Dialog open={!!journal} onOpenChange={open=>{if(!open&&!flight.current)onClose();}}><DialogContent onEscapeKeyDown={e=>{if(busy)e.preventDefault();}} onInteractOutside={e=>{if(busy)e.preventDefault();}}><DialogHeader><DialogTitle>{ui('Reverse Journal')}</DialogTitle><DialogDescription>{ui('A new entry will swap the debits and credits. The original journal remains in the audit history.')}</DialogDescription></DialogHeader>{journal&&<form onSubmit={submit} className="min-w-0 space-y-4"><p className="break-words text-sm font-semibold">{journal.journal_number}</p><label className="block space-y-1 text-sm"><span>{ui('Reversal date')}</span><Input aria-label={ui('Reversal date')} type="date" required min={journal.entry_date} max={businessDate()} value={date} disabled={busy} onChange={e=>setDate(e.target.value)}/></label>{locked&&<p role="alert" className="text-xs text-amber-900">{ui('This date is in a closed or locked period. Choose an open posting date.')}</p>}{periodError&&<p role="status" className="text-xs text-amber-900">{ui('Period information could not load. The server will validate the posting date.')}</p>}<label className="block space-y-1 text-sm"><span>{ui('Reason for reversal')}</span><Textarea aria-label={ui('Reason for reversal')} required minLength={3} maxLength={1000} value={reason} disabled={busy} onChange={e=>setReason(e.target.value)}/></label>{error&&<p role="alert" className="break-words text-sm text-red-700">{uiMessage(error)}</p>}<DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={onClose}>{ui('Cancel')}</Button><Button type="submit" variant="destructive" disabled={busy||locked||reason.trim().length<3||!date}>{ui(busy?'Reversing journal...':'Confirm reversal')}</Button></DialogFooter></form>}</DialogContent></Dialog>;
}
