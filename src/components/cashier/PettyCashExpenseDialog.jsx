
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import { businessDate } from '@/lib/business-date';
import React, { useEffect, useState } from "react";
import { erp } from "@/api/erpClient";
import { PETTY_CASH_LIMIT, recordPettyCashExpense } from "@/lib/petty-cash";
import { isSmallOperatingAccount, SMALL_OPERATING_CATEGORIES, smallOperatingExpenseIssue } from "@/lib/small-operating-expenses";
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
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const { toast } = useToast();
  const [expenseAccounts, setExpenseAccounts] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [form, setForm] = useState({
    treasury_id: accounts[0]?.id || "", expense_id: "", department_id: "", payee: "",
    category: "other", amount: "", date: businessDate(), description: "", receipt: "",
  });
  const [saving, setSaving] = useState(false);
  const [requestKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    erp.entities.Account.filter({ is_active: true }, "account_number", 500).then((accs) =>
      setExpenseAccounts(accs.filter(isSmallOperatingAccount)));
    erp.entities.Department.filter({ is_active: true }).then(setDepartments);
  }, []);

  const amount = Number(form.amount) || 0;
  const overLimit = amount > PETTY_CASH_LIMIT;
  const selectedExpenseAccount = expenseAccounts.find(a => a.id === form.expense_id);
  const issue = smallOperatingExpenseIssue({ category: form.category, expenseAccount: selectedExpenseAccount, description: form.description, payee: form.payee });

  async function handleSave() {
    const account = accounts.find(a => a.id === form.treasury_id);
    const expenseAccount = expenseAccounts.find(a => a.id === form.expense_id);
    const department = departments.find(d => d.id === form.department_id);
    if (!account || !expenseAccount || !form.description || amount <= 0 || !department) {
      toast({ title: ui("Missing details"), description: ui("Fill the float, expense account, cost centre, amount and description"), variant: "destructive" });
      return;
    }
    if (overLimit || issue) {
      toast({ title: ui("Use the appropriate expense workflow"), description: overLimit ? ui("Raise an expense request above {0}.", formatXAF(PETTY_CASH_LIMIT)) : issue, variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await recordPettyCashExpense({
        requestKey, account, expenseAccount, amount, date: form.date, description: form.description,
        payee: form.payee, category: form.category, department,
        receiptFileUri: form.receipt, userId, userName,
      });
      toast({ title: ui("Voucher posted"), description: ui("{0} paid from {1} — ledger and float updated", formatXAF(amount), account.name) });
      onDone();
    } catch (e) {
      toast({ title: ui("Not recorded"), description: e.message, variant: "destructive" });
    }
    setSaving(false);
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{ui("Record Petty Cash Expense")}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <p className="text-xs text-slate-600">{ui("Quick routine purchases only, up to ")}{formatXAF(PETTY_CASH_LIMIT)}{ui(". Use Payroll for salaries and an approved Expense Request for rent and other planned costs.")}</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>{ui("Paid From *")}</Label>
              <Select value={form.treasury_id} onValueChange={v => setForm(f => ({ ...f, treasury_id: v }))}>
                <SelectTrigger><SelectValue placeholder={ui("Select float")} /></SelectTrigger>
                <SelectContent>{accounts.map(a => (
                  <SelectItem key={a.id} value={a.id}>{a.name} ({formatXAF(a.balance)})</SelectItem>
                ))}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>{ui("Expense Account *")}</Label>
              <Select value={form.expense_id} onValueChange={v => setForm(f => ({ ...f, expense_id: v }))}>
                <SelectTrigger><SelectValue placeholder={ui("Select account")} /></SelectTrigger>
                <SelectContent>{expenseAccounts.map(a => (
                  <SelectItem key={a.id} value={a.id}>{a.account_number} — {a.name}</SelectItem>
                ))}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>{ui("Expense Type")}</Label>
              <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{SMALL_OPERATING_CATEGORIES.map(c => <SelectItem key={c} value={c}>{statusLabel(c)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>{ui("Payee / Vendor")}</Label>
              <Input value={form.payee} onChange={e => setForm(f => ({ ...f, payee: e.target.value }))} placeholder={ui("Who was paid")} />
            </div>
            <div>
              <Label>{ui("Cost Centre *")}</Label>
              <Select value={form.department_id} onValueChange={v => setForm(f => ({ ...f, department_id: v }))}>
                <SelectTrigger><SelectValue placeholder={ui("Select cost centre")} /></SelectTrigger>
                <SelectContent>{departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>{ui("Amount (XAF) *")}</Label>
              <Input type="number" min="0" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
            </div>
            <div>
              <Label>{ui("Date")}</Label>
              <Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
            </div>
          </div>

          <div>
            <Label>{ui("Description *")}</Label>
            <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder={ui("e.g. Motorcycle fuel for field deliveries")} />
          </div>

          <ReceiptField fileUri={form.receipt} onChange={uri => setForm(f => ({ ...f, receipt: uri }))} label={ui("Receipt (can be filed later)")} />

          {overLimit && (
            <div className="flex gap-2 rounded-lg border border-slate-300 bg-slate-50 p-3 text-sm text-slate-800">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>{ui("Above the ")}{formatXAF(PETTY_CASH_LIMIT)}{ui(" petty cash limit. Raise an expense request so the General Manager can approve it first.")}</span>
            </div>
          )}
          {issue && <p role="alert" className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-900">{issue}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{ui("Cancel")}</Button>
          <Button disabled={saving || overLimit || !!issue} onClick={handleSave}>
            <Banknote size={16} className="mr-1" /> {saving ? ui("Posting…") : ui("Pay & Post")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
