import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate } from "react-router-dom";
import { formatXAF, formatDate } from "@/lib/formatters";
import PageHeader from "@/components/shared/PageHeader";
import DataTable from "@/components/shared/DataTable";
import StatusBadge from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { Plus, Calculator, CheckCircle, FileText } from "lucide-react";

export default function Payroll() {
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => { loadData(); }, []);
  async function loadData() { base44.entities.PayrollRun.list("-created_date", 50).then(setRuns).finally(() => setLoading(false)); }

  async function handleCreate() {
    const run = await base44.entities.PayrollRun.create({
      period_name: `${year}-${String(month).padStart(2, "0")}`,
      month, year, status: "draft"
    });

    // Auto-populate with all active employees
    const employees = await base44.entities.Employee.filter({ status: "active" });
    for (const emp of employees) {
      const gross = emp.base_salary || 0;
      const statutory = Math.round(gross * 0.042); // Simplified CNPS employee contribution
      const net = gross - statutory;
      await base44.entities.PayrollLine.create({
        payroll_id: run.id, employee_id: emp.id, employee_name: emp.full_name,
        base_salary: emp.base_salary || 0, gross_pay: gross,
        statutory_deductions: statutory, net_pay: net
      });
    }
    await base44.entities.PayrollRun.update(run.id, {
      status: "calculated", employee_count: employees.length,
      total_gross: employees.reduce((s, e) => s + (e.base_salary || 0), 0),
      total_deductions: employees.reduce((s, e) => s + Math.round((e.base_salary || 0) * 0.042), 0),
      total_net: employees.reduce((s, e) => s + ((e.base_salary || 0) - Math.round((e.base_salary || 0) * 0.042)), 0)
    });

    toast({ title: "Payroll created and calculated" });
    setShowNew(false);
    loadData();
  }

  async function handleApprove(run) {
    await base44.entities.PayrollRun.update(run.id, { status: "approved", approved_at: new Date().toISOString() });
    await base44.entities.AuditLog.create({ action: "approve_payroll", module: "payroll", entity_type: "PayrollRun", entity_id: run.id, description: `Approved payroll ${run.period_name}` });
    toast({ title: "Payroll approved" });
    loadData();
  }

  async function handlePost(run) {
    // Create accounting journal
    const accounts = await base44.entities.Account.filter({});
    const salaryExpAccount = accounts.find(a => a.account_number === "6100");
    const salaryPayableAccount = accounts.find(a => a.account_number === "4200");

    if (salaryExpAccount && salaryPayableAccount) {
      const settings = (await base44.entities.CompanySettings.filter({}))[0];
      const jNum = settings?.next_journal_number || 1;
      const journal = await base44.entities.JournalEntry.create({
        journal_number: `JE-${String(jNum).padStart(5, "0")}`,
        entry_date: new Date().toISOString().split("T")[0],
        description: `Payroll ${run.period_name}`,
        source_module: "payroll", source_document_type: "PayrollRun",
        source_document_id: run.id, status: "posted",
        total_debit: run.total_gross, total_credit: run.total_gross,
        is_immutable: true, posted_at: new Date().toISOString()
      });
      if (settings) await base44.entities.CompanySettings.update(settings.id, { next_journal_number: jNum + 1 });

      await base44.entities.JournalLine.create({
        journal_id: journal.id, account_id: salaryExpAccount.id,
        account_number: "6100", account_name: salaryExpAccount.name,
        debit: run.total_gross, credit: 0, description: "Salary expense"
      });
      await base44.entities.JournalLine.create({
        journal_id: journal.id, account_id: salaryPayableAccount.id,
        account_number: "4200", account_name: salaryPayableAccount.name,
        debit: 0, credit: run.total_gross, description: "Salaries payable"
      });

      await base44.entities.PayrollRun.update(run.id, { status: "posted", journal_id: journal.id });
    }

    await base44.entities.AuditLog.create({ action: "post_payroll", module: "payroll", entity_type: "PayrollRun", entity_id: run.id, description: `Posted payroll ${run.period_name}: ${formatXAF(run.total_gross)}` });
    toast({ title: "Payroll posted to accounting" });
    loadData();
  }

  const cols = [
    { key: "period_name", label: "Period" },
    { key: "employee_count", label: "Employees", className: "text-right" },
    { key: "total_gross", label: "Gross", render: v => formatXAF(v), className: "text-right" },
    { key: "total_deductions", label: "Deductions", render: v => formatXAF(v), className: "text-right" },
    { key: "total_net", label: "Net Pay", render: v => formatXAF(v), className: "text-right" },
    { key: "status", label: "Status", render: v => <StatusBadge status={v} /> },
    { key: "id", label: "Actions", sortable: false, render: (_, row) => (
      <div className="flex gap-1">
        {row.status === "calculated" && <Button size="sm" variant="outline" onClick={e => { e.stopPropagation(); handleApprove(row); }}><CheckCircle size={12} className="mr-1" /> Approve</Button>}
        {row.status === "approved" && <Button size="sm" variant="outline" onClick={e => { e.stopPropagation(); handlePost(row); }}><FileText size={12} className="mr-1" /> Post</Button>}
      </div>
    )},
  ];

  if (loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;

  return (
    <div>
      <PageHeader title="Payroll" subtitle={`${runs.length} payroll runs`} actions={<Button onClick={() => setShowNew(true)}><Plus size={16} className="mr-1" /> New Payroll Run</Button>} />
      <DataTable columns={cols} data={runs} searchFields={["period_name"]} />
      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create Payroll Run</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Month</Label><Input type="number" min={1} max={12} value={month} onChange={e => setMonth(Number(e.target.value))} /></div>
            <div><Label>Year</Label><Input type="number" value={year} onChange={e => setYear(Number(e.target.value))} /></div>
          </div>
          <Button className="mt-4" onClick={handleCreate}><Calculator size={16} className="mr-1" /> Create & Calculate</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}