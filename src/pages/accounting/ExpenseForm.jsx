import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate } from "react-router-dom";
import { formatXAF } from "@/lib/formatters";
import PageHeader from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { Save, ArrowLeft } from "lucide-react";

const CATEGORIES = ["salaries", "bonuses", "rent", "electricity", "water", "generator_fuel", "vehicle_fuel", "repairs", "maintenance", "marketing", "advertising", "internet", "telephone", "security", "cleaning", "office_supplies", "professional_fees", "bank_charges", "mobile_money_fees", "travel", "transport", "taxes", "licences", "insurance", "miscellaneous"];
const METHODS = [
  { value: "cash", label: "Cash" },
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "mobile_money", label: "Mobile Money" },
  { value: "cheque", label: "Cheque" },
  { value: "credit", label: "On Credit (Supplier Payable)" },
];
const CLASSIFICATIONS = [
  { value: "operating_expense", label: "Operating Expense" },
  { value: "operating_repair", label: "Operating Repair" },
  { value: "preventive_maintenance", label: "Preventive Maintenance" },
  { value: "major_repair", label: "Major Repair" },
  { value: "capital_improvement", label: "Capital Improvement" },
  { value: "new_fixed_asset", label: "New Fixed Asset" },
];

export default function ExpenseForm() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [accounts, setAccounts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [form, setForm] = useState({
    expense_date: new Date().toISOString().split("T")[0], beneficiary: "", supplier_id: "",
    category: "miscellaneous", description: "", amount: 0, payment_method: "cash",
    paid_from_account_id: "", expense_account_id: "", department_id: "",
    classification: "operating_expense", notes: ""
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      base44.entities.Account.filter({ is_active: true }),
      base44.entities.Supplier.filter({ is_active: true }),
      base44.entities.Department.filter({}),
    ]).then(([a, s, d]) => { setAccounts(a); setSuppliers(s); setDepartments(d); });
  }, []);

  const treasuryAccounts = accounts.filter(a => a.is_treasury && a.is_posting !== false);
  const isCapex = ["capital_improvement", "new_fixed_asset"].includes(form.classification);
  const debitAccounts = isCapex
    ? accounts.filter(a => a.account_type === "asset" && (a.account_number || "").startsWith("2") && a.is_posting !== false && !(a.account_number || "").startsWith("219"))
    : accounts.filter(a => a.account_type === "expense" && a.is_posting !== false);

  async function handleSave() {
    if (!form.amount || form.amount <= 0) { toast({ title: "Error", description: "Enter a valid amount", variant: "destructive" }); return; }
    if (!form.expense_account_id) { toast({ title: "Error", description: "Select the debit account", variant: "destructive" }); return; }
    if (form.payment_method !== "credit" && !form.paid_from_account_id) { toast({ title: "Error", description: "Select the paid-from account", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const settings = (await base44.entities.CompanySettings.filter({}))[0];
      const num = settings?.next_journal_number || 1;
      const expense = await base44.entities.Expense.create({
        expense_number: `EXP-${String(num).padStart(5, "0")}`,
        ...form, amount: Number(form.amount),
        status: "posted"
      });

      const creditAccountKey = form.payment_method === "credit" ? "accounts_payable" : null;
      const lines = [
        { account_id: form.expense_account_id, debit: Number(form.amount), credit: 0, description: form.description || form.category, department_id: form.department_id, party_type: form.supplier_id ? "supplier" : "", party_id: form.supplier_id || "" }
      ];
      if (creditAccountKey) {
        lines.push({ account_key: creditAccountKey, debit: 0, credit: Number(form.amount), description: `Credit - ${form.beneficiary || "supplier"}`, party_type: "supplier", party_id: form.supplier_id || "" });
      } else {
        lines.push({ account_id: form.paid_from_account_id, debit: 0, credit: Number(form.amount), description: `Paid via ${form.payment_method}` });
      }

      const res = await base44.functions.invoke("postJournal", {
        source_module: "expenses",
        source_document_type: "Expense",
        source_document_id: expense.id,
        idempotency_key: `expenses:Expense:${expense.id}`,
        entry_date: form.expense_date,
        description: `Expense ${expense.expense_number} — ${form.category} — ${form.beneficiary || ""}`,
        reference: expense.expense_number,
        lines
      });
      await base44.entities.Expense.update(expense.id, { journal_id: res.data.journal_id });
      toast({ title: "Expense posted", description: `${expense.expense_number} — ${formatXAF(form.amount)}` });
      navigate("/accounting/journals/" + res.data.journal_id);
    } catch (e) {
      toast({ title: "Failed", description: e.response?.data?.error || e.message, variant: "destructive" });
    }
    setSaving(false);
  }

  return (
    <div>
      <PageHeader title="Record Expense" subtitle={isCapex ? "Capital expenditure — debits a fixed-asset account" : "Operating expense — debits an expense account"}
        actions={<Button variant="outline" onClick={() => navigate("/accounting")}><ArrowLeft size={16} className="mr-1" /> Back</Button>} />

      <div className="bg-white rounded-xl border border-slate-200 p-6 max-w-2xl">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div><Label>Date *</Label><Input type="date" value={form.expense_date} onChange={e => setForm(f => ({ ...f, expense_date: e.target.value }))} /></div>
          <div><Label>Category</Label>
            <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Beneficiary</Label><Input value={form.beneficiary} onChange={e => setForm(f => ({ ...f, beneficiary: e.target.value }))} /></div>
          <div><Label>Supplier (optional)</Label>
            <Select value={form.supplier_id} onValueChange={v => setForm(f => ({ ...f, supplier_id: v }))}>
              <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger><SelectContent>{suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2"><Label>Description</Label><Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} /></div>
          <div><Label>Amount (XAF) *</Label><Input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: Number(e.target.value) }))} /></div>
          <div><Label>Classification</Label>
            <Select value={form.classification} onValueChange={v => setForm(f => ({ ...f, classification: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{CLASSIFICATIONS.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>{isCapex ? "Fixed Asset Account (Debit) *" : "Expense Account (Debit) *"}</Label>
            <Select value={form.expense_account_id} onValueChange={v => setForm(f => ({ ...f, expense_account_id: v }))}>
              <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
              <SelectContent>
                {[...debitAccounts].sort((a, b) => (a.account_number || "").localeCompare(b.account_number || ""))
                  .map(a => <SelectItem key={a.id} value={a.id}>{a.account_number} — {a.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label>Payment Method</Label>
            <Select value={form.payment_method} onValueChange={v => setForm(f => ({ ...f, payment_method: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{METHODS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {form.payment_method !== "credit" && (
            <div><Label>Paid From Account *</Label>
              <Select value={form.paid_from_account_id} onValueChange={v => setForm(f => ({ ...f, paid_from_account_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Cash / Bank" /></SelectTrigger>
                <SelectContent>{treasuryAccounts.map(a => <SelectItem key={a.id} value={a.id}>{a.account_number} — {a.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          <div><Label>Department</Label>
            <Select value={form.department_id} onValueChange={v => setForm(f => ({ ...f, department_id: v }))}>
              <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger><SelectContent>{departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <div className="mt-6 flex gap-3">
          <Button onClick={handleSave} disabled={saving}><Save size={16} className="mr-1" /> {saving ? "Posting..." : "Post Expense"}</Button>
        </div>
      </div>
    </div>
  );
}