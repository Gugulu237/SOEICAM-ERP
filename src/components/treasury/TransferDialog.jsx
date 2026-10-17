import React, { useState } from "react";
import { formatXAF } from "@/lib/formatters";
import { transferFunds } from "@/lib/treasury";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";

export default function TransferDialog({ accounts, defaultToId = "", onClose, onDone }) {
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const [form, setForm] = useState({
    from_id: "", to_id: defaultToId, amount: 0, reference: "",
    date: new Date().toISOString().slice(0, 10), description: "",
  });
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    const from = accounts.find((a) => a.id === form.from_id);
    const to = accounts.find((a) => a.id === form.to_id);
    if (!from || !to || Number(form.amount) <= 0) {
      toast({ title: "Missing details", description: "Select both accounts and enter an amount", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await transferFunds({
        from, to, amount: Number(form.amount), date: form.date,
        description: form.description, reference: form.reference, userId: user?.id || "",
      });
      toast({ title: "Transfer complete", description: `${formatXAF(Number(form.amount))}: ${from.name} → ${to.name}` });
      onDone();
    } catch (e) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
    finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Transfer Funds</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>From</Label>
              <Select value={form.from_id} onValueChange={(v) => setForm((f) => ({ ...f, from_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Source" /></SelectTrigger>
                <SelectContent>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name} ({formatXAF(a.balance)})</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>To</Label>
              <Select value={form.to_id} onValueChange={(v) => setForm((f) => ({ ...f, to_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Destination" /></SelectTrigger>
                <SelectContent>{accounts.filter((a) => a.id !== form.from_id).map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Amount (XAF)</Label>
              <Input type="number" min="0" value={form.amount || ""} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
            </div>
            <div>
              <Label>Date</Label>
              <Input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
            </div>
          </div>
          <div>
            <Label>Description</Label>
            <Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="e.g. Petty cash replenishment" />
          </div>
          <div>
            <Label>Reference</Label>
            <Input value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} placeholder="Transfer / voucher number" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={saving} onClick={handleSave}>Transfer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}