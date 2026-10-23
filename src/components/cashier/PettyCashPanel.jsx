
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useEffect, useState } from "react";
import { erp } from "@/api/erpClient";
import { isPettyCash, floatHealth } from "@/lib/petty-cash";
import { formatXAF, formatDate } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import PayExpenseDialog from "@/components/expenses/PayExpenseDialog";
import TransferDialog from "@/components/treasury/TransferDialog";
import PettyCashExpenseDialog from "./PettyCashExpenseDialog";
import ReceiptCollectDialog from "./ReceiptCollectDialog";
import { AlertTriangle, Banknote, Paperclip, Plus, RefreshCw, Wallet } from "lucide-react";

// The petty cash desk: the float, the small expenses paid from it, the staff
// reimbursements it settles and the receipts still to be collected.
export default function PettyCashPanel({ accounts, canManage, userId, userName, user, onDone }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [vouchers, setVouchers] = useState([]);
  const [reimbursements, setReimbursements] = useState([]);
  const [recordOpen, setRecordOpen] = useState(false);
  const [replenish, setReplenish] = useState(false);
  const [collecting, setCollecting] = useState(null);
  const [paying, setPaying] = useState(null);

  const floats = accounts.filter(isPettyCash);

  async function load() {
    const [v, r] = await Promise.all([
      erp.entities.ExpenseRequest.filter({ petty_cash: true }, { sort: "-created_date", limit: 50 }),
      erp.entities.ExpenseRequest.filter({ status: "approved" }, { sort: "-request_date", limit: 50 }),
    ]);
    setVouchers(v.items);
    setReimbursements(r.items);
  }

  useEffect(() => { if (floats.length) load(); }, [floats.length]);

  const refresh = () => { load(); onDone(); };
  const missingReceipts = vouchers.filter(v => !v.receipt_url);

  if (!floats.length) return null;

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <Wallet size={15} className="text-slate-600" />{ui(" Petty Cash")}</h3>
        {canManage && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setReplenish(true)}>
              <RefreshCw size={14} className="mr-1" />{ui(" Replenish float")}</Button>
            <Button size="sm" onClick={() => setRecordOpen(true)}>
              <Plus size={14} className="mr-1" />{ui(" Record expense")}</Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        {floats.map(f => {
          const health = floatHealth(f);
          return (
            <div key={f.id} className="bg-white rounded-lg border border-slate-200 px-4 py-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700">{f.name}</span>
                {health.low && (
                  <span className="flex items-center gap-1 text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-full px-2 py-0.5">
                    <AlertTriangle size={11} />{ui(" Low float")}</span>
                )}
              </div>
              <div className="text-lg font-semibold tabular-nums mt-1">{formatXAF(health.balance)}</div>
              <div className="text-xs text-slate-400">
                {health.limit > 0 ? ui("Float {0}", formatXAF(health.limit)) : ui("No float limit set")}
                {f.custodian ? ` · ${f.custodian}` : ""}
              </div>
            </div>
          );
        })}
        <div className="bg-white rounded-lg border border-slate-200 px-4 py-3">
          <span className="text-sm font-medium text-slate-700">{ui("Receipts to collect")}</span>
          <div className="text-lg font-semibold tabular-nums mt-1">{missingReceipts.length}</div>
          <div className="text-xs text-slate-400">{ui("Vouchers paid without a receipt on file")}</div>
        </div>
      </div>

      {reimbursements.length > 0 && (
        <div className="mb-6">
          <h4 className="text-sm font-semibold text-slate-700 mb-2">{ui("Reimbursements to Staff")}</h4>
          <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-4 py-3 text-left font-semibold text-slate-600">{ui("Ref #")}</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-600">{ui("Expense")}</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-600">{ui("Staff member")}</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">{ui("Amount")}</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">{ui("Action")}</th>
                </tr>
              </thead>
              <tbody>
                {reimbursements.map(r => (
                  <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium">{r.request_number}</td>
                    <td className="px-4 py-3">{r.title}</td>
                    <td className="px-4 py-3">{r.requester_name || "—"}</td>
                    <td className="px-4 py-3 text-right font-medium">{formatXAF(r.amount)}</td>
                    <td className="px-4 py-3 text-right">
                      {canManage ? (
                        <Button size="sm" onClick={() => setPaying(r)}>
                          <Banknote size={14} className="mr-1" />{ui(" Reimburse")}</Button>
                      ) : <span className="text-xs text-slate-400">{ui("View only")}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <h4 className="text-sm font-semibold text-slate-700 mb-2">{ui("Recent Petty Cash Vouchers")}</h4>
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-4 py-3 text-left font-semibold text-slate-600">{ui("Voucher #")}</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">{ui("Date")}</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">{ui("Description")}</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">{ui("Payee")}</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">{ui("Cost Centre")}</th>
              <th className="px-4 py-3 text-right font-semibold text-slate-600">{ui("Amount")}</th>
              <th className="px-4 py-3 text-right font-semibold text-slate-600">{ui("Receipt")}</th>
            </tr>
          </thead>
          <tbody>
            {vouchers.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">{ui("No petty cash expenses recorded yet")}</td></tr>
            ) : vouchers.map(v => (
              <tr key={v.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <td className="px-4 py-3 font-medium">{v.request_number}</td>
                <td className="px-4 py-3">{formatDate(v.request_date)}</td>
                <td className="px-4 py-3">{v.title}</td>
                <td className="px-4 py-3">{v.payee || "—"}</td>
                <td className="px-4 py-3">{v.department_name || "—"}</td>
                <td className="px-4 py-3 text-right font-medium">{formatXAF(v.amount)}</td>
                <td className="px-4 py-3 text-right">
                  {v.receipt_url ? (
                    <span className="text-xs text-green-700">{ui("On file")}</span>
                  ) : canManage ? (
                    <Button size="sm" variant="outline" onClick={() => setCollecting(v)}>
                      <Paperclip size={14} className="mr-1" />{ui(" File receipt")}</Button>
                  ) : <span className="text-xs text-slate-600">{ui("Missing")}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {recordOpen && (
        <PettyCashExpenseDialog
          accounts={floats}
          userId={userId}
          userName={userName}
          onClose={() => setRecordOpen(false)}
          onDone={() => { setRecordOpen(false); refresh(); }}
        />
      )}

      {replenish && (
        <TransferDialog
          accounts={accounts}
          defaultToId={floats[0]?.id}
          onClose={() => setReplenish(false)}
          onDone={() => { setReplenish(false); refresh(); }}
        />
      )}

      {collecting && (
        <ReceiptCollectDialog
          request={collecting}
          userId={userId}
          onClose={() => setCollecting(null)}
          onDone={() => { setCollecting(null); refresh(); }}
        />
      )}

      {paying && (
        <PayExpenseDialog
          request={paying}
          user={user}
          defaultTreasuryId={floats[0]?.id}
          onOpenChange={o => !o && setPaying(null)}
          onPaid={() => { setPaying(null); refresh(); }}
        />
      )}
    </div>
  );
}