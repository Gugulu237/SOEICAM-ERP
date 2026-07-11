import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { Save } from "lucide-react";

const TYPES = [
  { value: "asset", label: "Asset", normal: "debit" },
  { value: "liability", label: "Liability", normal: "credit" },
  { value: "equity", label: "Equity", normal: "credit" },
  { value: "revenue", label: "Revenue", normal: "credit" },
  { value: "cogs", label: "Cost of Goods Sold", normal: "debit" },
  { value: "expense", label: "Expense", normal: "debit" },
  { value: "other_income", label: "Other Income", normal: "credit" },
  { value: "other_expense", label: "Other Expense", normal: "debit" },
];

export default function AccountFormDialog({ open, onOpenChange, account, onSaved }) {
  const { toast } = useToast();
  const isEdit = !!account;
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    account_number: "", name: "", description: "", account_type: "asset",
    subtype: "", parent_id: "", normal_balance: "debit", is_posting: true,
    is_active: true, is_control_account: false, reconciliation_required: false,
    financial_statement: "", cash_flow_category: "", balance: 0
  });

  useEffect(() => {
    if (account) {
      setForm({
        account_number: account.account_number || "", name: account.name || "",
        description: account.description || "", account_type: account.account_type || "asset",
        subtype: account.subtype || "", parent_id: account.parent_id || "",
        normal_balance: account.normal_balance || "debit", is_posting: account.is_posting !== false,
        is_active: account.is_active !== false, is_control_account: account.is_control_account || false,
        reconciliation_required: account.reconciliation_required || false,
        financial_statement: account.financial_statement || "", cash_flow_category: account.cash_flow_category || "",
        balance: account.balance || 0
      });
    } else {
      setForm({ account_number: "", name: "", description: "", account_type: "asset", subtype: "", parent_id: "", normal_balance: "debit", is_posting: true, is_active: true, is_control_account: false, reconciliation_required: false, financial_statement: "", cash_flow_category: "", balance: 0 });
    }
  }, [account, open]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const onTypeChange = (v) => {
    const t = TYPES.find(x => x.value === v);
    setForm(f => ({ ...f, account_type: v, normal_balance: t ? t.normal : f.normal_balance }));
  };

  async function handleSave() {
    if (!form.account_number || !form.name) {
      toast({ title: "Account number and name are required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      if (isEdit) await base44.entities.Account.update(account.id, form);
      else await base44.entities.Account.create(form);
      toast({ title: isEdit ? "Account updated" : "Account created" });
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
    setSaving(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{isEdit ? "Edit Account" : "New Account"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Account Number *</Label><Input value={form.account_number} onChange={e => set("account_number", e.target.value)} placeholder="e.g. 1120" /></div>
          <div><Label>Account Name *</Label><Input value={form.name} onChange={e => set("name", e.target.value)} placeholder="e.g. Petty Cash" /></div>
          <div className="col-span-2"><Label>Description</Label><Textarea value={form.description} onChange={e => set("description", e.target.value)} rows={2} /></div>
          <div>
            <Label>Account Type</Label>
            <Select value={form.account_type} onValueChange={onTypeChange}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Subtype</Label><Input value={form.subtype} onChange={e => set("subtype", e.target.value)} placeholder="e.g. current_asset, bank" /></div>
          <div>
            <Label>Normal Balance</Label>
            <Select value={form.normal_balance} onValueChange={v => set("normal_balance", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="debit">Debit</SelectItem><SelectItem value="credit">Credit</SelectItem></SelectContent>
            </Select>
          </div>
          <div>
            <Label>Financial Statement</Label>
            <Select value={form.financial_statement} onValueChange={v => set("financial_statement", v)}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="balance_sheet">Balance Sheet</SelectItem>
                <SelectItem value="income_statement">Income Statement</SelectItem>
                <SelectItem value="cash_flow">Cash Flow</SelectItem>
                <SelectItem value="equity_statement">Equity Statement</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Cash Flow Category</Label>
            <Select value={form.cash_flow_category} onValueChange={v => set("cash_flow_category", v)}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="operating">Operating</SelectItem>
                <SelectItem value="investing">Investing</SelectItem>
                <SelectItem value="financing">Financing</SelectItem>
                <SelectItem value="none">None</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-3 pt-6"><Switch checked={form.is_posting} onCheckedChange={v => set("is_posting", v)} /><Label>Posting Account</Label></div>
          <div className="flex items-center gap-3 pt-6"><Switch checked={form.is_control_account} onCheckedChange={v => set("is_control_account", v)} /><Label>Control Account</Label></div>
          <div className="flex items-center gap-3 pt-6"><Switch checked={form.reconciliation_required} onCheckedChange={v => set("reconciliation_required", v)} /><Label>Reconciliation Required</Label></div>
          <div className="flex items-center gap-3 pt-6"><Switch checked={form.is_active} onCheckedChange={v => set("is_active", v)} /><Label>Active</Label></div>
        </div>
        <Button className="mt-4" onClick={handleSave} disabled={saving}><Save size={16} className="mr-1" /> {saving ? "Saving..." : "Save Account"}</Button>
      </DialogContent>
    </Dialog>
  );
}