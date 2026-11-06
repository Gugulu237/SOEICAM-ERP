import React,{useRef,useState} from 'react';
import {ui,uiMessage} from '@/lib/i18n';
import {useLocaleRender} from '@/lib/localization';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import ProductThumb from '@/components/shared/ProductThumb';
import {invokeFieldOps} from '@/lib/field-ops';
import {formatQuantity} from '@/lib/formatters';
export default function OutletRetailSaleForm({location,product,snapshotKey,onClose,onDone}){
  useLocaleRender();
  const [quantity,setQuantity]=useState('1'),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const requestKey=useRef(crypto.randomUUID()),saving=useRef(false);
  const available=Math.min(product.display_quantity,product.opening_quantity-Number(product.today_sold_quantity||0));
  const valid=quantity!==''&&Number.isFinite(Number(quantity))&&Number(quantity)>0&&Number(quantity)<=available;
  async function submit(event){event.preventDefault();if(saving.current||!valid)return;saving.current=true;setBusy(true);setError('');
    try{const {data}=await invokeFieldOps({action:'recordOutletRetailSale',locationId:location.id,productId:product.id,quantity:Number(quantity),snapshotKey,requestKey:requestKey.current});if(data.error)throw Error(data.error);onDone();}
    catch(e){setError(e.message);}finally{saving.current=false;setBusy(false);}}
  return <Dialog open onOpenChange={open=>{if(!open&&!busy)onClose();}}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>{ui('Report units sold')}</DialogTitle><DialogDescription>{location.customer_name} / {location.name}</DialogDescription></DialogHeader>
    <form onSubmit={submit} className="space-y-5"><div className="flex items-center gap-4"><ProductThumb product={product} size={90}/><h3 className="font-semibold">{product.name}</h3></div><p className="text-sm">{ui('Available at this outlet')}: <strong>{formatQuantity(available)}</strong></p>
      <label className="block text-sm font-medium">{ui('Units sold now')}<Input className="mt-2 h-12 text-lg" autoFocus type="number" min="0.001" max={available} step="0.001" required value={quantity} disabled={busy} onChange={e=>setQuantity(e.target.value)}/></label>
      <div className="grid grid-cols-3 gap-2">{[1,2,5].map(n=><Button key={n} type="button" variant="outline" disabled={busy||n>available} onClick={()=>setQuantity(String(n))}>{n}</Button>)}</div>
      <p className="rounded-xl bg-emerald-50 p-4 text-sm">{ui('Remaining after this report')}: <strong>{valid?formatQuantity(product.display_quantity-Number(quantity)):'—'}</strong></p>
      {error&&<p role="alert" className="text-sm text-red-700">{uiMessage(error)}</p>}<Button type="submit" className="h-12 w-full" disabled={busy||!valid}>{ui(busy?'Saving...':'Save sales report')}</Button>
      <p className="text-xs text-slate-500">{ui('These units are included in today’s closing report.')}</p>
    </form></DialogContent></Dialog>;
}
