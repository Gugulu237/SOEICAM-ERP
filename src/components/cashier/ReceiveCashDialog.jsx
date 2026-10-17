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

// Receiving the cash a commercial collected on delivery, against the physical
// receipt they carry. Confirming posts the money to the ledger.
export default function ReceiveCashDialog({ row, commercials = [], treasuryAccounts, userId, userName, onClose, onDone }) {
  const { toast } = useToast();
  const { invoice, order } = row;
  const [form, setForm] = useState({
    treasury_account_id: treasuryAccounts[0]?.id || "",
    amount: invoice.balance || 0,
    date: new Date().toISOString().slice(0, 10),
    receipt_reference: "",
    received_from: order?.salesperson_name || (commercials.length === 1 ? commercials[0].name : ""),
    notes: "",
    receipt: "",
  });
  const [saving, setSaving] = useState(false);

  async function handleReceive() {
    const account = treasuryAccounts.find(a => a.id === form.treasury_account_id);
    if (!account || Number(form.amount) <= 0 || !form.receipt_reference.trim()) {
      toast({ title: "Missing details", description: "Enter the cash received, the account and the receipt number", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const collection = await receiveCashFromCommercial({
        invoice, order, treasuryAccount: account,
        amount: Number(form.amount), date: form.date,
        receiptReference: form.receipt_reference.trim(),
        receiptFileUris: form.receipt ? [form.receipt] : [],
        collectedBy: form.received_from, notes: form.notes,
        userId, userName,
      });
      toast({
        title: `Cash received — ${collection.acknowledgement_reference}`,
        description: `${formatXAF(Number(form.amount))} into ${account.name}, posted to the ledger against receipt ${form.receipt_reference}`,
      });
      onDone();
    } catch (e) {
      toast({ title: "Not received", description: e.message, variant: "destructive" });
    }
    setSaving(false);
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Receive Cash from Commercial</DialogTitle></DialogHeader>

        <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm space-y-1">
          <div className="flex justify-between"><span className="text-slate-500">Invoice</span><span className="font-medium">{invoice.invoice_number}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Customer</span><span className="font-medium">{invoice.customer_name}</span></div>
          {order?.order_number && (
            <div className="flex justify-between"><span className="text-slate-500">Delivery</span><span>{order.order_number} · {formatDate(order.delivery_date || order.order_date)}</span></div>
          )}
          {order?.salesperson_name && (
            <div className="flex justify-between"><span className="text-slate-500">Commercial</span><span className="font-medium">{order.salesperson_name}</span></div>
          )}
          {(order?.driver_name || order?.vehicle_name) && (
            <div className="flex justify-between">
              <span className="text-slate-500">Delivered by</span>
              <span>{[order?.driver_name, order?.vehicle_name].filter(Boolean).join(" · ")}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-slate-200 pt-1 mt-1">
            <span className="text-slate-500">Cash to collect</span>
            <span className="font-bold">{formatXAF(invoice.balance)}</span>
          </div>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Cash Received (XAF) *</Label>
              <Input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
            </div>
            <div>
              <Label>Date Received</Label>
              <Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
            </div>
            <div>
              <Label>Received Into *</Label>
              <Select value={form.treasury_account_id} onValueChange={v => setForm(f => ({ ...f, treasury_account_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select cash / bank account" /></SelectTrigger>
                <SelectContent>
                  {treasuryAccounts.map(a => <SelectItem key={a.id} value={a.id}>{a.name} ({formatXAF(a.balance)})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Received From</Label>
              <Select value={form.received_from} onValueChange={v => setForm(f => ({ ...f, received_from: v }))}>
                <SelectTrigger><SelectValue placeholder="Select commercial" /></SelectTrigger>
                <SelectContent>
                  {commercials.map(c => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {commercials.length === 0 && (
                <p className="text-xs text-slate-400 mt-1">No commercials with outstanding deliveries</p>
              )}
            </div>
          </div>

          <div>
            <Label>Physical Receipt No. *</Label>
            <Input
              value={form.receipt_reference}
              onChange={e => setForm(f => ({ ...f, receipt_reference: e.target.value }))}
              placeholder="Number on the receipt the commercial handed over"
            />
          </div>

          <ReceiptField
            fileUri={form.receipt}
            onChange={uri => setForm(f => ({ ...f, receipt: uri }))}
            label="Photograph of the receipt"
          />

          <div>
            <Label>Notes</Label>
            <Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={saving} onClick={handleReceive}>
            <HandCoins size={16} className="mr-1" /> {saving ? "Posting…" : "Receive & Post to Ledger"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}