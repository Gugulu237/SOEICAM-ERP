
/* localized-messages */
import { sourceMessage, uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState, useEffect, useCallback } from "react";
import { usePageState } from '@/lib/navigation-context';
import { erp } from "@/api/erpClient";
import { useNavigate,useSearchParams } from "@/lib/router";
import dynamic from 'next/dynamic';
import { readAll } from '@/lib/field-pos';
import { formatXAF } from "@/lib/formatters";
import PageHeader from "@/components/shared/PageHeader";
import DataTable from "@/components/shared/DataTable";
import StatusBadge from "@/components/shared/StatusBadge";
import PartnerTree from "@/components/customers/PartnerTree";
import { useCurrentUser } from '@/hooks/useCurrentUser';
import useCustomerPaymentStatus from '@/components/customers/useCustomerPaymentStatus';
import CustomerPaymentBadge from '@/components/customers/CustomerPaymentBadge';
import CustomerPaymentSummary from '@/components/customers/CustomerPaymentSummary';
import CustomerReceivePayment from '@/components/customers/CustomerReceivePayment';
import CustomerInfo from '@/components/customers/CustomerInfo';
import PartnerDetail from "@/components/customers/PartnerDetail";
import GroupReport from "@/components/customers/GroupReport";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Building2, Network, Table2, BarChart3, ShoppingBag,MapPin,UserCheck,Trash2,ArrowLeft } from "lucide-react";
const CustomerTasks=dynamic(()=>import('@/components/customers/CustomerTasks'));
const CustomerAcquisitions=dynamic(()=>import('@/components/customers/CustomerAcquisitionReview'));
const CustomerDeliveryZones=dynamic(()=>import('@/components/customers/CustomerDeliveryZones'));
const CustomerMapWorkspace=dynamic(()=>import('@/components/customers/CustomerMapWorkspace'));
const viewOptions=[{value:'map',get label(){return ui('Map');},icon:MapPin},{value:'zones',get label(){return ui("Delivery zones");},icon:MapPin},{value:'visual',get label(){return ui("Explorer");},icon:Network},{value:'table',get label(){return ui("Table");},icon:Table2},{value:'report',get label(){return ui("Group report");},icon:BarChart3},{value:'acquisitions',get label(){return ui('Acquisition review');},icon:UserCheck}];
const CustomerViewSelect=({value,onChange,options})=><select aria-label={ui('Customer view')} className="h-10 max-w-full rounded-md border bg-white px-3 text-sm" value={value} onChange={event=>onChange(event.target.value)}>{options.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select>;

export default function Customers() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [params,setParams]=useSearchParams(),navigate=useNavigate();
  const {role,isAdmin,loading}=useCurrentUser();
  const options=[...viewOptions.filter(option=>option.value!=='acquisitions'||isAdmin),...(isAdmin?[{value:'removed',label:ui('Deleted customers'),icon:Trash2}]:[])];
  const view=options.some(o=>o.value===params.get('view'))?params.get('view'):'zones';
  const setView=value=>{const next=new URLSearchParams(params);next.set('view',value);setParams(next);};
  if(loading)return <p role="status">{ui('Loading customers...')}</p>;
  if(role==='commercial'&&view!=='map')return <div><div className="mb-3 flex justify-end"><CustomerViewSelect value="zones" onChange={setView} options={[{value:'zones',label:ui('Customers')},{value:'map',label:ui('Map')}]}/></div><CustomerTasks/></div>;
  if(view==='map')return <div><PageHeader title={ui('Customers')} actions={<CustomerViewSelect value={view} onChange={setView} options={role==='commercial'?[{value:'zones',label:ui('Customers')},{value:'map',label:ui('Map')}]:options}/>}/><CustomerMapWorkspace onOpenCustomer={role==='commercial'?undefined:id=>{const next=new URLSearchParams(params);next.set('view','visual');next.set('customer',id);setParams(next);}}/></div>;
  if(view==='acquisitions')return <div><PageHeader title={ui('Customers')} actions={<CustomerViewSelect value={view} onChange={setView} options={options}/>}/><CustomerAcquisitions/></div>;
  if(view!=='zones')return <CustomerDirectory view={view} setView={setView} options={options} selectedId={params.get('customer')}/>;
  return <div><PageHeader title={ui("Customers")} subtitle={<CustomerInfo title={ui("Customers")}>{ui("Delivery zones, outlet locations and GPS coverage")}</CustomerInfo>} actions={<div className="flex flex-wrap items-center gap-2"><CustomerViewSelect value={view} onChange={setView} options={options}/><Button onClick={()=>navigate('/customers/new')}><Plus size={16} className="mr-1"/>{ui("Add customer")}</Button></div>}/><CustomerDeliveryZones onOpenCustomer={id=>{const next=new URLSearchParams(params);next.set('view','visual');next.set('customer',id);setParams(next);}}/></div>;
}

