import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { statusLabel } from "@/lib/formatters";

const REASONS = ["expired", "damaged_in_transit", "damaged_at_store", "packaging_defect", "quality_issue", "other"];

// Log spoiled products found at a specific partner branch, so replacements
// can be traced back to the exact location they came from.
export default function SpoilageDialog({ open, onOpenChange, customer, locations, onSaved }) {
  const { toast } = useToast();
  const [products, setProducts] = useState([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    location_id: "", product_id: "", quantity: "", reason: "expired",
    reported_date: new Date().toISOString().slice(0, 10), notes: "",
  });

  useEffect(() => {
    if (!open) return;
    base44.entities.Product.filter({ is_active: true, inventory_type: "finished_product" }).then(setProducts);
  }, [open]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function handleSave() {
    if (!form.location_id || !form.product_id || !Number(form.quantity)) {
      toast({ title: "Select the branch, product and quantity", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const loc = locations.find(l => l.id === form.location_id);
      const prod = products.find(p => p.id === form.product_id);
      const qty = Number(form.quantity);
      const unitCost = prod?.current_cost || 0;
      await base44.entities.SpoilageRecord.create({
        record_number: `SPL-${Date.now().toString(36).toUpperCase()}`,
        customer_id: customer.id, customer_name: customer.business_name,
        location_id: loc.id, location_name: loc.name,
        product_id: prod.id, product_name: prod.name,
        quantity: qty, unit: prod.sales_unit || "unit",
        unit_cost: unitCost, total_value: Math.round(unitCost * qty * 100) / 100,
        reported_date: form.reported_date, reason: form.reason,
        status: "reported", notes: form.notes,
      });
      toast({ title: "Spoilage recorded", description: `${qty} × ${prod.name} at ${loc.name}` });
      setForm(f => ({ ...f, product_id: "", quantity: "", notes: "" }));
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
    setSaving(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Report Spoilage — {customer?.business_name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Branch / Location *</Label>
            <Select value={form.location_id} onValueChange={v => set("location_id", v)}>
              <SelectTrigger><SelectValue placeholder="Which branch reported it?" /></SelectTrigger>
              <SelectContent>{locations.map(l => <SelectItem key={l.id} value={l.id}>{l.name}{l.town ? ` — ${l.town}` : ""}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Product *</Label>
            <Select value={form.product_id} onValueChange={v => set("product_id", v)}>
              <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
              <SelectContent>{products.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Quantity *</Label>
              <Input type="number" value={form.quantity} onChange={e => set("quantity", e.target.value)} />
            </div>
            <div>
              <Label>Date</Label>
              <Input type="date" value={form.reported_date} onChange={e => set("reported_date", e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Reason</Label>
            <Select value={form.reason} onValueChange={v => set("reason", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{REASONS.map(r => <SelectItem key={r} value={r}>{statusLabel(r)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea rows={2} value={form.notes} onChange={e => set("notes", e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Record Spoilage"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}