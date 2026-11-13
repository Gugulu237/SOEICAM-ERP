
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState, useEffect } from "react";
import { erp } from "@/api/erpClient";
import { formatXAF, formatDate } from "@/lib/formatters";
import { CUSTOMER_SALE_STATUSES, customerActivityScope, customerInvoiceDetailPath, customerInvoiceQuery } from '@/lib/customer-mobile-summary';
import { Link } from '@/lib/router';
import StatusBadge from "@/components/shared/StatusBadge";
import { ShoppingCart, Receipt } from "lucide-react";

const DELIVERED = ["delivered", "partially_delivered", "invoiced"];

function Tile({ label, value, hint }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-lg font-bold text-slate-900">{value}</p>
      {hint && <p className="text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

function Table({ head, children, empty }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

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
export default function PartnerSalesPanel({ partner, subPartners = [], headquartersId }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [result, setResult] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const idsKey = [partner.id, ...subPartners.map(s => s.id)].join(",");
  const requestKey = JSON.stringify([idsKey, headquartersId, attempt]);

  useEffect(() => {
    let cancelled = false;
    const customer = headquartersId ? partner.id : { $in: idsKey.split(",") };
    const scope = customerActivityScope(customer, headquartersId);
    Promise.all([
      erp.entities.SalesOrder.aggregate({ query: scope, groupBy: "status", sum: ["total"] }),
      erp.entities.Invoice.aggregate({ query: { ...scope, payment_type: { $ne: 'cash' }, status: { $in: CUSTOMER_SALE_STATUSES } }, groupBy: "status", sum: ["balance"] }),
      erp.entities.SalesOrder.filter(scope, { sort: "-order_date", limit: 15, include_total: false }),
      erp.entities.Invoice.filter(scope, { sort: "-invoice_date", limit: 15, include_total: false }),
      erp.entities.Invoice.aggregate({ query: customerInvoiceQuery(customer, headquartersId), groupBy: "status", sum: ["total"] }),
    ]).then(([orders, invoices, orderList, invoiceList, invoiceSales]) => {
      if (cancelled) return;
      setResult({ requestKey, data: { orders: orders.rows, invoices: invoices.rows, invoiceSales: invoiceSales.rows, orderList: orderList.items, invoiceList: invoiceList.items } });
    }).catch(() => {
      if (!cancelled) setResult({ requestKey, error: true });
    });
    return () => { cancelled = true; };
  }, [idsKey, partner.id, headquartersId, requestKey]);

  const current = result?.requestKey === requestKey ? result : null;
  if (current?.error) return <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
    {ui('Sales history could not load.')} <button type="button" onClick={() => setAttempt(value => value + 1)} className="font-semibold underline underline-offset-2">{ui('Retry')}</button>
  </p>;
  if (!current) return <div role="status" className="flex justify-center py-10"><span className="sr-only">{ui('Loading...')}</span><div aria-hidden="true" className="w-6 h-6 border-4 border-slate-200 border-t-primary rounded-full animate-spin" /></div>;

  const {data}=current;
  const orderCount = data.orders.reduce((s, r) => s + (r.count || 0), 0);
  const delivered = data.orders.filter(r => DELIVERED.includes(r.status)).reduce((s, r) => s + (r.sum_total || 0), 0);
  const invoiced = data.invoiceSales.reduce((s, r) => s + (r.sum_total || 0), 0);
  const outstanding = data.invoices.reduce((s, r) => s + (r.sum_balance || 0), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label={ui("Orders")} value={orderCount} hint={subPartners.length ? `Across ${subPartners.length + 1} branches` : "This partner"} />
        <Tile label={ui("Delivered value")} value={formatXAF(delivered)} hint="Delivered & invoiced orders" />
        <Tile label={ui("Invoiced")} value={formatXAF(invoiced)} hint={`${data.invoiceList.length} recent invoices`} />
        <Tile label={ui("Outstanding")} value={formatXAF(outstanding)} hint="Unpaid invoice balance" />
      </div>

      <div>
        <h3 className="text-sm font-semibold text-slate-900 mb-2 inline-flex items-center gap-1.5"><ShoppingCart size={14} />{ui(" Recent orders")}</h3>
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
        <h3 className="text-sm font-semibold text-slate-900 mb-2 inline-flex items-center gap-1.5"><Receipt size={14} />{ui(" Recent invoices")}</h3>
        <Table head={["Invoice", "Date", "Status", "Total", "Balance"]} empty={data.invoiceList.length === 0 ? "No invoices yet." : null}>
          {data.invoiceList.map(i => {
            const href = customerInvoiceDetailPath(partner.id, i, {fromSales:true});
            const number = i.invoice_number || ui('Invoice');
            return (
              <tr key={i.id}>
                <td className="px-3 py-2">
                  {href ? (
                    <Link to={href} aria-label={`${ui('Open invoice')} ${number}`} className="font-semibold text-primary underline underline-offset-2">{number}</Link>
                  ) : <p className="text-slate-900">{number}</p>}
                  <p className="text-xs text-slate-500">{i.customer_id===headquartersId ? ui('Billed to {0}', i.customer_name) : i.bill_to_location_name || i.location_name || i.customer_name}</p>
                </td>
                <td className="px-3 py-2 text-right text-slate-600">{formatDate(i.invoice_date)}</td>
                <td className="px-3 py-2 text-right"><StatusBadge status={i.status} /></td>
                <td className="px-3 py-2 text-right text-slate-600">{formatXAF(i.total)}</td>
                <td className="px-3 py-2 text-right font-medium text-slate-900">{formatXAF(i.payment_type!=='cash'&&CUSTOMER_SALE_STATUSES.includes(i.status)?i.balance:0)}</td>
              </tr>
            );
          })}
        </Table>
      </div>
    </div>
  );
}
