import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate } from "react-router-dom";
import { formatXAF } from "@/lib/formatters";
import PageHeader from "@/components/shared/PageHeader";
import DataTable from "@/components/shared/DataTable";
import StatusBadge from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { Plus, Save } from "lucide-react";

export default function Employees() {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ full_name: "", phone: "", email: "", job_title: "", contract_type: "permanent", base_salary: 0, payment_method: "bank_transfer", role: "" });
  const { toast } = useToast();

  useEffect(() => { loadData(); }, []);
  async function loadData() { base44.entities.Employee.filter({}).then(setEmployees).finally(() => setLoading(false)); }

  async function handleSave() {
    if (!form.full_name || !form.job_title) return;
    const count = employees.length;
    await base44.entities.Employee.create({ ...form, employee_number: `E-${String(count + 1).padStart(4, "0")}`, start_date: new Date().toISOString().split("T")[0] });
    toast({ title: "Employee created" });
    setShowForm(false);
    setForm({ full_name: "", phone: "", email: "", job_title: "", contract_type: "permanent", base_salary: 0, payment_method: "bank_transfer", role: "" });
    loadData();
  }

  const cols = [
    { key: "employee_number", label: "#" },
    { key: "full_name", label: "Name" },
    { key: "job_title", label: "Title" },
    { key: "role", label: "Role" },
    { key: "contract_type", label: "Contract", render: v => <StatusBadge status={v} /> },
    { key: "base_salary", label: "Salary", render: v => formatXAF(v), className: "text-right" },
    { key: "status", label: "Status", render: v => <StatusBadge status={v} /> },
  ];

  if (loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;

  return (
    <div>
      <PageHeader title="Employees" subtitle={`${employees.length} employees`} actions={<Button onClick={() => setShowForm(true)}><Plus size={16} className="mr-1" /> New Employee</Button>} />
      <DataTable columns={cols} data={employees} searchFields={["full_name", "job_title", "employee_number"]} />
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Employee</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Label>Full Name *</Label><Input value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} /></div>
            <div><Label>Job Title *</Label><Input value={form.job_title} onChange={e => setForm(f => ({ ...f, job_title: e.target.value }))} /></div>
            <div><Label>Role</Label><Input value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} placeholder="e.g. Salesperson, Driver" /></div>
            <div><Label>Phone</Label><Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} /></div>
            <div><Label>Email</Label><Input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
            <div><Label>Contract Type</Label><Select value={form.contract_type} onValueChange={v => setForm(f => ({ ...f, contract_type: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["permanent", "temporary", "daily", "intern", "contractor"].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select></div>
            <div><Label>Base Salary (XAF)</Label><Input type="number" value={form.base_salary} onChange={e => setForm(f => ({ ...f, base_salary: Number(e.target.value) }))} /></div>
          </div>
          <Button className="mt-4" onClick={handleSave}><Save size={16} className="mr-1" /> Save</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}