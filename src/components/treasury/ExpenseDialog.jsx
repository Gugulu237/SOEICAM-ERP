import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { formatXAF } from "@/lib/formatters";
import { recordExpense } from "@/lib/treasury";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";

export default function ExpenseDialog({ accounts, onClose, onDone }) {
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const [expenseAccounts, setExpenseAccounts] = useState([]);
  const [form, setForm] = useState({
    treasury_id: "", expense_id: "", amount: 0, reference: "",
    date: new Date().toISOString().slice(0, 10), description: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    base44.entities.Account.filter({ is_active: true }, "account_number", 500).then((accs) =>
      setExpenseAccounts(accs.filter((a) => ["expense", "other_expense", "cogs"].includes(a.account_type)))
    );
  }, []);

  async function handleSave() {
    const treasuryAccount = accounts.find((a) => a.id === form.treasury_id);
    const expenseAccount = expenseAccounts.find((a) => a.id === form.expense_id);
    if (!treasuryAccount || !expenseAccount || !form.description || Number(form.amount) <= 0) {
      toast({ title: "Missing details", description: "Fill account, expense category, amount and description", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await recordExpense({
        treasuryAccount, expenseAccount, amount: Number(form.amount),
        date: form.date, description: form.description, reference: form.reference, userId: user?.id || "",
      });
      toast({ title: "Expense recorded", description: `${formatXAF(Number(form.amount))} from ${treasuryAccount.name}` });
      onDone();
    } catch (e) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
    finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Record Expense</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Paid From</Label>
            <Select value={form.treasury_id} onValueChange={(v) => setForm((f) => ({ ...f, treasury_id: v }))}>
              <SelectTrigger><SelectValue placeholder="Select treasury account" /></SelectTrigger>
              <SelectContent>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name} ({formatXAF(a.balance)})</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Expense Category</Label>
            <Select value={form.expense_id} onValueChange={(v) => setForm((f) => ({ ...f, expense_id: v }))}>
              <SelectTrigger><SelectValue placeholder="Select expense account" /></SelectTrigger>
              <SelectContent>{expenseAccounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.account_number} — {a.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Amount (XAF)</Label>
              <Input type="number" min="0" value={form.amount || ""} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
            </div>
            <div>
              <Label>Date</Label>
              <Input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
            </div>
          </div>
          <div>
            <Label>Description</Label>
            <Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="e.g. Fuel for delivery truck" />
          </div>
          <div>
            <Label>Receipt Reference</Label>
            <Input value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} placeholder="Receipt / voucher number" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={saving} onClick={handleSave}>Record Expense</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}