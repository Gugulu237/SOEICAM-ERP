import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
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
    base44.entities.Department.filter({ is_active: true }).then(setDepartments);
    setForm(f => ({ ...f, department_id: departmentId || "" }));
  }, [open, departmentId]);

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setForm(f => ({ ...f, receipt_url: file_url }));
    } catch (err) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    }
    setUploading(false);
  }

  async function handleSave(submit) {
    if (!form.title || !Number(form.amount)) {
      toast({ title: "Add a title and amount", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const dept = departments.find(d => d.id === form.department_id);
      await base44.entities.ExpenseRequest.create({
        ...form,
        amount: Number(form.amount),
        request_number: `EXP-${Date.now().toString(36).toUpperCase()}`,
        requester_id: employee?.id || "",
        requester_name: employee?.full_name || "",
        department_name: dept?.name || "",
        status: submit ? "pending_approval" : "draft",
      });
      toast({ title: submit ? "Request submitted" : "Draft saved" });
      setForm({ title: "", amount: "", category: "other", department_id: departmentId || "", request_date: new Date().toISOString().slice(0, 10), justification: "", receipt_url: "" });
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
    setSaving(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>New Expense Request</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>What is it for? *</Label>
            <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Fuel for delivery truck" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Amount (XAF) *</Label>
              <Input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
            </div>
            <div>
              <Label>Date</Label>
              <Input type="date" value={form.request_date} onChange={e => setForm(f => ({ ...f, request_date: e.target.value }))} />
            </div>
            <div>
              <Label>Category</Label>
              <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{EXPENSE_CATEGORIES.map(c => <SelectItem key={c} value={c}>{statusLabel(c)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Department</Label>
              <Select value={form.department_id} onValueChange={v => setForm(f => ({ ...f, department_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Justification</Label>
            <Textarea rows={3} value={form.justification} onChange={e => setForm(f => ({ ...f, justification: e.target.value }))} placeholder="Why is this needed?" />
          </div>
          <div>
            <Label className="flex items-center gap-1"><Paperclip size={13} /> Receipt / Quote</Label>
            <Input type="file" onChange={handleUpload} />
            {uploading && <p className="text-xs text-slate-500 mt-1">Uploading…</p>}
            {form.receipt_url && <a href={form.receipt_url} target="_blank" rel="noreferrer" className="text-xs text-blue-600 underline">Attached file</a>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleSave(false)} disabled={saving}>Save Draft</Button>
          <Button onClick={() => handleSave(true)} disabled={saving}>Submit for Approval</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}