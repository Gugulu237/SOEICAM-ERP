import React from "react";
import { formatNumber, formatDate } from "@/lib/formatters";
import { AlertTriangle, CalendarClock, PackageX } from "lucide-react";

// Reorder-level and expiry watchlist built from live balances.
export default function StockAlerts({ products, balances }) {
  const onHand = {};
  balances.forEach(b => { onHand[b.product_id] = (onHand[b.product_id] || 0) + (b.quantity || 0); });

  const lowStock = products
    .filter(p => p.is_active !== false && (p.reorder_level || 0) > 0 && (onHand[p.id] || 0) <= p.reorder_level)
    .map(p => ({ ...p, stock: onHand[p.id] || 0 }));

  const outOfStock = lowStock.filter(p => p.stock <= 0);

  const horizon = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const expiring = balances
    .filter(b => b.expiry_date && (b.quantity || 0) > 0 && b.expiry_date <= horizon)
    .sort((a, b) => a.expiry_date.localeCompare(b.expiry_date));

  const Section = ({ icon: Icon, title, tone, children }) => (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className={`flex items-center gap-2 px-4 py-3 border-b border-slate-200 ${tone}`}>
        <Icon size={16} /><span className="font-semibold text-sm">{title}</span>
      </div>
      {children}
    </div>
  );

  return (
    <div className="space-y-4">
      <Section icon={PackageX} title={`Out of stock (${outOfStock.length})`} tone="text-red-600">
        {outOfStock.length === 0 ? <p className="px-4 py-6 text-sm text-slate-400">Nothing is out of stock.</p> : (
          <ul className="divide-y divide-slate-100">
            {outOfStock.map(p => (
              <li key={p.id} className="px-4 py-3 text-sm flex justify-between">
                <span>{p.name} <span className="text-slate-400">({p.sku})</span></span>
                <span className="text-red-600 font-medium">0 {p.storage_unit || ""}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section icon={AlertTriangle} title={`Below reorder level (${lowStock.length})`} tone="text-amber-600">
        {lowStock.length === 0 ? <p className="px-4 py-6 text-sm text-slate-400">All stocked items are above their reorder level.</p> : (
          <ul className="divide-y divide-slate-100">
            {lowStock.map(p => (
              <li key={p.id} className="px-4 py-3 text-sm flex justify-between">
                <span>{p.name} <span className="text-slate-400">({p.sku})</span></span>
                <span className="text-slate-700">{formatNumber(p.stock, 2)} / reorder at {formatNumber(p.reorder_level, 2)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section icon={CalendarClock} title={`Expiring within 30 days (${expiring.length})`} tone="text-orange-600">
        {expiring.length === 0 ? <p className="px-4 py-6 text-sm text-slate-400">No lots expiring soon.</p> : (
          <ul className="divide-y divide-slate-100">
            {expiring.map(b => (
              <li key={b.id} className="px-4 py-3 text-sm flex justify-between">
                <span>{b.product_name} <span className="text-slate-400">· {b.warehouse_name}{b.lot_number ? ` · ${b.lot_number}` : ""}</span></span>
                <span className="text-orange-600">{formatNumber(b.quantity, 2)} — exp. {formatDate(b.expiry_date)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}