
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useEffect, useState } from "react";
import { formatNumber, formatDate } from "@/lib/formatters";
import { AlertTriangle, CalendarClock, PackageX, ClipboardCheck } from "lucide-react";
import { invokeFieldOps } from '@/lib/field-ops';
import { Button } from '@/components/ui/button';

// Reorder-level and expiry watchlist built from live balances.
export default function StockAlerts({ products, balances, onCount }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [audits, setAudits] = useState([]);
  const [auditError, setAuditError] = useState('');
  const [busy, setBusy] = useState('');
  useEffect(() => { let active = true; invokeFieldOps({ action: 'productionAuditRequests' }).then(({ data }) => { if (active) setAudits(data.requests); }).catch(e => { if (active) setAuditError(e.message); }); return () => { active = false; }; }, []);
  async function markCounted(row) {
    setBusy(row.id);
    try { await invokeFieldOps({ action: 'resolveProductionAudit', requestId: row.id }); setAudits(rows => rows.filter(item => item.id !== row.id)); }
    catch (e) { setAuditError(e.message); }
    finally { setBusy(''); }
  }
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
      <Section icon={ClipboardCheck} title={ui("Production count requests ({0})", audits.length)} tone="text-blue-700">
        {auditError && <p role="alert" className="px-4 py-2 text-sm text-red-700">{auditError}</p>}
        {!audits.length ? <p className="px-4 py-5 text-sm text-slate-500">{ui("No open raw-material count requests.")}</p> : <ul className="divide-y divide-slate-100">{audits.map(row => <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"><div><strong>{products.find(p => p.id === row.material_id)?.name || ui("Material")}</strong><p className="text-slate-600">{row.description}</p></div><div className="flex gap-2">{onCount && <Button size="sm" variant="outline" onClick={onCount}>{ui("Count stock")}</Button>}<Button size="sm" variant="outline" disabled={busy === row.id} onClick={() => markCounted(row)}>{ui("Mark counted")}</Button></div></li>)}</ul>}
      </Section>
      <Section icon={PackageX} title={ui("Out of stock ({0})", outOfStock.length)} tone="text-red-600">
        {outOfStock.length === 0 ? <p className="px-4 py-6 text-sm text-slate-400">{ui("Nothing is out of stock.")}</p> : (
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

      <Section icon={AlertTriangle} title={ui("Below reorder level ({0})", lowStock.length)} tone="text-slate-600">
        {lowStock.length === 0 ? <p className="px-4 py-6 text-sm text-slate-400">{ui("All stocked items are above their reorder level.")}</p> : (
          <ul className="divide-y divide-slate-100">
            {lowStock.map(p => (
              <li key={p.id} className="px-4 py-3 text-sm flex justify-between">
                <span>{p.name} <span className="text-slate-400">({p.sku})</span></span>
                <span className="text-slate-700">{formatNumber(p.stock, 2)}{ui(" / reorder at ")}{formatNumber(p.reorder_level, 2)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section icon={CalendarClock} title={ui("Expiring within 30 days ({0})", expiring.length)} tone="text-slate-600">
        {expiring.length === 0 ? <p className="px-4 py-6 text-sm text-slate-400">{ui("No lots expiring soon.")}</p> : (
          <ul className="divide-y divide-slate-100">
            {expiring.map(b => (
              <li key={b.id} className="px-4 py-3 text-sm flex justify-between">
                <span>{b.product_name} <span className="text-slate-400">· {b.warehouse_name}{b.lot_number ? ` · ${b.lot_number}` : ""}</span></span>
                <span className="text-slate-600">{formatNumber(b.quantity, 2)}{ui(" — exp. ")}{formatDate(b.expiry_date)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
