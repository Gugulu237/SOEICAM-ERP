import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { PETTY_CASH_LIMIT, recordPettyCashExpense } from "@/lib/petty-cash";
import { EXPENSE_CATEGORIES } from "@/lib/expenses";
import { formatXAF, statusLabel } from "@/lib/formatters";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import ReceiptField from "./ReceiptField";
import { AlertTriangle, Banknote } from "lucide-react";

// A petty cash voucher: a small expense paid on the spot out of the float.
export default function PettyCashExpenseDialog({ accounts, userId, userName, onClose, onDone }) {
  const { toast } = useToast();
  const [expenseAccounts, setExpenseAccounts] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [form, setForm] = useState({
    treasury_id: accounts[0]?.id || "", expense_id: "", department_id: "", payee: "",
    category: "other", amount: "", date: new Date().toISOString().slice(0, 10), description: "", receipt: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    base44.entities.Account.filter({ is_active: true }, "account_number", 500).then((accs) =>
      setExpenseAccounts(accs.filter(a => ["expense", "other_expense"].includes(a.account_type))));
    base44.entities.Department.filter({ is_active: true }).then(setDepartments);
  }, []);

  const amount = Number(form.amount) || 0;
  const overLimit = amount > PETTY_CASH_LIMIT;

  async function handleSave() {
    const account = accounts.find(a => a.id === form.treasury_id);
    const expenseAccount = expenseAccounts.find(a => a.id === form.expense_id);
    const department = departments.find(d => d.id === form.department_id);
    if (!account || !expenseAccount || !form.description || amount <= 0 || !department) {
      toast({ title: "Missing details", description: "Fill the float, expense account, cost centre, amount and description", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await recordPettyCashExpense({
        account, expenseAccount, amount, date: form.date, description: form.description,
        payee: form.payee, category: form.category, department,
        receiptFileUri: form.receipt, userId, userName,
      });
      toast({ title: "Voucher posted", description: `${formatXAF(amount)} paid from ${account.name} — ledger and float updated` });
      onDone();
    } catch (e) {
      toast({ title: "Not recorded", description: e.message, variant: "destructive" });
    }
    setSaving(false);
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Record Petty Cash Expense</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Paid From *</Label>
              <Select value={form.treasury_id} onValueChange={v => setForm(f => ({ ...f, treasury_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select float" /></SelectTrigger>
                <SelectContent>{accounts.map(a => (
                  <SelectItem key={a.id} value={a.id}>{a.name} ({formatXAF(a.balance)})</SelectItem>
                ))}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Expense Account *</Label>
              <Select value={form.expense_id} onValueChange={v => setForm(f => ({ ...f, expense_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                <SelectContent>{expenseAccounts.map(a => (
                  <SelectItem key={a.id} value={a.id}>{a.account_number} — {a.name}</SelectItem>
                ))}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Expense Type</Label>
              <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{EXPENSE_CATEGORIES.map(c => <SelectItem key={c} value={c}>{statusLabel(c)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Payee / Vendor</Label>
              <Input value={form.payee} onChange={e => setForm(f => ({ ...f, payee: e.target.value }))} placeholder="Who was paid" />
            </div>
            <div>
              <Label>Cost Centre *</Label>
              <Select value={form.department_id} onValueChange={v => setForm(f => ({ ...f, department_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select cost centre" /></SelectTrigger>
                <SelectContent>{departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Amount (XAF) *</Label>
              <Input type="number" min="0" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
            </div>
            <div>
              <Label>Date</Label>
              <Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
            </div>
          </div>

          <div>
            <Label>Description *</Label>
            <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="e.g. Motorcycle fuel for field deliveries" />
          </div>

          <ReceiptField fileUri={form.receipt} onChange={uri => setForm(f => ({ ...f, receipt: uri }))} label="Receipt (can be filed later)" />

          {overLimit && (
            <div className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>
                Above the {formatXAF(PETTY_CASH_LIMIT)} petty cash limit. Raise an expense request so the General Manager can approve it first.
              </span>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={saving || overLimit} onClick={handleSave}>
            <Banknote size={16} className="mr-1" /> {saving ? "Posting…" : "Pay & Post"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}