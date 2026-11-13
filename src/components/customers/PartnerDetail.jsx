
/* localized-interface */
import { ui, uiMessage } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import { usePhoneLayout } from '@/hooks/usePhoneLayout';
import MobileCustomerOverview from './MobileCustomerOverview';
import CustomerBillingSummary from './CustomerBillingSummary';
import useHeadquartersDeliveryBalances from './useHeadquartersDeliveryBalances';
import React, { useState, useEffect, useCallback } from "react";
import { erp } from "@/api/erpClient";
import { useNavigate, useSearchParams } from "@/lib/router";
import { Button } from "@/components/ui/button";
import StatusBadge from "@/components/shared/StatusBadge";
import CustomerMapLinks from "./CustomerMapLinks";
import CustomerGpsButton from "./CustomerGpsButton";
import SpoilageDialog from "./SpoilageDialog";
import CustomerActionGrid from "./CustomerActionGrid";
import CustomerSpoilageReports from "./CustomerSpoilageReports";
import PartnerGroupPanel from "./PartnerGroupPanel";
import PartnerStockPanel from "./PartnerStockPanel";
import PartnerSalesPanel from "./PartnerSalesPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatAccountingXAF, formatXAF } from "@/lib/formatters";
import { branchTotalDue, customerAccountBalance, customerGroupBalance, headquartersDueForBranch } from '@/lib/customer-billing-summary';
import {customerActivityScope,customerInvoiceQuery,customerMonthInvoiceQuery} from '@/lib/customer-mobile-summary';
import { Plus } from "lucide-react";

