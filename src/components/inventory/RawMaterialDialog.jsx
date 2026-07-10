import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/use-toast";
import { Save } from "lucide-react";

export default function RawMaterialDialog({ open, onOpenChange, onSaved }) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    name: "", category: "", purchase_unit: "kg", storage_unit: "kg",
    current_cost: 0, reorder_level: 0, lot_tracking: true, expiry_tracking: false, shelf_life_days: 0
  });
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function handleSave() {
    if (!form.name) { toast({ title: "Name is required", variant: "destructive" }); return; }
    setSaving(true);
    try {
      await base44.entities.Product.create({
        ...form,
        sku: `RM-${Date.now().toString().slice(-6)}`,
        inventory_type: "raw_material",
        production_unit: form.purchase_unit,
        sales_unit: form.purchase_unit,
        is_active: true
      });
      toast({ title: "Raw material added" });
      setForm({ name: "", category: "", purchase_unit: "kg", storage_unit: "kg", current_cost: 0, reorder_level: 0, lot_tracking: true, expiry_tracking: false, shelf_life_days: 0 });
      onSaved();
      onOpenChange(false);
    } catch (e) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
    setSaving(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Add Raw Material / Ingredient</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><Label>Name *</Label><Input value={form.name} onChange={e => set("name", e.target.value)} placeholder="e.g. Milk Powder" /></div>
          <div className="col-span-2"><Label>Category</Label><Input value={form.category} onChange={e => set("category", e.target.value)} placeholder="e.g. Dairy, Sweetener, Flavour" /></div>
          <div><Label>Purchase Unit</Label><Input value={form.purchase_unit} onChange={e => set("purchase_unit", e.target.value)} placeholder="kg, litre, gram" /></div>
          <div><Label>Storage Unit</Label><Input value={form.storage_unit} onChange={e => set("storage_unit", e.target.value)} placeholder="kg, litre, gram" /></div>
          <div><Label>Unit Cost (XAF)</Label><Input type="number" value={form.current_cost} onChange={e => set("current_cost", Number(e.target.value))} /></div>
          <div><Label>Reorder Level</Label><Input type="number" value={form.reorder_level} onChange={e => set("reorder_level", Number(e.target.value))} /></div>
          <div><Label>Shelf Life (days)</Label><Input type="number" value={form.shelf_life_days} onChange={e => set("shelf_life_days", Number(e.target.value))} /></div>
          <div className="flex items-center gap-3 pt-6"><Switch checked={form.lot_tracking} onCheckedChange={v => set("lot_tracking", v)} /><Label>Lot Tracking</Label></div>
          <div className="flex items-center gap-3 pt-6"><Switch checked={form.expiry_tracking} onCheckedChange={v => set("expiry_tracking", v)} /><Label>Expiry Tracking</Label></div>
        </div>
        <Button className="mt-4" onClick={handleSave} disabled={saving}><Save size={16} className="mr-1" /> {saving ? "Saving..." : "Add Ingredient"}</Button>
      </DialogContent>
    </Dialog>
  );
}