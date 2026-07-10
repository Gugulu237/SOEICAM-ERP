import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { Save } from "lucide-react";

export default function PackagingDialog({ open, onOpenChange, onSaved }) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    name: "", size: "", category: "", purchase_unit: "unit", storage_unit: "unit",
    current_cost: 0, reorder_level: 0
  });
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function handleSave() {
    if (!form.name) { toast({ title: "Name is required", variant: "destructive" }); return; }
    setSaving(true);
    try {
      await base44.entities.Product.create({
        ...form,
        sku: `PK-${Date.now().toString().slice(-6)}`,
        inventory_type: "packaging",
        production_unit: form.purchase_unit,
        sales_unit: form.purchase_unit,
        is_active: true
      });
      toast({ title: "Packaging added" });
      setForm({ name: "", size: "", category: "", purchase_unit: "unit", storage_unit: "unit", current_cost: 0, reorder_level: 0 });
      onSaved();
      onOpenChange(false);
    } catch (e) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
    setSaving(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Add Packaging</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><Label>Name *</Label><Input value={form.name} onChange={e => set("name", e.target.value)} placeholder="e.g. 500ml Cup" /></div>
          <div><Label>Size</Label><Input value={form.size} onChange={e => set("size", e.target.value)} placeholder="e.g. 500ml, 1L, 12-pack" /></div>
          <div><Label>Product Category</Label><Input value={form.category} onChange={e => set("category", e.target.value)} placeholder="e.g. Yogurt, Juice" /></div>
          <div><Label>Unit</Label><Input value={form.purchase_unit} onChange={e => set("purchase_unit", e.target.value)} placeholder="unit, roll, box" /></div>
          <div><Label>Storage Unit</Label><Input value={form.storage_unit} onChange={e => set("storage_unit", e.target.value)} /></div>
          <div><Label>Unit Cost (XAF)</Label><Input type="number" value={form.current_cost} onChange={e => set("current_cost", Number(e.target.value))} /></div>
          <div><Label>Reorder Level</Label><Input type="number" value={form.reorder_level} onChange={e => set("reorder_level", Number(e.target.value))} /></div>
        </div>
        <Button className="mt-4" onClick={handleSave} disabled={saving}><Save size={16} className="mr-1" /> {saving ? "Saving..." : "Add Packaging"}</Button>
      </DialogContent>
    </Dialog>
  );
}