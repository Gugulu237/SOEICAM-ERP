import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { ACCOUNT_TYPES, typeMeta, suggestAccountNumber, validateAccount } from "@/lib/account-hierarchy";
import { Lock } from "lucide-react";

const NO_PARENT = "__none__";

export default function AccountFormDialog({ account, accounts, balances, defaultParentId, onClose, onDone }) {
  const { toast } = useToast();
  const isEdit = !!account;
  const [saving, setSaving] = useState(false);
  const [numberTouched, setNumberTouched] = useState(isEdit);
  const [form, setForm] = useState({
    id: account?.id || "",
    account_number: account?.account_number || suggestAccountNumber(accounts, account?.account_type || "asset", defaultParentId || null),
    name: account?.name || "",
    account_type: account?.account_type || "asset",
    normal_balance: account?.normal_balance || typeMeta("asset").normal,
    parent_id: account?.parent_id || defaultParentId || "",
    is_posting: account ? account.is_posting !== false : true,
    is_control_account: account?.is_control_account || false,
    allow_manual_journal: account ? account.allow_manual_journal !== false : true,
    is_active: account ? account.is_active !== false : true,
    description: account?.description || "",
    is_system: account?.is_system || false,
  });

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const changeType = (value) => {
    setForm((f) => ({
      ...f,
      account_type: value,
      normal_balance: typeMeta(value).normal,
      account_number: !isEdit && !numberTouched ? suggestAccountNumber(accounts, value, f.parent_id || null) : f.account_number,
    }));
  };

  const changeParent = (value) => {
    const parentId = value === NO_PARENT ? "" : value;
    const parent = accounts.find((a) => a.id === parentId);
    setForm((f) => ({
      ...f,
      parent_id: parentId,
      account_type: parent ? parent.account_type : f.account_type,
      normal_balance: parent ? parent.normal_balance : f.normal_balance,
      account_number: !isEdit && !numberTouched ? suggestAccountNumber(accounts, parent ? parent.account_type : f.account_type, parentId || null) : f.account_number,
    }));
  };

  async function handleSave() {
    const errors = validateAccount(form, accounts, balances);
    if (errors.length) {
      toast({ title: "Cannot save account", description: errors[0], variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        account_number: form.account_number.trim(),
        name: form.name.trim(),
        account_type: form.account_type,
        normal_balance: form.normal_balance,
        parent_id: form.parent_id || "",
        is_posting: form.is_posting,
        is_control_account: form.is_control_account,
        allow_manual_journal: form.allow_manual_journal,
        is_active: form.is_active,
        description: form.description,
        financial_statement: typeMeta(form.account_type).statement,
      };
      if (isEdit) await base44.entities.Account.update(account.id, payload);
      else await base44.entities.Account.create(payload);
      toast({ title: isEdit ? "Account updated" : "Account created", description: `${payload.account_number} — ${payload.name}` });
      onDone();
    } catch (e) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const headerAccounts = accounts.filter((a) => a.id !== form.id && a.is_posting === false);
  const locked = form.is_system;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit account ${account.account_number}` : "New account"}</DialogTitle>
        </DialogHeader>

        {locked && (
          <div className="flex items-start gap-2 rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-600">
            <Lock size={14} className="mt-0.5 shrink-0" />
            <span>This is a system account used by other modules. Its number, type and status are locked — you can still rename it and edit its description.</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label>Account Number</Label>
            <Input
              value={form.account_number}
              disabled={locked}
              onChange={(e) => { setNumberTouched(true); set("account_number", e.target.value); }}
            />
          </div>
          <div>
            <Label>Account Name</Label>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
          </div>
          <div>
            <Label>Type</Label>
            <Select value={form.account_type} onValueChange={changeType} disabled={locked}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ACCOUNT_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Normal Balance</Label>
            <Input value={form.normal_balance} disabled readOnly className="capitalize" />
          </div>
          <div className="sm:col-span-2">
            <Label>Parent Account</Label>
            <Select value={form.parent_id || NO_PARENT} onValueChange={changeParent}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PARENT}>No parent — top level account</SelectItem>
                {headerAccounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.account_number} — {a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-slate-500">
              {headerAccounts.length === 0
                ? "No header accounts yet — create one by turning off “Posting account” below."
                : "Accounts only nest under a header account of the same type."}
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <ToggleRow
            label="Posting account"
            hint="Posting accounts receive journal lines. Turn this off for a header that only groups sub-accounts."
            checked={form.is_posting}
            disabled={locked}
            onChange={(v) => set("is_posting", v)}
          />
          <ToggleRow
            label="Control account"
            hint="Balances controlled by a module — inventory, receivables, payables, tax."
            checked={form.is_control_account}
            disabled={locked}
            onChange={(v) => set("is_control_account", v)}
          />
          <ToggleRow
            label="Allow manual journal entry"
            hint="Turn off to keep this account out of manual journals — it can only be posted to by its module."
            checked={form.allow_manual_journal}
            disabled={locked}
            onChange={(v) => set("allow_manual_journal", v)}
          />
          <ToggleRow
            label="Active"
            hint="Inactive accounts stay in the ledger but are hidden from account pickers."
            checked={form.is_active}
            disabled={locked}
            onChange={(v) => set("is_active", v)}
          />
        </div>

        <div>
          <Label>Description</Label>
          <Textarea rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="What this account is used for" />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={saving} onClick={handleSave}>{isEdit ? "Save Changes" : "Create Account"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ToggleRow({ label, hint, checked, disabled, onChange }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 px-3 py-2">
      <div>
        <p className="text-sm font-medium text-slate-700">{label}</p>
        <p className="text-xs text-slate-500">{hint}</p>
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}