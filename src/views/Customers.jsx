
/* localized-messages */
import { sourceMessage, uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { usePageState } from '@/lib/navigation-context';
import { erp } from "@/api/erpClient";
import { useNavigate,useSearchParams } from "@/lib/router";
import { useMenuBack } from '@/hooks/useMenuBack';
import dynamic from 'next/dynamic';
import { readAll } from '@/lib/field-pos';

import PageHeader from "@/components/shared/PageHeader";


import CustomerGroupedList from "@/components/customers/CustomerGroupedList";
import CustomerCollectionDialog from "@/components/customers/CustomerCollectionDialog";
import CustomerGpsDialog from "@/components/customers/CustomerGpsDialog";
import { canCaptureCustomerGps } from "@/components/customers/CustomerGpsButton";
import { useCurrentUser } from '@/hooks/useCurrentUser';
import useCustomerPaymentStatus from '@/components/customers/useCustomerPaymentStatus';
import CustomerPaymentSummary from '@/components/customers/CustomerPaymentSummary';
import CustomerOpeningBalance from '@/components/customers/CustomerOpeningBalance';
import CustomerReceivePayment from '@/components/customers/CustomerReceivePayment';
import CustomerInfo from '@/components/customers/CustomerInfo';
import PartnerDetail from "@/components/customers/PartnerDetail";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Users, MapPin, Map as MapIcon, UserPlus } from "lucide-react";
const CustomerTasks=dynamic(()=>import('@/components/customers/CustomerTasks'));

const CustomerDeliveryZones=dynamic(()=>import('@/components/customers/CustomerDeliveryZones'));
const CustomerMapWorkspace=dynamic(()=>import('@/components/customers/CustomerMapWorkspace'));
const viewOptions=[{value:'list',icon:Users,get label(){return ui('View customers');}},{value:'zones',icon:MapPin,get label(){return ui('Delivery zones');}},{value:'map',icon:MapIcon,get label(){return ui('Map');}}];

export default function Customers() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [params,setParams]=useSearchParams(),navigate=useNavigate();
  const {role,employee,loading}=useCurrentUser();
  const backToMenu=useMenuBack('/customers');
  const options=role==='commercial'?viewOptions.filter(option=>option.value!=='zones'):viewOptions;
  const requested=params.get('view');
  const hasDetail=params.has('customer')||params.has('new')||params.has('parent');
  const view=options.some(o=>o.value===requested)?requested:hasDetail||['table','visual','removed','acquisitions','report'].includes(requested)?'list':'home';
  const setView=value=>setParams(new URLSearchParams({view:value}));
  const openCustomer=id=>{const next=new URLSearchParams(params);next.set('view','list');next.set('customer',id);setParams(next);};
  const canRegister=role!=='commercial'||Boolean(employee?.id&&(!employee.status||employee.status==='active'));
  const addCustomer=()=>role==='commercial'?setParams(new URLSearchParams({view:'list',new:'1'})):navigate('/customers/new');
  if(loading)return <p role="status">{ui('Loading customers...')}</p>;
  if(view==='home')return <div className="min-w-0 space-y-5">
    <PageHeader title={ui('Customers')}/>
    <nav aria-label={ui('Customer sections')} className="mx-auto grid max-w-5xl grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
      {[...options,...(canRegister?[{value:'new',icon:UserPlus,label:ui('Add customer')}]:[])].map(option=>{const Icon=option.icon;return <button type="button" key={option.value} aria-label={option.label} onClick={()=>option.value==='new'?addCustomer():setView(option.value)} className="group flex min-h-40 min-w-0 flex-col items-center justify-center gap-4 rounded-2xl border border-slate-200 bg-white px-3 py-6 text-center shadow-sm transition-colors hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 sm:min-h-48">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Icon size={28} strokeWidth={1.7} aria-hidden="true"/></span>
        <span className="break-words text-sm font-semibold text-slate-900 sm:text-base">{option.label}</span>
      </button>;})}
    </nav>
  </div>;
  return <div className="min-w-0 space-y-4">
    {view==='map'?<><PageHeader title={ui('Map')} back={{onClick:backToMenu,label:ui('Customers menu')}}/><CustomerMapWorkspace onClose={backToMenu} onOpenCustomer={role==='commercial'?undefined:openCustomer}/></>:role==='commercial'?<CustomerTasks directory back={{onClick:backToMenu,label:ui('Customers menu')}}/>:view==='list'?<CustomerDirectory selectedId={params.get('customer')} back={{onClick:backToMenu,label:ui('Customers menu')}}/>:<><PageHeader back={{onClick:backToMenu,label:ui('Customers menu')}} title={ui('Delivery zones')} subtitle={<CustomerInfo title={ui('Delivery zones')}>{ui('Delivery zones, outlet locations and GPS coverage')}</CustomerInfo>}/><CustomerDeliveryZones onOpenCustomer={openCustomer}/></>}
  </div>;
}

