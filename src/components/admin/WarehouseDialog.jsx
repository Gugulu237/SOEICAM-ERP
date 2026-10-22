
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState, useEffect } from "react";
import { erp } from "@/api/erpClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { WAREHOUSE_TYPES, MANAGED_WAREHOUSE_TYPES } from '@/lib/warehouse-workspace';

const TYPES = [
  { value: "general", get label(){return ui("General / Operations Area");} },
  { value: "raw_material", get label(){return ui("Raw Materials Store");} },
  { value: "packaging", get label(){return ui("Packaging Store");} },
  { value: "wip", get label(){return ui("Work In Progress");} },
  { value: "finished_goods", get label(){return ui("Finished Goods");} },
  { value: "cold_room", get label(){return ui("Cold Room");} },
  { value: "quarantine", get label(){return ui("Quarantine");} },
  { value: "damaged", get label(){return ui("Damaged Goods");} },
  { value: "vehicle", get label(){return ui("Vehicle");} },
];

export default function WarehouseDialog({ open, onOpenChange, warehouse, branches = [], onSaved }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const { toast } = useToast();
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setForm({ name:warehouse?.name || '',code:warehouse?.code || '',warehouse_type:warehouse?.warehouse_type || 'general',branch_id:warehouse?.branch_id || '',address:warehouse?.address || '',is_active:warehouse?.is_active !== false });
  }, [open, warehouse]);

  async function handleSave() {
    if (!form.name || !form.code) {
      toast({ title: ui("Error"), description: ui("Name and code are required"), variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      if (warehouse?.id) {
        await erp.entities.Warehouse.update(warehouse.id, form);
      } else {
        await erp.entities.Warehouse.create(form);
      }
      toast({ title: ui("Saved"), description: ui("Location {0} saved", form.name) });
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast({ title: ui("Error"), description: e.message, variant: "destructive" });
    }
    setSaving(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{warehouse ? ui("Edit warehouse") : ui("New warehouse")}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>{ui("Name *")}</Label>
              <Input value={form.name || ""} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder={ui("e.g. Production Floor")} />
            </div>
            <div>
              <Label>{ui("Code *")}</Label>
              <Input value={form.code || ""} onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))} placeholder={ui("e.g. PROD-01")} />
            </div>
          </div>
          <div>
            <Label>{ui("Type")}</Label>
            <Select disabled={MANAGED_WAREHOUSE_TYPES.includes(warehouse?.warehouse_type)} value={form.warehouse_type || "general"} onValueChange={v => setForm(f => ({ ...f, warehouse_type: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{TYPES.filter(t => !MANAGED_WAREHOUSE_TYPES.includes(t.value)).map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}{MANAGED_WAREHOUSE_TYPES.includes(warehouse?.warehouse_type) && <SelectItem value={warehouse.warehouse_type}>{WAREHOUSE_TYPES[warehouse.warehouse_type]}</SelectItem>}</SelectContent>
            </Select>
          </div>
          {branches.length > 0 && <div>
            <Label>{ui("Branch")}</Label>
            <Select value={form.branch_id || ""} onValueChange={v => setForm(f => ({ ...f, branch_id: v }))}>
              <SelectTrigger><SelectValue placeholder={ui("Select branch")} /></SelectTrigger>
              <SelectContent>{branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>}
          <div>
            <Label>{ui("Address / Physical Location")}</Label>
            <Input value={form.address || ""} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
          </div>
          <div className="flex items-center gap-2">
            <Switch disabled={MANAGED_WAREHOUSE_TYPES.includes(warehouse?.warehouse_type)} checked={form.is_active !== false} onCheckedChange={v => setForm(f => ({ ...f, is_active: v }))} />
            <Label>{ui("Active")}</Label>
          </div>
          <p className="text-xs leading-5 text-slate-500">{ui("Stock and history stay attached when a warehouse is renamed. Empty the location and complete open operations before changing its type or making it inactive. Vehicle assignments are managed in Distribution.")}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{ui("Cancel")}</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? ui("Saving...") : ui("Save Location")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
