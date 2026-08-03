import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";

export default function TreasuryAccountDialog({ onClose, onDone }) {
  const { toast } = useToast();
  const [glAccounts, setGlAccounts] = useState([]);
  const [form, setForm] = useState({ name: "", account_type: "cash", gl_account_id: "", float_limit: 0, custodian: "", opening_balance: 0 });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    base44.entities.Account.filter({ is_active: true, account_type: "asset" }, "account_number", 500).then(setGlAccounts);
  }, []);

  async function handleSave() {
    const gl = glAccounts.find((a) => a.id === form.gl_account_id);
    if (!form.name || !gl) {
      toast({ title: "Missing details", description: "Name and GL account are required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await base44.entities.TreasuryAccount.create({
        name: form.name, account_type: form.account_type,
        gl_account_id: gl.id, gl_account_number: gl.account_number, gl_account_name: gl.name,
        balance: Number(form.opening_balance) || 0,
        float_limit: Number(form.float_limit) || 0,
        custodian: form.custodian, is_active: true,
      });
      toast({ title: "Treasury account created", description: form.name });
      onDone();
    } catch (e) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
    finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>New Treasury Account</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Name</Label>
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Factory Petty Cash" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Type</Label>
              <Select value={form.account_type} onValueChange={(v) => setForm((f) => ({ ...f, account_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="bank">Bank</SelectItem>
                  <SelectItem value="mobile_money">Mobile Money</SelectItem>
                  <SelectItem value="petty_cash">Petty Cash</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Opening Balance (XAF)</Label>
              <Input type="number" min="0" value={form.opening_balance || ""} onChange={(e) => setForm((f) => ({ ...f, opening_balance: e.target.value }))} />
            </div>
          </div>
          <div>
            <Label>Linked GL Account</Label>
            <Select value={form.gl_account_id} onValueChange={(v) => setForm((f) => ({ ...f, gl_account_id: v }))}>
              <SelectTrigger><SelectValue placeholder="Select asset account" /></SelectTrigger>
              <SelectContent>{glAccounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.account_number} — {a.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {form.account_type === "petty_cash" && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Float Limit (XAF)</Label>
                <Input type="number" min="0" value={form.float_limit || ""} onChange={(e) => setForm((f) => ({ ...f, float_limit: e.target.value }))} />
              </div>
              <div>
                <Label>Custodian</Label>
                <Input value={form.custodian} onChange={(e) => setForm((f) => ({ ...f, custodian: e.target.value }))} placeholder="Responsible person" />
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={saving} onClick={handleSave}>Create Account</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}