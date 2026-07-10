import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate } from "react-router-dom";
import { formatXAF } from "@/lib/formatters";
import PageHeader from "@/components/shared/PageHeader";
import DataTable from "@/components/shared/DataTable";
import StatusBadge from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export default function Customers() {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    base44.entities.Customer.filter({}).then(setCustomers).finally(() => setLoading(false));
  }, []);

  const cols = [
    { key: "customer_number", label: "#" },
    { key: "business_name", label: "Business Name" },
    { key: "contact_person", label: "Contact" },
    { key: "phone", label: "Phone" },
    { key: "category", label: "Category", render: v => <StatusBadge status={v} /> },
    { key: "balance", label: "Balance", render: v => formatXAF(v), className: "text-right" },
    { key: "credit_limit", label: "Credit Limit", render: v => formatXAF(v), className: "text-right" },
    { key: "credit_status", label: "Status", render: v => <StatusBadge status={v} /> },
  ];

  if (loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;

  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle={`${customers.length} customers · ${formatXAF(customers.reduce((s, c) => s + (c.balance || 0), 0))} total receivables`}
        actions={<Button onClick={() => navigate("/customers/new")}><Plus size={16} className="mr-1" /> New Customer</Button>}
      />
      <DataTable columns={cols} data={customers} searchFields={["business_name", "contact_person", "phone", "customer_number"]} onRowClick={row => navigate(`/customers/${row.id}`)} />
    </div>
  );
}