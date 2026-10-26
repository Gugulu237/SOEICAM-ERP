
/* localized-messages */
import { sourceMessage, uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
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
