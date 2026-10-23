
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState, useEffect } from "react";
import { erp } from "@/api/erpClient";
import { formatDate } from "@/lib/formatters";
import { Package, AlertTriangle, Clock } from "lucide-react";

const DELIVERED = ["delivered", "partially_delivered", "invoiced"];
const DAY = 86400000;

function Tile({ label, value, hint }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-lg font-bold text-slate-900">{value}</p>
      {hint && <p className="text-xs text-slate-400 truncate">{hint}</p>}
    </div>
  );
}

// What the partner is still holding: delivered, minus returns and reported spoilage,
// with the expiry date of the batches those deliveries came from.
export default function PartnerStockPanel({ partner, subPartners = [] }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [rows, setRows] = useState(null);
  const idsKey = [partner.id, ...subPartners.map(s => s.id)].join(",");

  useEffect(() => {
    let cancelled = false;
    const ids = idsKey.split(",");

    async function load() {
      const orders = (await erp.entities.SalesOrder.filter({ customer_id: { $in: ids } }, { limit: 200, include_total: false, fields: ["id", "status"] })).items;
      const orderIds = orders.filter(o => DELIVERED.includes(o.status)).map(o => o.id);

      const [lines, spoilage, returns] = await Promise.all([
        orderIds.length ? erp.entities.SalesOrderLine.filter({ order_id: { $in: orderIds } }, { limit: 500, include_total: false }).then(r => r.items) : [],
        erp.entities.SpoilageRecord.filter({ customer_id: { $in: ids } }, { limit: 500, include_total: false, fields: ["product_id", "product_name", "quantity"] }).then(r => r.items),
        orderIds.length ? erp.entities.StockMovement.filter({ movement_type: "customer_return", document_id: { $in: orderIds } }, { limit: 500, include_total: false, fields: ["product_id", "product_name", "quantity"] }).then(r => r.items) : [],
      ]);

      const map = {};
      const row = (id, name) => (map[id] = map[id] || { id, name, delivered: 0, returned: 0, spoiled: 0, lots: [] });

      lines.forEach(l => {
        const r = row(l.product_id, l.product_name);
        const qty = l.delivered_quantity > 0 ? l.delivered_quantity : l.quantity || 0;
        r.delivered += qty;
        if (l.lot_number && !r.lots.includes(l.lot_number)) r.lots.push(l.lot_number);
      });
      returns.forEach(m => { row(m.product_id, m.product_name).returned += m.quantity || 0; });
      spoilage.forEach(s => { row(s.product_id, s.product_name).spoiled += s.quantity || 0; });

      const lots = [...new Set(Object.values(map).flatMap(r => r.lots))];
      const balances = lots.length
        ? (await erp.entities.StockBalance.filter({ lot_number: { $in: lots } }, { limit: 500, include_total: false, fields: ["lot_number", "expiry_date"] })).items
        : [];
      const expiryByLot = {};
      balances.forEach(b => {
        if (!b.expiry_date) return;
        if (!expiryByLot[b.lot_number] || b.expiry_date < expiryByLot[b.lot_number]) expiryByLot[b.lot_number] = b.expiry_date;
      });

      const today = new Date().setHours(0, 0, 0, 0);
      const list = Object.values(map)
        .map(r => {
          const earliest = r.lots.map(l => expiryByLot[l]).filter(Boolean).sort()[0] || null;
          const days = earliest ? Math.round((new Date(earliest).setHours(0, 0, 0, 0) - today) / DAY) : null;
          return { ...r, stillWith: r.delivered - r.returned - r.spoiled, earliest, days };
        })
        .sort((a, b) => b.stillWith - a.stillWith);

      if (!cancelled) setRows(list);
    }

    load();
    return () => { cancelled = true; };
  }, [idsKey]);

  if (!rows) return <div className="flex justify-center py-10"><div className="w-6 h-6 border-4 border-slate-200 border-t-primary rounded-full animate-spin" /></div>;

  const totalUnits = rows.reduce((s, r) => s + Math.max(0, r.stillWith), 0);
  const spoiled = rows.reduce((s, r) => s + r.spoiled, 0);
  const atRisk = rows.filter(r => r.days !== null && r.days <= 30);

  const expiry = (r) => {
    if (r.days === null) return <span className="text-xs text-slate-400">{ui("No expiry recorded")}</span>;
    if (r.days < 0) return <span className="text-xs font-medium text-red-600">{ui("Expired ")}{formatDate(r.earliest)}</span>;
    if (r.days <= 7) return <span className="text-xs font-medium text-red-600">{r.days}{ui(" days left")}</span>;
    if (r.days <= 30) return <span className="text-xs font-medium text-slate-600">{r.days}{ui(" days left")}</span>;
    return <span className="text-xs text-slate-500">{formatDate(r.earliest)}</span>;
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <Tile label={ui("Units still with partner")} value={totalUnits.toLocaleString()} hint={`${rows.length} product${rows.length === 1 ? "" : "s"} delivered`} />
        <Tile label={ui("Batches expiring ≤ 30 days")} value={atRisk.length} hint={atRisk.length ? atRisk.map(r => r.name).join(", ") : "Nothing expiring soon"} />
        <Tile label={ui("Reported spoilage")} value={spoiled.toLocaleString()} hint="Units reported by the partner" />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="text-left px-3 py-2 font-medium">{ui("Product")}</th>
              <th className="text-right px-3 py-2 font-medium">{ui("Delivered")}</th>
              <th className="text-right px-3 py-2 font-medium">{ui("Returned")}</th>
              <th className="text-right px-3 py-2 font-medium">{ui("Spoiled")}</th>
              <th className="text-right px-3 py-2 font-medium">{ui("Still with them")}</th>
              <th className="text-left px-3 py-2 font-medium">{ui("Earliest expiry")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(r => (
              <tr key={r.id}>
                <td className="px-3 py-2 text-slate-900">{r.name}</td>
                <td className="px-3 py-2 text-right text-slate-600">{r.delivered.toLocaleString()}</td>
                <td className="px-3 py-2 text-right text-slate-600">{r.returned.toLocaleString()}</td>
                <td className={`px-3 py-2 text-right ${r.spoiled > 0 ? "text-red-600" : "text-slate-600"}`}>{r.spoiled.toLocaleString()}</td>
                <td className="px-3 py-2 text-right font-semibold text-slate-900">{r.stillWith.toLocaleString()}</td>
                <td className="px-3 py-2">{expiry(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className="text-sm text-slate-400 bg-slate-50 p-4 text-center inline-flex items-center gap-2 w-full justify-center">
            <Package size={14} />{ui(" Nothing delivered to this partner yet.")}</p>
        )}
      </div>

      <p className="text-xs text-slate-400 inline-flex items-center gap-1.5">
        <Clock size={12} />{ui(" Still with them = delivered on completed orders minus returns and reported spoilage. Expiry comes from the batch each delivery was drawn from.")}</p>
      {spoiled > 0 && (
        <p className="text-xs text-slate-600 inline-flex items-center gap-1.5">
          <AlertTriangle size={12} />{ui(" Spoilage is logged per branch in the Overview tab.")}</p>
      )}
    </div>
  );
}
