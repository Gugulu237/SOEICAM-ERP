
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState, useEffect } from "react";
import { erp } from "@/api/erpClient";
import { useBack, useNavigate } from "@/lib/router";
import PageHeader from "@/components/shared/PageHeader";
import AllocationEditor from "@/components/accounting/AllocationEditor";
import { recordCustomerPayment } from "@/lib/ar-ap";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { formatXAF } from "@/lib/formatters";
import { Save, ArrowLeft } from "lucide-react";

export default function PaymentForm() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const navigate = useNavigate(), goBack = useBack('/accounting/receivables');
  const { user, role } = useCurrentUser();
  const { toast } = useToast();
  const [customers, setCustomers] = useState([]);
  const [treasuryAccounts, setTreasuryAccounts] = useState([]);
  const [requestKey] = useState(() => crypto.randomUUID());
  const [openInvoices, setOpenInvoices] = useState([]);
  const [allocations, setAllocations] = useState({});
  const [form, setForm] = useState({
    party_id: "", amount: 0,
    payment_date: new Date().toISOString().split("T")[0],
    payment_method: "cash", reference: "", treasury_account_id: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      erp.entities.Customer.filter({ is_active: true }, { sort: 'business_name', limit: 100 }),
      erp.entities.TreasuryAccount.filter({ is_active: true }, { sort: 'name', limit: 100 }),
    ]).then(([customerPage, accountPage]) => { setCustomers(customerPage.items); setTreasuryAccounts(accountPage.items); });
  }, []);

  useEffect(() => {
    setAllocations({});
    if (!form.party_id) { setOpenInvoices([]); return; }
    erp.entities.Invoice.filter({ customer_id: form.party_id, balance: { $gt: 0 }, status: { $in: ['posted', 'partially_paid', 'overdue'] } }, { sort: 'due_date', limit: 50 }).then(page => setOpenInvoices(page.items));
  }, [form.party_id]);

  const customer = customers.find((c) => c.id === form.party_id);

  async function handleSave() {
    if (!customer || Number(form.amount) <= 0) {
      toast({ title: ui("Error"), description: ui("Select customer and enter amount"), variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const payment = await recordCustomerPayment({
        customer, amount: Number(form.amount), paymentDate: form.payment_date,
        method: form.payment_method, reference: form.reference,
        allocations, openInvoices, userId: user?.id || "", treasuryAccountId: form.treasury_account_id, requestKey,
      });
      toast({ title: ui("Cashier receipt confirmed"), description: ui("{0} — awaiting GM approval before invoice balances and ledger are updated", payment.payment_number) });
      navigate("/accounting/receivables");
    } catch (e) {
      toast({ title: ui("Error"), description: e.message, variant: "destructive" });
    }
    setSaving(false);
  }

  if (role && role !== 'cashier') return <div className="p-6 text-muted-foreground">{ui("Only the cashier may confirm customer receipts. The GM reviews them in Accounting → Payments.")}</div>;

  return (
    <div>
      <PageHeader title={ui("Confirm Customer Payment Received")} subtitle={ui("Cashier confirms collection; GM approves before ledger posting")}
        actions={<Button variant="outline" onClick={goBack}><ArrowLeft size={16} className="mr-1" />{ui(" Back")}</Button>} />
      <div className="bg-white rounded-xl border border-slate-200 p-6 max-w-2xl space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label>{ui("Customer *")}</Label>
            <Select value={form.party_id} onValueChange={(v) => setForm((f) => ({ ...f, party_id: v }))}>
              <SelectTrigger><SelectValue placeholder={ui("Select customer")} /></SelectTrigger>
              <SelectContent>{customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.business_name} ({formatXAF(c.balance)}{ui(" owed)")}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>{ui("Amount (XAF) *")}</Label>
            <Input type="number" min="0" value={form.amount || ""} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
          </div>
          <div>
            <Label>{ui("Date")}</Label>
            <Input type="date" value={form.payment_date} onChange={(e) => setForm((f) => ({ ...f, payment_date: e.target.value }))} />
          </div>
          <div>
            <Label>{ui("Payment Method")}</Label>
            <Select value={form.payment_method} onValueChange={(v) => setForm((f) => ({ ...f, payment_method: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">{ui("Cash")}</SelectItem>
                <SelectItem value="bank_transfer">{ui("Bank Transfer")}</SelectItem>
                <SelectItem value="mobile_money">{ui("Mobile Money")}</SelectItem>
                <SelectItem value="cheque">{ui("Cheque")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label>{ui("Received Into *")}</Label>
            <Select value={form.treasury_account_id} onValueChange={v => setForm(f => ({ ...f, treasury_account_id: v }))}>
              <SelectTrigger><SelectValue placeholder={ui("Select cash / bank account")} /></SelectTrigger>
              <SelectContent>{treasuryAccounts.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label>{ui("Receipt / Transaction Reference *")}</Label>
            <Input value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} placeholder={ui("Receipt or transaction number")} />
          </div>
        </div>

        {form.party_id && (
          <AllocationEditor
            docs={openInvoices.map((i) => ({ id: i.id, number: i.invoice_number, date: i.invoice_date, due_date: i.due_date, balance: i.balance }))}
            allocations={allocations} onChange={setAllocations} amount={form.amount}
          />
        )}

        <div className="flex gap-3 pt-2">
          <Button onClick={handleSave} disabled={saving}><Save size={16} className="mr-1" /> {saving ? ui("Confirming...") : ui("Confirm Receipt for GM Approval")}</Button>
        </div>
      </div>
    </div>
  );
}