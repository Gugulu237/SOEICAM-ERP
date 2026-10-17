import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { formatDate } from "@/lib/formatters";
import PageHeader from "@/components/shared/PageHeader";
import DataTable from "@/components/shared/DataTable";
import StatusBadge from "@/components/shared/StatusBadge";

export default function Approvals() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    loadPending();
  }, []);

  async function loadPending() {
    const [pos, recipes, production, payroll, stockRequests, cashRequests] = await Promise.all([
      base44.entities.PurchaseOrder.filter({ status: "pending_approval" }),
      base44.entities.Recipe.filter({ status: "pending_approval" }),
      base44.entities.ProductionOrder.filter({ status: "awaiting_approval" }),
      base44.entities.PayrollRun.filter({ status: "calculated" }),
      base44.entities.DispatchRequest.filter({ status: "pending_approval" }),
      base44.entities.Payment.filter({ payment_type: "supplier_payment", status: "pending_approval" }),
    ]);
    const all = [
      ...pos.map(p => ({ ...p, _type: "Purchase Order", _ref: p.po_number })),
      ...recipes.map(r => ({ ...r, _type: "Recipe", _ref: r.recipe_name })),
      ...production.map(p => ({ ...p, _type: "Production Order", _ref: p.order_number })),
      ...payroll.map(p => ({ ...p, _type: "Payroll Run", _ref: p.period_name })),
      ...stockRequests.map(r => ({ ...r, _type: "Stock Request", _ref: `${r.request_number} — ${r.vehicle_name || ""}`, _link: `/distribution/requests/${r.id}` })),
      ...cashRequests.map(p => ({ ...p, _type: "Cash Disbursement", _ref: `${p.payment_number} — ${p.party_name}`, _link: "/cashier" })),
    ];
    setItems(all);
    setLoading(false);
  }

  const cols = [
    { key: "_type", label: "Type" },
    { key: "_ref", label: "Reference" },
    { key: "created_date", label: "Date", render: v => formatDate(v) },
    { key: "status", label: "Status", render: v => <StatusBadge status={v} /> },
  ];

  if (loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;

  return (
    <div>
      <PageHeader title="Pending Approvals" subtitle={`${items.length} items awaiting approval`} />
      <DataTable
        columns={cols}
        data={items}
        searchFields={["_type", "_ref"]}
        emptyMessage="No pending approvals 🎉"
        onRowClick={row => row._link && navigate(row._link)}
      />
    </div>
  );
}