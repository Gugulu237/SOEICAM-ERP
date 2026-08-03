import React, { useState } from "react";
import { formatXAF, formatDate } from "@/lib/formatters";
import { depositCashSale } from "@/lib/cash-sales";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { Landmark } from "lucide-react";

export default function CashCollections({ invoices, treasuryAccounts, canDisburse, userId, onDone }) {
  const { toast } = useToast();
  const [invoice, setInvoice] = useState(null);
  const [form, setForm] = useState({ treasury_account_id: "", amount: 0, date: "", reference: "" });
  const [saving, setSaving] = useState(false);

  function open(inv) {
    setInvoice(inv);
    setForm({
      treasury_account_id: treasuryAccounts[0]?.id || "",
      amount: inv.balance || 0,
      date: new Date().toISOString().split("T")[0],
      reference: "",
    });
  }

  async function handleDeposit() {
    setSaving(true);
    try {
      const account = treasuryAccounts.find(a => a.id === form.treasury_account_id);
      await depositCashSale({
        invoice, treasuryAccount: account, amount: Number(form.amount),
        date: form.date, reference: form.reference, userId,
      });
      toast({ title: "Deposited", description: `${formatXAF(form.amount)} banked into ${account.name}` });
      setInvoice(null);
      onDone();
    } catch (e) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
    setSaving(false);
  }

  return (
    <div className="mb-8">
      <h3 className="text-sm font-semibold text-slate-700 mb-3">Cash Sales to Deposit (Cash Clearing)</h3>
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-4 py-3 text-left font-semibold text-slate-600">Invoice #</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">Customer</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">Date</th>
              <th className="px-4 py-3 text-right font-semibold text-slate-600">To Collect</th>
              <th className="px-4 py-3 text-right font-semibold text-slate-600">Action</th>
            </tr>
          </thead>
          <tbody>
            {invoices.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-12 text-center text-slate-400">No cash sales awaiting deposit</td></tr>
            ) : invoices.map(inv => (
              <tr key={inv.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <td className="px-4 py-3 font-medium">{inv.invoice_number}</td>
                <td className="px-4 py-3">{inv.customer_name}</td>
                <td className="px-4 py-3">{formatDate(inv.invoice_date)}</td>
                <td className="px-4 py-3 text-right font-medium">{formatXAF(inv.balance)}</td>
                <td className="px-4 py-3 text-right">
                  {canDisburse
                    ? <Button size="sm" onClick={() => open(inv)}><Landmark size={14} className="mr-1" /> Deposit</Button>
                    : <span className="text-xs text-slate-400">View only</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={!!invoice} onOpenChange={o => !o && setInvoice(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Deposit Cash Collection</DialogTitle></DialogHeader>
          {invoice && (
            <div className="space-y-4">
              <div className="bg-slate-50 rounded-lg p-3 text-sm">
                <div className="flex justify-between mb-1"><span className="text-slate-500">Invoice:</span><span className="font-medium">{invoice.invoice_number}</span></div>
                <div className="flex justify-between mb-1"><span className="text-slate-500">Customer:</span><span className="font-medium">{invoice.customer_name}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Outstanding:</span><span className="font-bold">{formatXAF(invoice.balance)}</span></div>
              </div>
              <div>
                <Label>Deposit Into *</Label>
                <Select value={form.treasury_account_id} onValueChange={v => setForm(f => ({ ...f, treasury_account_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select cash / bank account" /></SelectTrigger>
                  <SelectContent>
                    {treasuryAccounts.map(a => <SelectItem key={a.id} value={a.id}>{a.name} ({formatXAF(a.balance)})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Amount (XAF) *</Label>
                  <Input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
                </div>
                <div>
                  <Label>Deposit Date</Label>
                  <Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
                </div>
              </div>
              <div>
                <Label>Reference</Label>
                <Input value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} placeholder="Slip / transaction number" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setInvoice(null)}>Cancel</Button>
            <Button onClick={handleDeposit} disabled={saving || !form.treasury_account_id || !form.amount}>
              <Landmark size={16} className="mr-1" /> {saving ? "Processing..." : "Confirm Deposit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}