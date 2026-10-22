
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState } from "react";
import { approveCashDisbursement, rejectCashDisbursement, releaseCashDisbursement } from "@/lib/purchase-payments";
import { formatXAF, formatDate } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { Banknote, ShieldCheck, XCircle } from "lucide-react";

export default function DisbursementRequests({ requests, ready, treasuryAccounts, isApprover, canDisburse, userId, onDone }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const { toast } = useToast();
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  if (!requests.length && !ready.length) return null;

  const run = async (fn, title) => {
    setBusy(true);
    try {
      await fn();
      toast({ title });
      onDone();
    } catch (e) {
      toast({ title: ui("Not completed"), description: e.message, variant: "destructive" });
    }
    setBusy(false);
  };

  const release = (payment) => run(
    () => releaseCashDisbursement({
      payment,
      treasuryAccount: treasuryAccounts.find(a => a.id === payment.treasury_account_id),
      userId,
    }),
    ui("Cash released"),
  );

  const head = (
    <tr className="bg-slate-50 border-b border-slate-200">
      <th className="px-4 py-3 text-left font-semibold text-slate-600">{ui("Payment #")}</th>
      <th className="px-4 py-3 text-left font-semibold text-slate-600">{ui("Supplier")}</th>
      <th className="px-4 py-3 text-right font-semibold text-slate-600">{ui("Amount")}</th>
      <th className="px-4 py-3 text-left font-semibold text-slate-600">{ui("Date")}</th>
      <th className="px-4 py-3 text-right font-semibold text-slate-600">{ui("Action")}</th>
    </tr>
  );

  const row = (payment, action) => (
    <tr key={payment.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
      <td className="px-4 py-3 font-medium">{payment.payment_number}</td>
      <td className="px-4 py-3">
        {payment.party_name}
        <div className="text-xs text-slate-400">{ui("from ")}{payment.treasury_account_name || "—"}</div>
      </td>
      <td className="px-4 py-3 text-right font-medium">{formatXAF(payment.amount)}</td>
      <td className="px-4 py-3">{formatDate(payment.payment_date)}</td>
      <td className="px-4 py-3 text-right">{action}</td>
    </tr>
  );

  return (
    <div className="mb-8 space-y-6">
      {requests.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
            <ShieldCheck size={15} className="text-amber-600" />{ui(" Cash Requests Awaiting Approval")}</h3>
          <div className="bg-amber-50 rounded-lg border border-amber-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>{head}</thead>
              <tbody>
                {requests.map(p => row(p, isApprover ? (
                  <div className="flex justify-end gap-1">
                    <Button size="sm" disabled={busy} onClick={() => run(() => approveCashDisbursement({ payment: p, userId }), "Approved — the cashier can release the cash")}>
                      <ShieldCheck size={14} className="mr-1" />{ui(" Approve")}</Button>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => { setRejecting(p); setReason(""); }}>
                      <XCircle size={14} className="mr-1" />{ui(" Refuse")}</Button>
                  </div>
                ) : <span className="text-xs text-slate-400">{ui("Awaiting General Manager")}</span>))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {ready.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
            <Banknote size={15} className="text-green-600" />{ui(" Approved — Ready to Release")}</h3>
          <div className="bg-white rounded-lg border border-green-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>{head}</thead>
              <tbody>
                {ready.map(p => row(p, canDisburse ? (
                  <Button size="sm" disabled={busy} onClick={() => release(p)}>
                    <Banknote size={14} className="mr-1" />{ui(" Release cash")}</Button>
                ) : <span className="text-xs text-slate-400">{ui("View only")}</span>))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Dialog open={!!rejecting} onOpenChange={open => !open && setRejecting(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{ui("Refuse ")}{rejecting?.payment_number}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="text-sm text-slate-600">
              {formatXAF(rejecting?.amount || 0)}{ui(" to ")}{rejecting?.party_name}{ui(" will not be released.")}</div>
            <div>
              <Label>{ui("Reason")}</Label>
              <Input value={reason} onChange={e => setReason(e.target.value)} placeholder={ui("Why the cash is not released")} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(null)}>{ui("Cancel")}</Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => run(() => rejectCashDisbursement({ payment: rejecting, reason, userId }), "Request refused").then(() => setRejecting(null))}
            >{ui("Refuse release")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}