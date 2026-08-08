import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { transferStock, getStockOnHand } from "@/lib/inventory";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { formatNumber } from "@/lib/formatters";

const TYPES = [
  { value: "warehouse_transfer", label: "Warehouse transfer" },
  { value: "production_issue", label: "Issue to production" },
  { value: "production_return", label: "Return from production" },
  { value: "vehicle_load", label: "Load onto delivery vehicle" },
  { value: "quality_quarantine", label: "Move to quarantine" },
];

export default function StockTransferDialog({ open, onOpenChange, products, warehouses, onSaved }) {
  const { toast } = useToast();
  const [form, setForm] = useState({ product_id: "", from: "", to: "", quantity: "", movement_type: "warehouse_transfer", reason: "", date: new Date().toISOString().slice(0, 10) });
  const [available, setAvailable] = useState(null);
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => {
    if (form.product_id && form.from) getStockOnHand(form.product_id, form.from).then(setAvailable);
    else setAvailable(null);
  }, [form.product_id, form.from]);

  async function submit() {
    setSaving(true);
    try {
      const product = products.find(p => p.id === form.product_id);
      await transferStock({
        productId: form.product_id,
        productName: product?.name,
        fromWarehouseId: form.from,
        toWarehouseId: form.to,
        quantity: Number(form.quantity),
        movementType: form.movement_type,
        movementDate: form.date,
        reason: form.reason,
      });
      toast({ title: "Stock moved", description: `${form.quantity} ${product?.storage_unit || "units"} of ${product?.name} transferred` });
      onOpenChange(false);
      setForm({ product_id: "", from: "", to: "", quantity: "", movement_type: "warehouse_transfer", reason: "", date: new Date().toISOString().slice(0, 10) });
      onSaved?.();
    } catch (e) {
      toast({ title: "Transfer failed", description: e.message, variant: "destructive" });
    }
    setSaving(false);
  }

  const valid = form.product_id && form.from && form.to && Number(form.quantity) > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Move Stock</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Product *</Label>
            <Select value={form.product_id} onValueChange={v => set("product_id", v)}>
              <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
              <SelectContent>
                {products.map(p => <SelectItem key={p.id} value={p.id}>{p.sku} — {p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>From Warehouse *</Label>
              <Select value={form.from} onValueChange={v => set("from", v)}>
                <SelectTrigger><SelectValue placeholder="Source" /></SelectTrigger>
                <SelectContent>
                  {warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {available !== null && <p className="text-xs text-slate-500 mt-1">Available: {formatNumber(available, 2)}</p>}
            </div>
            <div>
              <Label>To Warehouse *</Label>
              <Select value={form.to} onValueChange={v => set("to", v)}>
                <SelectTrigger><SelectValue placeholder="Destination" /></SelectTrigger>
                <SelectContent>
                  {warehouses.filter(w => w.id !== form.from).map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Quantity *</Label>
              <Input type="number" value={form.quantity} onChange={e => set("quantity", e.target.value)} />
            </div>
            <div>
              <Label>Date</Label>
              <Input type="date" value={form.date} onChange={e => set("date", e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Movement Type</Label>
            <Select value={form.movement_type} onValueChange={v => set("movement_type", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Reason / Reference</Label>
            <Input value={form.reason} onChange={e => set("reason", e.target.value)} placeholder="Optional note" />
          </div>
          <p className="text-xs text-slate-500">Lots are consumed first-expiry-first-out and their cost travels with the goods.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!valid || saving}>{saving ? "Moving..." : "Move Stock"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}