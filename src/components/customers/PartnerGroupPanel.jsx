
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState, useEffect } from "react";
import { erp } from "@/api/erpClient";
import { useNavigate } from "@/lib/router";
import { formatXAF } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import { Store, Pencil, ChevronRight, MapPin } from "lucide-react";

// Roll-up of a main partner and all its sub-partners (branches).
export default function PartnerGroupPanel({ partner, subPartners = [], locationsByCustomer = {}, onSelect }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const navigate = useNavigate();
  const [metrics, setMetrics] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const ids = [partner.id, ...subPartners.map(s => s.id)];
    Promise.all([
      erp.entities.SalesOrder.aggregate({ query: { customer_id: { $in: ids }, status: { $in: ["delivered", "partially_delivered", "invoiced"] } }, groupBy: "customer_id", sum: ["total"] }),
      erp.entities.Invoice.aggregate({ query: { customer_id: { $in: ids } }, groupBy: "customer_id", sum: ["total", "balance"] }),
      erp.entities.SpoilageRecord.aggregate({ query: { customer_id: { $in: ids } }, groupBy: "customer_id", sum: ["total_value"] }),
    ]).then(([sales, invoices, spoilage]) => {
      if (cancelled) return;
      const map = {};
      const row = (id) => (map[id] = map[id] || { delivered: 0, invoiced: 0, outstanding: 0, spoilage: 0 });
      sales.rows.forEach(r => { row(r.customer_id).delivered = r.sum_total || 0; });
      invoices.rows.forEach(r => { const m = row(r.customer_id); m.invoiced = r.sum_total || 0; m.outstanding = r.sum_balance || 0; });
      spoilage.rows.forEach(r => { row(r.customer_id).spoilage = r.sum_total_value || 0; });
      setMetrics(map);
    });
    return () => { cancelled = true; };
  }, [partner.id, subPartners]);

  const zero = { delivered: 0, invoiced: 0, outstanding: 0, spoilage: 0 };
  const m = (id) => (metrics ? metrics[id] || zero : zero);

  const branchIds = subPartners.map(s => s.id);
  const group = [partner.id, ...branchIds].reduce((acc, id) => {
    const r = m(id);
    return {
      delivered: acc.delivered + r.delivered,
      invoiced: acc.invoiced + r.invoiced,
      outstanding: acc.outstanding + r.outstanding,
      spoilage: acc.spoilage + r.spoilage,
    };
  }, { ...zero });
  const groupBalance = (partner.balance || 0) + subPartners.reduce((s, k) => s + (k.balance || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">{ui("Group — ")}{subPartners.length}{ui(" sub-partner")}{subPartners.length === 1 ? "" : "s"}</h3>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">{ui("Group Balance")}</p>
          <p className="text-lg font-bold text-slate-900">{formatXAF(groupBalance)}</p>
          <p className="text-xs text-slate-400">{ui("Across all branches")}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">{ui("Invoiced")}</p>
          <p className="text-lg font-bold text-slate-900">{formatXAF(group.invoiced)}</p>
          <p className="text-xs text-slate-400">{ui("Outstanding ")}{formatXAF(group.outstanding)}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">{ui("Delivered Value")}</p>
          <p className="text-lg font-bold text-green-700">{formatXAF(group.delivered)}</p>
          <p className="text-xs text-slate-400">{ui("Invoiced & delivered orders")}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">{ui("Spoilage")}</p>
          <p className="text-lg font-bold text-red-600">{formatXAF(group.spoilage)}</p>
          <p className="text-xs text-slate-400">{group.delivered > 0 ? ui("{0}% of deliveries", ((group.spoilage / group.delivered) * 100).toFixed(1)) : ui("No deliveries yet")}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {subPartners.map(sub => {
          const sm = m(sub.id);
          const locs = (locationsByCustomer[sub.id] || []).length;
          return (
            <div key={sub.id} className="bg-white border border-slate-200 rounded-xl p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2 min-w-0">
                  <Store size={15} className="mt-0.5 text-slate-500 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">{sub.business_name}</p>
                    <p className="text-xs text-slate-500 truncate">
                      {[sub.town, sub.neighbourhood].filter(Boolean).join(" · ") || ui("No address")}
                      {locs > 0 ? ` · ${locs} location${locs === 1 ? "" : "s"}` : ""}
                    </p>
                  </div>
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  <Button size="sm" variant="ghost" onClick={() => navigate(`/customers/${sub.id}`)}><Pencil size={13} /></Button>
                  <Button size="sm" variant="outline" onClick={() => onSelect?.(sub)}>{ui("Open ")}<ChevronRight size={13} className="ml-0.5" /></Button>
                </div>
              </div>
              <div className="grid grid-cols-1 min-[380px]:grid-cols-2 sm:grid-cols-3 gap-2 mt-2 pt-2 border-t border-slate-100 text-xs">
                <span className="text-slate-500">{ui("Balance ")}<span className="block font-semibold text-slate-900">{formatXAF(sub.balance)}</span></span>
                <span className="text-slate-500">{ui("Outstanding ")}<span className="block font-semibold text-slate-900">{formatXAF(sm.outstanding)}</span></span>
                <span className="text-slate-500">{ui("Spoilage ")}<span className={`block font-semibold ${sm.spoilage > 0 ? "text-red-600" : "text-slate-900"}`}>{formatXAF(sm.spoilage)}</span></span>
              </div>
            </div>
          );
        })}
      </div>

      {subPartners.length === 0 && (
        <p className="text-sm text-slate-400 bg-slate-50 rounded-lg p-4 text-center inline-flex items-center gap-2 w-full justify-center">
          <MapPin size={14} />{ui(" No sub-partners yet — use Add Partner to add a branch that trades under this name.")}</p>
      )}
    </div>
  );
}