import React, {useEffect, useRef, useState} from 'react';
import {ui, uiMessage} from '@/lib/i18n';
import {useLocaleRender} from '@/lib/localization';
import {invokeFieldOps} from '@/lib/field-ops';
import {validProductQuantity} from '@/lib/product-quantity';
import ProductCatalog from '@/components/shared/ProductCatalog';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter} from '@/components/ui/dialog';

const selectClass='mt-1 h-11 w-full rounded-md border bg-white px-3 text-sm';
const invoke=async body=>{const {data}=await invokeFieldOps(body);if(data?.error)throw Error(data.error);return data;};

export default function CentralDegustationForm({onClose,onSaved}){
  useLocaleRender();
  const [employeeId,setEmployeeId]=useState(''),[result,setResult]=useState(null),[loading,setLoading]=useState(true),[loadError,setLoadError]=useState(''),[reload,setReload]=useState(0);
  const [form,setForm]=useState({source:'company',legacyDispatchId:'',customerId:'',reason:'',lines:[]}),[busy,setBusy]=useState(false),[saveError,setSaveError]=useState('');
  const pending=useRef(null),lock=useRef(false);
  const data=result?.scope===employeeId?result.data:null,unresolved=!!saveError&&!!pending.current;
  useEffect(()=>{
    let active=true;setLoading(true);setLoadError('');
    invoke({action:'centralDegustationWorkspace',...(employeeId?{employeeId}:{})}).then(value=>{if(active)setResult({scope:employeeId,data:value});}).catch(error=>{if(active)setLoadError(error.message);}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[employeeId,reload]);
  const legacy=data?.previously_expensed||[],run=legacy.find(row=>row.id===form.legacyDispatchId);
  const products=(form.source==='previously_expensed'?run?.products||[]:data?.products||[]).map(product=>({...product,quantity:Number(product.available)||0})).filter(product=>product.quantity>0);
  const valid=!!data&&!loading&&!loadError&&!!data.employeeId&&form.reason.trim().length>=3&&form.reason.trim().length<=1000&&form.lines.length>0&&form.lines.length<=50&&form.lines.every(line=>validProductQuantity(line.quantity,products.find(product=>product.id===line.product_id)?.quantity))&&(form.source!=='previously_expensed'||!!run&&!!form.customerId);
  const set=(key,value)=>{if(busy||loading||unresolved)return;setForm(previous=>({...previous,[key]:value,...(['source','legacyDispatchId'].includes(key)?{lines:[]}:{}),...(key==='source'?{legacyDispatchId:value==='previously_expensed'&&legacy.length===1?legacy[0].id:''}:{})}));};
  const quantity=(product,value)=>{if(busy||loading||unresolved)return;setForm(previous=>({...previous,lines:value===null||value===''||Number(value)===0?previous.lines.filter(line=>line.product_id!==product.id):previous.lines.some(line=>line.product_id===product.id)?previous.lines.map(line=>line.product_id===product.id?{...line,quantity:value}:line):[...previous.lines,{product_id:product.id,quantity:value}]}));};
  async function save(){
    if(lock.current||!unresolved&&!valid)return;
    if(!pending.current)pending.current={action:'recordCentralDegustation',requestKey:crypto.randomUUID(),date:data.date,employeeId:data.employeeId,source:form.source,...(form.source==='previously_expensed'?{legacyDispatchId:form.legacyDispatchId}:{}),customerId:form.customerId,reason:form.reason.trim(),lines:form.lines.map(line=>({...line}))};
    lock.current=true;setBusy(true);setSaveError('');
    try{const value=await invoke(pending.current);pending.current=null;onSaved(value.record);}catch(error){setSaveError(error.message);}finally{lock.current=false;setBusy(false);}
  }
  return <Dialog open onOpenChange={open=>{if(!open&&!busy)onClose();}}><DialogContent className="max-h-[92dvh] max-w-4xl overflow-y-auto" onEscapeKeyDown={event=>{if(busy)event.preventDefault();}} onPointerDownOutside={event=>{if(busy)event.preventDefault();}}>
    <DialogHeader><DialogTitle>{ui('Record Dégustation')}</DialogTitle><DialogDescription>{ui('Record products actually given away. Company stock is reduced and their carrying cost is recorded as Dégustation expense.')}</DialogDescription></DialogHeader>
    {loading&&<p role="status">{ui('Checking company stock...')}</p>}
    {loadError&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{uiMessage(loadError)} <Button variant="outline" disabled={busy||loading} onClick={()=>setReload(value=>value+1)}>{ui('Retry')}</Button></p>}
    {data&&<fieldset disabled={busy||loading||!!loadError||unresolved} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {data.canChooseEmployee?<label className="text-sm">{ui('Employee recording Dégustation')}<select aria-label={ui('Employee recording Dégustation')} className={selectClass} value={data.employeeId||''} onChange={event=>{if(!busy&&!unresolved){setEmployeeId(event.target.value);setForm(previous=>({...previous,legacyDispatchId:'',customerId:'',lines:[]}));}}}><option value="">{ui('Choose an employee')}</option>{data.employees.map(employee=><option key={employee.id} value={employee.id}>{employee.full_name}</option>)}</select></label>:<p className="rounded-lg bg-slate-50 p-3 text-sm">{ui('Recorded under your profile')}: <strong>{data.employee?.full_name}</strong></p>}
        <p className="self-center text-sm text-slate-600">{ui('Date')}: {data.date}</p>
      </div>
      <Button variant="outline" type="button" disabled={busy||loading||unresolved} onClick={()=>setReload(value=>value+1)}>{ui('Refresh stock')}</Button>
      {!!legacy.length&&<label className="block text-sm">{ui('Dégustation stock source')}<select aria-label={ui('Dégustation stock source')} className={selectClass} value={form.source} onChange={event=>set('source',event.target.value)}><option value="company">{ui('Company stock')}</option><option value="previously_expensed">{ui('Previously expensed promotional stock')}</option></select></label>}
      {form.source==='previously_expensed'&&<><p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{ui('These products were expensed earlier. Recording their giveaway reduces the remaining allocation without another expense.')}</p><label className="block text-sm">{ui('Promotional allocation')}<select aria-label={ui('Promotional allocation')} className={selectClass} value={form.legacyDispatchId} onChange={event=>set('legacyDispatchId',event.target.value)}><option value="">{ui('Choose')}</option>{legacy.map(row=><option key={row.id} value={row.id}>{row.dispatch_number} · {row.employee_name}</option>)}</select></label></>}
      <label className="block text-sm">{ui('Customer receiving Dégustation')}<select aria-label={ui('Customer receiving Dégustation')} className={selectClass} value={form.customerId} onChange={event=>set('customerId',event.target.value)}><option value="">{ui(form.source==='previously_expensed'?'Choose a customer':'No specific customer')}</option>{(data.customers||[]).map(customer=><option key={customer.id} value={customer.id}>{customer.business_name}</option>)}</select></label>
      <ProductCatalog products={products} selecting hidePrice lines={form.lines} onQuantityChange={quantity} quantityLabel={ui('Given away')} disabled={busy||loading||!!loadError||unresolved} emptyMessage={ui('No saleable promotional products are available from this source.')}/>
      <label className="block text-sm">{ui('Dégustation reason / reference')}<Input aria-label={ui('Dégustation reason / reference')} className="mt-1" maxLength={1000} value={form.reason} onChange={event=>set('reason',event.target.value)}/></label>
    </fieldset>}
    {saveError&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{uiMessage(saveError)}</p>}
    {unresolved&&<p className="text-sm text-slate-600">{ui('Retry to confirm the same giveaway. Stock and expense will not be recorded twice.')}</p>}
    <DialogFooter><Button variant="outline" disabled={busy} onClick={onClose}>{ui(unresolved?'Close':'Cancel')}</Button><Button disabled={busy||!unresolved&&!valid} onClick={save}>{busy?ui('Saving...'):ui(unresolved?'Retry giveaway':'Confirm Dégustation')}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
