import React, { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { formatXAF } from "@/lib/formatters";
import { ROLE_CATEGORIES, ROLE_DEFINITIONS, roleLabel } from "@/lib/permissions";
import PageHeader from "@/components/shared/PageHeader";
import DataTable from "@/components/shared/DataTable";
import StatusBadge from "@/components/shared/StatusBadge";
import RoleBadge from "@/components/employees/RoleBadge";
import RoleAccessReference from "@/components/employees/RoleAccessReference";
import EmployeeFormDialog from "@/components/employees/EmployeeFormDialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, ShieldCheck } from "lucide-react";

const CATEGORY_ORDER = ["All", ...ROLE_CATEGORIES];

export default function Employees() {
  const [employees, setEmployees] = useState([]);
  const [counts, setCounts] = useState({});
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState("All");
  const [roleFilter, setRoleFilter] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [showRoles, setShowRoles] = useState(false);

  const load = useCallback(async () => {
    const query = roleFilter !== "all"
      ? { role: roleFilter }
      : category !== "All"
        ? { role: { $in: ROLE_DEFINITIONS.filter(r => r.category === category).map(r => r.key) } }
        : {};
    const [page, byRole] = await Promise.all([
      base44.entities.Employee.filter(query, { sort: "-created_date", limit: 200 }),
      base44.entities.Employee.aggregate({ groupBy: "role" }),
    ]);
    setEmployees(page.items);
    const rows = byRole.rows || [];
    setTotal(rows.reduce((sum, r) => sum + r.count, 0));
    const next = {};
    rows.forEach(r => { next[r.role] = r.count; });
    setCounts(next);
  }, [category, roleFilter]);

  useEffect(() => { setLoading(true); load().finally(() => setLoading(false)); }, [load]);

  const categoryCount = (cat) => cat === "All"
    ? total
    : ROLE_DEFINITIONS.filter(r => r.category === cat).reduce((sum, r) => sum + (counts[r.key] || 0), 0);

  const cols = [
    { key: "employee_number", label: "#" },
    { key: "full_name", label: "Name" },
    { key: "job_title", label: "Job Title" },
    { key: "role", label: "Role", render: v => <RoleBadge role={v} /> },
    {
      key: "responsibilities", label: "Responsibilities", sortable: false,
      render: (v) => v
        ? <span className="block max-w-[320px] truncate text-slate-600" title={v}>{v}</span>
        : <span className="text-slate-300">—</span>,
    },
    { key: "user_id", label: "Account", sortable: false, render: v => v
      ? <span className="text-xs text-emerald-600">linked</span>
      : <span className="text-xs text-slate-400">not linked</span> },
    { key: "contract_type", label: "Contract", render: v => <StatusBadge status={v} /> },
    { key: "base_salary", label: "Salary", render: v => formatXAF(v), className: "text-right" },
    { key: "status", label: "Status", render: v => <StatusBadge status={v} /> },
  ];

  const openNew = () => { setEditing(null); setShowForm(true); };
  const openEdit = (row) => { setEditing(row); setShowForm(true); };

  if (loading && employees.length === 0) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;

  return (
    <div>
      <PageHeader
        title="Employees"
        subtitle={`${total} employees · ${ROLE_DEFINITIONS.length} system roles`}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setShowRoles(true)}><ShieldCheck size={16} className="mr-1" /> Roles & Access</Button>
            <Button onClick={openNew}><Plus size={16} className="mr-1" /> New Employee</Button>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {CATEGORY_ORDER.map(cat => (
          <button
            key={cat}
            onClick={() => { setCategory(cat); setRoleFilter("all"); }}
            className={`rounded-full border px-3 py-1.5 text-sm transition ${
              category === cat
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
            }`}
          >
            {cat} <span className={category === cat ? "text-white/70" : "text-slate-400"}>{categoryCount(cat)}</span>
          </button>
        ))}
        <div className="ml-auto w-56">
          <Select value={roleFilter} onValueChange={(v) => { setRoleFilter(v); setCategory("All"); }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All roles</SelectItem>
              {ROLE_DEFINITIONS.map(r => (
                <SelectItem key={r.key} value={r.key}>{roleLabel(r.key)} ({counts[r.key] || 0})</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <DataTable
        columns={cols}
        data={employees}
        searchFields={["full_name", "job_title", "employee_number"]}
        onRowClick={openEdit}
        emptyMessage="No employees in this category yet"
      />

      <EmployeeFormDialog
        open={showForm}
        onOpenChange={setShowForm}
        employee={editing}
        employees={employees}
        onSaved={load}
      />
      <RoleAccessReference open={showRoles} onOpenChange={setShowRoles} />
    </div>
  );
}