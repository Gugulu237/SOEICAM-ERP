import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";

const TYPES = ["asset", "liability", "equity", "revenue", "cogs", "expense", "other_income", "other_expense"];

export default function AccountDialog({ account, onClose, onDone }) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    account_number: account.account_number || "",
    name: account.name || "",
    account_type: account.account_type || "asset",
    normal_balance: account.normal_balance || "debit",
    description: account.description || "",
    is_active: account.is_active !== false,
  });

  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  async function handleSave() {
    const account_number = form.account_number.trim();
    const name = form.name.trim();
    if (!account_number || !name) {
      toast({ title: "Missing details", description: "Account number and name are required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await base44.entities.Account.update(account.id, { ...form, account_number, name });
      toast({ title: "Account updated", description: `${account_number} — ${name}` });
      onDone();
    } catch (e) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Edit Account</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Account Number</Label>
              <Input value={form.account_number} onChange={(e) => set("account_number")(e.target.value)} />
            </div>
            <div>
              <Label>Account Name</Label>
              <Input value={form.name} onChange={(e) => set("name")(e.target.value)} />
            </div>
            <div>
              <Label>Type</Label>
              <Select value={form.account_type} onValueChange={set("account_type")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => <SelectItem key={t} value={t}>{t.replace("_", " ")}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Normal Balance</Label>
              <Select value={form.normal_balance} onValueChange={set("normal_balance")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="debit">debit</SelectItem>
                  <SelectItem value="credit">credit</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Description</Label>
            <Textarea rows={2} value={form.description} onChange={(e) => set("description")(e.target.value)} placeholder="What this account is used for" />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
            <div>
              <Label>Active</Label>
              <p className="text-xs text-slate-500">Inactive accounts are hidden from account pickers</p>
            </div>
            <Switch checked={form.is_active} onCheckedChange={set("is_active")} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={saving} onClick={handleSave}>Save Changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}