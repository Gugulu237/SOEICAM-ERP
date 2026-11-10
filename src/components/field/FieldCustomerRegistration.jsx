
/* localized-messages */
import { sourceMessage, uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import {usePhoneLayout} from '@/hooks/usePhoneLayout';
import React, { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import GpsCapture from '@/components/customers/GpsCapture';
import { hasCustomerLocation } from '@/lib/customer-location';
import { invokeFieldOps, errorMessage } from '@/lib/field-ops';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { DeliveryZoneSelect,useDeliveryZoneOptions } from '@/components/customers/DeliverySetupFields';

export default function FieldCustomerRegistration({ onSaved, onCancel, onBusyChange = undefined, commercialId = '', commercialName = '', parentCustomer = null, parentOptions = null }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const phone=usePhoneLayout();
  const { employee, isAdmin } = useCurrentUser();
  const zoneOptions=useDeliveryZoneOptions();
  const canRegister = Boolean(employee?.id || (isAdmin && commercialId));
  const [form, setForm] = useState({ parent_id: parentCustomer?.id || '', business_name: '', phone: '', contact_person: '', whatsapp: '', category: 'shop', town: '', neighbourhood: '', address: '', delivery_instructions: '' });
  const [branch,setBranch]=useState(Boolean(parentCustomer));
  const [parents,setParents]=useState(parentOptions||[]),[parentLoading,setParentLoading]=useState(false),[parentError,setParentError]=useState('');
  const loadParents=async()=>{setParentLoading(true);setParentError('');try{const {data}=await invokeFieldOps({action:'fieldCustomers',commercialId:commercialId||undefined});if(data.error)throw Error(data.error);setParents(data.customers);}catch(e){setParentError(errorMessage(e));}finally{setParentLoading(false);}};
  const availableParents=(parentOptions||(parentCustomer?[parentCustomer]:parents)).filter(c=>!c.parent_id&&c.is_active!==false&&!c.customer_removed_at);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const requestKey = useRef(crypto.randomUUID());
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const submit = async (event) => {
    event.preventDefault();
    if (submitting.current || locating) return;
    if(branch&&(!form.parent_id||parentLoading||parentError)){setError(sourceMessage('Choose the parent customer'));return;}
    if (!hasCustomerLocation(form)) { setError(sourceMessage("Capture the delivery location before saving.")); return; }
    submitting.current = true; setBusy(true); onBusyChange?.(true); setError('');
    try {
      const res = await invokeFieldOps({ action: 'registerCustomer', commercialId: commercialId || undefined, customer: form, requestKey: requestKey.current });
      if (res.data.error) throw new Error(res.data.error);
      onSaved(res.data.customer);
    } catch (e) { setError(errorMessage(e)); }
    finally { submitting.current = false; setBusy(false); onBusyChange?.(false); }
  };
  const changeBranch=enabled=>{setBranch(enabled);if(!enabled)set('parent_id','');else if(!parentOptions&&!parentCustomer)loadParents();};
  const field=(key,label,required=false,type='text')=><label className="block space-y-1 text-xs font-semibold text-muted-foreground" key={key}>{ui(label)}{required?' *':''}<Input required={required} maxLength={200} type={type} value={form[key]} onChange={e=>set(key,e.target.value)} className="h-12 rounded-xl bg-white text-foreground"/></label>;
  if(phone)return <form data-mobile-customer-form onSubmit={submit} className="space-y-4 pb-12">
    <fieldset disabled={busy} className="space-y-4">
      <div role="group" aria-label={ui('Customer type')} className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1">{[[false,'Main customer'],[true,'Branch']].map(([value,label])=><button type="button" key={label} aria-pressed={branch===value} onClick={()=>changeBranch(value)} className={'min-h-11 rounded-lg text-sm font-semibold '+(branch===value?'border bg-white':'text-muted-foreground')}>{ui(label)}</button>)}</div>
      {branch&&<label className="block space-y-1 text-xs font-semibold text-muted-foreground">{ui('Main / parent customer')}<select required aria-label={ui('Main / parent customer')} disabled={parentLoading} className="h-12 w-full rounded-xl border bg-white px-3 text-sm text-foreground" value={form.parent_id} onChange={e=>set('parent_id',e.target.value)}><option value="">{ui('Choose the parent customer')}</option>{availableParents.map(c=><option key={c.id} value={c.id}>{c.business_name}</option>)}</select></label>}
      {branch&&parentLoading&&<p role="status" className="text-xs">{ui('Loading customers…')}</p>}
      {branch&&parentError&&<p role="alert" className="text-xs text-red-700">{uiMessage(parentError)} <button type="button" className="underline" onClick={loadParents}>{ui('Retry')}</button></p>}
      {field('business_name','Business / customer name',true)}{field('phone','Contact phone',true,'tel')}
      <div className="grid grid-cols-2 items-start gap-3"><DeliveryZoneSelect value={form.delivery_zone_id||''} onChange={value=>set('delivery_zone_id',value)} disabled={busy}/>{field('neighbourhood','Neighbourhood')}</div>
      <GpsCapture compact maxAccuracy={zoneOptions.data?.policy.maxAccuracy||30} value={form} onChange={gps=>setForm(previous=>({...previous,...gps}))} onBusyChange={value=>{setLocating(value);onBusyChange?.(value);}} disabled={busy}/>
      <section className="rounded-xl border bg-white p-3"><p className="text-xs font-semibold text-muted-foreground">{ui('Acquired by (employee)')}</p><p className="mt-1 text-sm font-semibold">{commercialName||(commercialId&&isAdmin?ui('the selected Commercial agent'):employee?.full_name)||ui('your linked staff account')}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{ui('New customers await administrator verification for acquisition bonuses.')}</p></section>
      <details className="rounded-xl border bg-white"><summary className="min-h-12 cursor-pointer p-3 text-sm font-semibold">{ui('Contact and delivery details')}</summary><div className="space-y-4 border-t p-3">{field('contact_person','Contact person')}{field('whatsapp','WhatsApp',false,'tel')}{field('town','Town')}
        <label className="block space-y-1 text-xs font-semibold text-muted-foreground">{ui('Customer type')}<select value={form.category} onChange={e=>set('category',e.target.value)} className="h-12 w-full rounded-xl border bg-white px-3 text-sm text-foreground">{['shop','minimarket','supermarket','wholesaler','cash_customer','institutional'].map(value=><option key={value} value={value}>{ui(value.replaceAll('_',' '))}</option>)}</select></label>
        <label className="block space-y-1 text-xs font-semibold text-muted-foreground">{ui('Address / landmark')}<Input value={form.address} onChange={e=>set('address',e.target.value)} className="h-12" maxLength={500}/></label>
        <label className="block space-y-1 text-xs font-semibold text-muted-foreground">{ui('Delivery instructions')}<Textarea value={form.delivery_instructions} maxLength={1000} onChange={e=>set('delivery_instructions',e.target.value)} placeholder={ui('Entrance, opening hours, who to call…')}/></label>
      </div></details>
    </fieldset>
    {error&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{uiMessage(error)}</p>}
    <div data-mobile-action-bar className="fixed inset-x-0 bottom-0 z-50 grid grid-cols-[auto_1fr] gap-2 border-t bg-white p-3 pb-[max(.75rem,env(safe-area-inset-bottom))]"><Button type="button" variant="outline" className="h-12" onClick={onCancel} disabled={busy||locating}>{ui('Cancel')}</Button><Button type="submit" className="h-12 rounded-xl" disabled={busy||locating||!canRegister||!hasCustomerLocation(form)}>{busy?ui('Saving customer…'):ui('Save customer')}</Button></div>
  </form>;
  return <form onSubmit={submit} className="space-y-5">
    <p className="text-sm text-slate-500">{ui("Customer credited to ")}{commercialName || (commercialId && isAdmin ? ui("the selected Commercial agent") : employee?.full_name) || ui("your linked staff account")}{ui(". New customers await administrator verification for acquisition bonuses.")}</p>
    <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-3 rounded-xl border p-3 sm:col-span-2">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={branch} onChange={e=>{const enabled=e.target.checked;setBranch(enabled);if(!enabled)set('parent_id','');else if(!parentOptions&&!parentCustomer)loadParents();}}/>{ui('This customer belongs to a main / parent customer')}</label>
        {branch&&<label className="block text-sm">{ui('Main / parent customer')}<select required aria-label={ui('Main / parent customer')} className="mt-1 h-11 w-full rounded-md border bg-white px-3" disabled={parentLoading} value={form.parent_id} onChange={e=>set('parent_id',e.target.value)}><option value="">{ui('Choose the parent customer')}</option>{availableParents.map(c=><option key={c.id} value={c.id}>{c.business_name}</option>)}</select></label>}
        {branch&&parentLoading&&<p role="status" className="text-xs">{ui('Loading customers…')}</p>}
        {branch&&parentError&&<p role="alert" className="text-xs text-red-700">{uiMessage(parentError)} <button type="button" className="underline" onClick={loadParents}>{ui('Retry')}</button></p>}
      </div>
      {[['business_name', ui("Business / customer name"), true], ['phone', ui("Contact phone"), true], ['contact_person', ui("Contact person"), false], ['whatsapp', 'WhatsApp', false], ['town', 'Town', false], ['neighbourhood', 'Neighbourhood', false]].map(([key, label, required]) =>
        <label key={String(key)} className="space-y-1.5 text-sm font-medium">{label}{required ? ' *' : ''}<Input required={!!required} maxLength={200} type={['phone', 'whatsapp'].includes(String(key)) ? 'tel' : 'text'} value={form[String(key)]} onChange={(e) => set(String(key), e.target.value)} className="h-11" /></label>)}
      <label className="space-y-1.5 text-sm font-medium">{ui("Customer type")}<select value={form.category} onChange={(e) => set('category', e.target.value)} className="h-11 w-full rounded-md border bg-white px-3">{['shop', 'minimarket', 'supermarket', 'wholesaler', 'cash_customer', 'institutional'].map((c) => <option key={c} value={c}>{c.replaceAll('_', ' ')}</option>)}</select></label>
      <label className="space-y-1.5 text-sm font-medium">{ui("Address / landmark")}<Input value={form.address} onChange={(e) => set('address', e.target.value)} className="h-11" maxLength={500} /></label>
      <div className="sm:col-span-2"><DeliveryZoneSelect value={form.delivery_zone_id || ''} onChange={value=>set('delivery_zone_id',value)} disabled={busy}/></div>
      <div className="sm:col-span-2"><GpsCapture maxAccuracy={zoneOptions.data?.policy.maxAccuracy || 30} value={form} onChange={(gps) => setForm((f) => ({ ...f, ...gps }))} onBusyChange={(value) => { setLocating(value); onBusyChange?.(value); }} disabled={busy} /></div>
      <label className="space-y-1.5 text-sm font-medium sm:col-span-2">{ui("Delivery instructions")}<Textarea value={form.delivery_instructions} maxLength={1000} onChange={(e) => set('delivery_instructions', e.target.value)} placeholder={ui("Entrance, opening hours, who to call…")} /></label>
    </fieldset>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{uiMessage(error)}</p>}
    <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" onClick={onCancel} disabled={busy || locating}>{ui("Cancel")}</Button><Button type="submit" className="h-11" disabled={busy || locating || !canRegister || !hasCustomerLocation(form)}>{busy ? ui("Saving customer…") : ui("Register customer")}</Button></div>
  </form>;
}
