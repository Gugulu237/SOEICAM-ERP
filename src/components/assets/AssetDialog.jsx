
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState, useEffect } from "react";
import { erp } from "@/api/erpClient";
import { createAsset } from "@/lib/assets";
import {flatDepreciationTerms} from '@/lib/asset-schedule';
import {businessDate} from '@/lib/business-date';
import DepreciationRateFields from './DepreciationRateFields';
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";

const CATEGORIES = ["machinery", "vehicle", "building", "furniture", "equipment", "it_equipment", "other"];

export function AccountSelect({ label, accounts, value, onChange, placeholder }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

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
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const { user } = useCurrentUser();
  const { toast } = useToast();
  const [accounts, setAccounts] = useState([]);
  const [requestKey] = useState(() => crypto.randomUUID());
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "", category: "equipment", serial_number: "", location: "",
    acquisition_date: businessDate(),
    acquisition_cost: 0, salvage_value: 0, useful_life_months: "",
    depreciation_method: "straight_line", replacement_fund_enabled: true, in_service_date: businessDate(),
    depreciation_rate_mode:'life',annual_depreciation_rate:'',automatic_depreciation_enabled:true,
    asset_account_id: "", accum_dep_account_id: "", expense_account_id: "", funding_account_id: "",
  });

  useEffect(() => { erp.entities.Account.filter({ is_active: true }, "account_number", 500).then(setAccounts); }, []);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const byType = (types) => accounts.filter((a) => types.includes(a.account_type));

  async function handleSave() {
    const pick = (id) => accounts.find((a) => a.id === id);
    const assetAcc = pick(form.asset_account_id), accumAcc = pick(form.accum_dep_account_id), expAcc = pick(form.expense_account_id);
    let terms;try{terms=flatDepreciationTerms({basis:Number(form.acquisition_cost)-Number(form.salvage_value),months:form.useful_life_months,annualRate:form.annual_depreciation_rate,mode:form.depreciation_rate_mode});}catch{}
    if (!form.name || Number(form.acquisition_cost) <= 0 || !terms || !assetAcc || !accumAcc || !expAcc) {
      toast({ title: ui("Missing details"), description: ui("Enter name, cost, valid residual value, a depreciation rate or useful life, and the three accounts"), variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const asset = await createAsset({
        data: {
          name: form.name, category: form.category, serial_number: form.serial_number, location: form.location,
          acquisition_date: form.acquisition_date,
          acquisition_cost: Number(form.acquisition_cost),
          salvage_value: Number(form.salvage_value) || 0,
          useful_life_months: terms.months,
          depreciation_rate_mode:form.depreciation_rate_mode,annual_depreciation_rate:form.annual_depreciation_rate,automatic_depreciation_enabled:form.automatic_depreciation_enabled,
          in_service_date: form.in_service_date, replacement_fund_enabled: form.replacement_fund_enabled,
          depreciation_method: form.depreciation_method,
          asset_account_id: assetAcc.id, asset_account_number: assetAcc.account_number, asset_account_name: assetAcc.name,
          accum_dep_account_id: accumAcc.id, accum_dep_account_number: accumAcc.account_number, accum_dep_account_name: accumAcc.name,
          expense_account_id: expAcc.id, expense_account_number: expAcc.account_number, expense_account_name: expAcc.name,
        },
        fundingAccount: pick(form.funding_account_id) || null,
        userId: user?.id || "", requestKey,
      });
      toast({ title: ui("Asset registered"), description: form.name });
      onDone(asset);
    } catch (e) { toast({ title: ui("Error"), description: e.message, variant: "destructive" }); }
    finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{ui("Register Fixed Asset")}</DialogTitle></DialogHeader>
        <fieldset disabled={saving} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label>{ui("Asset Name")}</Label>
              <Input value={form.name} onChange={(e) => set("name")(e.target.value)} placeholder={ui("e.g. Bottling Line 2")} />
            </div>
            <div>
              <Label>{ui("Category")}</Label>
              <Select value={form.category} onValueChange={set("category")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c.replace("_", " ")}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>{ui("Serial Number")}</Label>
              <Input value={form.serial_number} onChange={(e) => set("serial_number")(e.target.value)} />
            </div>
            <div>
              <Label>{ui("Location")}</Label>
              <Input value={form.location} onChange={(e) => set("location")(e.target.value)} />
            </div>
            <div>
              <Label>{ui("Acquisition Date")}</Label>
              <Input type="date" value={form.acquisition_date} onChange={(e) => set("acquisition_date")(e.target.value)} />
            </div>
            <div>
              <Label>{ui("Acquisition Cost (XAF)")}</Label>
              <Input type="number" min="0" value={form.acquisition_cost || ""} onChange={(e) => set("acquisition_cost")(e.target.value)} />
            </div>
            <div>
              <Label>{ui("Salvage Value (XAF)")}</Label>
              <Input type="number" min="0" value={form.salvage_value || ""} onChange={(e) => set("salvage_value")(e.target.value)} />
            </div>
            <div className="sm:col-span-2"><DepreciationRateFields mode={form.depreciation_rate_mode} months={form.useful_life_months} annualRate={form.annual_depreciation_rate} basis={Number(form.acquisition_cost)-Number(form.salvage_value)} onChange={change=>setForm(f=>({...f,...(change.mode?{depreciation_rate_mode:change.mode}:{}),...(change.months!==undefined?{useful_life_months:change.months}:{}),...(change.annualRate!==undefined?{annual_depreciation_rate:change.annualRate}:{})}))} /></div>
            <div><Label>{ui("In-service date")}</Label><Input type="date" value={form.in_service_date} onChange={e=>set("in_service_date")(e.target.value)} /></div>
            <div className="sm:col-span-2 rounded-lg bg-slate-50 p-3 text-sm">
              <strong>{ui("Flat rate / straight-line depreciation")}</strong>
              <p>{ui("(Cost − residual value) ÷ months. A full monthly charge starts in the in-service month; the final charge adjusts for rounding.")}</p>
              <label className="mt-2 flex gap-2"><input type="checkbox" checked={form.automatic_depreciation_enabled} onChange={e=>set("automatic_depreciation_enabled")(e.target.checked)} />{ui('Post depreciation automatically each month')}</label><p className="mt-1 text-xs text-slate-600">{ui('Posts at month end and catches up any unposted completed months from the in-service date. No cash payment is created.')}</p>
              <label className="mt-2 flex gap-2"><input type="checkbox" checked={form.replacement_fund_enabled} onChange={e=>set("replacement_fund_enabled")(e.target.checked)} />{ui(" Track a replacement-fund target equal to each posted charge")}</label>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-200">
            <AccountSelect label={ui("Fixed Asset Account")} accounts={byType(["asset"])} value={form.asset_account_id} onChange={set("asset_account_id")} placeholder={ui("Asset account")} />
            <AccountSelect label={ui("Accumulated Depreciation Account")} accounts={byType(["asset"]).filter(a => a.normal_balance === "credit")} value={form.accum_dep_account_id} onChange={set("accum_dep_account_id")} placeholder={ui("Contra-asset account")} />
            <AccountSelect label={ui("Depreciation Expense Account")} accounts={byType(["expense", "other_expense"])} value={form.expense_account_id} onChange={set("expense_account_id")} placeholder={ui("Expense account")} />
            <AccountSelect label={ui("Paid From / Payable (optional)")} accounts={byType(["asset", "liability"])} value={form.funding_account_id} onChange={set("funding_account_id")} placeholder={ui("Posts acquisition entry")} />
            <p className="sm:col-span-2 text-xs text-slate-500">{ui("Leave the acquisition credit account blank only when the purchase has already been recorded in the ledger. Cash purchases must use a ledger linked to an active treasury account.")}</p>
          </div>
        </fieldset>
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={onClose}>{ui("Cancel")}</Button>
          <Button disabled={saving} onClick={handleSave}>{ui("Register Asset")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
