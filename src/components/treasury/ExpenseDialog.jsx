
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import { businessDate } from '@/lib/business-date';
import {Link} from '@/lib/router';
import {usePhoneLayout} from '@/hooks/usePhoneLayout';
import {ArrowLeft,CalendarClock,ChevronRight} from 'lucide-react';
import React, { useState, useEffect } from "react";
import { erp } from "@/api/erpClient";
import { formatXAF, statusLabel } from "@/lib/formatters";
import { PETTY_CASH_LIMIT } from "@/lib/petty-cash";
import { isSmallOperatingAccount, SMALL_OPERATING_CATEGORIES, smallOperatingExpenseIssue } from "@/lib/small-operating-expenses";
import { recordExpense } from "@/lib/treasury";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";

export default function ExpenseDialog({ accounts, onClose, onDone }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const phone=usePhoneLayout();
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const [expenseAccounts, setExpenseAccounts] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [form, setForm] = useState({
    treasury_id: "", expense_id: "", amount: 0, reference: "",
    date: businessDate(), description: "",
    category: "other", payee: "", department_id: "",
  });
  const [saving, setSaving] = useState(false);
  const [requestKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    erp.entities.Account.filter({ is_active: true }, "account_number", 500).then((accs) =>
      setExpenseAccounts(accs.filter(isSmallOperatingAccount))
    );
    erp.entities.Department.filter({ is_active: true }).then(setDepartments);
  }, []);

  const selectedExpenseAccount = expenseAccounts.find((a) => a.id === form.expense_id);
  const issue = smallOperatingExpenseIssue({ category: form.category, expenseAccount: selectedExpenseAccount, description: form.description, payee: form.payee });
  const overLimit = Number(form.amount) > PETTY_CASH_LIMIT;

  async function handleSave() {
    const treasuryAccount = accounts.find((a) => a.id === form.treasury_id);
    const expenseAccount = selectedExpenseAccount;
    if (!treasuryAccount || !expenseAccount || !form.description || Number(form.amount) <= 0) {
      toast({ title: ui("Missing details"), description: ui("Fill account, expense category, amount and description"), variant: "destructive" });
      return;
    }
    if (overLimit || issue) {
      toast({ title: ui("Use the appropriate expense workflow"), description: overLimit ? ui("Small expenses cannot exceed {0}. Raise an expense request.", formatXAF(PETTY_CASH_LIMIT)) : issue, variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const department = departments.find((d) => d.id === form.department_id);
      await recordExpense({
        requestKey, treasuryAccount, expenseAccount, amount: Number(form.amount),
        date: form.date, description: form.description, reference: form.reference, userId: user?.id || "",
        category: form.category, payee: form.payee,
        department_id: department?.id || "", department_name: department?.name || "",
      });
      toast({ title: ui("Expense recorded"), description: ui("{0} from {1}", formatXAF(Number(form.amount)), treasuryAccount.name) });
      onDone();
    } catch (e) { toast({ title: ui("Error"), description: e.message, variant: "destructive" }); }
    finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-sleek-new-expense>
        {phone?<DialogHeader className="flex-row items-center gap-3 space-y-0 text-left"><Button variant="outline" size="icon" className="h-12 w-12 shrink-0 rounded-xl" aria-label={ui('Back')} onClick={onClose}><ArrowLeft size={20}/></Button><div><DialogTitle className="text-xl">{ui('New expense')}</DialogTitle><p className="mt-1 text-xs text-muted-foreground">{ui('Recorded once')}</p></div></DialogHeader>:<DialogHeader><DialogTitle>{ui('Small Operating Expense')}</DialogTitle></DialogHeader>}
        {phone?<div className="space-y-4">
          <label className="block space-y-1 text-xs font-semibold text-muted-foreground">{ui('Expense Category')}<select aria-label={ui('Select expense account')} className="min-h-12 w-full rounded-xl border bg-white px-3 text-sm font-normal text-foreground" value={form.expense_id} onChange={e=>setForm(f=>({...f,expense_id:e.target.value}))}><option value="">{ui('Select expense account')}</option>{expenseAccounts.map(a=><option key={a.id} value={a.id}>{a.account_number} · {a.name}</option>)}</select></label>
          <div className="grid grid-cols-2 gap-3"><label className="space-y-1 text-xs font-semibold text-muted-foreground">{ui('Amount (XAF)')}<Input aria-label={ui('Amount (XAF)')} type="number" min="0" inputMode="decimal" value={form.amount||''} onChange={e=>setForm(f=>({...f,amount:e.target.value}))}/></label><label className="min-w-0 space-y-1 text-xs font-semibold text-muted-foreground">{ui('Date')}<Input aria-label={ui('Date')} type="date" value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))}/></label></div>
          <label className="block space-y-1 text-xs font-semibold text-muted-foreground">{ui('Payee / Vendor')}<Input aria-label={ui('Payee / Vendor')} value={form.payee} onChange={e=>setForm(f=>({...f,payee:e.target.value}))}/></label>
          <label className="block space-y-1 text-xs font-semibold text-muted-foreground">{ui('Receipt Reference')}<Input aria-label={ui('Receipt Reference')} value={form.reference} onChange={e=>setForm(f=>({...f,reference:e.target.value}))}/></label>
          <label className="block space-y-1 text-xs font-semibold text-muted-foreground">{ui('Description')}<Input aria-label={ui('Description')} value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))}/></label>
          <section><h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-primary">{ui('Payment status')}</h2><div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-50 p-1"><span className="flex min-h-11 items-center justify-center rounded-lg border bg-white text-sm font-semibold">{ui('Paid')}</span><Link to="/expenses?new=request" className="flex min-h-11 items-center justify-center rounded-lg px-2 text-center text-sm font-semibold text-muted-foreground">{ui('Expense request')}</Link></div><label className="mt-3 block space-y-1 rounded-xl border bg-white p-3 text-xs font-semibold text-muted-foreground">{ui('Paid From Petty Cash')}<select aria-label={ui('Select treasury account')} className="min-h-12 w-full rounded-xl border bg-white px-3 text-sm font-normal text-foreground" value={form.treasury_id} onChange={e=>setForm(f=>({...f,treasury_id:e.target.value}))}><option value="">{ui('Select treasury account')}</option>{accounts.filter(a=>a.account_type==='petty_cash').map(a=><option key={a.id} value={a.id}>{a.name} · {formatXAF(a.balance)}</option>)}</select></label></section>
          <details className="rounded-xl border bg-white p-3"><summary className="min-h-8 cursor-pointer text-xs font-semibold">{ui('Expense Type')} · {ui('Cost Centre *')}</summary><div className="mt-3 space-y-3"><label className="block text-xs">{ui('Expense Type')}<select className="mt-1 min-h-11 w-full rounded-lg border px-2" value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value}))}>{SMALL_OPERATING_CATEGORIES.map(c=><option key={c} value={c}>{statusLabel(c)}</option>)}</select></label><label className="block text-xs">{ui('Cost Centre *')}<select className="mt-1 min-h-11 w-full rounded-lg border px-2" value={form.department_id} onChange={e=>setForm(f=>({...f,department_id:e.target.value}))}><option value="">{ui('No department')}</option>{departments.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label></div></details>
          <Link to="/accounting/recurring-expenses" className="flex min-h-14 items-center gap-3 rounded-xl border bg-white p-3 text-sm font-semibold"><CalendarClock size={20} className="text-primary"/><span className="flex-1">{ui('Recurring expenses')}</span><ChevronRight size={18}/></Link><p className="text-xs text-muted-foreground">{ui('Recorded once from petty cash. For planned or unpaid charges, use the expense request or recurring charge workflow.')}</p>
          {(overLimit||issue)&&<p role="alert" className="rounded-lg border bg-slate-50 p-3 text-xs">{overLimit?ui('Above the {0} petty cash limit. Use New Expense Request in Expenses & Budgets.',formatXAF(PETTY_CASH_LIMIT)):issue}</p>}
        </div>:<div className="space-y-4">
          <section className="rounded-xl border bg-white p-3 sm:hidden"><p className="text-xs font-semibold text-primary">{ui('Paid expense')}</p><p className="mt-1 text-xs text-muted-foreground">{ui('Recorded once from petty cash. For planned or unpaid charges, use the expense request or recurring charge workflow.')}</p><div className="mt-3 flex flex-wrap gap-2"><Link to="/expenses?new=request" className="min-h-11 rounded-lg border px-3 py-3 text-xs font-semibold">{ui('Expense request')}</Link><Link to="/accounting/recurring-expenses" className="min-h-11 rounded-lg border px-3 py-3 text-xs font-semibold">{ui('Recurring expenses')}</Link></div></section>
          <div>
            <p className="mb-3 text-xs text-slate-500">{ui("For quick, routine purchases such as fuel, local transport and office supplies, up to ")}{formatXAF(PETTY_CASH_LIMIT)}{ui(". Salaries go through Payroll; rent and other planned costs need an approved Expense Request.")}</p><Label>{ui("Paid From Petty Cash")}</Label>
            <Select value={form.treasury_id} onValueChange={(v) => setForm((f) => ({ ...f, treasury_id: v }))}>
              <SelectTrigger><SelectValue placeholder={ui("Select treasury account")} /></SelectTrigger>
              <SelectContent>{accounts.filter(a => a.account_type === 'petty_cash').map((a) => <SelectItem key={a.id} value={a.id}>{a.name} ({formatXAF(a.balance)})</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>{ui("Expense Category")}</Label>
            <Select value={form.expense_id} onValueChange={(v) => setForm((f) => ({ ...f, expense_id: v }))}>
              <SelectTrigger><SelectValue placeholder={ui("Select expense account")} /></SelectTrigger>
              <SelectContent>{expenseAccounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.account_number} — {a.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>{ui("Expense Type")}</Label>
              <Select value={form.category} onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{SMALL_OPERATING_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{statusLabel(c)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>{ui("Payee / Vendor")}</Label>
              <Input value={form.payee} onChange={(e) => setForm((f) => ({ ...f, payee: e.target.value }))} placeholder={ui("Who was paid")} />
            </div>
          </div>
          <div>
            <Label>{ui("Cost Centre *")}</Label>
            <Select value={form.department_id || "none"} onValueChange={(v) => setForm((f) => ({ ...f, department_id: v === "none" ? "" : v }))}>
              <SelectTrigger><SelectValue placeholder={ui("No department")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{ui("No department")}</SelectItem>
                {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>{ui("Amount (XAF)")}</Label>
              <Input type="number" min="0" value={form.amount || ""} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
            </div>
            <div>
              <Label>{ui("Date")}</Label>
              <Input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
            </div>
          </div>
          <div>
            <Label>{ui("Description")}</Label>
            <Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder={ui("e.g. Fuel for delivery truck")} />
          </div>
          <div>
            <Label>{ui("Receipt Reference")}</Label>
            <Input value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} placeholder={ui("Receipt / voucher number")} />
          </div>
          {(overLimit || issue) && <p role="alert" className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-900">{overLimit ? ui("Above the {0} petty cash limit. Use New Expense Request in Expenses & Budgets.", formatXAF(PETTY_CASH_LIMIT)) : issue}</p>}
        </div>}
        <DialogFooter data-mobile-action-bar>
          <Button variant="outline" onClick={onClose}>{ui("Cancel")}</Button>
          <Button disabled={saving || overLimit || !!issue} onClick={handleSave}>{ui("Record Expense")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