export function CustomerDirectory({selectedId,back}) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [params,setParams]=useSearchParams();
  const backToList=useMenuBack('/customers?view=list');
  const [records, setCustomers] = useState([]);
  const customers = useMemo(()=>records.filter(row=>!row.customer_removed_at),[records]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,setError]=useState('');
  const [selected, setSelected] = useState(null);
  const selectCustomer=customer=>{setSelected(customer);const next=new URLSearchParams(params);next.set('view','list');customer?next.set('customer',customer.id):next.delete('customer');setParams(next);};
  const [search, setSearch] = usePageState("customer-directory:search", "");
  const navigate = useNavigate();
  const session = useCurrentUser();
  const { isAdmin, isCommercial, role } = session;
  const canCollect=['admin','employee','commercial','cashier'].includes(role)&&!session.loading;
  const canReport=['admin','employee','commercial'].includes(role)&&!session.loading;
  const canEditGps = canCaptureCustomerGps(session);
  const [gpsTarget, setGpsTarget] = useState(null), [notice, setNotice] = useState('');
  const editGps = (customer, location) => { setNotice(''); setGpsTarget({ customer, location }); };
  const savedGps = ({kind, record}) => {
    if(kind==='location') setLocations(rows=>rows.map(row=>row.id===record.id?{...row,...record}:row));
    else {setCustomers(rows=>rows.map(row=>row.id===record.id?{...row,...record}:row));setSelected(row=>row?.id===record.id?{...row,...record}:row);}
    setGpsTarget(null);setNotice(ui('GPS location saved.'));
  };
  const [receiptCustomer, setReceiptCustomer] = useState(null);
  const paymentStatus = useCustomerPaymentStatus(customers, isAdmin);

  const load = useCallback(async () => {
    setError('');
    try {
    const [cs, ls] = await Promise.all([
      readAll(erp.entities.Customer),
      readAll(erp.entities.CustomerLocation,{ is_active: true }),
    ]);
    setCustomers(cs);
    setLocations(ls);
    setSelected(sel => sel ? cs.find(c => c.id === sel.id) || null : null);
    }catch(e){setError(e.message || sourceMessage("Customer records could not load."));}finally{setLoading(false);}
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(()=>{setSelected(selectedId ? customers.find(c=>c.id===selectedId) || null : null);},[selectedId,customers]);

  const locationsByCustomer = locations.reduce((acc, l) => {
    (acc[l.customer_id] = acc[l.customer_id] || []).push(l);
    return acc;
  }, {});

  // Sub-partners grouped under their main partner.
  const childrenByParent = customers.reduce((acc, c) => {
    if (!c.parent_id) return acc;
    (acc[c.parent_id] = acc[c.parent_id] || []).push(c);
    return acc;
  }, {});
  const customerById=new Map(customers.map(customer=>[customer.id,customer]));
  const query=search.trim().toLocaleLowerCase();
  const filtered=customers.filter(customer=>[customer.business_name,customer.customer_number,customer.phone,customer.contact_person,customer.town,customer.neighbourhood,customerById.get(customer.parent_id)?.business_name,...(locationsByCustomer[customer.id]||[]).flatMap(location=>[location.name,location.town])].join(' ').toLocaleLowerCase().includes(query)).sort((a,b)=>(a.business_name||'').localeCompare(b.business_name||''));

  if (loading) return <div><PageHeader title={ui('Customers')} back={selectedId?{onClick:backToList,label:ui('Back to customers')}:back}/><div role="status" aria-label={ui('Loading customers...')} className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-primary rounded-full animate-spin" /></div></div>;

  return (
    <div>
      <PageHeader
        back={selectedId?{onClick:backToList,label:ui('Back to customers')}:back}
        title={selected?.business_name || ui("Customers")}
        subtitle={!selectedId ? ui('{0} customers',customers.length) : undefined}
        actions={
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Button onClick={() => navigate("/customers/new")}><Plus size={16} className="mr-1" />{ui("Add customer")}</Button>
          </div>
        }
      />

      {error&&<p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{uiMessage(error)} <button className="underline" onClick={load}>{ui("Retry")}</button></p>}
      {notice&&<p role="status" className="mb-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
      {gpsTarget&&<CustomerGpsDialog key={gpsTarget.location?.id||gpsTarget.customer.id} {...gpsTarget} onClose={()=>setGpsTarget(null)} onSaved={savedGps}/>}
      {!selected?<div className="mx-auto max-w-4xl space-y-3">
        <Input aria-label={ui('Find a customer')} placeholder={ui('Name, phone or neighbourhood')} value={search} onChange={event=>setSearch(event.target.value)} className="bg-white"/>
        <CustomerGroupedList key={search} customers={customers} matchingIds={filtered.map(c=>c.id)} search={search} onOpen={selectCustomer}/>
      </div>:<div className="min-w-0">
            {selected ? (
              <>
              {isAdmin && selected.acquired_by_name && <section className="mb-4 rounded-xl border bg-white p-4 text-sm"><p>{ui("Acquired by ")}<strong>{selected.acquired_by_name}</strong> / {selected.acquisition_date}</p>{selected.registered_by_name && <p className="mt-1 text-xs text-slate-500">{ui("Registered by ")}{selected.registered_by_name}</p>}<p className="mt-1 text-xs text-slate-500">{ui("Acquisition: ")}{(selected.acquisition_verified || 'pending').replaceAll('_', ' ')}</p></section>}

              <PartnerDetail
                key={selected.id}
                partner={selected}
                onSale={(isAdmin||isCommercial)?()=>navigate((isCommercial?'/commercial?section=pos&new=1&customer=':'/sales/new?customer=')+encodeURIComponent(selected.id)):undefined}
                onReceive={canCollect?()=>setReceiptCustomer(selected):undefined}
                canReportSpoilage={canReport}
                paymentSummary={isAdmin?<><CustomerOpeningBalance key={selected.id} customer={selected} onSaved={()=>{load();paymentStatus.refetch();}}/><CustomerPaymentSummary customer={selected} summary={paymentStatus.data?.[selected.id]} error={paymentStatus.isError} onRetry={()=>paymentStatus.refetch()}/></>:null}
                onEditGps={canEditGps?editGps:undefined}
                onChanged={load}
                subPartners={childrenByParent[selected.id] || []}
                parentPartner={customers.find(c => c.id === selected.parent_id) || null}
                locationsByCustomer={locationsByCustomer}
                onSelect={selectCustomer}
              />
              </>
            ) : null}
        </div>}
      {canCollect&&receiptCustomer&&(role==='cashier'?<CustomerReceivePayment key={receiptCustomer.id} customer={receiptCustomer} onClose={()=>setReceiptCustomer(null)} onDone={()=>{setReceiptCustomer(null);paymentStatus.refetch();load();}}/>:<CustomerCollectionDialog key={receiptCustomer.id} customer={receiptCustomer} onClose={()=>setReceiptCustomer(null)} onDone={()=>{setReceiptCustomer(null);setNotice(ui('Cash collection recorded. Hand this cash to the cashier.'));paymentStatus.refetch();load();}}/>)}
    </div>
  );
}
