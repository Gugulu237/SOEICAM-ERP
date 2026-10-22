
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState, useEffect } from "react";
import { erp } from "@/api/erpClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { EXPENSE_CATEGORIES } from "@/lib/expenses";
import { statusLabel } from "@/lib/formatters";
import { Paperclip } from "lucide-react";

// Quick submit form for a new expense budget request.
export default function ExpenseRequestDialog({ open, onOpenChange, onSaved, employee, departmentId }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const { toast } = useToast();
  const [departments, setDepartments] = useState([]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({
    title: "", amount: "", category: "other", department_id: "",
    request_date: new Date().toISOString().slice(0, 10), justification: "", receipt_url: "",
  });

  useEffect(() => {
    if (!open) return;
    erp.entities.Department.filter({ is_active: true }).then(setDepartments);
    setForm(f => ({ ...f, department_id: departmentId || "" }));
  }, [open, departmentId]);

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { file_url } = await erp.integrations.Core.UploadFile({ file });
      setForm(f => ({ ...f, receipt_url: file_url }));
    } catch (err) {
      toast({ title: ui("Upload failed"), description: err.message, variant: "destructive" });
    }
    setUploading(false);
  }

  async function handleSave(submit) {
    if (!form.title || !Number(form.amount)) {
      toast({ title: ui("Add a title and amount"), variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const dept = departments.find(d => d.id === form.department_id);
      await erp.entities.ExpenseRequest.create({
        ...form,
        amount: Number(form.amount),
        request_number: `EXP-${Date.now().toString(36).toUpperCase()}`,
        requester_id: employee?.id || "",
        requester_name: employee?.full_name || "",
        department_name: dept?.name || "",
        status: submit ? "pending_approval" : "draft",
      });
      toast({ title: submit ? ui("Request submitted") : ui("Draft saved") });
      setForm({ title: "", amount: "", category: "other", department_id: departmentId || "", request_date: new Date().toISOString().slice(0, 10), justification: "", receipt_url: "" });
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast({ title: ui("Error"), description: e.message, variant: "destructive" });
    }
    setSaving(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{ui("New Expense Request")}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>{ui("What is it for? *")}</Label>
            <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder={ui("e.g. Fuel for delivery truck")} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{ui("Amount (XAF) *")}</Label>
              <Input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
            </div>
            <div>
              <Label>{ui("Date")}</Label>
              <Input type="date" value={form.request_date} onChange={e => setForm(f => ({ ...f, request_date: e.target.value }))} />
            </div>
            <div>
              <Label>{ui("Category")}</Label>
              <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{EXPENSE_CATEGORIES.map(c => <SelectItem key={c} value={c}>{statusLabel(c)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>{ui("Department")}</Label>
              <Select value={form.department_id} onValueChange={v => setForm(f => ({ ...f, department_id: v }))}>
                <SelectTrigger><SelectValue placeholder={ui("Select")} /></SelectTrigger>
                <SelectContent>{departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>{ui("Justification")}</Label>
            <Textarea rows={3} value={form.justification} onChange={e => setForm(f => ({ ...f, justification: e.target.value }))} placeholder={ui("Why is this needed?")} />
          </div>
          <div>
            <Label className="flex items-center gap-1"><Paperclip size={13} />{ui(" Receipt / Quote")}</Label>
            <Input type="file" onChange={handleUpload} />
            {uploading && <p className="text-xs text-slate-500 mt-1">{ui("Uploading…")}</p>}
            {form.receipt_url && <a href={form.receipt_url} target="_blank" rel="noreferrer" className="text-xs text-blue-600 underline">{ui("Attached file")}</a>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleSave(false)} disabled={saving}>{ui("Save Draft")}</Button>
          <Button onClick={() => handleSave(true)} disabled={saving}>{ui("Submit for Approval")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}