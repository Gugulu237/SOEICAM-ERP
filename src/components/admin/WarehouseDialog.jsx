import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";

const TYPES = [
  { value: "general", label: "General / Operations Area" },
  { value: "raw_material", label: "Raw Materials Store" },
  { value: "packaging", label: "Packaging Store" },
  { value: "wip", label: "Work In Progress" },
  { value: "finished_goods", label: "Finished Goods" },
  { value: "cold_room", label: "Cold Room" },
  { value: "quarantine", label: "Quarantine" },
  { value: "damaged", label: "Damaged Goods" },
  { value: "vehicle", label: "Vehicle" },
];

export default function WarehouseDialog({ open, onOpenChange, warehouse, branches, onSaved }) {
  const { toast } = useToast();
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setForm(warehouse || { name: "", code: "", warehouse_type: "general", branch_id: "", address: "", is_active: true });
  }, [open, warehouse]);

  async function handleSave() {
    if (!form.name || !form.code) {
      toast({ title: "Error", description: "Name and code are required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      if (warehouse?.id) {
        await base44.entities.Warehouse.update(warehouse.id, form);
      } else {
        await base44.entities.Warehouse.create(form);
      }
      toast({ title: "Saved", description: `Location ${form.name} saved` });
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
    setSaving(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{warehouse ? "Edit Location" : "New Location"}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Name *</Label>
              <Input value={form.name || ""} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Production Floor" />
            </div>
            <div>
              <Label>Code *</Label>
              <Input value={form.code || ""} onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))} placeholder="e.g. PROD-01" />
            </div>
          </div>
          <div>
            <Label>Type</Label>
            <Select value={form.warehouse_type || "general"} onValueChange={v => setForm(f => ({ ...f, warehouse_type: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Branch</Label>
            <Select value={form.branch_id || ""} onValueChange={v => setForm(f => ({ ...f, branch_id: v }))}>
              <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
              <SelectContent>{branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Address / Physical Location</Label>
            <Input value={form.address || ""} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={form.is_active !== false} onCheckedChange={v => setForm(f => ({ ...f, is_active: v }))} />
            <Label>Active</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save Location"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}