// 360° view of one business partner: its group (sub-partners), locations,
// deliveries and spoilage per branch.
export default function PartnerDetail({ partner, onChanged, subPartners = [], parentPartner = null, locationsByCustomer = {}, onSelect, onEditGps, onSale, onReceive, canReportSpoilage=false, paymentSummary }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const navigate = useNavigate();
  const [params,setParams] = useSearchParams();
  const tab = params.get('tab');
  const selectTab = value => {
    const next = new URLSearchParams(params);
    if(value==='overview')next.delete('tab');else next.set('tab',value);
    setParams(next,{replace:true});
  };
  const phone=usePhoneLayout();
  const [mobileSales,setMobileSales]=useState({loading:true,invoices:[],total:null,error:''});
  const [salesReload,setSalesReload]=useState(0);
  const [locations, setLocations] = useState([]);
  const [orders, setOrders] = useState([]);
  const [spoilage, setSpoilage] = useState([]),[loadError,setLoadError]=useState('');
  const [spoilOpen, setSpoilOpen] = useState(false),[reportVersion,setReportVersion]=useState(0);
  const headquarters = parentPartner?.id === partner.parent_id && !parentPartner?.parent_id ? parentPartner : null;
  const headquartersId = headquarters?.id;

  const load = useCallback(async () => {
    setLoadError('');
    try {
    const [locs, ords, spls] = await Promise.all([
      erp.entities.CustomerLocation.filter({ customer_id: partner.id, is_active: true }),
      erp.entities.SalesOrder.filter(customerActivityScope(partner.id,headquartersId), "-order_date", 200),
      erp.entities.SpoilageRecord.filter({ customer_id: partner.id }, "-reported_date", 200),
    ]);
    setLocations(locs);
    setOrders(ords);
    setSpoilage(spls);
    } catch(error) { setLoadError(error.message); }
  }, [partner.id,headquartersId]);

  useEffect(() => { load(); }, [load]);

  useEffect(()=>{
    if(!phone)return;
    let active=true;
    setMobileSales({loading:true,invoices:[],total:null,error:''});
    Promise.all([
      erp.entities.Invoice.aggregate({query:customerMonthInvoiceQuery(partner.id,new Date(),headquartersId),groupBy:'status',sum:['total']}),
      erp.entities.Invoice.filter(customerInvoiceQuery(partner.id,headquartersId),{sort:'-invoice_date',limit:6,include_total:false}),
    ]).then(([summary,recent])=>{if(active)setMobileSales({loading:false,invoices:recent.items,total:summary.rows.reduce((sum,row)=>sum+Number(row.sum_total||0),0),error:''});})
      .catch(error=>{if(active)setMobileSales({loading:false,invoices:[],total:null,error:error.message});});
    return()=>{active=false;};
  },[phone,partner.id,headquartersId,salesReload]);
  const Tools=phone?'details':'div';
  const deliveredOrders = orders.filter(o => ["invoiced", "delivered", "partially_delivered"].includes(o.status));
  const deliveredValue = deliveredOrders.reduce((s, o) => s + (o.total || 0), 0);
  const spoilageValue = spoilage.reduce((s, r) => s + (r.total_value || 0), 0);
  const deliveryBalances = useHeadquartersDeliveryBalances(headquarters || partner, headquarters ? [partner] : subPartners);
  const isGroup = !partner.parent_id && subPartners.length > 0;
  const balanceLabel = headquarters ? 'Total due for this branch' : isGroup ? 'Group Balance' : 'Account balance due';
  const balance = headquarters ? branchTotalDue(partner, headquartersDueForBranch(deliveryBalances.data, partner.id))
    : isGroup ? customerGroupBalance(partner, subPartners) : customerAccountBalance(partner);
  const billingSummary = <CustomerBillingSummary partner={partner} parentPartner={headquarters} subPartners={subPartners} deliveryBalances={deliveryBalances} onSelect={onSelect}/>;


  return (
    <div className={phone?"space-y-5 pb-24":"space-y-5"}>
      {/* Header */}
      <div className="hidden flex-wrap items-start justify-between gap-3 sm:flex">
        <div>
          <h2 className="text-lg font-bold text-slate-900">{partner.business_name}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <StatusBadge status={partner.credit_status || "good"} />
          </div>
        </div>
        <div className="flex min-w-0 max-w-full flex-wrap gap-2">

          <Button size="sm" onClick={() => navigate('/customers/new?parent='+encodeURIComponent(partner.parent_id||partner.id))}><Plus size={13} className="mr-1" />{ui("Add branch")}</Button>
        </div>
      </div>

      {phone ? <MobileCustomerOverview partner={partner} balanceLabel={balanceLabel} balance={balance} deliveryBalances={deliveryBalances} billingSummary={billingSummary} sales={mobileSales.invoices} monthlySales={mobileSales.total} loading={mobileSales.loading} salesError={mobileSales.error} onRetrySales={()=>setSalesReload(n=>n+1)} subPartners={subPartners} locationsByCustomer={locationsByCustomer} onSelect={onSelect} onEditGps={onEditGps} onSale={onSale}/> : <div className="grid gap-3 lg:grid-cols-2">
        <section className="rounded-xl border bg-white p-4">
          <h3 className="text-sm font-semibold">{ui(balanceLabel)}</h3>
          <p className="mt-1 text-lg font-bold tabular-nums">{balance === null ? '—' : formatAccountingXAF(balance)}</p>
          {!headquarters&&!isGroup&&<p className="text-xs text-muted-foreground">{ui('Limit ')}{formatXAF(partner.credit_limit)}</p>}
        </section>
        {billingSummary}
      </div>}
      <Tools open={phone&&tab==='sales'?true:undefined} className={phone?'rounded-xl border bg-white':'space-y-5'}>
      {phone&&<summary className="min-h-12 cursor-pointer p-3 text-sm font-semibold">{ui('Customer tools and details')}</summary>}
      <div className={phone?'space-y-5 border-t p-3':'space-y-5'}>
      {phone&&canReportSpoilage&&<Button variant="outline" onClick={()=>navigate('/customers/new?parent='+encodeURIComponent(partner.parent_id||partner.id))}><Plus size={15}/>{ui('Add branch')}</Button>}
      <CustomerActionGrid onSale={phone?undefined:onSale} onReceive={onReceive} onSpoilage={canReportSpoilage?()=>setSpoilOpen(true):undefined} onEdit={canReportSpoilage?()=>navigate('/customers/'+partner.id):undefined} disabled={partner.is_active===false}/>
      {paymentSummary}
      {loadError&&<p role="alert" className="text-sm text-red-700">{uiMessage(loadError)} <button className="underline" onClick={load}>{ui('Retry')}</button></p>}
      <section aria-label={ui("Customer delivery location")} className="hidden sm:block space-y-3 rounded-xl border bg-white p-4">
        <h3 className="text-sm font-semibold">{ui("Customer delivery location")}</h3>
        {(locationsByCustomer[partner.id]?.length ? locationsByCustomer[partner.id] : [partner]).map(point=><div key={point.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          {point.id!==partner.id&&<p className="w-full break-words text-sm font-medium">{point.name}</p>}
          <CustomerMapLinks customer={point}/>
          {onEditGps&&partner.is_active!==false&&point.is_active!==false&&<CustomerGpsButton point={point} onClick={()=>onEditGps(partner,point.id===partner.id?undefined:point)}/>}
        </div>)}
      </section>
      <Tabs value={tab==='sales'||tab==='stock'?tab:'overview'} onValueChange={selectTab}>
        <TabsList>
          <TabsTrigger value="overview">{ui("Overview")}</TabsTrigger>
          <TabsTrigger value="stock">{ui("Stock & Expiry")}</TabsTrigger>
          <TabsTrigger value="sales">{ui("Sales")}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 space-y-5">
      {!partner.parent_id && subPartners.length>0 && (
        <PartnerGroupPanel partner={partner} subPartners={subPartners} deliveryBalances={deliveryBalances} locationsByCustomer={locationsByCustomer} onSelect={onSelect} />
      )}

      {/* KPIs */}
      <div className="hidden grid-cols-2 lg:grid-cols-3 gap-3 sm:grid">
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">{ui("Delivered Value")}</p>
          <p className="text-lg font-bold text-green-700">{formatXAF(deliveredValue)}</p>
          <p className="text-xs text-slate-400">{deliveredOrders.length}{ui(" deliveries")}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">{ui("Spoilage")}</p>
          <p className="text-lg font-bold text-red-600">{formatXAF(spoilageValue)}</p>
          <p className="text-xs text-slate-400">{spoilage.length}{ui(" incidents")}{deliveredValue > 0 ? ` · ${((spoilageValue / deliveredValue) * 100).toFixed(1)}%` : ""}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">{ui("Branches")}</p>
          <p className="text-lg font-bold text-slate-900">{subPartners.length}</p>
          <p className="text-xs text-slate-400">{new Set(subPartners.map(l => l.town).filter(Boolean)).size}{ui(" towns")}</p>
        </div>
      </div>

      {locations.length>0&&<details className="rounded-xl border bg-white p-4"><summary className="cursor-pointer text-sm font-medium">{ui('Previous delivery points')}</summary><div className="mt-3 space-y-2">{locations.map(l=><div key={l.id} className="border-b py-2 text-sm"><strong>{l.name}</strong><p className="text-xs text-slate-500">{[l.town,l.neighbourhood].filter(Boolean).join(' · ')}</p></div>)}</div></details>}
      {spoilage.some(r=>r.record_type!=='customer_spoilage_report')&&<details className="rounded-xl border bg-white p-4"><summary className="cursor-pointer text-sm font-medium">{ui('Previous spoilage records')}</summary><div className="mt-3 space-y-3">{spoilage.filter(r=>r.record_type!=='customer_spoilage_report').map(r=><div key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 text-sm"><span>{r.product_name} · {r.quantity} {r.unit}<small className="block text-slate-500">{r.location_name} · {r.reported_date}</small></span><StatusBadge status={r.status}/></div>)}</div></details>}
        </TabsContent>

        <TabsContent value="stock" className="mt-4">
          <PartnerStockPanel partner={partner} subPartners={subPartners} />
        </TabsContent>

        <TabsContent value="sales" className="mt-4">
          <PartnerSalesPanel partner={partner} subPartners={subPartners} headquartersId={headquartersId} />
        </TabsContent>
      </Tabs>

      {canReportSpoilage&&<CustomerSpoilageReports key={partner.id} customer={partner} reload={reportVersion}/>}
      </div></Tools>
      {spoilOpen&&<SpoilageDialog
        open={spoilOpen}
        onOpenChange={setSpoilOpen}
        customer={partner}
        locations={locations}
        onSaved={()=>{setReportVersion(n=>n+1);onChanged?.();}}
      />}
    </div>
  );
}
