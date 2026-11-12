
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState } from "react";
import { receiveCashFromCommercial } from "@/lib/cash-receipts";
import { formatXAF, formatDate } from "@/lib/formatters";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import ReceiptField from "./ReceiptField";
import { HandCoins } from "lucide-react";

// Reconcile cash from older deliveries against the recorded invoice.
export default function ReceiveCashDialog({ row, commercials = [], treasuryAccounts, userId, userName, onClose, onDone }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const { toast } = useToast();
  const { invoice, order } = row;
  const [form, setForm] = useState({
    treasury_account_id: treasuryAccounts[0]?.id || "",
    amount: invoice.balance || 0,
    date: new Date().toISOString().slice(0, 10),
    received_from: order?.salesperson_name || (commercials.length === 1 ? commercials[0].name : ""),
    notes: "",
    receipt: "",
  });
  const [saving, setSaving] = useState(false);
  const [requestKey] = useState(() => crypto.randomUUID());

  async function handleReceive() {
    const account = treasuryAccounts.find(a => a.id === form.treasury_account_id);
    const amount = Number(form.amount);
    if (!account || !Number.isFinite(amount) || amount <= 0) {
      toast({ title: ui("Missing details"), description: account ? ui("Enter a positive received amount") : ui("Select the treasury account used for this payment."), variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const collection = await receiveCashFromCommercial({
        invoice, order, treasuryAccount: account,
        amount, date: form.date,
        receiptFileUris: form.receipt ? [form.receipt] : [],
        collectedBy: form.received_from, notes: form.notes,
        userId, userName, requestKey,
      });
      toast({
        title: ui("Cash received — {0}", collection.acknowledgement_reference),
        description: [ui(collection.status==='posted'?'Payment posted directly to treasury':'Payment ready to post'), collection.treasury_account_name].filter(Boolean).join(' · '),
      });
      onDone();
    } catch (e) {
      toast({ title: ui("Not received"), description: e.message, variant: "destructive" });
    }
    setSaving(false);
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{ui("Receive Cash from Commercial")}</DialogTitle></DialogHeader>

        <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm space-y-1">
          <div className="flex justify-between"><span className="text-slate-500">{ui("Invoice")}</span><span className="font-medium">{invoice.invoice_number}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">{ui("Customer")}</span><span className="font-medium">{invoice.customer_name}</span></div>
          {order?.order_number && (
            <div className="flex justify-between"><span className="text-slate-500">{ui("Delivery")}</span><span>{order.order_number} · {formatDate(order.delivery_date || order.order_date)}</span></div>
          )}
          {order?.salesperson_name && (
            <div className="flex justify-between"><span className="text-slate-500">{ui("Commercial")}</span><span className="font-medium">{order.salesperson_name}</span></div>
          )}
          {(order?.driver_name || order?.vehicle_name) && (
            <div className="flex justify-between">
              <span className="text-slate-500">{ui("Delivered by")}</span>
              <span>{[order?.driver_name, order?.vehicle_name].filter(Boolean).join(" · ")}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-slate-200 pt-1 mt-1">
            <span className="text-slate-500">{ui("Cash to collect")}</span>
            <span className="font-bold">{formatXAF(invoice.balance)}</span>
          </div>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>{ui("Cash Received (XAF) *")}</Label>
              <Input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
            </div>
            <div>
              <Label>{ui("Date Received")}</Label>
              <Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
            </div>
            <div>
              <Label>{ui("Received Into *")}</Label>
              <Select value={form.treasury_account_id} onValueChange={v => setForm(f => ({ ...f, treasury_account_id: v }))}>
                <SelectTrigger><SelectValue placeholder={ui("Select cash / bank account")} /></SelectTrigger>
                <SelectContent>
                  {treasuryAccounts.map(a => <SelectItem key={a.id} value={a.id}>{a.name} ({formatXAF(a.balance)})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{ui("Received From")}</Label>
              <Select value={form.received_from} onValueChange={v => setForm(f => ({ ...f, received_from: v }))}>
                <SelectTrigger><SelectValue placeholder={ui("Select commercial")} /></SelectTrigger>
                <SelectContent>
                  {commercials.map(c => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {commercials.length === 0 && (
                <p className="text-xs text-slate-400 mt-1">{ui("No commercials with outstanding deliveries")}</p>
              )}
            </div>
          </div>

          <ReceiptField
            fileUri={form.receipt}
            onChange={uri => setForm(f => ({ ...f, receipt: uri }))}
            label={ui("Photograph of the receipt")}
          />

          <div>
            <Label>{ui("Notes")}</Label>
            <Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder={ui("Optional")} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{ui("Cancel")}</Button>
          <Button disabled={saving} onClick={handleReceive}>
            <HandCoins size={16} className="mr-1" /> {saving ? ui("Confirming…") : ui("Record payment")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
