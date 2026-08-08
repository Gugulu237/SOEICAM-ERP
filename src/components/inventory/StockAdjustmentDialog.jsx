import React, { useState } from "react";
import { adjustStock } from "@/lib/inventory";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { formatNumber } from "@/lib/formatters";

const REASONS = [
  { value: "stock_count_variance", label: "Physical count variance" },
  { value: "damage", label: "Damaged stock" },
  { value: "expiry", label: "Expired stock" },
  { value: "stock_adjustment", label: "Other adjustment" },
];

export default function StockAdjustmentDialog({ open, onOpenChange, balances, onSaved }) {
  const { toast } = useToast();
  const [form, setForm] = useState({ balance_id: "", counted: "", movement_type: "stock_count_variance", reason: "", date: new Date().toISOString().slice(0, 10) });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const selected = balances.find(b => b.id === form.balance_id);
  const diff = selected && form.counted !== "" ? Number(form.counted) - (selected.quantity || 0) : null;

  async function submit() {
    setSaving(true);
    try {
      const res = await adjustStock({
        balanceId: form.balance_id,
        countedQuantity: Number(form.counted),
        movementType: form.movement_type,
        reason: form.reason,
        movementDate: form.date,
      });
      toast({ title: "Stock adjusted", description: `${res.difference > 0 ? "+" : ""}${formatNumber(res.difference, 2)} recorded` });
      onOpenChange(false);
      setForm({ balance_id: "", counted: "", movement_type: "stock_count_variance", reason: "", date: new Date().toISOString().slice(0, 10) });
      onSaved?.();
    } catch (e) {
      toast({ title: "Adjustment failed", description: e.message, variant: "destructive" });
    }
    setSaving(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Adjust Stock</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Stock Line *</Label>
            <Select value={form.balance_id} onValueChange={v => set("balance_id", v)}>
              <SelectTrigger><SelectValue placeholder="Select product / warehouse / lot" /></SelectTrigger>
              <SelectContent>
                {balances.map(b => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.product_name} · {b.warehouse_name}{b.lot_number ? ` · ${b.lot_number}` : ""} ({formatNumber(b.quantity, 2)})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selected && (
            <p className="text-sm text-slate-600">System quantity: <strong>{formatNumber(selected.quantity, 2)}</strong></p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Counted Quantity *</Label>
              <Input type="number" value={form.counted} onChange={e => set("counted", e.target.value)} />
              {diff !== null && diff !== 0 && (
                <p className={`text-xs mt-1 ${diff > 0 ? "text-emerald-600" : "text-red-600"}`}>
                  Variance: {diff > 0 ? "+" : ""}{formatNumber(diff, 2)}
                </p>
              )}
            </div>
            <div>
              <Label>Date</Label>
              <Input type="date" value={form.date} onChange={e => set("date", e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Adjustment Type</Label>
            <Select value={form.movement_type} onValueChange={v => set("movement_type", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {REASONS.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Reason *</Label>
            <Input value={form.reason} onChange={e => set("reason", e.target.value)} placeholder="Explain the variance" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!form.balance_id || form.counted === "" || !form.reason || saving}>
            {saving ? "Saving..." : "Record Adjustment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}