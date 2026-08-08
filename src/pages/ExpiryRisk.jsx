import React, { useState, useEffect } from "react";
import { getExpiryRisk } from "@/lib/inventory";
import PageHeader from "@/components/shared/PageHeader";
import DataTable from "@/components/shared/DataTable";
import KPICard from "@/components/shared/KPICard";
import { Button } from "@/components/ui/button";
import { formatDate, formatNumber, formatXAF } from "@/lib/formatters";
import { AlertTriangle, Clock, ShieldAlert, Trash2 } from "lucide-react";

const WINDOWS = [1, 3, 7, 14, 30];

const RISK_STYLE = {
  expired: "bg-red-100 text-red-700",
  critical: "bg-red-50 text-red-600",
  warning: "bg-amber-100 text-amber-800",
  held: "bg-blue-100 text-blue-700",
  rejected: "bg-slate-200 text-slate-700",
};

const ACTION = {
  expired: "Write off immediately",
  critical: "Sell today — prioritise nearest route",
  warning: "Prioritise for sale or discount",
  held: "Awaiting quality release",
  rejected: "Destroy / investigate",
};

export default function ExpiryRisk() {
  const [days, setDays] = useState(30);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getExpiryRisk(days).then(setRows).finally(() => setLoading(false));
  }, [days]);

  const expired = rows.filter(r => r.risk === "expired");
  const critical = rows.filter(r => r.risk === "critical");
  const held = rows.filter(r => r.risk === "held" || r.risk === "rejected");
  const atRiskValue = rows.reduce((s, r) => s + (r.total_value || 0), 0);

  const cols = [
    { key: "product_name", label: "Product" },
    { key: "lot_number", label: "Batch", render: v => v || "—" },
    { key: "warehouse_name", label: "Location" },
    { key: "quantity", label: "Qty", className: "text-right", render: v => formatNumber(v, 2) },
    { key: "expiry_date", label: "Expiry", render: v => v ? formatDate(v) : "—" },
    {
      key: "days_left", label: "Days Left", className: "text-right",
      render: v => v === null ? "—" : v < 0 ? `${Math.abs(v)} overdue` : v,
    },
    { key: "total_value", label: "Value", className: "text-right", render: v => formatXAF(v) },
    {
      key: "risk", label: "Risk",
      render: v => <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${RISK_STYLE[v]}`}>{v}</span>,
    },
    { key: "risk", label: "Suggested Action", render: v => <span className="text-slate-600">{ACTION[v]}</span> },
  ];

  return (
    <div>
      <PageHeader
        title="Expiry Risk"
        subtitle="Yogurt batches that need attention before they are lost"
        actions={
          <div className="flex gap-1">
            {WINDOWS.map(d => (
              <Button key={d} size="sm" variant={days === d ? "default" : "outline"} onClick={() => setDays(d)}>
                {d}d
              </Button>
            ))}
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KPICard title="Expired" value={expired.length} subtitle="lots to write off" icon={Trash2} color="red" />
        <KPICard title="Expiring in 3 days" value={critical.length} subtitle="sell now" icon={AlertTriangle} color="orange" />
        <KPICard title="Held by Quality" value={held.length} subtitle="quarantined or rejected" icon={ShieldAlert} color="blue" />
        <KPICard title="Value at Risk" value={formatXAF(atRiskValue)} subtitle={`within ${days} days`} icon={Clock} color="amber" />
      </div>

      {loading
        ? <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>
        : <DataTable columns={cols} data={rows} searchFields={["product_name", "lot_number", "warehouse_name"]} emptyMessage="No stock at risk — every batch is in date and released." />
      }
    </div>
  );
}