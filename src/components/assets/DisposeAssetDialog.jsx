
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState, useEffect } from "react";
import { erp } from "@/api/erpClient";
import { disposeAsset } from "@/lib/assets";
import { formatXAF } from "@/lib/formatters";
import { round2 } from "@/lib/posting";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";

export default function DisposeAssetDialog({ asset, onClose, onDone }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const { user } = useCurrentUser();
  const { toast } = useToast();
  const [accounts, setAccounts] = useState([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10), proceeds: 0, proceeds_account_id: "", gain_loss_account_id: "",
  });

  useEffect(() => { erp.entities.Account.filter({ is_active: true }, "account_number", 500).then(setAccounts); }, []);

  const nbv = round2(asset.acquisition_cost - asset.accumulated_depreciation);
  const gainLoss = round2(Number(form.proceeds || 0) - nbv);

  async function handleSave() {
    setSaving(true);
    try {
      await disposeAsset({
        asset, date: form.date, proceeds: Number(form.proceeds) || 0,
        proceedsAccount: accounts.find((a) => a.id === form.proceeds_account_id),
        gainLossAccount: accounts.find((a) => a.id === form.gain_loss_account_id),
        userId: user?.id || "",
      });
      toast({ title: ui("Asset disposed"), description: `${asset.name} — ${gainLoss >= 0 ? "gain" : "loss"} ${formatXAF(Math.abs(gainLoss))}` });
      onDone();
    } catch (e) { toast({ title: ui("Error"), description: e.message, variant: "destructive" }); }
    finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{ui("Dispose ")}{asset.name}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="bg-slate-50 rounded px-3 py-2 text-sm space-y-1">
            <div className="flex justify-between"><span className="text-slate-500">{ui("Cost")}</span><span>{formatXAF(asset.acquisition_cost)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">{ui("Accumulated depreciation")}</span><span>{formatXAF(asset.accumulated_depreciation)}</span></div>
            <div className="flex justify-between font-semibold"><span>{ui("Net book value")}</span><span>{formatXAF(nbv)}</span></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>{ui("Disposal Date")}</Label>
              <Input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
            </div>
            <div>
              <Label>{ui("Proceeds (XAF)")}</Label>
              <Input type="number" min="0" value={form.proceeds || ""} onChange={(e) => setForm((f) => ({ ...f, proceeds: e.target.value }))} />
            </div>
          </div>
          <div>
            <Label>{ui("Proceeds Received Into")}</Label>
            <Select value={form.proceeds_account_id} onValueChange={(v) => setForm((f) => ({ ...f, proceeds_account_id: v }))}>
              <SelectTrigger><SelectValue placeholder={ui("Cash / bank / receivable account")} /></SelectTrigger>
              <SelectContent>{accounts.filter((a) => a.account_type === "asset").map((a) => <SelectItem key={a.id} value={a.id}>{a.account_number} — {a.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>{ui("Gain / Loss on Disposal Account")}</Label>
            <Select value={form.gain_loss_account_id} onValueChange={(v) => setForm((f) => ({ ...f, gain_loss_account_id: v }))}>
              <SelectTrigger><SelectValue placeholder={ui("Other income / other expense account")} /></SelectTrigger>
              <SelectContent>{accounts.filter((a) => ["other_income", "other_expense", "expense", "revenue"].includes(a.account_type)).map((a) => <SelectItem key={a.id} value={a.id}>{a.account_number} — {a.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className={`text-sm font-medium px-3 py-2 rounded ${gainLoss >= 0 ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
            {gainLoss >= 0 ? ui("Gain") : ui("Loss")}{ui(" on disposal: ")}{formatXAF(Math.abs(gainLoss))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={onClose}>{ui("Cancel")}</Button>
          <Button variant="destructive" disabled={saving} onClick={handleSave}>{ui("Confirm Disposal")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}