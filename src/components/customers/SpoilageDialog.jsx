'use client';
import React,{useEffect,useRef,useState} from 'react';
import {ui,uiMessage} from '@/lib/i18n';
import {useLocaleRender} from '@/lib/localization';
import {invokeFieldOps,errorMessage} from '@/lib/field-ops';
import {statusLabel} from '@/lib/formatters';
import SaleProductPicker from '@/components/sales/SaleProductPicker';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
const reasons=['expired','damaged_in_transit','damaged_at_store','packaging_defect','quality_issue','other'];
async function call(body){const {data}=await invokeFieldOps(body);if(data.error)throw Error(data.error);return data;}
export default function SpoilageDialog({open,onOpenChange,customer,onSaved}){
  useLocaleRender();
  const [data,setData]=useState(null),[loadError,setLoadError]=useState(''),[retry,setRetry]=useState(0),[error,setError]=useState(''),[busy,setBusy]=useState(false),[picker,setPicker]=useState(false);
  const [lines,setLines]=useState([]),[locationId,setLocationId]=useState(''),[reason,setReason]=useState('expired'),[notes,setNotes]=useState(''),[batchNumber,setBatchNumber]=useState(''),[expiryDate,setExpiryDate]=useState('');
  const key=useRef(crypto.randomUUID()),pending=useRef(false);
  useEffect(()=>{if(!open)return;let active=true;setData(null);setLoadError('');call({action:'customerSpoilageWorkspace',customerId:customer.id,includeProducts:true}).then(d=>{if(active){setData(d);setLocationId(d.locations.length===1?d.locations[0].id:'');}}).catch(e=>{if(active)setLoadError(errorMessage(e));});return()=>{active=false;};},[open,customer.id,retry]);
  const quantity=(product,value)=>setLines(rows=>value===null?rows.filter(r=>r.product_id!==product.id):rows.some(r=>r.product_id===product.id)?rows.map(r=>r.product_id===product.id?{...r,quantity:value}:r):[...rows,{product_id:product.id,quantity:value}]);
  const valid=data&&lines.length>0&&lines.every(l=>Number(l.quantity)>0&&Number(l.quantity)<=1000000&&Math.round(Number(l.quantity)*1000)/1000===Number(l.quantity))&&(!data.locations.length||locationId)&&notes.trim();
  async function save(){
    if(pending.current||!valid)return;pending.current=true;setBusy(true);setError('');
    try{const result=await call({action:'reportCustomerSpoilage',customerId:customer.id,requestKey:key.current,reference:'SP-'+key.current.slice(0,8).toUpperCase(),date:data.date,locationId,reason,notes:notes.trim(),batchNumber,expiryDate,lines:lines.map(l=>({...l,quantity:Number(l.quantity)}))});onOpenChange(false);onSaved?.(result);}
    catch(e){setError(errorMessage(e));}finally{pending.current=false;setBusy(false);}
  }
  return <Dialog open={open} onOpenChange={value=>{if(!pending.current)onOpenChange(value);}}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
    <DialogHeader><DialogTitle>{ui('Report spoilage')}</DialogTitle><DialogDescription>{customer.business_name}</DialogDescription></DialogHeader>
    {loadError?<p role="alert" className="text-sm text-red-700">{uiMessage(loadError)} <button onClick={()=>setRetry(n=>n+1)}>{ui('Retry')}</button></p>:!data?<p role="status">{ui('Loading products and delivery points...')}</p>:<fieldset disabled={busy} className="space-y-4">
      <p className="text-xs text-slate-500">{ui('Reported by')}: <strong>{data.reporter.name}</strong> · {data.date}</p>
      {data.locations.length>0&&<label className="block text-sm">{ui('Delivery point')}<select aria-label={ui('Delivery point')} className="mt-1 h-11 w-full rounded-md border bg-white px-3" value={locationId} onChange={e=>setLocationId(e.target.value)}><option value="">{ui('Choose the affected delivery point')}</option>{data.locations.map(l=><option value={l.id} key={l.id}>{l.name}</option>)}</select></label>}
      <Button type="button" className="min-h-11 w-full" onClick={()=>setPicker(true)}>{lines.length?ui('Edit selected products ({0})',lines.length):ui('Choose products')}</Button>
      {!!lines.length&&<div className="max-h-36 overflow-y-auto rounded-lg border px-3">{lines.map(l=><div key={l.product_id} className="flex items-center justify-between gap-2 border-b py-2 text-sm last:border-0"><span>{data.products.find(p=>p.id===l.product_id)?.name}</span><strong>{l.quantity}</strong></div>)}</div>}
      <label className="block text-sm">{ui('Reason')}<select aria-label={ui('Spoilage reason')} className="mt-1 h-11 w-full rounded-md border bg-white px-3" value={reason} onChange={e=>setReason(e.target.value)}>{reasons.map(r=><option key={r} value={r}>{statusLabel(r)}</option>)}</select></label>
      <label className="block text-sm">{ui('What happened / action needed')}<textarea aria-label={ui('What happened / action needed')} className="mt-1 w-full rounded-md border p-3 text-sm" rows={3} maxLength={2000} value={notes} onChange={e=>setNotes(e.target.value)}/></label>
      <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm">{ui('Batch and expiry details (optional)')}</summary><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-sm">{ui('Batch / lot')}<Input maxLength={150} value={batchNumber} onChange={e=>setBatchNumber(e.target.value)}/></label><label className="text-sm">{ui('Printed expiry date')}<Input type="date" value={expiryDate} onChange={e=>setExpiryDate(e.target.value)}/></label></div><p className="mt-2 text-xs text-slate-500">{ui('For different batches or expiry dates, submit separate reports.')}</p></details>
      <p className="text-xs text-slate-500">{ui('This records the loss for review. Replacement goods, customer credits and stock adjustments require their verified workflows.')}</p>
    </fieldset>}
    {error&&<p role="alert" className="text-sm text-red-700">{uiMessage(error)}</p>}
    <div className="flex flex-wrap justify-end gap-2 border-t pt-3"><Button variant="outline" disabled={busy} onClick={()=>onOpenChange(false)}>{ui('Cancel')}</Button><Button disabled={busy||!valid} onClick={save}>{busy?ui('Saving...'):ui('Submit spoilage report')}</Button></div>
    {picker&&<SaleProductPicker open onOpenChange={setPicker} purpose="spoilage" products={data?.products||[]} lines={lines} onQuantityChange={quantity} disabled={busy}/>}
  </DialogContent></Dialog>;
}
