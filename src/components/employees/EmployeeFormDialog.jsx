import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { ROLE_DEFINITIONS, roleDefinition } from "@/lib/permissions";
import { Save } from "lucide-react";

const EMPTY = {
  full_name: "", job_title: "", role: "", responsibilities: "", phone: "", email: "",
  contract_type: "permanent", base_salary: 0, payment_method: "bank_transfer", status: "active",
  user_id: "", user_email: "",
};

const CONTRACTS = ["permanent", "temporary", "daily", "intern", "contractor"];
const STATUSES = ["active", "on_leave", "suspended", "terminated"];

export default function EmployeeFormDialog({ open, onOpenChange, employee, employees, onSaved }) {
  const [form, setForm] = useState(EMPTY);
  const [users, setUsers] = useState([]);
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;
    setForm(employee ? { ...EMPTY, ...employee } : EMPTY);
    base44.entities.User.list().then(res => setUsers(Array.isArray(res) ? res : res?.items || []));
  }, [open, employee]);

  const dutiesOf = (key) => (roleDefinition(key)?.duties || []).join(" • ");

  const set = (field) => (value) => setForm(f => ({ ...f, [field]: value }));

  // Picking a role prefills its standard duties, without wiping a custom description.
  const changeRole = (key) => setForm(f => {
    const previousDefault = f.role ? dutiesOf(f.role) : "";
    const keepCustom = f.responsibilities && f.responsibilities !== previousDefault;
    return { ...f, role: key, responsibilities: keepCustom ? f.responsibilities : dutiesOf(key) };
  });

  // A system role is required, so legacy free-text roles get re-categorised on save.
  const valid = form.full_name.trim() && form.job_title.trim() && !!roleDefinition(form.role);

  const save = async () => {
    if (!valid) return;
    const linked = users.find(u => u.id === form.user_id);
    const payload = {
      full_name: form.full_name.trim(),
      job_title: form.job_title.trim(),
      role: form.role,
      responsibilities: form.responsibilities,
      phone: form.phone,
      email: form.email,
      contract_type: form.contract_type,
      base_salary: Number(form.base_salary) || 0,
      payment_method: form.payment_method,
      status: form.status,
      user_id: form.user_id,
      user_email: linked?.email || "",
    };
    if (employee?.id) {
      await base44.entities.Employee.update(employee.id, payload);
    } else {
      await base44.entities.Employee.create({
        ...payload,
        employee_number: `E-${String(employees.length + 1).padStart(4, "0")}`,
        start_date: new Date().toISOString().split("T")[0],
      });
    }
    toast({ title: employee ? "Employee updated" : "Employee created" });
    onOpenChange(false);
    onSaved();
  };

  const currentRole = roleDefinition(form.role);
  const legacyRole = form.role && !currentRole ? form.role : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{employee ? "Edit Employee" : "New Employee"}</DialogTitle>
          <DialogDescription>Set the role and responsibilities that decide this person's access.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label>Full Name *</Label>
            <Input value={form.full_name} onChange={e => set("full_name")(e.target.value)} />
          </div>
          <div>
            <Label>Job Title *</Label>
            <Input value={form.job_title} onChange={e => set("job_title")(e.target.value)} placeholder="e.g. Salesperson, Driver" />
          </div>
          <div>
            <Label>System Role *</Label>
            <Select value={form.role} onValueChange={changeRole}>
              <SelectTrigger><SelectValue placeholder="Select a role" /></SelectTrigger>
              <SelectContent>
                {legacyRole && <SelectItem value={legacyRole}>{legacyRole} (not a system role)</SelectItem>}
                {ROLE_DEFINITIONS.map(r => (
                  <SelectItem key={r.key} value={r.key}>{r.label} — {r.category}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="col-span-2">
            <Label>Responsibilities</Label>
            <Textarea
              rows={3}
              value={form.responsibilities}
              onChange={e => set("responsibilities")(e.target.value)}
              placeholder={currentRole ? currentRole.summary : "Prefilled from the role — adjust if needed"}
            />
            {currentRole && <p className="mt-1 text-xs text-slate-500">{currentRole.summary}</p>}
          </div>

          <div className="col-span-2">
            <Label>Linked user account</Label>
            <Select value={form.user_id || "none"} onValueChange={v => set("user_id")(v === "none" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="Not linked" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not linked</SelectItem>
                {users.map(u => <SelectItem key={u.id} value={u.id}>{u.full_name || u.email}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-slate-500">Linking the account is what gives this person the role's access when they sign in.</p>
          </div>

          <div>
            <Label>Phone</Label>
            <Input value={form.phone} onChange={e => set("phone")(e.target.value)} />
          </div>
          <div>
            <Label>Email</Label>
            <Input value={form.email} onChange={e => set("email")(e.target.value)} />
          </div>
          <div>
            <Label>Contract Type</Label>
            <Select value={form.contract_type} onValueChange={set("contract_type")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CONTRACTS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Status</Label>
            <Select value={form.status} onValueChange={set("status")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Base Salary (XAF)</Label>
            <Input type="number" value={form.base_salary} onChange={e => set("base_salary")(e.target.value)} />
          </div>
          <div>
            <Label>Payment Method</Label>
            <Select value={form.payment_method} onValueChange={set("payment_method")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{["bank_transfer", "mobile_money", "cash"].map(m => <SelectItem key={m} value={m}>{m.replace("_", " ")}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>

        <Button className="mt-4" onClick={save} disabled={!valid}>
          <Save size={16} className="mr-1" /> {employee ? "Save changes" : "Create employee"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}