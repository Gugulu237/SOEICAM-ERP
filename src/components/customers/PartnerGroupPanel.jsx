
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState, useEffect } from "react";
import { erp } from "@/api/erpClient";
import { useNavigate } from "@/lib/router";
import { formatAccountingXAF } from "@/lib/formatters";
import { customerAccountBalance, customerOpenInvoiceQuery } from '@/lib/customer-billing-summary';
import { customerInvoiceQuery } from '@/lib/customer-mobile-summary';
import { Button } from "@/components/ui/button";
import { Store, Pencil, ChevronRight, MapPin } from "lucide-react";

// Roll-up of a main partner and all its sub-partners (branches).
export default function PartnerGroupPanel({ partner, subPartners = [], locationsByCustomer = {}, onSelect }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const navigate = useNavigate();
  const [metrics, setMetrics] = useState(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const ids = [...new Set([partner.id, ...subPartners.filter(branch => branch.parent_id === partner.id).map(branch => branch.id)])];
    setMetrics(null);
    Promise.allSettled([
      erp.entities.SalesOrder.aggregate({ query: { customer_id: { $in: ids }, status: { $in: ["delivered", "partially_delivered", "invoiced"] } }, groupBy: "customer_id", sum: ["total"] }),
      erp.entities.Invoice.aggregate({ query: customerInvoiceQuery({ $in: ids }), groupBy: "customer_id", sum: "total" }),
      erp.entities.Invoice.aggregate({ query: customerOpenInvoiceQuery({ $in: ids }), groupBy: "customer_id", sum: "balance" }),
      erp.entities.SpoilageRecord.aggregate({ query: { customer_id: { $in: ids } }, groupBy: "customer_id", sum: ["total_value"] }),
    ]).then(results => {
      if (cancelled) return;
      const metricFields = [['delivered', 'sum_total'], ['invoiced', 'sum_total'], ['outstanding', 'sum_balance'], ['spoilage', 'sum_total_value']];
      setMetrics(Object.fromEntries(metricFields.map(([name, field], index) => [name, results[index].status === 'fulfilled' ? new Map(results[index].value.rows.map(row => [row.customer_id, Number(row[field] || 0)])) : null])));
    });
    return () => { cancelled = true; };
  }, [partner.id, subPartners, reload]);

  const metric = (name, id) => metrics?.[name] ? metrics[name].get(id) || 0 : null;
  const groupTotal = name => metrics?.[name] ? [...metrics[name].values()].reduce((sum, value) => sum + value, 0) : null;
  const display = amount => amount === null ? '—' : formatAccountingXAF(amount);
  const delivered = groupTotal('delivered');
  const spoiled = groupTotal('spoilage');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">{ui("Branches: {0}",subPartners.length)}</h3>
      </div>

      {metrics&&Object.values(metrics).some(value => value === null)&&<p role="alert" className="text-xs text-red-700">{ui('Some branch totals could not load.')} <button type="button" className="underline" onClick={() => setReload(value => value + 1)}>{ui('Retry')}</button></p>}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">{ui("Invoiced")}</p>
          <p className="text-lg font-bold text-slate-900">{display(groupTotal('invoiced'))}</p>
          <p className="text-xs text-slate-500">{ui('Open invoice balance')} · {display(groupTotal('outstanding'))}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">{ui("Delivered Value")}</p>
          <p className="text-lg font-bold text-green-700">{display(delivered)}</p>
          <p className="text-xs text-slate-400">{ui("Invoiced & delivered orders")}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">{ui("Spoilage")}</p>
          <p className="text-lg font-bold text-red-600">{display(spoiled)}</p>
          {delivered !== null && spoiled !== null && <p className="text-xs text-slate-400">{delivered > 0 ? ui("{0}% of deliveries", ((spoiled / delivered) * 100).toFixed(1)) : ui("No deliveries yet")}</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {subPartners.map(sub => {
          const spoilage = metric('spoilage', sub.id);
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
                <span className="text-slate-500">{ui('Account balance due')}<span className="block font-semibold text-slate-900">{display(customerAccountBalance(sub))}</span></span>
                <span className="text-slate-500">{ui('Open invoice balance')}<span className="block font-semibold text-slate-900">{display(metric('outstanding', sub.id))}</span></span>
                <span className="text-slate-500">{ui("Spoilage ")}<span className={`block font-semibold ${spoilage > 0 ? "text-red-600" : "text-slate-900"}`}>{display(spoilage)}</span></span>
              </div>
            </div>
          );
        })}
      </div>

      {subPartners.length === 0 && (
        <p className="text-sm text-slate-400 bg-slate-50 rounded-lg p-4 text-center inline-flex items-center gap-2 w-full justify-center">
          <MapPin size={14} />{ui(" No branches yet. Use Add branch to link a customer to this main customer.")}</p>
      )}
    </div>
  );
}
