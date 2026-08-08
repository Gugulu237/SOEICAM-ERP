import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { formatDateTime } from "@/lib/formatters";
import PageHeader from "@/components/shared/PageHeader";
import DataTable from "@/components/shared/DataTable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { Save, Plus, Pencil } from "lucide-react";
import WarehouseDialog from "@/components/admin/WarehouseDialog";
import DepartmentDialog from "@/components/admin/DepartmentDialog";

export default function Administration() {
  const [settings, setSettings] = useState(null);
  const [auditLogs, setAuditLogs] = useState([]);
  const [branches, setBranches] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [warehouseDialog, setWarehouseDialog] = useState({ open: false, record: null });
  const [departmentDialog, setDepartmentDialog] = useState({ open: false, record: null });
  const { toast } = useToast();

  useEffect(() => { loadData(); }, []);

  function loadData() {
    Promise.all([
      base44.entities.CompanySettings.filter({}),
      base44.entities.AuditLog.list("-created_date", 100),
      base44.entities.Branch.filter({}),
      base44.entities.Warehouse.filter({}),
      base44.entities.Department.filter({}),
    ]).then(([s, a, b, w, d]) => {
      setSettings(s[0] || null);
      setAuditLogs(a);
      setBranches(b);
      setWarehouses(w);
      setDepartments(d);
    }).finally(() => setLoading(false));
  }

  async function saveSettings() {
    if (settings?.id) {
      await base44.entities.CompanySettings.update(settings.id, settings);
    }
    toast({ title: "Settings saved" });
  }

  const auditCols = [
    { key: "created_date", label: "Time", render: v => formatDateTime(v) },
    { key: "user_name", label: "User" },
    { key: "module", label: "Module" },
    { key: "action", label: "Action" },
    { key: "description", label: "Description" },
  ];

  const branchCols = [
    { key: "code", label: "Code" },
    { key: "name", label: "Name" },
    { key: "city", label: "City" },
  ];

  const warehouseCols = [
    { key: "code", label: "Code" },
    { key: "name", label: "Name" },
    { key: "warehouse_type", label: "Type", render: v => (v || "").replace(/_/g, " ") },
    { key: "address", label: "Location" },
    { key: "is_active", label: "Status", render: v => v === false ? <span className="text-red-500">Inactive</span> : <span className="text-emerald-600">Active</span> },
    { key: "id", label: "", render: (_, row) => <button onClick={e => { e.stopPropagation(); setWarehouseDialog({ open: true, record: row }); }} className="p-1 text-slate-400 hover:text-slate-700"><Pencil size={14} /></button> },
  ];

  const departmentCols = [
    { key: "code", label: "Code" },
    { key: "name", label: "Name" },
    { key: "is_active", label: "Status", render: v => v === false ? <span className="text-red-500">Inactive</span> : <span className="text-emerald-600">Active</span> },
    { key: "id", label: "", render: (_, row) => <button onClick={e => { e.stopPropagation(); setDepartmentDialog({ open: true, record: row }); }} className="p-1 text-slate-400 hover:text-slate-700"><Pencil size={14} /></button> },
  ];

  if (loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;

  return (
    <div>
      <PageHeader title="Administration" subtitle="Company Settings · Audit Log · Structure" />
      <Tabs defaultValue="settings">
        <TabsList>
          <TabsTrigger value="settings">Company Settings</TabsTrigger>
          <TabsTrigger value="structure">Structure</TabsTrigger>
          <TabsTrigger value="audit">Audit Log</TabsTrigger>
        </TabsList>

        <TabsContent value="settings" className="mt-4">
          {settings && (
            <div className="bg-white rounded-xl border border-slate-200 p-6 max-w-2xl">
              <div className="grid grid-cols-2 gap-4">
                <div><Label>Company Name</Label><Input value={settings.company_name || ""} onChange={e => setSettings(s => ({ ...s, company_name: e.target.value }))} /></div>
                <div><Label>Brand</Label><Input value={settings.brand_name || ""} onChange={e => setSettings(s => ({ ...s, brand_name: e.target.value }))} /></div>
                <div><Label>Currency</Label><Input value={settings.currency || "XAF"} onChange={e => setSettings(s => ({ ...s, currency: e.target.value }))} /></div>
                <div><Label>Timezone</Label><Input value={settings.timezone || ""} onChange={e => setSettings(s => ({ ...s, timezone: e.target.value }))} /></div>
                <div><Label>Fiscal Year Start Month</Label><Input type="number" value={settings.fiscal_year_start_month || 1} onChange={e => setSettings(s => ({ ...s, fiscal_year_start_month: Number(e.target.value) }))} /></div>
                <div><Label>Phone</Label><Input value={settings.phone || ""} onChange={e => setSettings(s => ({ ...s, phone: e.target.value }))} /></div>
                <div className="col-span-2"><Label>Address</Label><Input value={settings.address || ""} onChange={e => setSettings(s => ({ ...s, address: e.target.value }))} /></div>
              </div>
              <Button className="mt-4" onClick={saveSettings}><Save size={16} className="mr-1" /> Save Settings</Button>
            </div>
          )}
        </TabsContent>

        <TabsContent value="structure" className="mt-4">
          <div className="space-y-6">
            <div>
              <h3 className="font-semibold text-slate-900 mb-3">Branches</h3>
              <DataTable columns={branchCols} data={branches} />
            </div>
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-slate-900">Warehouses & Locations</h3>
                <Button size="sm" variant="outline" onClick={() => setWarehouseDialog({ open: true, record: null })}><Plus size={14} className="mr-1" /> Add Location</Button>
              </div>
              <p className="text-xs text-slate-500 mb-3">Operational locations where goods are delivered or operations are carried out — not only storage warehouses.</p>
              <DataTable columns={warehouseCols} data={warehouses} />
            </div>
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-slate-900">Departments</h3>
                <Button size="sm" variant="outline" onClick={() => setDepartmentDialog({ open: true, record: null })}><Plus size={14} className="mr-1" /> Add Department</Button>
              </div>
              <p className="text-xs text-slate-500 mb-3">Factory departments that can request purchases.</p>
              <DataTable columns={departmentCols} data={departments} />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="audit" className="mt-4">
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