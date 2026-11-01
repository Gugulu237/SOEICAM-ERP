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
import { UserPlus, MapPin } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { customerDeliveryRequest } from '@/lib/customer-delivery-client';
import { deliveryGpsStatus,GPS_LABELS } from '@/lib/customer-delivery';

export default function CustomerTasks({ embedded = false, directory = false, onRecordSale } = {}) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const navigate = useNavigate();
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
  return <div className={embedded ? "rounded-2xl border bg-white p-4 sm:p-5" : "mx-auto max-w-6xl p-4 sm:p-6"}>
    <PageHeader title={isAdmin ? ui("Customers") : ui("Customers")} subtitle={<CustomerInfo title={ui("Customers")}>{ui("Customer contacts, delivery pins and acquisition history.")}</CustomerInfo>}
      actions={<div className="flex gap-2">{commercialId && <Button variant="outline" onClick={() => navigate('/commercial?employee=' + encodeURIComponent(commercialId))}>{ui("Back to agent dashboard")}</Button>}{canRegister && <Button className="h-11" disabled={!canRegister} onClick={() => {setBranchParent(null);setOpen(true);}}><UserPlus size={16} className="mr-2" />{ui("New customer")}</Button>}</div>} />
    {commercialId && <CustomerInfo title={ui("Customers")}>{ui("Customers registered by or assigned to this agent. Field registrations and sales must be recorded by the employee from their own account.")}</CustomerInfo>}
    {!employee && !commercialId && <p className="mb-4 text-sm text-slate-800">{ui("Link your login to a staff record to register customers.")}</p>}
    <div className="mb-5 flex flex-wrap gap-3"><Input aria-label={ui("Find a customer")} value={search} onChange={event => setSearch(event.target.value)} placeholder={ui("Search name, phone, town or agent")} className="h-11 flex-1 bg-white" /><Button variant="outline" className="h-11" onClick={()=>navigate('/customers?view=map')}><MapPin size={16} className="mr-2"/>{ui('Map')}</Button></div>
    <div className="mb-4 flex flex-wrap items-center gap-3"><label className="text-xs">{ui("Delivery zone")}<select aria-label={ui("Filter customers by zone")} className="mt-1 h-10 w-full min-w-0 rounded-md border bg-white px-2 text-sm" value={zone} onChange={e=>setZone(e.target.value)}><option value="">{ui("All zones")}</option><option value="unassigned">{ui("Unassigned")}</option>{zoneOptions.data?.zones.map(z=><option key={z.id} value={z.id}>{z.name}</option>)}</select></label>{zoneOptions.isError&&<p className="text-xs text-slate-700">{ui("Zone names could not load. ")}<button className="underline" onClick={()=>zoneOptions.refetch()}>{ui("Retry")}</button></p>}</div>

    {paymentCustomer&&<CustomerCollectionDialog customer={paymentCustomer} onClose={()=>setPaymentCustomer(null)} onDone={()=>{setPaymentCustomer(null);setGpsNotice(ui('Cash collection recorded. Hand this cash to the cashier.'));}}/>}
    {spoilCustomer&&<SpoilageDialog open customer={spoilCustomer} onOpenChange={value=>{if(!value)setSpoilCustomer(null);}} onSaved={()=>setReportVersion(n=>n+1)}/>}
    {gpsCustomer && <CustomerGpsDialog key={gpsCustomer.id} customer={gpsCustomer} onClose={() => setGpsCustomer(null)} onSaved={({record}) => { setCustomers(rows => rows.map(row => row.id === record.id ? {...row,...record} : row)); setGpsCustomer(null); setGpsNotice(ui('GPS location saved.')); }} />}
    {gpsNotice&&<p role="status" className="mb-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{gpsNotice}</p>}
    {loading ? <p role="status" className="py-10 text-center text-slate-500">{ui("Loading customers…")}</p> : error ? <p role="alert" className="text-red-700">{uiMessage(error)} <button className="underline" onClick={() => setReload((n) => n + 1)}>{ui("Retry")}</button></p>
      : !profile?<CustomerGroupedList key={search+'|'+zone} customers={customers} matchingIds={filtered.map(c=>c.id)} search={search} onOpen={openProfile} onEditGps={canEditGps?c=>{setGpsNotice('');setGpsCustomer(c);}:undefined} renderDetails={c=><p className="text-xs text-slate-500">{zoneOptions.data?.zones.find(z=>z.id===c.delivery_zone_id)?.name||ui('Unassigned')}</p>}/>:<div className="space-y-3"><Button variant="ghost" onClick={()=>directory?backToList():openProfile(null)}>{ui('Back to customers')}</Button>{[profile].map((c) => <article key={c.id} className="space-y-3 rounded-2xl border bg-white p-5">
        <div><h2 className="font-semibold text-slate-900">{c.business_name}</h2><p className="text-sm text-slate-500">{[c.neighbourhood, c.town].filter(Boolean).join(', ') || ui("Address not specified")}</p></div>
        <CustomerActionGrid onSale={canRegister?()=>onRecordSale?onRecordSale(c.id):navigate('/commercial?section=pos&new=1&customer='+encodeURIComponent(c.id)):undefined} onReceive={canEditGps?()=>setPaymentCustomer(c):undefined} onSpoilage={canEditGps?()=>setSpoilCustomer(c):undefined} disabled={c.is_active===false}/>
        <p className="text-sm">{c.contact_person}{c.phone && <a href={'tel:' + c.phone} className="ml-2 text-blue-700">{c.phone}</a>}</p>
        {c.address && <p className="text-sm text-slate-600">{c.address}</p>}
        {c.delivery_instructions && <p className="text-sm text-slate-600">{c.delivery_instructions}</p>}
        <p className="text-xs text-slate-500">{ui("Zone: ")}{zoneOptions.data?.zones.find(z=>z.id===c.delivery_zone_id)?.name || (c.delivery_zone_id?ui("Previously assigned"):ui("Unassigned"))} · {GPS_LABELS[deliveryGpsStatus(c,zoneOptions.data?.policy)]}</p>
        <CustomerMapLinks customer={c} />
        {canEditGps&&c.is_active!==false&&<CustomerGpsButton point={c} onClick={()=>{setGpsNotice('');setGpsCustomer(c);}}/>}
        <div className="border-t pt-3 text-xs text-slate-500"><p>{ui("Acquired by ")}{c.acquired_by_name || ui("unassigned")} · {c.acquisition_date || ui("Date unavailable")}</p>{c.registered_by_name && <p className="mt-1">{ui("Registered by ")}{c.registered_by_name}</p>}<p className="mt-1">{ui("Acquisition: ")}{(c.acquisition_verified || ui("pending")).replaceAll('_', ' ')}{c.is_active === false ? ui(" · Inactive customer") : ''}</p></div>
          {canRegister&&!c.parent_id&&c.is_active!==false&&<Button variant="outline" className="h-11 w-full" onClick={()=>{setBranchParent(c);setOpen(true);}}>{ui('Add branch')}</Button>}
          {canEditGps&&<CustomerSpoilageReports customer={c} reload={reportVersion}/>}
      </article>)}</div>}
    <Dialog open={open} onOpenChange={(value) => { if (!registrationBusy) setOpen(value); }}><DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto" onPointerDownOutside={(e) => e.preventDefault()}><DialogHeader><DialogTitle>{ui("Register a field customer")}</DialogTitle></DialogHeader>
      {open && canRegister && <FieldCustomerRegistration key={branchParent?.id||'main'} parentCustomer={branchParent} parentOptions={customers} commercialId={commercialId} onBusyChange={setRegistrationBusy} onCancel={() => setOpen(false)} onSaved={(customer) => { setCustomers((rows) => [customer, ...rows.filter((c) => c.id !== customer.id)]); setOpen(false); }} />}
    </DialogContent></Dialog>
  </div>;
}
