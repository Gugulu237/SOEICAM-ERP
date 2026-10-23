
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState, useEffect } from "react";
import { erp } from "@/api/erpClient";
import { formatDateTime } from "@/lib/formatters";
import PageHeader from "@/components/shared/PageHeader";
import DataTable from "@/components/shared/DataTable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Plus, Pencil } from "lucide-react";
import { Link } from '@/lib/router';
import WarehouseDialog from "@/components/admin/WarehouseDialog";
import DepartmentDialog from "@/components/admin/DepartmentDialog";
import CompanyProfileSettings from "@/components/admin/CompanyProfileSettings";
import AuditSourceBadge from "@/components/shared/AuditSourceBadge";

export default function Administration() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [auditLogs, setAuditLogs] = useState([]);
  const [branches, setBranches] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [warehouseDialog, setWarehouseDialog] = useState({ open: false, record: null });
  const [departmentDialog, setDepartmentDialog] = useState({ open: false, record: null });

  useEffect(() => { loadData(); }, []);

  function loadData() {
    Promise.all([
      erp.entities.AuditLog.list("-created_date", 100),
      erp.entities.Branch.filter({}),
      erp.entities.Warehouse.filter({}),
      erp.entities.Department.filter({}),
    ]).then(([a, b, w, d]) => {
      setAuditLogs(a);
      setBranches(b);
      setWarehouses(w);
      setDepartments(d);
    }).finally(() => setLoading(false));
  }

  const auditCols = [
    { key: "created_date", label: ui("Time"), render: v => formatDateTime(v) },
    { key: "user_name", label: ui("Recorded by"), render: (value, row) => <div><span>{value || row.user_id || '—'}</span>{value && row.user_id && <div className="text-xs text-slate-500" title={ui("Recorded account ID")}>{row.user_id}</div>}</div> },
    { key: "audit_source", label: ui("Record source"), render: (_, row) => <AuditSourceBadge event={row} /> },
    { key: "module", label: ui("Module") },
    { key: "action", label: ui("Action") },
    { key: "description", label: ui("Description") },
  ];

  const branchCols = [
    { key: "code", label: ui("Code") },
    { key: "name", label: ui("Name") },
    { key: "city", label: ui("City") },
  ];

  const warehouseCols = [
    { key: "code", label: ui("Code") },
    { key: "name", label: ui("Name") },
    { key: "warehouse_type", label: ui("Type"), render: v => (v || "").replace(/_/g, " ") },
    { key: "address", label: ui("Location") },
    { key: "is_active", label: ui("Status"), render: v => v === false ? <span className="text-red-500">{ui("Inactive")}</span> : <span className="text-emerald-600">{ui("Active")}</span> },
    { key: "id", label: "", render: (_, row) => <button onClick={e => { e.stopPropagation(); setWarehouseDialog({ open: true, record: row }); }} className="p-1 text-slate-400 hover:text-slate-700"><Pencil size={14} /></button> },
  ];

  const departmentCols = [
    { key: "code", label: ui("Code") },
    { key: "name", label: ui("Name") },
    { key: "is_active", label: ui("Status"), render: v => v === false ? <span className="text-red-500">{ui("Inactive")}</span> : <span className="text-emerald-600">{ui("Active")}</span> },
    { key: "id", label: "", render: (_, row) => <button onClick={e => { e.stopPropagation(); setDepartmentDialog({ open: true, record: row }); }} className="p-1 text-slate-400 hover:text-slate-700"><Pencil size={14} /></button> },
  ];

  if (loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-primary rounded-full animate-spin" /></div>;

  return (
    <div>
      <PageHeader title={ui("Administration")} subtitle={ui("Company settings, audit log and structure")} />
      <Tabs defaultValue="settings">
        <TabsList>
          <TabsTrigger value="settings">{ui("Company Settings")}</TabsTrigger>
          <TabsTrigger value="staff">{ui("Staff Access")}</TabsTrigger>
          <TabsTrigger value="structure">{ui("Structure")}</TabsTrigger>
          <TabsTrigger value="audit">{ui("Audit Log")}</TabsTrigger>
        </TabsList>

        <TabsContent value="settings" className="mt-4">
          <CompanyProfileSettings />
        </TabsContent>

        <TabsContent value="staff" className="mt-4">
          <section className="max-w-2xl rounded-xl border bg-white p-6"><h2 className="text-lg font-semibold">{ui("Employee invitations and roles")}</h2><p className="mt-2 text-sm leading-6 text-slate-600">{ui("Create a staff profile, choose its system role and email address, then send a sign-up invitation. The employee receives access only after signing in with the verified invited email. Edit their role or suspend their profile in Employees whenever responsibilities change.")}</p><Button asChild className="mt-4"><Link to="/employees">{ui("Manage employee access")}</Link></Button></section>
        </TabsContent>

        <TabsContent value="structure" className="mt-4">
          <div className="space-y-6">
            <div>
              <h3 className="font-semibold text-slate-900 mb-3">{ui("Branches")}</h3>
              <DataTable columns={branchCols} data={branches} />
            </div>
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-slate-900">{ui("Warehouses & Locations")}</h3>
                <Button size="sm" variant="outline" onClick={() => setWarehouseDialog({ open: true, record: null })}><Plus size={14} className="mr-1" />{ui(" Add Location")}</Button>
              </div>
              <p className="text-xs text-slate-500 mb-3">{ui("Operational locations where goods are delivered or operations are carried out — not only storage warehouses.")}</p>
              <DataTable columns={warehouseCols} data={warehouses} />
            </div>
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-slate-900">{ui("Departments")}</h3>
                <Button size="sm" variant="outline" onClick={() => setDepartmentDialog({ open: true, record: null })}><Plus size={14} className="mr-1" />{ui(" Add Department")}</Button>
              </div>
              <p className="text-xs text-slate-500 mb-3">{ui("Factory departments that can request purchases.")}</p>
              <DataTable columns={departmentCols} data={departments} />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="audit" className="mt-4">
          <p className="mb-3 text-sm text-slate-600">{ui("Each audit entry identifies its recorded account and verification source.")}</p>
          <DataTable columns={auditCols} data={auditLogs} searchFields={["user_name", "module", "action", "description"]} />
        </TabsContent>
      </Tabs>

      <WarehouseDialog
        open={warehouseDialog.open}
        onOpenChange={o => setWarehouseDialog(d => ({ ...d, open: o }))}
        warehouse={warehouseDialog.record}
        branches={branches}
        onSaved={loadData}
      />
      <DepartmentDialog
        open={departmentDialog.open}
        onOpenChange={o => setDepartmentDialog(d => ({ ...d, open: o }))}
        department={departmentDialog.record}
        branches={branches}
        onSaved={loadData}
      />
    </div>
  );
}
