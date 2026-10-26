import React,{useRef,useState} from 'react';
import {ui,uiMessage} from '@/lib/i18n';
import {invalidateERPReads} from '@/api/erpClient';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
export default function SupplierRemoval({supplier,onDone,onBusyChange,disabled}){
 const [confirm,setConfirm]=useState(false),[reason,setReason]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),flight=useRef(false),key=useRef('');
 const restore=!!supplier.supplier_removed_at;
 const save=async()=>{if(flight.current||reason.trim().length<3)return;flight.current=true;setBusy(true);onBusyChange?.(true);setError('');
  try{const response=await fetch('/api/suppliers/'+encodeURIComponent(supplier.id)+'/lifecycle',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:restore?'restore':'remove',revision:Number(supplier.supplier_lifecycle_revision||0),reason:reason.trim(),requestKey:key.current})});const data=await response.json();if(!response.ok)throw Error(data.error||'Supplier change failed.');invalidateERPReads();onDone?.(data.supplier);}
  catch(e){setError(e.message);}finally{flight.current=false;setBusy(false);onBusyChange?.(false);}
 };
 return <section className="mt-4 space-y-3 border-t pt-3">
 {!confirm?<Button type="button" variant="outline" disabled={disabled} className={restore?'':'text-red-700'} onClick={()=>{key.current=crypto.randomUUID();setReason('');setError('');setConfirm(true);}}>{ui(restore?'Restore supplier':'Delete supplier')}</Button>:<>
 <p className="text-xs text-slate-600">{ui(restore?'Restore this supplier as inactive, then review its details before activation.':'Remove this supplier from the directory while retaining purchase and accounting history. Unsettled balances and unfinished purchases must be resolved first.')}</p>
 <Input aria-label={ui('Supplier deletion or restoration reason')} value={reason} minLength={3} maxLength={1000} disabled={busy} onChange={e=>setReason(e.target.value)} placeholder={ui('Reason')}/>
 {error&&<p role="alert" className="text-xs text-red-700">{uiMessage(error)}</p>}
 <div className="flex flex-wrap gap-2"><Button type="button" variant={restore?'default':'destructive'} disabled={busy||reason.trim().length<3} onClick={save}>{ui(restore?'Restore supplier':'Confirm deletion')}</Button><Button type="button" variant="outline" disabled={busy} onClick={()=>setConfirm(false)}>{ui('Cancel')}</Button></div></>}
 </section>;
}
