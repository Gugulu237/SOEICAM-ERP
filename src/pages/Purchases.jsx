import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate } from "react-router-dom";
import { formatXAF, formatDate } from "@/lib/formatters";
import PageHeader from "@/components/shared/PageHeader";
import DataTable from "@/components/shared/DataTable";
import StatusBadge from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export default function Purchases() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    base44.entities.PurchaseOrder.list("-created_date", 50).then(setOrders).finally(() => setLoading(false));
  }, []);

  const cols = [
    { key: "po_number", label: "PO #" },
    { key: "supplier_name", label: "Supplier" },
    { key: "order_date", label: "Date", render: v => formatDate(v) },
    { key: "expected_date", label: "Expected", render: v => formatDate(v) },
    { key: "total", label: "Total", render: v => formatXAF(v), className: "text-right" },
    { key: "status", label: "Status", render: v => <StatusBadge status={v} /> },
  ];

  if (loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;

  return (
    <div>
      <PageHeader
        title="Purchase Orders"
        subtitle={`${orders.length} orders`}
        actions={<Button onClick={() => navigate("/purchases/new")}><Plus size={16} className="mr-1" /> New Purchase Order</Button>}
      />
      <DataTable columns={cols} data={orders} searchFields={["po_number", "supplier_name"]} onRowClick={row => navigate(`/purchases/${row.id}`)} />
    </div>
  );
}