
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState, useEffect, useCallback } from "react";
import { erp } from "@/api/erpClient";
import { useNavigate } from "@/lib/router";
import { Button } from "@/components/ui/button";
import StatusBadge from "@/components/shared/StatusBadge";
import CustomerInfo from "./CustomerInfo";
import CustomerMapLinks from "./CustomerMapLinks";
import SpoilageDialog from "./SpoilageDialog";
import PartnerGroupPanel from "./PartnerGroupPanel";
import PartnerStockPanel from "./PartnerStockPanel";
import PartnerSalesPanel from "./PartnerSalesPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatXAF, formatDate, statusLabel } from "@/lib/formatters";
import { Plus, AlertTriangle, Pencil } from "lucide-react";

// 360° view of one business partner: its group (sub-partners), locations,
// deliveries and spoilage per branch.
export default function PartnerDetail({ partner, onChanged, subPartners = [], parentPartner = null, locationsByCustomer = {}, onSelect }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const navigate = useNavigate();
  const [locations, setLocations] = useState([]);
  const [orders, setOrders] = useState([]);
  const [spoilage, setSpoilage] = useState([]);
  const [spoilOpen, setSpoilOpen] = useState(false);

  const load = useCallback(async () => {
    const [locs, ords, spls] = await Promise.all([
      erp.entities.CustomerLocation.filter({ customer_id: partner.id, is_active: true }),
      erp.entities.SalesOrder.filter({ customer_id: partner.id }, "-order_date", 200),
      erp.entities.SpoilageRecord.filter({ customer_id: partner.id }, "-reported_date", 200),
    ]);
    setLocations(locs);
    setOrders(ords);
    setSpoilage(spls);
  }, [partner.id]);

  useEffect(() => { load(); }, [load]);

  const deliveredOrders = orders.filter(o => ["invoiced", "delivered", "partially_delivered"].includes(o.status));
  const deliveredValue = deliveredOrders.reduce((s, o) => s + (o.total || 0), 0);
  const spoilageValue = spoilage.reduce((s, r) => s + (r.total_value || 0), 0);

  async function markReplaced(record) {
    await erp.entities.SpoilageRecord.update(record.id, { status: "replaced", replaced_at: new Date().toISOString() });
    load();
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
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
          <Button size="sm" variant="outline" onClick={() => navigate(`/customers/${partner.id}`)}><Pencil size={13} className="mr-1" />{ui(" Edit")}</Button>
          {locations.length>0&&<Button size="sm" variant="outline" onClick={() => setSpoilOpen(true)}><AlertTriangle size={13} className="mr-1" />{ui(" Report Spoilage")}</Button>}
          <Button size="sm" onClick={() => navigate('/customers/new?parent='+encodeURIComponent(partner.parent_id||partner.id))}><Plus size={13} className="mr-1" />{ui("Add branch")}</Button>
        </div>
      </div>

      <CustomerMapLinks customer={partner} />
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
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
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
      {/* Spoilage log */}
      {spoilage.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-900 mb-2">{ui("Spoilage History")}</h3>
          <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
            {spoilage.slice(0, 10).map(r => (
              <div key={r.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <AlertTriangle size={14} className="text-red-500 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-slate-900 truncate">{r.quantity} × {r.product_name}{ui(" at ")}<span className="font-medium">{r.location_name}</span></p>
                  <p className="text-xs text-slate-500">{formatDate(r.reported_date)} · {statusLabel(r.reason)} · {formatXAF(r.total_value)}</p>
                </div>
                <StatusBadge status={r.status} />
                {r.status === "reported" && (
                  <Button size="sm" variant="outline" onClick={() => markReplaced(r)}>{ui("Mark Replaced")}</Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

        </TabsContent>

        <TabsContent value="stock" className="mt-4">
          <PartnerStockPanel partner={partner} subPartners={subPartners} />
        </TabsContent>

        <TabsContent value="sales" className="mt-4">
          <PartnerSalesPanel partner={partner} subPartners={subPartners} />
        </TabsContent>
      </Tabs>

      <SpoilageDialog
        open={spoilOpen}
        onOpenChange={setSpoilOpen}
        customer={partner}
        locations={locations}
        onSaved={load}
      />
    </div>
  );
}