import React, { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate } from "react-router-dom";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { formatXAF, formatDate } from "@/lib/formatters";
import PageHeader from "@/components/shared/PageHeader";
import DataTable from "@/components/shared/DataTable";
import StatusBadge from "@/components/shared/StatusBadge";
import KPICard from "@/components/shared/KPICard";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { Plus, Clock, CheckCircle2, Truck, DollarSign, AlertCircle } from "lucide-react";

const STATUS_TABS = [
  { key: "all", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "pending_approval", label: "Pending Approval" },
  { key: "approved", label: "Approved" },
  { key: "partially_received", label: "Partial" },
  { key: "received", label: "Received" },
  { key: "billed", label: "Paid" },
  { key: "cancelled", label: "Cancelled" },
];

const DATE_RANGES = [
  { key: "all", label: "All Time" },
  { key: "today", label: "Today" },
  { key: "week", label: "This Week" },
  { key: "month", label: "This Month" },
];

const GROUP_OPTIONS = [
  { key: "none", label: "No Grouping" },
  { key: "status", label: "By Status" },
  { key: "requested_department_name", label: "By Department" },
  { key: "supplier_name", label: "By Supplier" },
];

function inRange(dateStr, range) {
  if (!dateStr || range === "all") return true;
  const d = new Date(dateStr);
  const now = new Date();
  if (range === "today") return dateStr === now.toISOString().split("T")[0];
  if (range === "week") {
    const day = now.getDay() || 7;
    const monday = new Date(now);
    monday.setDate(now.getDate() - day + 1);
    monday.setHours(0, 0, 0, 0);
    return d >= monday;
  }
  if (range === "month") return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  return true;
}

