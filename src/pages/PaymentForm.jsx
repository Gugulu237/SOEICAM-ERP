import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate } from "react-router-dom";
import PageHeader from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { formatXAF } from "@/lib/formatters";
import { Save, ArrowLeft } from "lucide-react";

export default function PaymentForm() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [customers, setCustomers] = useState([]);
  const [form, setForm] = useState({
    payment_type: "customer_payment", party_id: "", amount: 0,
    payment_date: new Date().toISOString().split("T")[0],
    payment_method: "cash", reference: "", notes: ""
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => { base44.entities.Customer.filter({}).then(setCustomers); }, []);

  async function handleSave() {
    if (!form.party_id || form.amount <= 0) {
      toast({ title: "Error", description: "Select customer and enter amount", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const cust = customers.find(c => c.id === form.party_id);
      const payment = await base44.entities.Payment.create({
        ...form, party_name: cust?.business_name || "",
        payment_number: `PMT-${Date.now().toString(36).toUpperCase()}`,
        status: "posted"
      });

      // Update customer balance
      if (cust) {
        await base44.entities.Customer.update(cust.id, {
          balance: Math.max(0, (cust.balance || 0) - form.amount)
        });
      }

      // Create accounting journal: Debit Cash/Bank, Credit Receivable
      const accounts = await base44.entities.Account.filter({});
      const cashAccount = accounts.find(a => a.account_number === "1100");
      const arAccount = accounts.find(a => a.account_number === "1200");
      if (cashAccount && arAccount) {
        const settings = (await base44.entities.CompanySettings.filter({}))[0];
        const jNum = settings?.next_journal_number || 1;
        const journal = await base44.entities.JournalEntry.create({
          journal_number: `JE-${String(jNum).padStart(5, "0")}`,
          entry_date: form.payment_date,
          description: `Customer payment from ${cust?.business_name || ""}`,
          source_module: "payments", source_document_type: "Payment",
          source_document_id: payment.id, status: "posted",
          total_debit: form.amount, total_credit: form.amount,
          is_immutable: true, posted_at: new Date().toISOString()
        });
        if (settings) await base44.entities.CompanySettings.update(settings.id, { next_journal_number: jNum + 1 });

        await base44.entities.JournalLine.create({
          journal_id: journal.id, account_id: cashAccount.id,
          account_number: "1100", account_name: cashAccount.name,
          debit: form.amount, credit: 0, description: `Payment received - ${form.payment_method}`
        });
        await base44.entities.JournalLine.create({
          journal_id: journal.id, account_id: arAccount.id,
          account_number: "1200", account_name: arAccount.name,
          debit: 0, credit: form.amount, description: `Receivable cleared - ${cust?.business_name}`,
          party_type: "customer", party_id: form.party_id
        });
      }

      // Auto-allocate to oldest invoices
      const openInvoices = (await base44.entities.Invoice.filter({ customer_id: form.party_id }))
        .filter(i => i.balance > 0 && i.status !== "cancelled")
        .sort((a, b) => (a.invoice_date || "").localeCompare(b.invoice_date || ""));
      let remaining = form.amount;
      for (const inv of openInvoices) {
        if (remaining <= 0) break;
        const allocate = Math.min(remaining, inv.balance);
        const newPaid = (inv.amount_paid || 0) + allocate;
        const newBal = inv.total - newPaid;
        await base44.entities.Invoice.update(inv.id, {
          amount_paid: newPaid, balance: newBal,
          status: newBal <= 0 ? "paid" : "partially_paid"
        });
        remaining -= allocate;
      }

      await base44.entities.AuditLog.create({
        action: "receive_payment", module: "payments", entity_type: "Payment", entity_id: payment.id,
        description: `Payment ${formatXAF(form.amount)} from ${cust?.business_name}`
      });

      toast({ title: "Payment recorded", description: "Customer balance and invoices updated" });
      navigate("/accounting");
    } catch (e) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
    setSaving(false);
  }

  return (
    <div>
      <PageHeader title="Record Customer Payment" actions={<Button variant="outline" onClick={() => navigate("/accounting")}><ArrowLeft size={16} className="mr-1" /> Back</Button>} />
      <div className="bg-white rounded-xl border border-slate-200 p-6 max-w-lg">
        <div className="space-y-4">
          <div>
            <Label>Customer *</Label>
            <Select value={form.party_id} onValueChange={v => setForm(f => ({ ...f, party_id: v }))}>
              <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
              <SelectContent>{customers.map(c => <SelectItem key={c.id} value={c.id}>{c.business_name} ({formatXAF(c.balance)} owed)</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Amount (XAF) *</Label>
            <Input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: Number(e.target.value) }))} />
          </div>
          <div>
            <Label>Date</Label>
            <Input type="date" value={form.payment_date} onChange={e => setForm(f => ({ ...f, payment_date: e.target.value }))} />
          </div>
          <div>
            <Label>Payment Method</Label>
            <Select value={form.payment_method} onValueChange={v => setForm(f => ({ ...f, payment_method: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                <SelectItem value="mobile_money">Mobile Money</SelectItem>
                <SelectItem value="cheque">Cheque</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Reference</Label>
            <Input value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} placeholder="Receipt or transaction number" />
          </div>
        </div>
        <div className="mt-6 flex gap-3">
          <Button onClick={handleSave} disabled={saving}><Save size={16} className="mr-1" /> {saving ? "Processing..." : "Record Payment"}</Button>
        </div>
      </div>
    </div>
  );
}