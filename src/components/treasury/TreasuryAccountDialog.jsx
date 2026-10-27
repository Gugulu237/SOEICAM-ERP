
/* localized-interface */
import {readAll} from "@/lib/field-pos";
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState, useEffect } from "react";
import { erp } from "@/api/erpClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";

export default function TreasuryAccountDialog({ onClose, onDone }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const { toast } = useToast();
  const [glAccounts, setGlAccounts] = useState([]);
  const [form, setForm] = useState({ name: "", account_type: "cash", gl_account_id: "", float_limit: 0, custodian: "", opening_balance: 0 });
  const [saving, setSaving] = useState(false),[loadError,setLoadError]=useState("");

  useEffect(() => {
    readAll(erp.entities.Account,{is_active:true,account_type:"asset"},"account_number").then(a=>setGlAccounts(a.filter(r=>r.is_posting!==false&&r.normal_balance==="debit"&&!r.is_control_account))).catch(e=>setLoadError(e.message));
  }, []);

  async function handleSave() {
    const gl = glAccounts.find((a) => a.id === form.gl_account_id);
    if (!form.name || !gl) {
      toast({ title: ui("Missing details"), description: ui("Name and GL account are required"), variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await erp.entities.TreasuryAccount.create({
        name: form.name, account_type: form.account_type,
        gl_account_id: gl.id, gl_account_number: gl.account_number, gl_account_name: gl.name,
        balance: 0,
        float_limit: Number(form.float_limit) || 0,
        custodian: form.custodian, is_active: true,
      });
      toast({ title: ui("Treasury account created"), description: form.name });
      onDone();
    } catch (e) { toast({ title: ui("Error"), description: e.message, variant: "destructive" }); }
    finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{ui("New Treasury Account")}</DialogTitle></DialogHeader>
        {loadError&&<p role="alert" className="text-sm text-red-700">{loadError}</p>}
        <div className="space-y-4">
          <div>
            <Label>{ui("Name")}</Label>
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder={ui("e.g. Factory Petty Cash")} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>{ui("Type")}</Label>
              <Select value={form.account_type} onValueChange={(v) => setForm((f) => ({ ...f, account_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">{ui("Cash")}</SelectItem>
                  <SelectItem value="bank">{ui("Bank")}</SelectItem>
                  <SelectItem value="mobile_money">{ui("Mobile Money")}</SelectItem>
                  <SelectItem value="petty_cash">{ui("Petty Cash")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="self-end text-xs text-slate-500">{ui("Record opening cash through Accounting opening balances. This account links to its posted GL balance.")}</p>
          </div>
          <div>
            <Label>{ui("Linked GL Account")}</Label>
            <Select value={form.gl_account_id} onValueChange={(v) => setForm((f) => ({ ...f, gl_account_id: v }))}>
              <SelectTrigger><SelectValue placeholder={ui("Select asset account")} /></SelectTrigger>
              <SelectContent>{glAccounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.account_number} — {a.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {form.account_type === "petty_cash" && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>{ui("Float Limit (XAF)")}</Label>
                <Input type="number" min="0" value={form.float_limit || ""} onChange={(e) => setForm((f) => ({ ...f, float_limit: e.target.value }))} />
              </div>
              <div>
                <Label>{ui("Custodian")}</Label>
                <Input value={form.custodian} onChange={(e) => setForm((f) => ({ ...f, custodian: e.target.value }))} placeholder={ui("Responsible person")} />
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{ui("Cancel")}</Button>
          <Button disabled={saving} onClick={handleSave}>{ui("Create Account")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}