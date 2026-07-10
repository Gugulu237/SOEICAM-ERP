import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/use-toast";
import { Save } from "lucide-react";

export default function FinishedProductDialog({ open, onOpenChange, onSaved }) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    name: "", flavor: "", size: "", category: "", sales_unit: "unit",
    selling_price: 0, standard_cost: 0, shelf_life_days: 21,
    lot_tracking: true, expiry_tracking: true
  });
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function handleSave() {
    if (!form.name) { toast({ title: "Name is required", variant: "destructive" }); return; }
    setSaving(true);
    try {
      await base44.entities.Product.create({
        ...form,
        sku: `FP-${Date.now().toString().slice(-6)}`,
        inventory_type: "finished_product",
        purchase_unit: form.sales_unit,
        storage_unit: form.sales_unit,
        production_unit: form.sales_unit,
        is_active: true
      });
      toast({ title: "Finished product added" });
      setForm({ name: "", flavor: "", size: "", category: "", sales_unit: "unit", selling_price: 0, standard_cost: 0, shelf_life_days: 21, lot_tracking: true, expiry_tracking: true });
      onSaved();
      onOpenChange(false);
    } catch (e) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
    setSaving(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Add Finished Product</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><Label>Name *</Label><Input value={form.name} onChange={e => set("name", e.target.value)} placeholder="e.g. YOLA Natural Yogurt" /></div>
          <div><Label>Flavor</Label><Input value={form.flavor} onChange={e => set("flavor", e.target.value)} placeholder="e.g. Natural, Strawberry" /></div>
          <div><Label>Size</Label><Input value={form.size} onChange={e => set("size", e.target.value)} placeholder="e.g. 500ml, 1L" /></div>
          <div><Label>Product Category</Label><Input value={form.category} onChange={e => set("category", e.target.value)} placeholder="e.g. Yogurt, Juice" /></div>
          <div><Label>Sales Unit</Label><Input value={form.sales_unit} onChange={e => set("sales_unit", e.target.value)} placeholder="unit, carton" /></div>
          <div><Label>Selling Price (XAF)</Label><Input type="number" value={form.selling_price} onChange={e => set("selling_price", Number(e.target.value))} /></div>
          <div><Label>Standard Cost (XAF)</Label><Input type="number" value={form.standard_cost} onChange={e => set("standard_cost", Number(e.target.value))} /></div>
          <div><Label>Shelf Life (days)</Label><Input type="number" value={form.shelf_life_days} onChange={e => set("shelf_life_days", Number(e.target.value))} /></div>
          <div className="flex items-center gap-3 pt-6"><Switch checked={form.lot_tracking} onCheckedChange={v => set("lot_tracking", v)} /><Label>Lot Tracking</Label></div>
          <div className="flex items-center gap-3 pt-6"><Switch checked={form.expiry_tracking} onCheckedChange={v => set("expiry_tracking", v)} /><Label>Expiry Tracking</Label></div>
        </div>
        <Button className="mt-4" onClick={handleSave} disabled={saving}><Save size={16} className="mr-1" /> {saving ? "Saving..." : "Add Product"}</Button>
      </DialogContent>
    </Dialog>
  );
}