'use client';
import React,{useEffect,useRef,useState} from 'react';
import {ui,uiMessage} from '@/lib/i18n';
import {useLocaleRender} from '@/lib/localization';
import {invokeFieldOps,errorMessage} from '@/lib/field-ops';
import {formatXAF} from '@/lib/formatters';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
async function call(body){const {data}=await invokeFieldOps(body);if(data.error)throw Error(data.error);return data;}
export default function SaleReversalDialog({invoiceId,fieldSaleId,onClose,onDone}){
  useLocaleRender();
  const [data,setData]=useState(null),[error,setError]=useState(''),[reason,setReason]=useState(''),[stock,setStock]=useState(''),[warehouse,setWarehouse]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[reload,setReload]=useState(0);
  const saving=useRef(false);
  useEffect(()=>{let active=true;setData(null);setError('');setConfirmed(false);call({action:'previewSaleReversal',invoiceId,fieldSaleId}).then(d=>{if(active)setData(d);}).catch(e=>{if(active)setError(errorMessage(e));});return()=>{active=false;};},[invoiceId,fieldSaleId,reload]);
  async function save(){if(saving.current)return;saving.current=true;setBusy(true);setError('');try{const result=await call({action:'reverseSale',invoiceId,fieldSaleId,reviewToken:data.reviewToken,reason,stockDisposition:stock,warehouseId:warehouse,confirmed});onDone(result);}catch(e){setError(errorMessage(e));}finally{saving.current=false;setBusy(false);}}
  return <Dialog open onOpenChange={v=>{if(!v&&!saving.current)onClose();}}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl"><DialogHeader><DialogTitle>{ui('Reverse sale')}</DialogTitle><DialogDescription>{ui('Keep the original sale and record a dated correction for mistakes or audit findings.')}</DialogDescription></DialogHeader>
    {error&&<div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{uiMessage(error)} <button disabled={busy} type="button" className="underline" onClick={()=>setReload(n=>n+1)}>{ui('Reload preview')}</button></div>}
    {!data&&!error&&<p role="status">{ui('Loading sale correction...')}</p>}
    {data&&<><div className="rounded-lg bg-slate-50 p-3 text-sm"><strong>{data.number} · {data.customer_name}</strong><p>{ui('Correction date')}: {data.date}</p><p>{ui('Sale reversed')}: {formatXAF(data.total)}</p><p>{ui('Unpaid balance cancelled')}: {formatXAF(data.unpaid_cancelled)}</p><p>{ui('Customer credit created')}: <strong>{formatXAF(data.customer_credit)}</strong></p><p className="mt-2">{ui('Received money stays in company funds. This does not issue a cash refund.')}</p></div>
    <fieldset disabled={busy} className="space-y-3"><label className="block text-sm">{ui('Reason for reversal')}<Textarea aria-label={ui('Reason for reversal')} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)} /></label>
    <label className="block text-sm">{ui('What happened to the goods?')}<select aria-label={ui('What happened to the goods?')} className="mt-1 h-11 w-full rounded-md border px-3" value={stock} onChange={e=>{setStock(e.target.value);setConfirmed(false);}}><option value="">{ui('Choose a stock outcome')}</option><option value="retain_stock">{ui('Goods have not returned — leave stock and costs unchanged')}</option><option value="return_stock" disabled={!data.can_restore_stock}>{ui('Goods are back in company custody — quarantine for quality review')}</option></select></label>
    {stock==='return_stock'&&<><label className="block text-sm">{ui('Actual return warehouse')}<select aria-label={ui('Actual return warehouse')} className="mt-1 h-11 w-full rounded-md border px-3" value={warehouse} onChange={e=>{setWarehouse(e.target.value);setConfirmed(false);}}><option value="">{ui('Choose warehouse')}</option>{data.warehouses.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label><ul className="rounded-lg border p-3 text-sm">{data.items.map((l,i)=><li key={i}>{l.product_name}: {l.quantity} {l.unit}</li>)}</ul><p className="text-xs text-slate-600">{ui('Confirm all listed goods are physically at this warehouse. Returned stock stays unavailable for sales until quality approval.')}</p></>}
    {data.has_replacements&&<p className="text-sm text-amber-800">{ui('This reverses sold products only. Linked damaged-product replacements remain in their separate return records.')}</p>}
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/><span>{ui('I checked the customer credit and confirm this stock outcome is accurate.')}</span></label></fieldset></>}
    <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" disabled={busy} onClick={onClose}>{ui('Cancel')}</Button><Button variant="destructive" disabled={busy||!data||reason.trim().length<3||!stock||!confirmed||(stock==='return_stock'&&!warehouse)} onClick={save}>{busy?ui('Recording correction...'):ui('Confirm sale reversal')}</Button></div>
  </DialogContent></Dialog>;
}
