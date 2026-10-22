
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useEffect, useState } from "react";
import { loadCashToCollect, loadCashReceipts, loadOutstandingCommercials } from "@/lib/cash-receipts";
import { receiptUrl } from "@/lib/field-ops";
import { formatXAF, formatDate } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import ReceiveCashDialog from "./ReceiveCashDialog";
import { HandCoins, Paperclip } from "lucide-react";
import { useCurrentUser } from '@/hooks/useCurrentUser';

// Cash the commercials collected on delivery, received at the till against their
// physical receipts. The GM must approve before a receipt reaches the ledger.
export default function CashCollections({ treasuryAccounts, canReceive, userId, userName, onDone }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const { toast } = useToast();
  const { role } = useCurrentUser();
  const [rows, setRows] = useState([]);
  const [receipts, setReceipts] = useState([]);
  const [commercials, setCommercials] = useState([]);
  const [receiving, setReceiving] = useState(null);

  async function load() {
    const [toCollect, record] = await Promise.all([loadCashToCollect(), loadCashReceipts()]);
    setRows(toCollect);
    setReceipts(record);
    setCommercials(await loadOutstandingCommercials(toCollect));
  }

  useEffect(() => { load(); }, []);

  const today = new Date().toISOString().slice(0, 10);
  const receivedToday = receipts.filter(r => (r.received_at || "").slice(0, 10) === today);
  const receivedTodayTotal = receivedToday.reduce((s, r) => s + (r.received_amount || 0), 0);
  const toCollectTotal = rows.reduce((s, r) => s + (r.invoice.balance || 0), 0);

  async function openReceipt(uri) {
    try {
      window.open(await receiptUrl(uri), "_blank");
    } catch (e) {
      toast({ title: ui("Receipt unavailable"), description: e.message, variant: "destructive" });
    }
  }

  const done = () => { setReceiving(null); load(); onDone && onDone(); };

  return (
    <div className="mb-8">
      <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
        <HandCoins size={15} className="text-amber-600" />{ui(" Cash Sales Received from Commercials")}</h3>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="bg-white rounded-lg border border-slate-200 px-4 py-3">
          <div className="text-xs text-slate-500">{ui("Cash awaiting receipt")}</div>
          <div className="text-lg font-semibold tabular-nums">{formatXAF(toCollectTotal)}</div>
          <div className="text-xs text-slate-400">{rows.length}{ui(" delivered cash sale(s) not yet handed over")}</div>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 px-4 py-3">
          <div className="text-xs text-slate-500">{ui("Received today")}</div>
          <div className="text-lg font-semibold tabular-nums">{formatXAF(receivedTodayTotal)}</div>
          <div className="text-xs text-slate-400">{receivedToday.length}{ui(" cashier-confirmed receipt(s); ledger posting requires GM approval")}</div>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden mb-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-4 py-3 text-left font-semibold text-slate-600">{ui("Invoice #")}</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">{ui("Customer")}</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">{ui("Commercial")}</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">{ui("Delivery")}</th>
              <th className="px-4 py-3 text-right font-semibold text-slate-600">{ui("Cash to Collect")}</th>
              <th className="px-4 py-3 text-right font-semibold text-slate-600">{ui("Action")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">{ui("No delivered cash sales waiting to be received")}</td></tr>
            ) : rows.map(({ invoice, order }) => (
              <tr key={invoice.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <td className="px-4 py-3 font-medium">{invoice.invoice_number}</td>
                <td className="px-4 py-3">{invoice.customer_name}</td>
                <td className="px-4 py-3">
                  {order?.salesperson_name || order?.driver_name || <span className="text-slate-400">{ui("Not recorded")}</span>}
                  {order?.driver_name && <div className="text-xs text-slate-400">{ui("Driver: ")}{order.driver_name}</div>}
                </td>
                <td className="px-4 py-3">
                  {formatDate(order?.delivery_date || invoice.invoice_date)}
                  {order?.vehicle_name && <div className="text-xs text-slate-400">{order.vehicle_name}</div>}
                </td>
                <td className="px-4 py-3 text-right font-medium">{formatXAF(invoice.balance)}</td>
                <td className="px-4 py-3 text-right">
                  {canReceive && role === 'cashier' ? (
                    <Button size="sm" onClick={() => setReceiving({ invoice, order })}>
                      <HandCoins size={14} className="mr-1" />{ui(" Receive cash")}</Button>
                  ) : <span className="text-xs text-slate-400">{ui("View only")}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h4 className="text-sm font-semibold text-slate-700 mb-2">{ui("Cash Receipts Record")}</h4>
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-4 py-3 text-left font-semibold text-slate-600">{ui("Receipt #")}</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">{ui("Date")}</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">{ui("Commercial")}</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">{ui("Invoice")}</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">{ui("Physical receipt")}</th>
              <th className="px-4 py-3 text-right font-semibold text-slate-600">{ui("Amount")}</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">{ui("Received by")}</th>
              <th className="px-4 py-3 text-right font-semibold text-slate-600">{ui("Proof")}</th>
            </tr>
          </thead>
          <tbody>
            {receipts.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">{ui("No cash received from commercials yet")}</td></tr>
            ) : receipts.map(r => (
              <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <td className="px-4 py-3 font-medium">{r.acknowledgement_reference || r.collection_number}<div className="text-xs text-muted-foreground">{r.journal_id ? ui("Posted to ledger") : ui("Awaiting GM approval")}</div></td>
                <td className="px-4 py-3">{formatDate(r.collection_date)}</td>
                <td className="px-4 py-3">{r.commercial_name || "—"}</td>
                <td className="px-4 py-3">{r.invoice_number || r.sale_number}</td>
                <td className="px-4 py-3">{r.receipt_reference || "—"}</td>
                <td className="px-4 py-3 text-right font-medium">{formatXAF(r.received_amount)}</td>
                <td className="px-4 py-3">{r.received_by || "—"}</td>
                <td className="px-4 py-3 text-right">
                  {r.receipt_file_uris?.length ? (
                    <Button size="sm" variant="outline" onClick={() => openReceipt(r.receipt_file_uris[0])}>
                      <Paperclip size={14} className="mr-1" />{ui(" View")}</Button>
                  ) : <span className="text-xs text-slate-400">{ui("No scan")}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {receiving && (
        <ReceiveCashDialog
          row={receiving}
          commercials={commercials}
          treasuryAccounts={treasuryAccounts}
          userId={userId}
          userName={userName}
          onClose={() => setReceiving(null)}
          onDone={done}
        />
      )}
    </div>
  );
}