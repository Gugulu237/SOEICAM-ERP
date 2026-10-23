
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import CustomerMapLinks from '@/components/customers/CustomerMapLinks';
import React from "react";
import StatusBadge from "@/components/shared/StatusBadge";
import { formatDate, formatNumber, formatXAF } from "@/lib/formatters";
import TraceJourney from "@/components/quality/TraceJourney";

function Section({ title, children }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 mb-4">
      <h3 className="font-semibold text-slate-900 mb-3">{title}</h3>
      {children}
    </div>
  );
}

export default function BatchGenealogy({ direction, lot, data }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  if (!data) {
    return <p className="text-sm text-slate-500 bg-white border border-slate-200 rounded-xl p-8 text-center">{ui("No production record found for batch ")}{lot.lot_number}.
    </p>;
  }

  if (direction === "backward") {
    const { order, recipe, ingredients } = data;
    const reachedBack = ["materials", "production"];
    if (["released", "completed", "closed"].includes(order.status)) reachedBack.push("quality", "store");
    return (
      <div>
        <TraceJourney
          reached={reachedBack}
          detail={{
            materials: `${ingredients.length} material${ingredients.length === 1 ? "" : "s"}`,
            production: formatDate(order.production_date),
            quality: order.status === "released" ? "Released" : "Pending",
          }}
        />
        <Section title={ui("Production — {0}", order.order_number)}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div><p className="text-slate-500">{ui("Product")}</p><p className="font-medium">{order.product_name}</p></div>
            <div><p className="text-slate-500">{ui("Produced")}</p><p className="font-medium">{formatDate(order.production_date)}</p></div>
            <div><p className="text-slate-500">{ui("Expires")}</p><p className="font-medium">{order.expiry_date ? formatDate(order.expiry_date) : "—"}</p></div>
            <div><p className="text-slate-500">{ui("Output")}</p><p className="font-medium">{formatNumber(order.actual_output || 0, 2)}{ui(" of ")}{formatNumber(order.planned_output, 2)}</p></div>
            <div><p className="text-slate-500">{ui("Yield")}</p><p className="font-medium">{order.planned_output ? formatNumber((order.actual_output || 0) / order.planned_output * 100, 1) : 0}%</p></div>
            <div><p className="text-slate-500">{ui("Cost / unit")}</p><p className="font-medium">{formatXAF(order.actual_cost_per_unit)}</p></div>
            <div><p className="text-slate-500">{ui("Recipe")}</p><p className="font-medium">{recipe ? `${recipe.recipe_name} v${recipe.version}` : "—"}</p></div>
            <div><p className="text-slate-500">{ui("Status")}</p><StatusBadge status={order.status} /></div>
          </div>
        </Section>

        <Section title={ui("Ingredients & Packaging Consumed")}>
          {data.yogurt_yields&&<p className="mb-3 text-sm text-slate-500">{ui('These materials cover the shared fermentation batch and all its finished variants. Unused packaging has been deducted.')}</p>}
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-slate-600">
                <th className="pb-2">{ui("Material")}</th>
                <th className="pb-2">{ui("Lot(s)")}</th>
                <th className="pb-2 text-right">{ui("Consumed")}</th>
                <th className="pb-2 text-right">{ui("Cost")}</th>
              </tr>
            </thead>
            <tbody>
              {ingredients.map(m => (
                <tr key={m.id} className="border-b border-slate-100">
                  <td className="py-2 font-medium">{m.material_name}</td>
                  <td className="py-2 text-slate-600">{m.lot_number || "—"}</td>
                  <td className="py-2 text-right">{formatNumber(m.consumed_quantity || m.standard_quantity, 3)} {m.unit}</td>
                  <td className="py-2 text-right">{formatXAF(m.total_cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {ingredients.length === 0 && <p className="text-sm text-slate-400 py-4">{ui("No materials recorded for this batch.")}</p>}
        </Section>
      </div>
    );
  }

  const { produced, delivered, returned, onHand, customers, movements } = data;
  const inStock = onHand.reduce((s, o) => s + o.quantity, 0);
  const reachedFwd = [];
  if (produced > 0) reachedFwd.push("production");
  if (movements.some(m => m.movement_type === "production_issue")) reachedFwd.push("materials");
  if (movements.some(m => m.movement_type === "quality_release")) reachedFwd.push("quality");
  if (inStock > 0) reachedFwd.push("store");
  if (movements.some(m => m.source_type === "vehicle" || m.destination_type === "vehicle" || m.movement_type === "vehicle_load")) reachedFwd.push("transit");
  if (customers.length > 0) reachedFwd.push("customer");
  return (
    <div>
      <TraceJourney
        reached={reachedFwd}
        detail={{
          production: `${formatNumber(produced, 0)} units`,
          store: `${formatNumber(inStock, 0)} left`,
          customer: `${new Set(customers.map(c => c.customer_id || c.customer_name)).size} customers`,
        }}
      />
      <Section title={ui("Batch Balance")}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div><p className="text-slate-500">{ui("Produced")}</p><p className="font-medium">{formatNumber(produced, 2)}</p></div>
          <div><p className="text-slate-500">{ui("Delivered")}</p><p className="font-medium">{formatNumber(delivered, 2)}</p></div>
          <div><p className="text-slate-500">{ui("Returned")}</p><p className="font-medium">{formatNumber(returned, 2)}</p></div>
          <div><p className="text-slate-500">{ui("Still in stock")}</p><p className="font-medium">{formatNumber(onHand.reduce((s, o) => s + o.quantity, 0), 2)}</p></div>
        </div>
      </Section>

      <Section title={ui("Currently Held At")}>
        {onHand.length === 0 && <p className="text-sm text-slate-400">{ui("None of this batch remains in stock.")}</p>}
        {onHand.map((o, i) => (
          <div key={i} className="flex items-center justify-between py-2 border-b border-slate-100 text-sm">
            <span className="font-medium">{o.location}</span>
            <span>{formatNumber(o.quantity, 2)}{ui(" units")}</span>
            <StatusBadge status={o.qc_status} />
          </div>
        ))}
      </Section>

      <Section title={ui("Customers Who Received This Batch")}>
        {customers.length === 0 && <p className="text-sm text-slate-400">{ui("No customer stock issues are recorded for this exact product batch.")}</p>}
        {customers.map((c, i) => (
          <div key={i} className="flex items-center justify-between py-2 border-b border-slate-100 text-sm">
            <div>
              <p className="font-medium">{c.customer_name}{c.location_name ? " / " + c.location_name : ""}</p><p className="mt-1 text-xs text-slate-500">{c.supply_type} · {c.commercial_name}{c.driver_name ? " · Driver " + c.driver_name : ""}</p>
              <p className="text-xs text-slate-500">{c.order_number} · {formatDate(c.date)}</p>
            </div>
            <span className="whitespace-nowrap font-semibold">{formatNumber(c.quantity, 3)} {lot.unit || ui("units")}</span>
          </div>
        ))}
      </Section>

      {customers.some(c => c.phone || c.address) && <Section title={ui("Current customer contact details")}><div className="grid gap-3 sm:grid-cols-2">{[...new Map(customers.map(c => [c.customer_id + ':' + c.location_id,c])).values()].map(c => <div key={c.customer_id + ':' + c.location_id} className="rounded-xl border p-3"><p className="text-sm font-semibold">{c.customer_name}{c.location_name ? ' / ' + c.location_name : ''}</p>{c.phone && <a href={'tel:' + c.phone} className="mt-2 block text-sm text-blue-700 underline">{c.phone}</a>}<p className="mt-1 text-xs text-slate-500">{c.address}</p><CustomerMapLinks customer={c}/></div>)}</div></Section>}

      <Section title={ui("Movement Timeline")}>
        <ol className="relative border-l border-slate-200 ml-2">
          {movements.map(m => (
            <li key={m.id} className="ml-4 pb-4">
              <span className="absolute -left-1.5 w-3 h-3 bg-slate-400 rounded-full" />
              <p className="text-sm font-medium text-slate-900">{m.movement_type.replace(/_/g, " ")}</p>
              <p className="text-xs text-slate-500">
                {formatDate(m.movement_date)} · {formatNumber(m.quantity, 2)}{ui(" units")}{m.source_name ? ui(" · from {0}", m.source_name) : ""}
                {m.destination_name ? ui(" · to {0}", m.destination_name) : ""}
              </p>
              {m.reason && <p className="text-xs text-slate-400">{m.reason}</p>}
            </li>
          ))}
        </ol>
        {movements.length === 0 && <p className="text-sm text-slate-400">{ui("No ledger movements recorded for this batch.")}</p>}
      </Section>
    </div>
  );
}