export default function Purchases() {
  const { user, departmentId, canViewAllPOs, canApprovePO, loading: userLoading } = useCurrentUser();
  const { toast } = useToast();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateRange, setDateRange] = useState("all");
  const [groupBy, setGroupBy] = useState("none");
  const navigate = useNavigate();

  async function loadData() {
    setLoading(true);
    try {
      let data;
      if (canViewAllPOs) {
        data = await base44.entities.PurchaseOrder.list("-created_date", 200);
      } else {
        data = await base44.entities.PurchaseOrder.filter(
          { requested_department_id: departmentId }, "-created_date", 200
        );
      }
      setOrders(data);
    } catch (e) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
    setLoading(false);
  }

  useEffect(() => {
    if (userLoading) return;
    if (!user) return;
    if (canViewAllPOs || departmentId) {
      loadData();
    } else {
      setLoading(false);
    }
  }, [user, departmentId, canViewAllPOs, userLoading]);

  async function handleSubmit(po) {
    try {
      await base44.entities.PurchaseOrder.update(po.id, { status: "pending_approval" });
      await base44.entities.AuditLog.create({ action: "submit", module: "procurement", entity_type: "PurchaseOrder", entity_id: po.id, description: `Submitted PO ${po.po_number} for approval` });
      toast({ title: "Submitted", description: "Purchase order submitted for approval" });
      loadData();
    } catch (e) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
  }

  async function handleApprove(po) {
    try {
      await base44.entities.PurchaseOrder.update(po.id, { status: "approved", approved_by: user?.full_name || user?.email || "", approved_at: new Date().toISOString() });
      await base44.entities.AuditLog.create({ action: "approve", module: "procurement", entity_type: "PurchaseOrder", entity_id: po.id, user_id: user?.id || "", description: `Approved PO ${po.po_number}` });
      toast({ title: "Approved", description: "PO approved and ready for cashier disbursement" });
      loadData();
    } catch (e) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
  }

  const stats = useMemo(() => ({
    pending: orders.filter(o => o.status === "pending_approval").length,
    approved: orders.filter(o => o.status === "approved").length,
    partial: orders.filter(o => o.status === "partially_received").length,
    received: orders.filter(o => o.status === "received").length,
    totalValue: orders.filter(o => o.status !== "cancelled").reduce((s, o) => s + (o.total || 0), 0),
  }), [orders]);

  const filtered = useMemo(() => {
    return orders.filter(o => {
      if (statusFilter !== "all" && o.status !== statusFilter) return false;
      if (!inRange(o.order_date, dateRange)) return false;
      return true;
    });
  }, [orders, statusFilter, dateRange]);

  const groups = useMemo(() => {
    if (groupBy === "none") return [{ key: null, label: "", items: filtered }];
    const map = {};
    for (const o of filtered) {
      const gk = o[groupBy] || "Unassigned";
      if (!map[gk]) map[gk] = [];
      map[gk].push(o);
    }
    return Object.entries(map).map(([key, items]) => ({ key, label: key, items }));
  }, [filtered, groupBy]);

  const cols = [
    { key: "po_number", label: "PO #" },
    { key: "supplier_name", label: "Supplier" },
    { key: "requested_department_name", label: "Department", render: v => v || "—" },
    { key: "order_date", label: "Date", render: v => formatDate(v) },
    { key: "total", label: "Total", render: v => formatXAF(v), className: "text-right" },
    { key: "status", label: "Status", render: v => <StatusBadge status={v} /> },
    { key: "actions", label: "", sortable: false, className: "text-right", render: (_, row) => (
      <div className="flex justify-end gap-1" onClick={e => e.stopPropagation()}>
        {row.status === "draft" && (
          <Button size="sm" variant="outline" onClick={() => handleSubmit(row)}>Submit</Button>
        )}
        {row.status === "pending_approval" && canApprovePO && (
          <Button size="sm" onClick={() => handleApprove(row)}>Approve</Button>
        )}
      </div>
    )},
  ];

  if (userLoading || loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;

  return (
    <div>
      <PageHeader
        title="Purchase Orders"
        subtitle={canViewAllPOs ? `${orders.length} total orders` : "Your department's orders"}
        actions={<Button onClick={() => navigate("/purchases/new")}><Plus size={16} className="mr-1" /> New Purchase Order</Button>}
      />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <KPICard title="Pending Approval" value={stats.pending} icon={AlertCircle} color="text-amber-600" />
        <KPICard title="Approved" value={stats.approved} icon={Clock} color="text-blue-600" />
        <KPICard title="Partially Received" value={stats.partial} icon={Truck} color="text-orange-600" />
        <KPICard title="Received" value={stats.received} icon={CheckCircle2} color="text-green-600" />
        <KPICard title="Total Value" value={formatXAF(stats.totalValue)} icon={DollarSign} color="text-slate-700" />
      </div>

      <div className="flex items-center gap-1 mb-4 overflow-x-auto pb-1">
        {STATUS_TABS.map(tab => {
          const count = tab.key === "all" ? orders.length : orders.filter(o => o.status === tab.key).length;
          const active = statusFilter === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setStatusFilter(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-colors ${active ? "bg-slate-900 text-white" : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"}`}
            >
              {tab.label}
              <span className={`text-xs px-1.5 py-0.5 rounded ${active ? "bg-white/20" : "bg-slate-100"}`}>{count}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-500">Date:</span>
          <Select value={dateRange} onValueChange={setDateRange}>
            <SelectTrigger className="w-36 h-8"><SelectValue /></SelectTrigger>
            <SelectContent>{DATE_RANGES.map(r => <SelectItem key={r.key} value={r.key}>{r.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-500">Group:</span>
          <Select value={groupBy} onValueChange={setGroupBy}>
            <SelectTrigger className="w-44 h-8"><SelectValue /></SelectTrigger>
            <SelectContent>{GROUP_OPTIONS.map(g => <SelectItem key={g.key} value={g.key}>{g.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <span className="text-sm text-slate-400 ml-auto">{filtered.length} shown</span>
      </div>

      <div className="space-y-6">
        {groups.length === 0 ? (
          <div className="bg-white rounded-lg border border-slate-200 py-12 text-center text-slate-400">No orders match the current filters</div>
        ) : groups.map(group => (
          <div key={group.key || "all"}>
            {group.key !== null && (
              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-sm font-semibold text-slate-700">{group.label}</h3>
                <span className="text-xs text-slate-400">{group.items.length} order{group.items.length !== 1 ? "s" : ""}</span>
                <span className="text-xs text-slate-400">·</span>
                <span className="text-xs text-slate-500">{formatXAF(group.items.reduce((s, o) => s + (o.total || 0), 0))}</span>
              </div>
            )}
            <DataTable
              columns={cols}
              data={group.items}
              searchFields={["po_number", "supplier_name", "requested_department_name"]}
              onRowClick={row => navigate(`/purchases/${row.id}`)}
              emptyMessage="No orders in this group"
            />
          </div>
        ))}
      </div>
    </div>
  );
}