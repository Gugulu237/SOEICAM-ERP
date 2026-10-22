
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState, useEffect } from "react";
import { erp } from "@/api/erpClient";
import DataTable from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { formatXAF } from "@/lib/formatters";
import { Plus } from "lucide-react";

// Budget vs actuals per department and accounting period.
export default function BudgetManager() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const { toast } = useToast();
  const [budgets, setBudgets] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ department_id: "", period_id: "", budget_amount: "" });

  useEffect(() => { load(); }, []);

  async function load() {
    const [b, d, p] = await Promise.all([
      erp.entities.Budget.filter({}),
      erp.entities.Department.filter({ is_active: true }),
      erp.entities.AccountingPeriod.filter({}),
    ]);
    setBudgets(b); setDepartments(d); setPeriods(p);
  }

  async function handleSave() {
    if (!form.department_id || !form.period_id || !Number(form.budget_amount)) {
      toast({ title: ui("Fill in department, period and amount"), variant: "destructive" });
      return;
    }
    const dept = departments.find(d => d.id === form.department_id);
    const period = periods.find(p => p.id === form.period_id);
    const amount = Number(form.budget_amount);
    await erp.entities.Budget.create({
      department_id: form.department_id, department_name: dept?.name || "",
      period_id: form.period_id, period_name: period?.name || "",
      budget_amount: amount, actual_spent: 0, remaining_amount: amount,
    });
    toast({ title: ui("Budget set") });
    setForm({ department_id: "", period_id: "", budget_amount: "" });
    setOpen(false);
    load();
  }

  const cols = [
    { key: "department_name", label: ui("Department") },
    { key: "period_name", label: ui("Period") },
    { key: "budget_amount", label: ui("Budget"), render: v => formatXAF(v), className: "text-right" },
    { key: "actual_spent", label: ui("Spent"), render: v => formatXAF(v), className: "text-right" },
    {
      key: "remaining_amount", label: ui("Remaining"),
      render: (v, row) => {
        const remaining = (row.budget_amount || 0) - (row.actual_spent || 0);
        return <span className={remaining < 0 ? "text-red-600 font-semibold" : "text-green-700 font-medium"}>{formatXAF(remaining)}</span>;
      },
      className: "text-right",
    },
    {
      key: "id", label: ui("Usage"),
      render: (_v, row) => {
        const pct = row.budget_amount > 0 ? Math.min(100, ((row.actual_spent || 0) / row.budget_amount) * 100) : 0;
        const over = (row.actual_spent || 0) > (row.budget_amount || 0);
        return (
          <div className="w-32">
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
              <div className={`h-full rounded-full ${over ? "bg-red-500" : pct > 80 ? "bg-orange-500" : "bg-green-500"}`} style={{ width: `${pct}%` }} />
            </div>
            <span className="text-xs text-slate-500">{pct.toFixed(0)}%</span>
          </div>
        );
      },
    },
  ];

  return (
    <div>
      <div className="flex justify-end mb-3">
        <Button size="sm" onClick={() => setOpen(true)}><Plus size={14} className="mr-1" />{ui(" Set Budget")}</Button>
      </div>
      <DataTable columns={cols} data={budgets} searchFields={["department_name", "period_name"]} />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{ui("Set Department Budget")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>{ui("Department *")}</Label>
              <Select value={form.department_id} onValueChange={v => setForm(f => ({ ...f, department_id: v }))}>
                <SelectTrigger><SelectValue placeholder={ui("Select")} /></SelectTrigger>
                <SelectContent>{departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>{ui("Period *")}</Label>
              <Select value={form.period_id} onValueChange={v => setForm(f => ({ ...f, period_id: v }))}>
                <SelectTrigger><SelectValue placeholder={ui("Select")} /></SelectTrigger>
                <SelectContent>{periods.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>{ui("Budget Amount (XAF) *")}</Label>
              <Input type="number" value={form.budget_amount} onChange={e => setForm(f => ({ ...f, budget_amount: e.target.value }))} />
            </div>
          </div>
          <DialogFooter><Button onClick={handleSave}>{ui("Save Budget")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}