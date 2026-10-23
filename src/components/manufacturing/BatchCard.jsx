import FermentationTimer from "./FermentationTimer";
import BatchOutputSummary from "./BatchOutputSummary";

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React from "react";
import { formatDate, formatNumber, formatXAF } from "@/lib/formatters";
import StatusBadge from "@/components/shared/StatusBadge";
import { ProductPhoto } from "@/components/shared/ProductThumb";
import { productionHandoff } from '@/lib/production-handoff';
import { isYogurt } from '@/lib/yogurt-production';

const STAGE = {
  draft: { get label(){return ui("Planning");}, pct: 5 },
  awaiting_approval: { get label(){return ui("Awaiting Approval");}, pct: 15 },
  approved: { get label(){return ui("Approved");}, pct: 25 },
  materials_reserved: { get label(){return ui("Materials Reserved");}, pct: 35 },
  materials_issued: { get label(){return ui("Materials Issued");}, pct: 50 },
  in_production: { get label(){return ui("Under fermentation");}, pct: 65 },
  awaiting_qc: { get label(){return ui("Awaiting QC");}, pct: 85 },
  completed: { get label(){return ui("Completed");}, pct: 100 },
  released: { get label(){return ui("Released");}, pct: 100 },
  rejected: { get label(){return ui("Rejected");}, pct: 100 },
};

const BAR = {
  awaiting_qc: "bg-slate-400",
  rejected: "bg-red-500",
  completed: "bg-green-500",
  released: "bg-green-500",
};

// Visual card representing one production batch.
export default function BatchCard({ order, product, onClick }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const yogurt=isYogurt(order);
  const phase=order.yogurt_phase;
  const stage = yogurt&&order.yogurt_packaged_at?{label:ui('Production cycle complete'),pct:100}:yogurt&&order.status==='in_production'&&phase!=='fermentation'?{label:ui(phase==='additives'?'Additives':phase==='flavouring'?'Flavouring':'Packaging'),pct:phase==='additives'?68:phase==='flavouring'?72:80}:STAGE[order.status] || { label: order.status, pct: 0 };
  const handoff = yogurt&&order.status==='in_production'&&phase==='packaging'?{owner:'Production / Warehouse',task:'Record actual finished quantities; packaging is deducted at completion.'}:yogurt&&order.status==='in_production'?{owner:order.yogurt_issued_stages?.[phase]?'Production Manager':'Warehouse Manager',task:order.yogurt_issued_stages?.[phase]?'Complete the current production phase.':'Issue materials for the current production phase.'}:productionHandoff(order.status);
  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-white border border-slate-200 rounded-xl p-4 hover:shadow-md hover:border-purple-300 transition-all"
    >
      <ProductPhoto product={product} name={order.product_name} className="aspect-[4/3] w-full rounded-lg mb-3" imageClassName="p-2" />
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-900 text-sm truncate">{order.product_name}</p>
          <p className="text-xs text-slate-500 font-mono">{order.batch_number || order.order_number || ui("No batch #")}</p>
        </div>
        <StatusBadge status={order.status} />
      </div>
      <div className="h-2 rounded-full bg-slate-100 overflow-hidden mb-2">
        <div
          className={`h-full rounded-full ${BAR[order.status] || "bg-purple-500"} transition-all`}
          style={{ width: `${stage.pct}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>{stage.label}</span>
        <span>{stage.pct}%</span>
      </div>
      <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
        <div>
          <p className="text-slate-400">{ui("Planned")}</p>
          <p className="font-medium text-slate-700">{yogurt?`${order.yogurt_plan.buckets} × 30 L`:formatNumber(order.planned_output)+ui(' units')}</p>
        </div>
        <div>
          <p className="text-slate-400">{order.actual_output ? ui("Actual") : ui("Date")}</p>
          <p className="font-medium text-slate-700">
            {order.actual_output ? `${formatNumber(order.actual_output)} units` : formatDate(order.production_date)}
          </p>
        </div>
        {!yogurt && order.actual_cost_per_unit > 0 && (
          <div>
            <p className="text-slate-400">{ui("Cost / unit")}</p>
            <p className="font-medium text-slate-700">{formatXAF(order.actual_cost_per_unit)}</p>
          </div>
        )}
        {order.expiry_date && (
          <div>
            <p className="text-slate-400">{ui("Expiry")}</p>
            <p className="font-medium text-slate-700">{formatDate(order.expiry_date)}</p>
          </div>
        )}
      </div>
      {yogurt&&<BatchOutputSummary order={order} compact/>}
      <FermentationTimer order={order}/>
      {handoff && <p className="mt-3 rounded-lg bg-slate-50 p-2 text-xs text-slate-600"><strong>{ui(handoff.owner)}</strong><span className="mt-1 block">{ui(handoff.task)}</span></p>}
    </button>
  );
}
