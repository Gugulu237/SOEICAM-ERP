
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React from "react";
import { useNavigate } from "@/lib/router";
import BatchCard from "@/components/manufacturing/BatchCard";

const COLUMNS = [
  { key: "planning", get label(){return ui("Planning");}, statuses: ["draft", "awaiting_approval"], dot: "bg-slate-400" },
  { key: "materials", get label(){return ui("Materials");}, statuses: ["approved", "materials_reserved", "materials_issued"], dot: "bg-indigo-500" },
  { key: "production", get label(){return ui("Production");}, statuses: ["in_production"], dot: "bg-purple-500" },
  { key: "qc", get label(){return ui("Awaiting QC");}, statuses: ["awaiting_qc"], dot: "bg-orange-500" },
  { key: "done", get label(){return ui("Completed");}, statuses: ["completed", "released", "rejected"], dot: "bg-green-500" },
];

// Kanban-style board of production batches by stage.
export default function ProductionBoard({ orders, products = [] }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const navigate = useNavigate();

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
      {COLUMNS.map(col => {
        const items = orders.filter(o => col.statuses.includes(o.status));
        return (
          <div key={col.key} className="bg-slate-100/70 rounded-xl p-3 min-h-[10rem]">
            <div className="flex items-center gap-2 mb-3 px-1">
              <span className={`w-2 h-2 rounded-full ${col.dot}`} />
              <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">{col.label}</p>
              <span className="ml-auto text-xs font-bold text-slate-400">{items.length}</span>
            </div>
            <div className="space-y-3">
              {items.map(o => (
                <BatchCard key={o.id} order={o} product={products.find((p) => p.id === o.product_id)} onClick={() => navigate(`/manufacturing/${o.id}`)} />
              ))}
              {items.length === 0 && (
                <p className="text-xs text-slate-400 text-center py-6">{ui("Nothing here")}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
