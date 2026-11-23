'use client';
import React,{useEffect,useRef,useState} from 'react';
import {ui,uiMessage} from '@/lib/i18n';
import {useLocaleRender} from '@/lib/localization';
import {invokeFieldOps,errorMessage} from '@/lib/field-ops';
import {formatXAF,formatNumber,formatDateTime} from '@/lib/formatters';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import CashSaleDepositSelect from './CashSaleDepositSelect';
async function call(body){const {data}=await invokeFieldOps(body);if(data.error)throw Error(data.error);return data;}

export default function PostedSaleEditDialog({invoiceId,fieldSaleId,onClose,onDone}){
 useLocaleRender();
 const [data,setData]=useState(null),[form,setForm]=useState(null),[review,setReview]=useState(null),[confirmed,setConfirmed]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[reload,setReload]=useState(0);
 const saving=useRef(false),key=useRef(crypto.randomUUID());
 useEffect(()=>{let active=true;setData(null);setReview(null);setConfirmed(false);setError('');
  call({action:'postedSaleEditWorkspace',invoiceId,fieldSaleId}).then(result=>{if(!active)return;setData(result);setForm({customerId:result.customerId,locationId:result.locationId,paymentType:result.paymentType,treasuryAccountId:result.treasuryAccountId||result.defaultCashAccountId||'',reference:result.reference,reason:'',lines:result.lines.map(l=>({line_id:l.line_id,quantity:String(l.quantity)}))});}).catch(e=>{if(active)setError(errorMessage(e));});
  return()=>{active=false;};
 },[invoiceId,fieldSaleId,reload]);
 const change=(key,value)=>{setForm(previous=>({...previous,[key]:value}));setReview(null);setConfirmed(false);};
 const points=data?.points.filter(p=>p.customer_id===form?.customerId)||[],customer=data?.customers.find(c=>c.id===form?.customerId);
 const valid=form&&form.reference.trim()&&form.reason.trim().length>=3&&form.lines.every(l=>String(l.quantity).trim()!==''&&Number.isFinite(Number(l.quantity))&&Number(l.quantity)>=0);
 async function preview(){if(busy||!valid)return;setBusy(true);setError('');try{setReview(await call({action:'previewPostedSaleEdit',invoiceId,fieldSaleId,...form}));setConfirmed(false);}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}
 async function save(){if(saving.current||!review||!confirmed)return;saving.current=true;setBusy(true);setError('');try{const result=await call({action:'savePostedSaleEdit',invoiceId,fieldSaleId,...form,requestKey:key.current,fingerprint:review.fingerprint,confirmed:true});onDone(result);}catch(e){setError(errorMessage(e));setReview(null);setConfirmed(false);}finally{saving.current=false;setBusy(false);}}
 return <Dialog open onOpenChange={open=>{if(!open&&!saving.current)onClose();}}><DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{ui('Edit posted sale')}</DialogTitle><DialogDescription>{ui('Correct payment terms and quantities using the physical receipt. The invoice number stays the same and every saved version remains in the audit history.')}</DialogDescription></DialogHeader>
 {error&&<div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{uiMessage(error)} <button type="button" className="underline" disabled={busy} onClick={()=>{key.current=crypto.randomUUID();setReload(n=>n+1);}}>{ui('Reload sale')}</button></div>}
 {!data&&!error&&<p role="status">{ui('Loading sale correction...')}</p>}
 {data&&form&&<><div className="rounded-lg bg-slate-50 p-3 text-sm"><strong>{data.number}</strong><p>{ui('Current total')}: {formatXAF(data.total)} · {ui('Amount due')}: {formatXAF(data.balance)}</p></div>
 {data.history?.length>0&&<details className="rounded-lg border p-3 text-sm"><summary className="cursor-pointer font-medium">{ui('Correction history')}</summary><ul className="mt-2 space-y-2">{data.history.map(item=><li key={item.id}><p className="text-xs text-slate-500">{item.date?formatDateTime(item.date):''} · {item.by}</p><p>{item.reason}</p></li>)}</ul></details>}
 <fieldset disabled={busy} className="space-y-4">
 <label className="block text-sm">{ui('Billing customer or branch')}<select aria-label={ui('Billing customer or branch')} className="mt-1 min-h-11 w-full rounded-md border bg-white px-3" value={form.customerId} onChange={e=>{const chosen=data.customers.find(c=>c.id===e.target.value);setForm(previous=>({...previous,customerId:e.target.value,locationId:chosen?.parent_id?chosen.id:''}));setReview(null);setConfirmed(false);}}>{data.customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
 {points.length>0&&<label className="block text-sm">{ui('Delivery branch')}<select aria-label={ui('Delivery branch')} className="mt-1 min-h-11 w-full rounded-md border bg-white px-3" value={form.locationId} onChange={e=>change('locationId',e.target.value)}><option value="">{ui('Choose a branch')}</option>{points.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
 {!points.length&&customer?.parent_id&&<p className="text-xs text-slate-600">{customer.name}</p>}
 <label className="block text-sm">{ui('Payment type')}<select aria-label={ui('Payment type')} className="mt-1 min-h-11 w-full rounded-md border bg-white px-3" value={form.paymentType} onChange={e=>change('paymentType',e.target.value)}><option value="cash">{ui('Cash')}</option><option value="credit">{ui('Credit')}</option></select></label>
 {form.paymentType==='cash'&&!data.field_collection&&<CashSaleDepositSelect accounts={data.cashAccounts} value={form.treasuryAccountId} onChange={value=>change('treasuryAccountId',value)} disabled={busy}/>}
 <div className="overflow-x-auto rounded-lg border"><table className="w-full text-left text-sm"><thead className="bg-slate-50"><tr><th className="p-3">{ui('Product')}</th><th className="p-3">{ui('Unit price')}</th><th className="p-3">{ui('Correct quantity')}</th></tr></thead><tbody>{data.lines.map((line,index)=><tr key={line.line_id} className="border-t"><td className="p-3">{line.product_name}<span className="block text-xs text-slate-500">{ui('Original quantity')}: {formatNumber(line.quantity,3)} {line.unit}</span></td><td className="p-3">{formatXAF(line.unit_price)}</td><td className="w-36 p-3"><Input type="number" min="0" max="1000000000" step="0.001" aria-label={ui('Correct quantity for {0}',line.product_name)} value={form.lines[index].quantity} onChange={e=>change('lines',form.lines.map((l,i)=>i===index?{...l,quantity:e.target.value}:l))}/></td></tr>)}</tbody></table></div>
 <p className="text-xs text-slate-600">{ui('Enter zero to remove a product. Quantity increases require available stock. Reductions restore the original stock quantity and carrying value.')}</p>
 <label className="block text-sm">{ui('Physical receipt reference')}<Input aria-label={ui('Physical receipt reference')} maxLength={150} value={form.reference} onChange={e=>change('reference',e.target.value)}/></label>
 <label className="block text-sm">{ui('Reason for correction')}<Textarea aria-label={ui('Reason for correction')} maxLength={1000} value={form.reason} onChange={e=>change('reason',e.target.value)}/></label>
 </fieldset>
 {review&&<section className="space-y-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm"><h3 className="font-semibold">{ui('Review corrected sale')}</h3><p>{review.customer_name} · {ui(review.payment_type==='cash'?'Cash':'Credit')}</p><dl className="grid grid-cols-2 gap-2"><dt>{ui('Corrected total')}</dt><dd className="text-right font-semibold">{formatXAF(review.total)}</dd><dt>{ui('Paid')}</dt><dd className="text-right">{formatXAF(review.amount_paid)}</dd><dt>{ui('Amount due')}</dt><dd className="text-right font-semibold">{formatXAF(review.balance)}</dd><dt>{ui(data.field_collection?'Recorded cash collection change':'Cash balance change')}</dt><dd className="text-right">{formatXAF(review.cash_change)}</dd></dl><ul className="space-y-1">{review.stock_changes.filter(l=>l.before!==l.after).map((l,i)=><li key={i}>{l.product_name}: {formatNumber(l.before,3)} → {formatNumber(l.after,3)}</li>)}</ul><label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>{ui('I checked the physical receipt and confirm these corrected quantities and payment terms.')}</label></section>}
 <div className="flex flex-wrap justify-end gap-2 border-t pt-3"><Button variant="outline" disabled={busy} onClick={onClose}>{ui('Cancel')}</Button>{review?<Button disabled={busy||!confirmed} onClick={save}>{busy?ui('Saving…'):ui('Save posted sale correction')}</Button>:<Button disabled={busy||!valid} onClick={preview}>{busy?ui('Checking…'):ui('Review correction')}</Button>}</div></>}
 </DialogContent></Dialog>;
}
