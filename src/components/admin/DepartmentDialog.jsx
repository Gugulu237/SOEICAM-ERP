
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

export default function DepartmentDialog({ open, onOpenChange, department, branches, onSaved }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const { toast } = useToast();
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setForm(department || { name: "", code: "", branch_id: "", is_active: true });
  }, [open, department]);

  async function handleSave() {
    if (!form.name || !form.code) {
      toast({ title: ui("Error"), description: ui("Name and code are required"), variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      if (department?.id) {
        await erp.entities.Department.update(department.id, form);
      } else {
        await erp.entities.Department.create(form);
      }
      toast({ title: ui("Saved"), description: ui("Department {0} saved", form.name) });
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
        <DialogHeader><DialogTitle>{department ? ui("Edit Department") : ui("New Department")}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>{ui("Name *")}</Label>
              <Input value={form.name || ""} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder={ui("e.g. Production")} />
            </div>
            <div>
              <Label>{ui("Code *")}</Label>
              <Input value={form.code || ""} onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))} placeholder={ui("e.g. PROD")} />
            </div>
          </div>
          <div>
            <Label>{ui("Branch")}</Label>
            <Select value={form.branch_id || ""} onValueChange={v => setForm(f => ({ ...f, branch_id: v }))}>
              <SelectTrigger><SelectValue placeholder={ui("Select branch")} /></SelectTrigger>
              <SelectContent>{branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={form.is_active !== false} onCheckedChange={v => setForm(f => ({ ...f, is_active: v }))} />
            <Label>{ui("Active")}</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{ui("Cancel")}</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? ui("Saving...") : ui("Save Department")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}