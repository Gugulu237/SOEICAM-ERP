import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { createAsset } from "@/lib/assets";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";

const CATEGORIES = ["machinery", "vehicle", "building", "furniture", "equipment", "it_equipment", "other"];

function AccountSelect({ label, accounts, value, onChange, placeholder }) {
  return (
    <div>
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger><SelectValue placeholder={placeholder} /></SelectTrigger>
        <SelectContent>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.account_number} — {a.name}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
}

export default function AssetDialog({ onClose, onDone }) {
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const [accounts, setAccounts] = useState([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "", category: "equipment", serial_number: "", location: "",
    acquisition_date: new Date().toISOString().slice(0, 10),
    acquisition_cost: 0, salvage_value: 0, useful_life_months: 60,
    depreciation_method: "straight_line",
    asset_account_id: "", accum_dep_account_id: "", expense_account_id: "", funding_account_id: "",
  });

  useEffect(() => { base44.entities.Account.filter({ is_active: true }, "account_number", 500).then(setAccounts); }, []);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const byType = (types) => accounts.filter((a) => types.includes(a.account_type));

  async function handleSave() {
    const pick = (id) => accounts.find((a) => a.id === id);
    const assetAcc = pick(form.asset_account_id), accumAcc = pick(form.accum_dep_account_id), expAcc = pick(form.expense_account_id);
    if (!form.name || Number(form.acquisition_cost) <= 0 || !assetAcc || !accumAcc || !expAcc) {
      toast({ title: "Missing details", description: "Name, cost and the three accounts are required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await createAsset({
        data: {
          name: form.name, category: form.category, serial_number: form.serial_number, location: form.location,
          acquisition_date: form.acquisition_date,
          acquisition_cost: Number(form.acquisition_cost),
          salvage_value: Number(form.salvage_value) || 0,
          useful_life_months: Number(form.useful_life_months) || 60,
          depreciation_method: form.depreciation_method,
          asset_account_id: assetAcc.id, asset_account_number: assetAcc.account_number, asset_account_name: assetAcc.name,
          accum_dep_account_id: accumAcc.id, accum_dep_account_number: accumAcc.account_number, accum_dep_account_name: accumAcc.name,
          expense_account_id: expAcc.id, expense_account_number: expAcc.account_number, expense_account_name: expAcc.name,
        },
        fundingAccount: pick(form.funding_account_id) || null,
        userId: user?.id || "",
      });
      toast({ title: "Asset registered", description: form.name });
      onDone();
    } catch (e) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
    finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Register Fixed Asset</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Asset Name</Label>
              <Input value={form.name} onChange={(e) => set("name")(e.target.value)} placeholder="e.g. Bottling Line 2" />
            </div>
            <div>
              <Label>Category</Label>
              <Select value={form.category} onValueChange={set("category")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c.replace("_", " ")}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Serial Number</Label>
              <Input value={form.serial_number} onChange={(e) => set("serial_number")(e.target.value)} />
            </div>
            <div>
              <Label>Location</Label>
              <Input value={form.location} onChange={(e) => set("location")(e.target.value)} />
            </div>
            <div>
              <Label>Acquisition Date</Label>
              <Input type="date" value={form.acquisition_date} onChange={(e) => set("acquisition_date")(e.target.value)} />
            </div>
            <div>
              <Label>Acquisition Cost (XAF)</Label>
              <Input type="number" min="0" value={form.acquisition_cost || ""} onChange={(e) => set("acquisition_cost")(e.target.value)} />
            </div>
            <div>
              <Label>Salvage Value (XAF)</Label>
              <Input type="number" min="0" value={form.salvage_value || ""} onChange={(e) => set("salvage_value")(e.target.value)} />
            </div>
            <div>
              <Label>Useful Life (months)</Label>
              <Input type="number" min="1" value={form.useful_life_months || ""} onChange={(e) => set("useful_life_months")(e.target.value)} />
            </div>
            <div>
              <Label>Depreciation Method</Label>
              <Select value={form.depreciation_method} onValueChange={set("depreciation_method")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="straight_line">Straight line</SelectItem>
                  <SelectItem value="none">No depreciation</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 pt-2 border-t border-slate-200">
            <AccountSelect label="Fixed Asset Account" accounts={byType(["asset"])} value={form.asset_account_id} onChange={set("asset_account_id")} placeholder="Asset account" />
            <AccountSelect label="Accumulated Depreciation Account" accounts={byType(["asset", "liability"])} value={form.accum_dep_account_id} onChange={set("accum_dep_account_id")} placeholder="Contra-asset account" />
            <AccountSelect label="Depreciation Expense Account" accounts={byType(["expense", "other_expense"])} value={form.expense_account_id} onChange={set("expense_account_id")} placeholder="Expense account" />
            <AccountSelect label="Paid From / Payable (optional)" accounts={byType(["asset", "liability"])} value={form.funding_account_id} onChange={set("funding_account_id")} placeholder="Posts acquisition entry" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={saving} onClick={handleSave}>Register Asset</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}