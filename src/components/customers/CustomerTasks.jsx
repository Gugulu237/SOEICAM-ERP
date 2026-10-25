import CustomerInfo from './CustomerInfo';

/* localized-messages */
import { uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from '@/lib/router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import PageHeader from '@/components/shared/PageHeader';
import FieldCustomerRegistration from '@/components/field/FieldCustomerRegistration';
import CustomerMapLinks from '@/components/customers/CustomerMapLinks';
import CustomerDeliveryPlanner from '@/components/customers/CustomerDeliveryPlanner';
import CustomerGpsDialog from '@/components/customers/CustomerGpsDialog';
import { invokeFieldOps, errorMessage } from '@/lib/field-ops';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { UserPlus, ShoppingBag, MapPin } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { customerDeliveryRequest } from '@/lib/customer-delivery-client';
import { deliveryGpsStatus,GPS_LABELS } from '@/lib/customer-delivery';

export default function CustomerTasks({ embedded = false, onRecordSale } = {}) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { employee, isAdmin, role, loading: authLoading } = useCurrentUser();
  const commercialId = isAdmin ? params.get('commercial') || '' : '';
  const canRegister = role === 'commercial' && Boolean(employee?.id) && (!employee.status || employee.status === 'active');
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(() => !isAdmin && params.get('new') === '1');
  const [registrationBusy, setRegistrationBusy] = useState(false);
  const [showMap, setShowMap] = useState(false), [gpsCustomer, setGpsCustomer] = useState(null);
  const [reload, setReload] = useState(0);
  const [zone,setZone]=useState('');
  const zoneOptions=useQuery({queryKey:['delivery-zone-options'],queryFn:()=>customerDeliveryRequest({action:'deliveryZoneOptions'}),staleTime:60000});
  useEffect(() => {
    if (params.get('new') === '1') { if (canRegister) setOpen(true); const next = new URLSearchParams(params); next.delete('new'); setParams(next, { replace: true }); }
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
  const filtered = customers.filter((c) => (!zone || (zone==='unassigned'?!c.delivery_zone_id:c.delivery_zone_id===zone)) && [c.business_name, c.phone, c.town, c.neighbourhood, c.acquired_by_name].join(' ').toLowerCase().includes(search.toLowerCase()));
  return <div className={embedded ? "rounded-2xl border bg-white p-4 sm:p-5" : "mx-auto max-w-6xl p-4 sm:p-6"}>
    <PageHeader title={isAdmin ? ui("Customers") : ui("Customers")} subtitle={<CustomerInfo title={ui("Customers")}>{ui("Customer contacts, delivery pins and acquisition history.")}</CustomerInfo>}
      actions={<div className="flex gap-2">{commercialId && <Button variant="outline" onClick={() => navigate('/commercial?employee=' + encodeURIComponent(commercialId))}>{ui("Back to agent dashboard")}</Button>}{canRegister && <Button className="h-11" disabled={!canRegister} onClick={() => setOpen(true)}><UserPlus size={16} className="mr-2" />{ui("New customer")}</Button>}</div>} />
    {commercialId && <CustomerInfo title={ui("Customers")}>{ui("Customers registered by or assigned to this agent. Field registrations and sales must be recorded by the employee from their own account.")}</CustomerInfo>}
    {!employee && !commercialId && <p className="mb-4 text-sm text-slate-800">{ui("Link your login to a staff record to register customers.")}</p>}
    <div className="mb-5 flex flex-wrap gap-3"><Input aria-label={ui("Find a customer")} value={search} onChange={event => setSearch(event.target.value)} placeholder={ui("Search name, phone, town or agent")} className="h-11 flex-1 bg-white" /><Button variant={showMap ? 'default' : 'outline'} className="h-11" onClick={() => setShowMap(value => !value)}><MapPin size={16} className="mr-2" />{showMap ? ui("Hide map") : ui("Customer map & deliveries")}</Button></div>
    <div className="mb-4 flex flex-wrap items-center gap-3"><label className="text-xs">{ui("Delivery zone")}<select aria-label={ui("Filter customers by zone")} className="ml-2 h-10 rounded-md border bg-white px-2 text-sm" value={zone} onChange={e=>setZone(e.target.value)}><option value="">{ui("All zones")}</option><option value="unassigned">{ui("Unassigned")}</option>{zoneOptions.data?.zones.map(z=><option key={z.id} value={z.id}>{z.name}</option>)}</select></label>{zoneOptions.isError&&<p className="text-xs text-slate-700">{ui("Zone names could not load. ")}<button className="underline" onClick={()=>zoneOptions.refetch()}>{ui("Retry")}</button></p>}</div>
    {showMap && !loading && !error && <CustomerDeliveryPlanner customers={filtered} />}
    {gpsCustomer && <CustomerGpsDialog key={gpsCustomer.id} customer={gpsCustomer} onClose={() => setGpsCustomer(null)} onSaved={customer => { setCustomers(rows => rows.map(row => row.id === customer.id ? customer : row)); setGpsCustomer(null); }} />}
    {loading ? <p role="status" className="py-10 text-center text-slate-500">{ui("Loading customers…")}</p> : error ? <p role="alert" className="text-red-700">{uiMessage(error)} <button className="underline" onClick={() => setReload((n) => n + 1)}>{ui("Retry")}</button></p>
      : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{!filtered.length && <p className="py-10 text-slate-500">{ui("No customers match. Register a customer to get started.")}</p>}{filtered.map((c) => <article key={c.id} className="space-y-3 rounded-2xl border bg-white p-5">
        <div><h2 className="font-semibold text-slate-900">{c.business_name}</h2><p className="text-sm text-slate-500">{[c.neighbourhood, c.town].filter(Boolean).join(', ') || ui("Address not specified")}</p></div>
        <p className="text-sm">{c.contact_person}{c.phone && <a href={'tel:' + c.phone} className="ml-2 text-blue-700">{c.phone}</a>}</p>
        {c.address && <p className="text-sm text-slate-600">{c.address}</p>}
        {c.delivery_instructions && <p className="text-sm text-slate-600">{c.delivery_instructions}</p>}
        <p className="text-xs text-slate-500">{ui("Zone: ")}{zoneOptions.data?.zones.find(z=>z.id===c.delivery_zone_id)?.name || (c.delivery_zone_id?ui("Previously assigned"):ui("Unassigned"))} · {GPS_LABELS[deliveryGpsStatus(c,zoneOptions.data?.policy)]}</p>
        <CustomerMapLinks customer={c} />
        {c.is_active !== false && <Button variant="ghost" size="sm" className="min-h-10 px-0 text-emerald-700" onClick={() => setGpsCustomer(c)}><MapPin size={14} className="mr-1" />{ui("Update delivery pin")}</Button>}
        <div className="border-t pt-3 text-xs text-slate-500"><p>{ui("Acquired by ")}{c.acquired_by_name || ui("unassigned")} · {c.acquisition_date || ui("Date unavailable")}</p>{c.registered_by_name && <p className="mt-1">{ui("Registered by ")}{c.registered_by_name}</p>}<p className="mt-1">{ui("Acquisition: ")}{(c.acquisition_verified || ui("pending")).replaceAll('_', ' ')}{c.is_active === false ? ui(" · Inactive customer") : ''}</p></div>
          {canRegister && <Button variant="outline" className="h-11 w-full" disabled={!canRegister || c.is_active === false} onClick={() => onRecordSale ? onRecordSale(c.id) : navigate('/commercial?section=pos&new=1&customer=' + encodeURIComponent(c.id) + (commercialId ? '&employee=' + encodeURIComponent(commercialId) : ''))}><ShoppingBag size={16} className="mr-2" />{ui("Record supply / sale")}</Button>}
      </article>)}</div>}
    <Dialog open={open} onOpenChange={(value) => { if (!registrationBusy) setOpen(value); }}><DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto" onPointerDownOutside={(e) => e.preventDefault()}><DialogHeader><DialogTitle>{ui("Register a field customer")}</DialogTitle></DialogHeader>
      {open && canRegister && <FieldCustomerRegistration commercialId={commercialId} onBusyChange={setRegistrationBusy} onCancel={() => setOpen(false)} onSaved={(customer) => { setCustomers((rows) => [customer, ...rows.filter((c) => c.id !== customer.id)]); setOpen(false); }} />}
    </DialogContent></Dialog>
  </div>;
}
