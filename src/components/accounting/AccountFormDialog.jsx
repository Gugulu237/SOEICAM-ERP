
/* localized-interface */
import { ui, uiMessage } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState, useRef } from "react";
import { erp } from "@/api/erpClient";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { ACCOUNT_TYPES, typeMeta, suggestAccountNumber, validateAccount, eligibleAccountParents } from "@/lib/account-hierarchy";
import { Lock } from "lucide-react";

const NO_PARENT = "__none__";

export default function AccountFormDialog({ account, accounts, balances, defaultParentId, onClose, onDone }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const { toast } = useToast();
  const isEdit = !!account;
  const savingRef = useRef(false);
  const requestKey = useRef(crypto.randomUUID());
  const defaultParent = accounts.find(a => a.id === defaultParentId);
  const initialType = account?.account_type || defaultParent?.account_type || "asset";
  const [newParent, setNewParent] = useState(null);
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [numberTouched, setNumberTouched] = useState(isEdit);
  const [form, setForm] = useState({
    id: account?.id || "",
    account_number: account?.account_number || suggestAccountNumber(accounts, initialType, defaultParentId || null),
    name: account?.name || "",
    account_type: initialType,
    normal_balance: account?.normal_balance || typeMeta(initialType).normal,
    parent_id: account?.parent_id || defaultParentId || "",
    is_posting: account ? account.is_posting !== false : true,
    is_control_account: account?.is_control_account || false,
    allow_manual_journal: account ? account.allow_manual_journal !== false : true,
    is_active: account ? account.is_active !== false : true,
    description: account?.description || "",
    is_system: account?.is_system || false,
    cash_flow_category: account?.cash_flow_category || 'none',
    is_treasury: account?.is_treasury || false,
  });

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const changeType = (value) => {
    setNewParent(null);
    setForm((f) => ({
      ...f,
      account_type: value,
      parent_id: "",
      normal_balance: typeMeta(value).normal,
      account_number: !isEdit && !numberTouched ? suggestAccountNumber(accounts, value, null) : f.account_number,
    }));
  };

  const changeParent = (value) => {
    setNewParent(null);
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
    if (savingRef.current) return;
    setSaveError("");
    const errors = validateAccount(form, accounts, balances);
    if (errors.length) {
      toast({ title: ui("Cannot save account"), description: uiMessage(errors[0]), variant: "destructive" });
      return;
    }
    savingRef.current = true;
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
        cash_flow_category: form.cash_flow_category,
        is_treasury: form.is_treasury,
      };
      await erp.accounting.saveAccount({requestKey:requestKey.current, accountId: account?.id || null, updatedDate: account?.updated_date, account: payload, newParent});
      toast({ title: isEdit ? ui("Account updated") : ui("Account created"), description: `${payload.account_number} — ${payload.name}` });
      onDone();
    } catch (e) {
      setSaveError(e.message);
      toast({ title: ui("Error"), description: e.message, variant: "destructive" });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const parentAccounts = eligibleAccountParents(accounts, form);
  const locked = form.is_system;

  return (
    <Dialog open onOpenChange={(o) => !o && !savingRef.current && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? ui("Edit account {0}", account.account_number) : ui("New account")}</DialogTitle>
        </DialogHeader>

        {locked && (
          <div className="flex items-start gap-2 rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-600">
            <Lock size={14} className="mt-0.5 shrink-0" />
            <span>{ui("This is a system account used by other modules. Its number, type and status are locked — you can still rename it and edit its description.")}</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label>{ui("Account Number")}</Label>
            <Input
              value={form.account_number}
              disabled={locked}
              onChange={(e) => { setNumberTouched(true); set("account_number", e.target.value); }}
            />
          </div>
          <div>
            <Label>{ui("Account Name")}</Label>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
          </div>
          <div>
            <Label>{ui("Type")}</Label>
            <Select value={form.account_type} onValueChange={changeType} disabled={locked}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ACCOUNT_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {['equity','liability'].includes(form.account_type) && <p className="mt-1 text-xs text-slate-500">{ui("Use Equity for ownership capital. Repayable investor loans belong in Liabilities.")}</p>}
          </div>
          <div>
            <Label>{ui("Normal Balance")}</Label>
            <Input value={form.normal_balance} disabled readOnly className="capitalize" />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="account-parent">{ui("Parent Account")}</Label>
            <Select disabled={locked || !!newParent} value={form.parent_id || NO_PARENT} onValueChange={changeParent}>
              <SelectTrigger id="account-parent" aria-label={ui("Parent Account")}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PARENT}>{ui("No parent — top level account")}</SelectItem>
                {parentAccounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.account_number} — {a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-slate-500">
              {parentAccounts.length === 0
                ? ui("No active parent accounts of this type. Create a parent account below.")
                : ui("Select any active account of the same type. Posting parents keep their own transactions and include sub-account balances.")}
            </p>
            {!locked && <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => { set("parent_id", ""); setNewParent(newParent ? null : {account_number: suggestAccountNumber([...accounts, {account_number:form.account_number}], form.account_type), name: ""}); }}>{newParent ? ui("Use an existing parent") : ui("Create a parent account")}</Button>}
            {newParent && <div className="mt-3 grid gap-3 rounded-lg border bg-slate-50 p-3 sm:grid-cols-2">
              <div><Label htmlFor="parent-number">{ui("Parent account number")}</Label><Input id="parent-number" value={newParent.account_number} onChange={e => setNewParent({...newParent, account_number:e.target.value})}/></div>
              <div><Label htmlFor="parent-name">{ui("Parent account name")}</Label><Input id="parent-name" value={newParent.name} onChange={e => setNewParent({...newParent, name:e.target.value})}/></div>
              <p className="text-xs text-slate-500 sm:col-span-2">{ui("The parent is a grouping header. Both accounts will be saved together.")}</p>
            </div>}
          </div>
        </div>

        <div className="space-y-2">
          <div className="rounded-lg border border-slate-200 p-3">
            <Label>{ui("Cash-flow activity")}</Label>
            <Select value={form.cash_flow_category} onValueChange={v => set('cash_flow_category', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{ui("Automatic classification")}</SelectItem>
                <SelectItem value="operating">{ui("Operating — sales, suppliers and running costs")}</SelectItem>
                <SelectItem value="investing">{ui("Investing — fixed assets and investments")}</SelectItem>
                <SelectItem value="financing">{ui("Financing — loans, capital and distributions")}</SelectItem>
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-slate-500">{ui("Used when this account is the counterpart of a cash receipt or payment. Changes apply when reports are rerun. Use separate payable accounts for operating suppliers and fixed asset purchases.")}</p>
          </div>
          {form.account_type === 'asset' && form.normal_balance === 'debit' && form.is_posting && <ToggleRow label={ui("Cash account in cash-flow reports")} hint="For cash, bank or mobile money GL accounts. Treasury-linked accounts and commercial cash in transit (1050) are included automatically." checked={form.is_treasury} onChange={v => set('is_treasury', v)} />}
          <ToggleRow
            label={ui("Posting account")}
            hint="Posting accounts receive journal lines. Turn this off for a header that only groups sub-accounts."
            checked={form.is_posting}
            disabled={locked}
            onChange={(v) => set("is_posting", v)}
          />
          <ToggleRow
            label={ui("Control account")}
            hint="Balances controlled by a module — inventory, receivables, payables, tax."
            checked={form.is_control_account}
            disabled={locked}
            onChange={(v) => set("is_control_account", v)}
          />
          <ToggleRow
            label={ui("Allow manual journal entry")}
            hint="Turn off to keep this account out of manual journals — it can only be posted to by its module."
            checked={form.allow_manual_journal}
            disabled={locked}
            onChange={(v) => set("allow_manual_journal", v)}
          />
          <ToggleRow
            label={ui("Active")}
            hint="Inactive accounts stay in the ledger but are hidden from account pickers."
            checked={form.is_active}
            disabled={locked}
            onChange={(v) => set("is_active", v)}
          />
        </div>

        <div>
          <Label>{ui("Description")}</Label>
          <Textarea rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} placeholder={ui("What this account is used for")} />
        </div>

        {saveError && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">{uiMessage(saveError)}</p>}
        <DialogFooter>
          <Button disabled={saving} variant="outline" onClick={onClose}>{ui("Cancel")}</Button>
          <Button disabled={saving} onClick={handleSave}>{isEdit ? ui("Save Changes") : ui("Create Account")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ToggleRow({ label, hint, checked, disabled, onChange }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 px-3 py-2">
      <div>
        <p className="text-sm font-medium text-slate-700">{label}</p>
        <p className="text-xs text-slate-500">{ui(hint)}</p>
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}
