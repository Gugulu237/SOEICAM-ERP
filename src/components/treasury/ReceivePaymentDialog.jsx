import React, { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { formatXAF, formatDate } from "@/lib/formatters";
import { receiveInvoicePayment } from "@/lib/treasury";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { Search, Landmark, Receipt } from "lucide-react";

// Treasury receipt: pick an open invoice, pick the account the money lands in.
export default function ReceivePaymentDialog({ accounts, onClose, onDone }) {
  const { user, role } = useCurrentUser();
  const { toast } = useToast();
  const [invoices, setInvoices] = useState([]);
  const [search, setSearch] = useState("");
  const [invoice, setInvoice] = useState(null);
  const [saving, setSaving] = useState(false);
  const [requestKey] = useState(() => crypto.randomUUID());
  const [form, setForm] = useState({
    treasury_account_id: accounts[0]?.id || "",
    amount: 0,
    date: new Date().toISOString().split("T")[0],
    reference: "",
  });

  const loadInvoices = useCallback(async (term) => {
    const query = { balance: { $gt: 0 }, status: { $in: ["posted", "partially_paid", "overdue"] } };
    if (term) query.$or = [
      { invoice_number: { $regex: term, $options: "i" } },
      { customer_name: { $regex: term, $options: "i" } },
    ];
    const page = await base44.entities.Invoice.filter(query, { sort: "-invoice_date", limit: 50 });
    setInvoices(page.items);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => loadInvoices(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search, loadInvoices]);

  function pick(inv) {
    setInvoice(inv);
    setForm(f => ({ ...f, amount: inv.balance || 0 }));
  }

  async function handleReceive() {
    setSaving(true);
    try {
      const account = accounts.find(a => a.id === form.treasury_account_id);
      await receiveInvoicePayment({
        invoice, treasuryAccount: account, amount: Number(form.amount),
        date: form.date, reference: form.reference, userId: user?.id || "", requestKey,
      });
      toast({ title: "Cashier receipt confirmed", description: `${formatXAF(form.amount)} for ${invoice.invoice_number}; awaiting GM approval before posting.` });
      onDone();
    } catch (e) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
    setSaving(false);
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Receive Payment for an Invoice</DialogTitle></DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Open Invoices</Label>
            <div className="relative mt-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <Input placeholder="Search invoice # or customer…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
            </div>
            <div className="mt-2 max-h-56 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
              {invoices.length === 0 && <p className="px-3 py-6 text-center text-sm text-slate-400">No open invoices found</p>}
              {invoices.map(inv => (
                <button
                  key={inv.id}
                  onClick={() => pick(inv)}
                  className={`w-full flex items-center gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50 ${invoice?.id === inv.id ? "bg-amber-50" : ""}`}
                >
                  <Receipt size={14} className="text-slate-400 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-900 truncate">{inv.invoice_number} · {inv.customer_name}</p>
                    <p className="text-xs text-slate-500">
                      {formatDate(inv.invoice_date)} · {inv.payment_type === "cash" ? "Cash sale" : "Credit"}
                    </p>
                  </div>
                  <span className="font-semibold text-slate-900 flex-shrink-0">{formatXAF(inv.balance)}</span>
                </button>
              ))}
            </div>
          </div>

          {invoice && (
            <>
              <div className="bg-slate-50 rounded-lg p-3 text-sm">
                <div className="flex justify-between mb-1"><span className="text-slate-500">Invoice:</span><span className="font-medium">{invoice.invoice_number}</span></div>
                <div className="flex justify-between mb-1"><span className="text-slate-500">Customer:</span><span className="font-medium">{invoice.customer_name}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Outstanding:</span><span className="font-bold">{formatXAF(invoice.balance)}</span></div>
              </div>

              <div>
                <Label>Deposit Into *</Label>
                <Select value={form.treasury_account_id} onValueChange={v => setForm(f => ({ ...f, treasury_account_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select cash / bank / mobile money account" /></SelectTrigger>
                  <SelectContent>
                    {accounts.map(a => <SelectItem key={a.id} value={a.id}>{a.name} ({formatXAF(a.balance)})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Amount (XAF) *</Label>
                  <Input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
                </div>
                <div>
                  <Label>Payment Date</Label>
                  <Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
                </div>
              </div>

              <div>
                <Label>Reference</Label>
                <Input value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} placeholder="Slip / transaction number" />
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleReceive} disabled={role !== 'cashier' || saving || !invoice || !form.treasury_account_id || !Number(form.amount)}>
            <Landmark size={16} className="mr-1" /> {saving ? "Confirming..." : "Confirm Receipt for GM"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}