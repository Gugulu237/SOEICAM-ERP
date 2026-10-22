import React,{useRef,useState} from 'react';
import { erp } from '@/api/erpClient';
import { invalidateItemLookups } from '@/lib/item-lookup-cache';
import { finishedItemSetupIssues } from '@/lib/item-readiness';
import { ui,uiMessage } from '@/lib/i18n';
import { Button } from '@/components/ui/button';

export default function ItemAvailabilityAction({item,onEdit,onSaved,disabled=false}){
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),pending=useRef(false);
  if(item.is_active!==false&&item.configuration_status!=='draft')return null;
  const missing=finishedItemSetupIssues(item),setup=missing.length>0;
  async function activate(){
    if(disabled||pending.current)return;
    if(setup){onEdit?.(item);return;}
    pending.current=true;setBusy(true);setError('');
    try{const saved=await erp.items.save({id:item.id,changes:{is_active:true},updatedDate:item.updated_date});invalidateItemLookups();onSaved?.(saved);}
    catch(e){setError(e.message);}
    finally{pending.current=false;setBusy(false);}
  }
  return <div className="min-w-0" onClick={e=>e.stopPropagation()}>
    <Button type="button" size="sm" variant="outline" disabled={disabled||busy||setup&&!onEdit} onClick={activate} aria-label={ui(setup?'Finish setup for {0}':'Activate {0}',item.name)} className="h-auto min-h-8 whitespace-normal text-xs">{ui(busy?'Activating…':setup?'Finish setup':'Activate')}</Button>
    {error&&<div className="mt-1"><p role="alert" className="text-xs text-red-700">{uiMessage(error)}</p>{onEdit&&<button type="button" className="mt-1 text-xs underline" disabled={disabled||busy} onClick={()=>onEdit(item)}>{ui('Edit setup')}</button>}</div>}
  </div>;
}