function CustomerDirectory({view,setView,selectedId,options}) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [params,setParams]=useSearchParams();
  const [records, setCustomers] = useState([]);
  const customers = records.filter(row => view === 'removed' ? !!row.customer_removed_at : !row.customer_removed_at);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,setError]=useState('');
  const [selected, setSelected] = useState(null);
  const selectCustomer=customer=>{setSelected(customer);const next=new URLSearchParams(params);customer?next.set('customer',customer.id):next.delete('customer');setParams(next);};
  const [search, setSearch] = usePageState("customer-directory:search", "");
  const navigate = useNavigate();
  const { isAdmin, isCommercial } = useCurrentUser();
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
  const mainCount = customers.filter(c => !c.parent_id).length;

  const cols = [
    { key: "customer_number", label: "#" },
    { key: "business_name", label: ui("Business Name") },
    { key: "id", label: ui("Locations"), render: (v) => (locationsByCustomer[v] || []).length },
    ...(isAdmin ? [{ key: "acquired_by_name", label: ui("Acquired by"), render: value => value || ui("Unassigned") }] : []),
    { key: "contact_person", label: ui("Contact") },
    { key: "phone", label: ui("Phone") },
    { key: "category", label: ui("Category"), render: v => <StatusBadge status={v} /> },
    { key: "balance", label: ui("Balance"), render: v => formatXAF(v), className: "text-right" },
    { key: "credit_status", label: ui("Status"), render: v => <StatusBadge status={v} /> },
    ...(isAdmin ? [
      { key: 'payment_status', label: ui("Payment Status"), sortable: false, render: (_, row) => <CustomerPaymentBadge summary={paymentStatus.data?.[row.id]} error={paymentStatus.isError} /> },
      { key: 'invoice_outstanding', label: ui("Invoice Outstanding"), sortable: false, render: (_, row) => paymentStatus.data?.[row.id] ? formatXAF(paymentStatus.data[row.id].outstanding) : '—', className: 'text-right' },
      { key: 'receive_payment', label: ui("Payment"), sortable: false, render: (_, row) => <Button size="sm" variant="outline" onClick={event => { event.stopPropagation(); setReceiptCustomer(row); }}>{ui("Receive Payment")}</Button> },
    ] : []),
  ];

  if (loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-primary rounded-full animate-spin" /></div>;

  return (
    <div>
      <PageHeader
        title={ui("Customers")}
        subtitle={ui("{0} main partners · {1} partner records · {2} total receivables", mainCount, customers.length, formatXAF(customers.reduce((s, c) => s + (c.balance || 0), 0)))}
        actions={
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <CustomerViewSelect
              value={view}
              onChange={setView}
              options={options}
            />
            <Button onClick={() => navigate("/customers/new")}><Plus size={16} className="mr-1" />{ui(" Add Partner")}</Button>
          </div>
        }
      />

      {error&&<p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{uiMessage(error)} <button className="underline" onClick={load}>{ui("Retry")}</button></p>}
      {view === "table" || view === "removed" ? (
        <DataTable columns={cols} data={customers} searchFields={["business_name", "contact_person", "phone", "customer_number"]} onRowClick={row => { if(view === "removed")navigate("/customers/"+encodeURIComponent(row.id));else {selectCustomer(row); setView("visual");} }} />
      ) : view === "report" ? (
        <GroupReport partners={customers} childrenByParent={childrenByParent} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-5">
          <div className={(selected ? "hidden lg:block " : "") + "min-w-0 bg-white border border-slate-200 rounded-xl p-3 h-fit lg:sticky lg:top-4"}>
            <Input
              placeholder={ui("Search partners or branches…")}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="mb-3"
            />
            <div className="max-h-[70vh] overflow-y-auto">
              <PartnerTree
                partners={customers}
                childrenByParent={childrenByParent}
                locationsByCustomer={locationsByCustomer}
                selectedId={selected?.id}
                onSelect={selectCustomer}
                search={search}
                paymentSummaries={isAdmin ? paymentStatus.data || {} : null}
                paymentError={paymentStatus.isError}
              />
            </div>
          </div>
          <div className={selected ? "min-w-0" : "hidden min-w-0 lg:block"}>
            {selected ? (
              <>
                <Button variant="ghost" className="mb-3 lg:hidden" onClick={() => selectCustomer(null)}><ArrowLeft size={16} />{ui("Customers")}</Button>
        {(isAdmin || isCommercial) && <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4"><div><p className="text-sm font-semibold text-slate-900">{ui("Make a delivery to ")}{selected.business_name}</p><CustomerInfo title={ui("Record sale")}>{ui("Pick products by photo in the field POS.")}</CustomerInfo></div><Button disabled={selected.is_active === false} onClick={() => navigate(`/commercial?section=pos&new=1&customer=${encodeURIComponent(selected.id)}`)}><ShoppingBag size={16} className="mr-2" />{ui("Record sale")}</Button></div>}
              {isAdmin && selected.acquired_by_name && <section className="mb-4 rounded-xl border bg-white p-4 text-sm"><p>{ui("Acquired by ")}<strong>{selected.acquired_by_name}</strong> / {selected.acquisition_date}</p>{selected.registered_by_name && <p className="mt-1 text-xs text-slate-500">{ui("Registered by ")}{selected.registered_by_name}</p>}<p className="mt-1 text-xs text-slate-500">{ui("Acquisition: ")}{(selected.acquisition_verified || 'pending').replaceAll('_', ' ')}</p></section>}
              {isAdmin && <CustomerPaymentSummary customer={selected} summary={paymentStatus.data?.[selected.id]} error={paymentStatus.isError} onReceive={setReceiptCustomer} onRetry={() => paymentStatus.refetch()} />}
              <PartnerDetail
                partner={selected}
                onChanged={load}
                subPartners={childrenByParent[selected.id] || []}
                parentPartner={customers.find(c => c.id === selected.parent_id) || null}
                locationsByCustomer={locationsByCustomer}
                onSelect={selectCustomer}
              />
              </>
            ) : (
              <div className="flex flex-col items-center justify-center text-center py-24 text-slate-400 bg-slate-50 rounded-xl">
                <Building2 size={36} className="mb-3" />
                <p className="font-medium text-slate-500">{ui("Select a business partner")}</p>
                <CustomerInfo title={ui("Customers")}>{ui("See its locations, deliveries and spoilage at a glance.")}</CustomerInfo>
              </div>
            )}
          </div>
        </div>
      )}
      {isAdmin && receiptCustomer && <CustomerReceivePayment key={receiptCustomer.id} customer={receiptCustomer} onClose={() => setReceiptCustomer(null)} onDone={() => { setReceiptCustomer(null); paymentStatus.refetch(); load(); }} />}
    </div>
  );
}
