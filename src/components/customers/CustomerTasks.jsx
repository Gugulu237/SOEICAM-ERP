import {usePhoneLayout} from '@/hooks/usePhoneLayout';
import MobileCustomerHeader from './MobileCustomerHeader';
import MobileCustomerOverview from './MobileCustomerOverview';
import CustomerInfo from './CustomerInfo';
import CustomerGroupedList from './CustomerGroupedList';
import CustomerActionGrid from './CustomerActionGrid';
import CustomerCollectionDialog from './CustomerCollectionDialog';
import SpoilageDialog from './SpoilageDialog';
import CustomerSpoilageReports from './CustomerSpoilageReports';
import CustomerGpsButton, {canCaptureCustomerGps} from './CustomerGpsButton';

/* localized-messages */
import { uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from '@/lib/router';
import { useMenuBack } from '@/hooks/useMenuBack';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import PageHeader from '@/components/shared/PageHeader';
import FieldCustomerRegistration from '@/components/field/FieldCustomerRegistration';
import CustomerMapLinks from '@/components/customers/CustomerMapLinks';

import CustomerGpsDialog from '@/components/customers/CustomerGpsDialog';
import { invokeFieldOps, errorMessage } from '@/lib/field-ops';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { UserPlus, MapPin, Plus, Search } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { customerDeliveryRequest } from '@/lib/customer-delivery-client';
import { deliveryGpsStatus,GPS_LABELS } from '@/lib/customer-delivery';

export default function CustomerTasks({ embedded = false, directory = false, back, onRecordSale } = {}) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const navigate = useNavigate();
  const phone=usePhoneLayout();
  const backToList=useMenuBack('/customers?view=list');
  const [params, setParams] = useSearchParams();
  const session = useCurrentUser();
  const { employee, isAdmin, role, loading: authLoading } = session;
  const canEditGps=canCaptureCustomerGps(session);
  const [gpsNotice,setGpsNotice]=useState('');
  const commercialId = isAdmin ? params.get('commercial') || '' : '';
  const canRegister = role === 'commercial' && Boolean(employee?.id) && (!employee.status || employee.status === 'active');
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(() => !isAdmin && params.get('new') === '1');
  const [branchParent,setBranchParent]=useState(null);
  const [registrationBusy, setRegistrationBusy] = useState(false);
  const [gpsCustomer, setGpsCustomer] = useState(null),[paymentCustomer,setPaymentCustomer]=useState(null),[spoilCustomer,setSpoilCustomer]=useState(null),[reportVersion,setReportVersion]=useState(0);
  const [reload, setReload] = useState(0);
  const [zone,setZone]=useState('');
  const zoneOptions=useQuery({queryKey:['delivery-zone-options'],queryFn:()=>customerDeliveryRequest({action:'deliveryZoneOptions'}),staleTime:60000});
  useEffect(() => {
    if (params.get('new') === '1') { if (canRegister) setOpen(true); const next = new URLSearchParams(params); next.delete('new'); if(directory)next.set('view','list'); setParams(next, { replace: true }); }
  }, [params, setParams]);
  useEffect(() => {
    if (authLoading) return;
    let active = true;
    setLoading(true); setError('');
    setCustomers([]);
    invokeFieldOps({ action: 'fieldCustomers', commercialId }).then((res) => {
      if (res.data.error) throw new Error(res.data.error);
      if (active) setCustomers(res.data.customers);
    }).catch((e) => { if (active) setError(errorMessage(e)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [authLoading, reload, commercialId]);
  useEffect(()=>{const parent=params.get('parent');if(!parent||loading||!canRegister)return;const customer=customers.find(c=>c.id===parent&&!c.parent_id&&c.is_active!==false);if(customer){setBranchParent(customer);setOpen(true);}const next=new URLSearchParams(params);next.delete('parent');if(directory)next.set('view','list');setParams(next,{replace:true});},[loading,customers,canRegister,params,setParams]);
  const profile=customers.find(c=>c.id===params.get('customer'));
  const openProfile=c=>{const next=new URLSearchParams(params);c?next.set('customer',c.id):next.delete('customer');setParams(next);};
  const filtered = customers.filter((c) => (!zone || (zone==='unassigned'?!c.delivery_zone_id:c.delivery_zone_id===zone)) && [c.business_name, c.phone, c.town, c.neighbourhood, c.acquired_by_name].join(' ').toLowerCase().includes(search.toLowerCase()));
  const profileSale=customer=>onRecordSale?onRecordSale(customer.id):navigate('/commercial?section=pos&new=1&customer='+encodeURIComponent(customer.id));
  return <div className={embedded ? "rounded-2xl border bg-white p-4 sm:p-5" : "mx-auto max-w-6xl sm:p-6"}>
    {phone?<MobileCustomerHeader title={profile?.business_name||ui('Customers')} subtitle={profile?[ui(profile.parent_id?'Branch':'Main customer'),profile.neighbourhood||profile.town].filter(Boolean).join(' · '):ui('{0} customers',customers.length)} back={profile?{onClick:()=>directory?backToList():openProfile(null),label:ui('Back to customers')}:back} actions={!profile&&<>
      <button type="button" aria-label={ui('Map')} onClick={()=>navigate('/customers?view=map')} className="flex h-12 w-12 items-center justify-center rounded-xl border bg-white"><MapPin size={20}/></button>
      {canRegister&&<button type="button" aria-label={ui('New customer')} onClick={()=>{setBranchParent(null);setOpen(true);}} className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-white"><Plus size={20}/></button>}
    </>}/>:<PageHeader back={profile?{onClick:()=>directory?backToList():openProfile(null),label:ui('Back to customers')}:commercialId?{onClick:()=>navigate('/commercial?employee='+encodeURIComponent(commercialId)),label:ui('Back to agent dashboard')}:back} title={profile?.business_name || ui("Customers")} subtitle={<CustomerInfo title={ui("Customers")}>{ui("Customer contacts, delivery pins and acquisition history.")}</CustomerInfo>}
      actions={<div className="flex gap-2">{canRegister && <Button className="h-11" disabled={!canRegister} onClick={() => {setBranchParent(null);setOpen(true);}}><UserPlus size={16} className="mr-2" />{ui("New customer")}</Button>}</div>} />}
    {commercialId && <CustomerInfo title={ui("Customers")}>{ui("Customers registered by or assigned to this agent. Field registrations and sales must be recorded by the employee from their own account.")}</CustomerInfo>}
    {!employee && !commercialId && <p className="mb-4 text-sm text-slate-800">{ui("Link your login to a staff record to register customers.")}</p>}
    {(!phone||!profile)&&<>
    <div className="relative mb-3 flex flex-wrap gap-3">{phone&&<Search size={17} className="pointer-events-none absolute left-3 top-3.5 text-slate-400"/>}<Input aria-label={ui("Find a customer")} value={search} onChange={event => setSearch(event.target.value)} placeholder={ui("Search name, phone, town or agent")} className={phone?"h-12 flex-1 rounded-xl bg-white pl-10":"h-11 flex-1 bg-white"} />{!phone&&<Button variant="outline" className="h-11" onClick={()=>navigate('/customers?view=map')}><MapPin size={16} className="mr-2"/>{ui('Map')}</Button>}</div>
    {phone?<nav aria-label={ui('Filter customers by zone')} className="mb-4 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">{[{id:'',name:ui('All zones')},{id:'unassigned',name:ui('Unassigned')},...(zoneOptions.data?.zones||[])].map(item=><button type="button" key={item.id} aria-pressed={zone===item.id} onClick={()=>setZone(item.id)} className={'min-h-11 shrink-0 rounded-xl border px-3 text-xs font-semibold '+(zone===item.id?'border-primary bg-primary text-white':'bg-white')}>{item.name}</button>)}</nav>:<div className="mb-4 flex flex-wrap items-center gap-3"><label className="text-xs">{ui("Delivery zone")}<select aria-label={ui("Filter customers by zone")} className="mt-1 h-10 w-full min-w-0 rounded-md border bg-white px-2 text-sm" value={zone} onChange={e=>setZone(e.target.value)}><option value="">{ui("All zones")}</option><option value="unassigned">{ui("Unassigned")}</option>{zoneOptions.data?.zones.map(z=><option key={z.id} value={z.id}>{z.name}</option>)}</select></label>{zoneOptions.isError&&<p className="text-xs text-slate-700">{ui("Zone names could not load. ")}<button className="underline" onClick={()=>zoneOptions.refetch()}>{ui("Retry")}</button></p>}</div>}
    {phone&&zoneOptions.isError&&<p role="alert" className="mb-3 text-xs text-muted-foreground">{ui('Zone names could not load. ')}<button type="button" className="underline" onClick={()=>zoneOptions.refetch()}>{ui('Retry')}</button></p>}
    </>}

    {paymentCustomer&&<CustomerCollectionDialog customer={paymentCustomer} onClose={()=>setPaymentCustomer(null)} onDone={()=>{setPaymentCustomer(null);setGpsNotice(ui('Payment posted directly to treasury'));setReload(n=>n+1);}}/>}
    {spoilCustomer&&<SpoilageDialog open customer={spoilCustomer} onOpenChange={value=>{if(!value)setSpoilCustomer(null);}} onSaved={()=>setReportVersion(n=>n+1)}/>}
    {gpsCustomer && <CustomerGpsDialog key={gpsCustomer.id} customer={gpsCustomer} onClose={() => setGpsCustomer(null)} onSaved={({record}) => { setCustomers(rows => rows.map(row => row.id === record.id ? {...row,...record} : row)); setGpsCustomer(null); setGpsNotice(ui('GPS location saved.')); }} />}
    {gpsNotice&&<p role="status" className="mb-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{gpsNotice}</p>}
    {loading ? <p role="status" className="py-10 text-center text-slate-500">{ui("Loading customers…")}</p> : error ? <p role="alert" className="text-red-700">{uiMessage(error)} <button className="underline" onClick={() => setReload((n) => n + 1)}>{ui("Retry")}</button></p>
      : !profile?<CustomerGroupedList key={search+'|'+zone} customers={customers} matchingIds={filtered.map(c=>c.id)} search={search} onOpen={openProfile}/>:<div className="space-y-3 pb-24">{phone&&<MobileCustomerOverview partner={profile} salesUnavailable subPartners={customers.filter(c=>c.parent_id===profile.id)} onSelect={openProfile} onEditGps={canEditGps?customer=>{setGpsNotice('');setGpsCustomer(customer);}:undefined} onSale={canRegister?()=>profileSale(profile):undefined}/>}{[profile].map((c) => {const Tools=phone?'details':'article';return <Tools key={c.id} className="rounded-2xl border bg-white">{phone&&<summary className="min-h-12 cursor-pointer p-3 text-sm font-semibold">{ui('Customer tools and details')}</summary>}<div className="space-y-3 p-4">
        <div><h2 className="font-semibold text-slate-900">{c.business_name}</h2><p className="text-sm text-slate-500">{[c.neighbourhood, c.town].filter(Boolean).join(', ') || ui("Address not specified")}</p></div>
        <CustomerActionGrid onSale={!phone&&canRegister?()=>profileSale(c):undefined} onReceive={canEditGps?()=>setPaymentCustomer(c):undefined} onSpoilage={canEditGps?()=>setSpoilCustomer(c):undefined} disabled={c.is_active===false}/>
        <p className="text-sm">{c.contact_person}{c.phone && <a href={'tel:' + c.phone} className="ml-2 text-blue-700">{c.phone}</a>}</p>
        {c.address && <p className="text-sm text-slate-600">{c.address}</p>}
        {c.delivery_instructions && <p className="text-sm text-slate-600">{c.delivery_instructions}</p>}
        <p className="text-xs text-slate-500">{ui("Zone: ")}{zoneOptions.data?.zones.find(z=>z.id===c.delivery_zone_id)?.name || (c.delivery_zone_id?ui("Previously assigned"):ui("Unassigned"))} · {GPS_LABELS[deliveryGpsStatus(c,zoneOptions.data?.policy)]}</p>
        <CustomerMapLinks customer={c} />
        {canEditGps&&c.is_active!==false&&<CustomerGpsButton point={c} onClick={()=>{setGpsNotice('');setGpsCustomer(c);}}/>}
        <div className="border-t pt-3 text-xs text-slate-500"><p>{ui("Acquired by ")}{c.acquired_by_name || ui("unassigned")} · {c.acquisition_date || ui("Date unavailable")}</p>{c.registered_by_name && <p className="mt-1">{ui("Registered by ")}{c.registered_by_name}</p>}<p className="mt-1">{ui("Acquisition: ")}{(c.acquisition_verified || ui("pending")).replaceAll('_', ' ')}{c.is_active === false ? ui(" · Inactive customer") : ''}</p></div>
          {phone&&c.parent_id&&customers.some(parent=>parent.id===c.parent_id)&&<Button variant="outline" onClick={()=>openProfile(customers.find(parent=>parent.id===c.parent_id))}>{ui('Main customer')}: {customers.find(parent=>parent.id===c.parent_id).business_name}</Button>}
          {canRegister&&!c.parent_id&&c.is_active!==false&&<Button variant="outline" className="h-11 w-full" onClick={()=>{setBranchParent(c);setOpen(true);}}>{ui('Add branch')}</Button>}
          {canEditGps&&<CustomerSpoilageReports customer={c} reload={reportVersion}/>}
      </div></Tools>;})}</div>}
    <Dialog open={open} onOpenChange={(value) => { if (!registrationBusy) setOpen(value); }}><DialogContent style={phone?{transform:'none',animation:'none'}:undefined} className={phone?"left-0 top-0 flex h-[100dvh] flex-col max-h-[100dvh] w-full max-w-none translate-x-0 translate-y-0 overflow-y-auto rounded-none p-4 pb-28 [&>button:last-child]:hidden":"max-h-[90dvh] max-w-2xl overflow-y-auto"} onPointerDownOutside={(e) => e.preventDefault()}><DialogHeader className={phone?"sr-only":undefined}><DialogTitle>{ui("Register a field customer")}</DialogTitle></DialogHeader>{phone&&<MobileCustomerHeader title={ui('New customer')} subtitle={ui('Identity, zone and delivery location')} back={{onClick:()=>{if(!registrationBusy)setOpen(false);},disabled:registrationBusy,label:ui('Cancel')}}/>}
      {open && canRegister && <FieldCustomerRegistration key={branchParent?.id||'main'} parentCustomer={branchParent} parentOptions={customers} commercialId={commercialId} onBusyChange={setRegistrationBusy} onCancel={() => setOpen(false)} onSaved={(customer) => { setCustomers((rows) => [customer, ...rows.filter((c) => c.id !== customer.id)]); setOpen(false); }} />}
    </DialogContent></Dialog>
  </div>;
}
