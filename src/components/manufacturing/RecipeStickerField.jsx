import React,{useRef,useState} from 'react';
import {yogurtStickerChoices} from '@/lib/yogurt-product-materials';
import {isStickerItem} from '@/lib/inventory-packaging';
import {yogurtAssemblyPackaging} from '@/lib/yogurt-production';
import {ui,uiMessage} from '@/lib/i18n';
import {Button} from '@/components/ui/button';
import AssemblyComponentPicker from '@/components/items/AssemblyComponentPicker';
export default function RecipeStickerField({product,output,items,family,onChange,disabled=false}){
  const [open,setOpen]=useState(false),[error,setError]=useState(''),anchor=useRef(null);
  const linked=items.find(item=>item.id===output.sticker_material_id),choices=yogurtStickerChoices(product,items,{...output,family});
  for(const line of output.packaging||[]){const item=items.find(item=>item.id===line.material_id);if(isStickerItem(item)&&!choices.some(row=>row.id===item.id))choices.push(item);}
  return <section className="mt-4 space-y-2 rounded-lg border p-3"><h3 className="text-sm font-semibold">{ui('Product stickers')}</h3><Button ref={anchor} type="button" variant="outline" className="h-auto w-full whitespace-normal text-left" disabled={disabled} aria-haspopup="dialog" aria-expanded={open} aria-label={ui('Choose product sticker')} onClick={()=>setOpen(true)}>{linked?.name||ui('Select matching sticker')}</Button><p className="text-xs text-slate-600">{ui('One sticker per finished unit')}: <strong>{Number(output.buckets)*Number(output.standard_units_per_bucket)||0}</strong></p>{error&&<p role="alert" className="text-sm text-red-700">{uiMessage(error)}</p>}{open&&<AssemblyComponentPicker records={choices} type="inventory_part" value={output.sticker_material_id} label="Choose product sticker" searchLabel="Search product stickers" returnFocusRef={anchor} onClose={()=>setOpen(false)} onSelect={item=>{try{const next={...output,sticker_material_id:item.id,require_sticker:true};onChange({sticker_material_id:item.id,require_sticker:true,packaging:yogurtAssemblyPackaging(product,items,{...next,family})});setError('');setOpen(false);}catch(e){setError(e.message);}}}/>}</section>;
}
