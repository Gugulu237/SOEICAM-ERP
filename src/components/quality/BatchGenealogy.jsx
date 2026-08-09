import React from "react";
import StatusBadge from "@/components/shared/StatusBadge";
import { formatDate, formatNumber, formatXAF } from "@/lib/formatters";
import TraceJourney from "@/components/quality/TraceJourney";

function Section({ title, children }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 mb-4">
      <h3 className="font-semibold text-slate-900 mb-3">{title}</h3>
      {children}
    </div>
  );
}

export default function BatchGenealogy({ direction, lot, data }) {
  if (!data) {
    return <p className="text-sm text-slate-500 bg-white border border-slate-200 rounded-xl p-8 text-center">
      No production record found for batch {lot.lot_number}.
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
        <Section title={`Production — ${order.order_number}`}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div><p className="text-slate-500">Product</p><p className="font-medium">{order.product_name}</p></div>
            <div><p className="text-slate-500">Produced</p><p className="font-medium">{formatDate(order.production_date)}</p></div>
            <div><p className="text-slate-500">Expires</p><p className="font-medium">{order.expiry_date ? formatDate(order.expiry_date) : "—"}</p></div>
            <div><p className="text-slate-500">Output</p><p className="font-medium">{formatNumber(order.actual_output || 0, 2)} of {formatNumber(order.planned_output, 2)}</p></div>
            <div><p className="text-slate-500">Yield</p><p className="font-medium">{order.planned_output ? formatNumber((order.actual_output || 0) / order.planned_output * 100, 1) : 0}%</p></div>
            <div><p className="text-slate-500">Cost / unit</p><p className="font-medium">{formatXAF(order.actual_cost_per_unit)}</p></div>
            <div><p className="text-slate-500">Recipe</p><p className="font-medium">{recipe ? `${recipe.recipe_name} v${recipe.version}` : "—"}</p></div>
            <div><p className="text-slate-500">Status</p><StatusBadge status={order.status} /></div>
          </div>
        </Section>

        <Section title="Ingredients & Packaging Consumed">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-slate-600">
                <th className="pb-2">Material</th>
                <th className="pb-2">Lot(s)</th>
                <th className="pb-2 text-right">Consumed</th>
                <th className="pb-2 text-right">Cost</th>
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
          {ingredients.length === 0 && <p className="text-sm text-slate-400 py-4">No materials recorded for this batch.</p>}
        </Section>
      </div>
    );
  }

  const { produced, delivered, returned, onHand, customers, movements } = data;
  const inStock = onHand.reduce((s, o) => s + o.quantity, 0);
  const reachedFwd = ["materials", "production", "quality"];
  if (inStock > 0) reachedFwd.push("store");
  if (movements.some(m => (m.destination_name || "").toLowerCase().includes("vehicle")) || delivered > 0) reachedFwd.push("transit");
  if (customers.length > 0) reachedFwd.push("customer");
  return (
    <div>
      <TraceJourney
        reached={reachedFwd}
        detail={{
          production: `${formatNumber(produced, 0)} units`,
          store: `${formatNumber(inStock, 0)} left`,
          customer: `${customers.length} customer${customers.length === 1 ? "" : "s"}`,
        }}
      />
      <Section title="Batch Balance">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div><p className="text-slate-500">Produced</p><p className="font-medium">{formatNumber(produced, 2)}</p></div>
          <div><p className="text-slate-500">Delivered</p><p className="font-medium">{formatNumber(delivered, 2)}</p></div>
          <div><p className="text-slate-500">Returned</p><p className="font-medium">{formatNumber(returned, 2)}</p></div>
          <div><p className="text-slate-500">Still in stock</p><p className="font-medium">{formatNumber(onHand.reduce((s, o) => s + o.quantity, 0), 2)}</p></div>
        </div>
      </Section>

      <Section title="Currently Held At">
        {onHand.length === 0 && <p className="text-sm text-slate-400">None of this batch remains in stock.</p>}
        {onHand.map((o, i) => (
          <div key={i} className="flex items-center justify-between py-2 border-b border-slate-100 text-sm">
            <span className="font-medium">{o.location}</span>
            <span>{formatNumber(o.quantity, 2)} units</span>
            <StatusBadge status={o.qc_status} />
          </div>
        ))}
      </Section>

      <Section title="Customers Who Received This Batch">
        {customers.length === 0 && <p className="text-sm text-slate-400">This batch has not reached any customer yet.</p>}
        {customers.map((c, i) => (
          <div key={i} className="flex items-center justify-between py-2 border-b border-slate-100 text-sm">
            <div>
              <p className="font-medium">{c.customer_name}</p>
              <p className="text-xs text-slate-500">{c.order_number} · {formatDate(c.date)}</p>
            </div>
            <span>{formatNumber(c.quantity, 2)} units</span>
          </div>
        ))}
      </Section>

      <Section title="Movement Timeline">
        <ol className="relative border-l border-slate-200 ml-2">
          {movements.map(m => (
            <li key={m.id} className="ml-4 pb-4">
              <span className="absolute -left-1.5 w-3 h-3 bg-amber-400 rounded-full" />
              <p className="text-sm font-medium text-slate-900">{m.movement_type.replace(/_/g, " ")}</p>
              <p className="text-xs text-slate-500">
                {formatDate(m.movement_date)} · {formatNumber(m.quantity, 2)} units
                {m.source_name ? ` · from ${m.source_name}` : ""}
                {m.destination_name ? ` · to ${m.destination_name}` : ""}
              </p>
              {m.reason && <p className="text-xs text-slate-400">{m.reason}</p>}
            </li>
          ))}
        </ol>
        {movements.length === 0 && <p className="text-sm text-slate-400">No ledger movements recorded for this batch.</p>}
      </Section>
    </div>
  );
}