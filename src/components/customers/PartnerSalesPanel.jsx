import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { formatXAF, formatDate } from "@/lib/formatters";
import StatusBadge from "@/components/shared/StatusBadge";
import { ShoppingCart, Receipt } from "lucide-react";

const DELIVERED = ["delivered", "partially_delivered", "invoiced"];

function Tile({ label, value, hint }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-lg font-bold text-slate-900">{value}</p>
      {hint && <p className="text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

function Table({ head, children, empty }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>{head.map((h, i) => <th key={h} className={`px-3 py-2 font-medium ${i === 0 ? "text-left" : "text-right"}`}>{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
      {empty && <p className="text-sm text-slate-400 bg-slate-50 p-4 text-center">{empty}</p>}
    </div>
  );
}

// Sales performance of a partner and its branches: orders taken, invoiced, still owed.
export default function PartnerSalesPanel({ partner, subPartners = [] }) {
  const [data, setData] = useState(null);
  const idsKey = [partner.id, ...subPartners.map(s => s.id)].join(",");

  useEffect(() => {
    let cancelled = false;
    const ids = idsKey.split(",");
    Promise.all([
      base44.entities.SalesOrder.aggregate({ query: { customer_id: { $in: ids } }, groupBy: "status", sum: ["total"] }),
      base44.entities.Invoice.aggregate({ query: { customer_id: { $in: ids } }, groupBy: "status", sum: ["total", "balance"] }),
      base44.entities.SalesOrder.filter({ customer_id: { $in: ids } }, { sort: "-order_date", limit: 15 }),
      base44.entities.Invoice.filter({ customer_id: { $in: ids } }, { sort: "-invoice_date", limit: 15 }),
    ]).then(([orders, invoices, orderList, invoiceList]) => {
      if (cancelled) return;
      setData({ orders: orders.rows, invoices: invoices.rows, orderList: orderList.items, invoiceList: invoiceList.items });
    });
    return () => { cancelled = true; };
  }, [idsKey]);

  if (!data) return <div className="flex justify-center py-10"><div className="w-6 h-6 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;

  const orderCount = data.orders.reduce((s, r) => s + (r.count || 0), 0);
  const delivered = data.orders.filter(r => DELIVERED.includes(r.status)).reduce((s, r) => s + (r.sum_total || 0), 0);
  const invoiced = data.invoices.reduce((s, r) => s + (r.sum_total || 0), 0);
  const outstanding = data.invoices.reduce((s, r) => s + (r.sum_balance || 0), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Orders" value={orderCount} hint={subPartners.length ? `Across ${subPartners.length + 1} branches` : "This partner"} />
        <Tile label="Delivered value" value={formatXAF(delivered)} hint="Delivered & invoiced orders" />
        <Tile label="Invoiced" value={formatXAF(invoiced)} hint={`${data.invoiceList.length} recent invoices`} />
        <Tile label="Outstanding" value={formatXAF(outstanding)} hint="Unpaid invoice balance" />
      </div>

      <div>
        <h3 className="text-sm font-semibold text-slate-900 mb-2 inline-flex items-center gap-1.5"><ShoppingCart size={14} /> Recent orders</h3>
        <Table head={["Order", "Date", "Status", "Total"]} empty={data.orderList.length === 0 ? "No orders yet." : null}>
          {data.orderList.map(o => (
            <tr key={o.id}>
              <td className="px-3 py-2">
                <p className="text-slate-900">{o.order_number}</p>
                <p className="text-xs text-slate-500">{o.customer_name}</p>
              </td>
              <td className="px-3 py-2 text-right text-slate-600">{formatDate(o.order_date)}</td>
              <td className="px-3 py-2 text-right"><StatusBadge status={o.status} /></td>
              <td className="px-3 py-2 text-right font-medium text-slate-900">{formatXAF(o.total)}</td>
            </tr>
          ))}
        </Table>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-slate-900 mb-2 inline-flex items-center gap-1.5"><Receipt size={14} /> Recent invoices</h3>
        <Table head={["Invoice", "Date", "Status", "Total", "Balance"]} empty={data.invoiceList.length === 0 ? "No invoices yet." : null}>
          {data.invoiceList.map(i => (
            <tr key={i.id}>
              <td className="px-3 py-2">
                <p className="text-slate-900">{i.invoice_number}</p>
                <p className="text-xs text-slate-500">{i.bill_to_location_name || i.location_name || i.customer_name}</p>
              </td>
              <td className="px-3 py-2 text-right text-slate-600">{formatDate(i.invoice_date)}</td>
              <td className="px-3 py-2 text-right"><StatusBadge status={i.status} /></td>
              <td className="px-3 py-2 text-right text-slate-600">{formatXAF(i.total)}</td>
              <td className="px-3 py-2 text-right font-medium text-slate-900">{formatXAF(i.balance)}</td>
            </tr>
          ))}
        </Table>
      </div>
    </div>
  );
}