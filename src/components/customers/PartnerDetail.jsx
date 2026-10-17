import React, { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import StatusBadge from "@/components/shared/StatusBadge";
import LocationDialog from "./LocationDialog";
import SpoilageDialog from "./SpoilageDialog";
import PartnerGroupPanel from "./PartnerGroupPanel";
import PartnerStockPanel from "./PartnerStockPanel";
import PartnerSalesPanel from "./PartnerSalesPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatXAF, formatDate, statusLabel } from "@/lib/formatters";
import { MapPin, Plus, AlertTriangle, Pencil, Landmark, Truck } from "lucide-react";

// 360° view of one business partner: its group (sub-partners), locations,
// deliveries and spoilage per branch.
export default function PartnerDetail({ partner, onChanged, subPartners = [], parentPartner = null, locationsByCustomer = {}, onSelect }) {
  const navigate = useNavigate();
  const [locations, setLocations] = useState([]);
  const [orders, setOrders] = useState([]);
  const [spoilage, setSpoilage] = useState([]);
  const [locDialog, setLocDialog] = useState({ open: false, location: null });
  const [spoilOpen, setSpoilOpen] = useState(false);

  const load = useCallback(async () => {
    const [locs, ords, spls] = await Promise.all([
      base44.entities.CustomerLocation.filter({ customer_id: partner.id, is_active: true }),
      base44.entities.SalesOrder.filter({ customer_id: partner.id }, "-order_date", 200),
      base44.entities.SpoilageRecord.filter({ customer_id: partner.id }, "-reported_date", 200),
    ]);
    setLocations(locs);
    setOrders(ords);
    setSpoilage(spls);
  }, [partner.id]);

  useEffect(() => { load(); }, [load]);

  const deliveredOrders = orders.filter(o => ["invoiced", "delivered", "partially_delivered"].includes(o.status));
  const deliveredValue = deliveredOrders.reduce((s, o) => s + (o.total || 0), 0);
  const spoilageValue = spoilage.reduce((s, r) => s + (r.total_value || 0), 0);

  const locStats = (locId) => ({
    delivered: deliveredOrders.filter(o => o.location_id === locId).reduce((s, o) => s + (o.total || 0), 0),
    spoilage: spoilage.filter(r => r.location_id === locId).reduce((s, r) => s + (r.total_value || 0), 0),
    lastOrder: orders.find(o => o.location_id === locId)?.order_date,
  });

  async function markReplaced(record) {
    await base44.entities.SpoilageRecord.update(record.id, { status: "replaced", replaced_at: new Date().toISOString() });
    load();
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {parentPartner && (
            <button onClick={() => onSelect?.(parentPartner)} className="text-xs text-blue-600 hover:underline mb-0.5">
              ← Sub-partner of {parentPartner.business_name}
            </button>
          )}
          <h2 className="text-lg font-bold text-slate-900">{partner.business_name}</h2>
          <div className="flex items-center gap-2 mt-1 text-xs text-slate-500">
            <StatusBadge status={partner.credit_status || "good"} />
            <span className="inline-flex items-center gap-1">
              <Landmark size={12} />
              {partner.financial_centralization_mode === "decentralized" ? "Each branch pays its own invoices" : "Centralized — HQ handles payments"}
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => navigate(`/customers/${partner.id}`)}><Pencil size={13} className="mr-1" /> Edit</Button>
          <Button size="sm" variant="outline" onClick={() => setSpoilOpen(true)} disabled={locations.length === 0}><AlertTriangle size={13} className="mr-1" /> Report Spoilage</Button>
          <Button size="sm" onClick={() => setLocDialog({ open: true, location: null })}><Plus size={13} className="mr-1" /> Add Location</Button>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="stock">Stock &amp; Expiry</TabsTrigger>
          <TabsTrigger value="sales">Sales</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 space-y-5">
      {subPartners.length > 0 && (
        <PartnerGroupPanel partner={partner} subPartners={subPartners} locationsByCustomer={locationsByCustomer} onSelect={onSelect} />
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">Balance Owed</p>
          <p className="text-lg font-bold text-slate-900">{formatXAF(partner.balance)}</p>
          <p className="text-xs text-slate-400">Limit {formatXAF(partner.credit_limit)}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">Delivered Value</p>
          <p className="text-lg font-bold text-green-700">{formatXAF(deliveredValue)}</p>
          <p className="text-xs text-slate-400">{deliveredOrders.length} deliveries</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">Spoilage</p>
          <p className="text-lg font-bold text-red-600">{formatXAF(spoilageValue)}</p>
          <p className="text-xs text-slate-400">{spoilage.length} incidents{deliveredValue > 0 ? ` · ${((spoilageValue / deliveredValue) * 100).toFixed(1)}%` : ""}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">Locations</p>
          <p className="text-lg font-bold text-slate-900">{locations.length}</p>
          <p className="text-xs text-slate-400">{new Set(locations.map(l => l.town).filter(Boolean)).size} towns</p>
        </div>
      </div>

      {/* Locations with per-branch stats */}
      <div>
        <h3 className="text-sm font-semibold text-slate-900 mb-2">Delivery Locations</h3>
        {locations.length === 0 && (
          <p className="text-sm text-slate-400 bg-slate-50 rounded-lg p-4 text-center">
            No locations yet — add the branches where you deliver to this partner.
          </p>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {locations.map(l => {
            const st = locStats(l.id);
            return (
              <div key={l.id} className="bg-white border border-slate-200 rounded-xl p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 min-w-0">
                    <MapPin size={15} className={`mt-0.5 flex-shrink-0 ${l.is_headquarters ? "text-amber-500" : "text-slate-400"}`} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">
                        {l.name} {l.is_headquarters && <span className="text-[10px] font-medium text-amber-600 bg-amber-50 px-1.5 rounded-full align-middle">HQ</span>}
                      </p>
                      <p className="text-xs text-slate-500 truncate">{[l.town, l.neighbourhood].filter(Boolean).join(" · ") || "No address"}</p>
                      {l.route_name && <p className="text-xs text-slate-400 inline-flex items-center gap-1 mt-0.5"><Truck size={11} /> {l.route_name}{l.delivery_days ? ` · ${l.delivery_days}` : ""}</p>}
                    </div>
                  </div>
                  <button onClick={() => setLocDialog({ open: true, location: l })} className="p-1 text-slate-400 hover:text-slate-600 flex-shrink-0"><Pencil size={13} /></button>
                </div>
                <div className="flex gap-4 mt-2 pt-2 border-t border-slate-100 text-xs">
                  <span className="text-slate-500">Delivered <span className="font-semibold text-slate-900">{formatXAF(st.delivered)}</span></span>
                  <span className="text-slate-500">Spoilage <span className={`font-semibold ${st.spoilage > 0 ? "text-red-600" : "text-slate-900"}`}>{formatXAF(st.spoilage)}</span></span>
                  {st.lastOrder && <span className="text-slate-400 ml-auto">Last order {formatDate(st.lastOrder)}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Spoilage log */}
      {spoilage.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-900 mb-2">Spoilage History</h3>
          <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
            {spoilage.slice(0, 10).map(r => (
              <div key={r.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <AlertTriangle size={14} className="text-red-500 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-slate-900 truncate">{r.quantity} × {r.product_name} at <span className="font-medium">{r.location_name}</span></p>
                  <p className="text-xs text-slate-500">{formatDate(r.reported_date)} · {statusLabel(r.reason)} · {formatXAF(r.total_value)}</p>
                </div>
                <StatusBadge status={r.status} />
                {r.status === "reported" && (
                  <Button size="sm" variant="outline" onClick={() => markReplaced(r)}>Mark Replaced</Button>
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

      <LocationDialog
        open={locDialog.open}
        onOpenChange={open => setLocDialog(d => ({ ...d, open }))}
        customer={partner}
        location={locDialog.location}
        onSaved={() => { load(); onChanged?.(); }}
      />
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