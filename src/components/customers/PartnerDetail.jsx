
/* localized-interface */
import { ui, uiMessage } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import { usePhoneLayout } from '@/hooks/usePhoneLayout';
import MobileCustomerOverview from './MobileCustomerOverview';
import React, { useState, useEffect, useCallback } from "react";
import { erp } from "@/api/erpClient";
import { useNavigate } from "@/lib/router";
import { Button } from "@/components/ui/button";
import StatusBadge from "@/components/shared/StatusBadge";
import CustomerInfo from "./CustomerInfo";
import CustomerMapLinks from "./CustomerMapLinks";
import CustomerGpsButton from "./CustomerGpsButton";
import SpoilageDialog from "./SpoilageDialog";
import CustomerActionGrid from "./CustomerActionGrid";
import CustomerSpoilageReports from "./CustomerSpoilageReports";
import PartnerGroupPanel from "./PartnerGroupPanel";
import PartnerStockPanel from "./PartnerStockPanel";
import PartnerSalesPanel from "./PartnerSalesPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatXAF } from "@/lib/formatters";
import { Plus } from "lucide-react";

// 360° view of one business partner: its group (sub-partners), locations,
// deliveries and spoilage per branch.
export default function PartnerDetail({ partner, onChanged, subPartners = [], parentPartner = null, locationsByCustomer = {}, onSelect, onEditGps, onSale, onReceive, canReportSpoilage=false, paymentSummary }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const navigate = useNavigate();
  const phone=usePhoneLayout();
  const [locations, setLocations] = useState([]);
  const [orders, setOrders] = useState([]);
  const [spoilage, setSpoilage] = useState([]),[loadError,setLoadError]=useState(''),[loading,setLoading]=useState(true);
  const [spoilOpen, setSpoilOpen] = useState(false),[reportVersion,setReportVersion]=useState(0);

  const load = useCallback(async () => {
    setLoadError('');setLoading(true);
    try {
    const [locs, ords, spls] = await Promise.all([
      erp.entities.CustomerLocation.filter({ customer_id: partner.id, is_active: true }),
      erp.entities.SalesOrder.filter({ customer_id: partner.id }, "-order_date", 200),
      erp.entities.SpoilageRecord.filter({ customer_id: partner.id }, "-reported_date", 200),
    ]);
    setLocations(locs);
    setOrders(ords);
    setSpoilage(spls);
    } catch(error) { setLoadError(error.message); }finally{setLoading(false);}
  }, [partner.id]);

  useEffect(() => { load(); }, [load]);

  const deliveredOrders = orders.filter(o => ["invoiced", "delivered", "partially_delivered"].includes(o.status));
  const deliveredValue = deliveredOrders.reduce((s, o) => s + (o.total || 0), 0);
  const spoilageValue = spoilage.reduce((s, r) => s + (r.total_value || 0), 0);


  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="hidden flex-wrap items-start justify-between gap-3 sm:flex">
        <div>
          {parentPartner && (
            <button onClick={() => onSelect?.(parentPartner)} className="text-xs text-blue-600 hover:underline mb-0.5">{ui("← Branch of ")}{parentPartner.business_name}
            </button>
          )}
          <h2 className="text-lg font-bold text-slate-900">{partner.business_name}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <StatusBadge status={partner.credit_status || "good"} />
            <CustomerInfo title={ui("Payment responsibility")}>
              {partner.financial_centralization_mode === "decentralized" ? ui("Each branch pays its own invoices") : ui("Centralized — HQ handles payments")}
            </CustomerInfo>
          </div>
        </div>
        <div className="flex min-w-0 max-w-full flex-wrap gap-2">

          <Button size="sm" onClick={() => navigate('/customers/new?parent='+encodeURIComponent(partner.parent_id||partner.id))}><Plus size={13} className="mr-1" />{ui("Add branch")}</Button>
        </div>
      </div>

      {phone&&<MobileCustomerOverview partner={partner} orders={orders} deliveredValue={deliveredValue} loading={loading} subPartners={subPartners} locationsByCustomer={locationsByCustomer} onSelect={onSelect} onEditGps={onEditGps} onSale={onSale}/>}
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
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">{ui("Overview")}</TabsTrigger>
          <TabsTrigger value="stock">{ui("Stock & Expiry")}</TabsTrigger>
          <TabsTrigger value="sales">{ui("Sales")}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 space-y-5">
      {!partner.parent_id && subPartners.length>0 && (
        <PartnerGroupPanel partner={partner} subPartners={subPartners} locationsByCustomer={locationsByCustomer} onSelect={onSelect} />
      )}

      {/* KPIs */}
      <div className="hidden grid-cols-2 lg:grid-cols-4 gap-3 sm:grid">
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">{ui("Balance Owed")}</p>
          <p className="text-lg font-bold text-slate-900">{formatXAF(partner.balance)}</p>
          <p className="text-xs text-slate-400">{ui("Limit ")}{formatXAF(partner.credit_limit)}</p>
        </div>
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
          <PartnerSalesPanel partner={partner} subPartners={subPartners} />
        </TabsContent>
      </Tabs>

      {canReportSpoilage&&<CustomerSpoilageReports key={partner.id} customer={partner} reload={reportVersion}/>}
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
