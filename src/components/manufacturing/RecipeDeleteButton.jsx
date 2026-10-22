import React,{useRef,useState} from 'react';
import {invokeFieldOps} from '@/lib/field-ops';
import {ui,uiMessage} from '@/lib/i18n';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Input} from '@/components/ui/input';
export default function RecipeDeleteButton({recipe,onDeleted,disabled=false}){
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[reason,setReason]=useState('Recipe no longer required'),[error,setError]=useState(''),pending=useRef(false);
  async function remove(){if(pending.current)return;pending.current=true;setBusy(true);setError('');try{await invokeFieldOps({action:'removeManufacturingRecipe',recipeId:recipe.id,reason});setOpen(false);await onDeleted?.();}catch(e){setError(e.message);}finally{pending.current=false;setBusy(false);}}
  return <><Button type="button" variant="outline" disabled={disabled} onClick={event=>{event.stopPropagation();setOpen(true);}}>{ui('Delete recipe')}</Button><Dialog open={open} onOpenChange={value=>{if(!pending.current)setOpen(value);}}><DialogContent className="max-w-md" onClick={event=>event.stopPropagation()}><DialogHeader><DialogTitle>{ui('Delete recipe')}</DialogTitle><DialogDescription>{ui('Remove this recipe from planning. Existing production batches and recipe history are preserved.')}</DialogDescription></DialogHeader><p className="text-sm font-medium">{recipe.recipe_name}</p><label className="text-sm">{ui('Reason')}<Input aria-label={ui('Recipe removal reason')} value={reason} maxLength={500} disabled={busy} onChange={event=>setReason(event.target.value)}/></label>{error&&<p role="alert" className="text-sm text-red-700">{uiMessage(error)}</p>}<div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={()=>setOpen(false)}>{ui('Cancel')}</Button><Button variant="destructive" disabled={busy||!reason.trim()} onClick={remove}>{ui(busy?'Deleting...':'Confirm delete')}</Button></div></DialogContent></Dialog></>;
}
