import React,{useRef,useState} from 'react';
import {Trash2,RotateCcw} from 'lucide-react';
import {ui,uiMessage} from '@/lib/i18n';
import {invalidateERPReads} from '@/api/erpClient';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter} from '@/components/ui/dialog';

export default function ItemRemoval({item,onDone,onBusyChange,disabled=false}){
  const [open,setOpen]=useState(false),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const flight=useRef(false),requestKey=useRef(null);
  const removed=Boolean(item.item_removed_at),title=ui(removed?'Restore item':'Delete item');
  const changeOpen=value=>{if(flight.current)return;if(value){setReason('');setError('');requestKey.current=crypto.randomUUID();}setOpen(value);};
  const submit=async event=>{
    event.preventDefault();
    if(flight.current||disabled||reason.trim().length<3)return;
    flight.current=true;setBusy(true);setError('');onBusyChange?.(true);
    try{
      const response=await fetch('/api/items/'+encodeURIComponent(item.id)+'/lifecycle',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:removed?'restore':'remove',reason:reason.trim(),revision:Number(item.item_lifecycle_revision||0),requestKey:requestKey.current})});
      const data=await response.json();if(!response.ok||data.error)throw Error(data.error||'Item catalogue change failed.');
      invalidateERPReads();setOpen(false);onDone?.(data.item);
    }catch(e){setError(e.message);}finally{flight.current=false;setBusy(false);onBusyChange?.(false);}
  };
  return <><Button type="button" variant={removed?'outline':'ghost'} className={removed?'min-h-11':'min-h-11 text-red-700 hover:bg-red-50 hover:text-red-800'} disabled={disabled||busy} onClick={()=>changeOpen(true)}>{removed?<RotateCcw size={16} className="mr-2"/>:<Trash2 size={16} className="mr-2"/>}{title}</Button>
    <Dialog open={open} onOpenChange={changeOpen}><DialogContent onPointerDownOutside={e=>{if(busy)e.preventDefault();}} onEscapeKeyDown={e=>{if(busy)e.preventDefault();}}>
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{removed?ui('Restore this item as inactive. Review its setup before activating it again.'):ui('Remove this item from the catalogue while retaining stock history, transactions and accounting records. Items with remaining stock or active dependencies must be resolved first.')}</DialogDescription></DialogHeader>
      <form onSubmit={submit} className="space-y-4"><p className="break-words text-sm font-semibold">{item.name}</p><label className="block text-sm">{ui('Reason')}<Textarea aria-label={ui('Item deletion or restoration reason')} autoFocus required minLength={3} maxLength={1000} value={reason} disabled={busy} onChange={e=>setReason(e.target.value)} className="mt-2"/></label>
        {error&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{uiMessage(error)}</p>}
        <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={()=>changeOpen(false)}>{ui('Cancel')}</Button><Button type="submit" variant={removed?'default':'destructive'} disabled={busy||reason.trim().length<3}>{busy?ui('Saving…'):title}</Button></DialogFooter>
      </form>
    </DialogContent></Dialog>
  </>;
}
