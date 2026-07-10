import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate } from "react-router-dom";
import { formatXAF, formatDate } from "@/lib/formatters";
import PageHeader from "@/components/shared/PageHeader";
import DataTable from "@/components/shared/DataTable";
import StatusBadge from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus } from "lucide-react";

export default function Sales() {
  const [orders, setOrders] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([
      base44.entities.SalesOrder.list("-created_date", 50),
      base44.entities.Invoice.list("-created_date", 50),
    ]).then(([o, i]) => { setOrders(o); setInvoices(i); }).finally(() => setLoading(false));
  }, []);

  const orderCols = [
    { key: "order_number", label: "Order #" },
    { key: "customer_name", label: "Customer" },
    { key: "order_date", label: "Date", render: v => formatDate(v) },
    { key: "payment_type", label: "Payment", render: v => <StatusBadge status={v} /> },
    { key: "total", label: "Total", render: v => formatXAF(v), className: "text-right" },
    { key: "status", label: "Status", render: v => <StatusBadge status={v} /> },
  ];

  const invoiceCols = [
    { key: "invoice_number", label: "Invoice #" },
    { key: "customer_name", label: "Customer" },
    { key: "invoice_date", label: "Date", render: v => formatDate(v) },
    { key: "due_date", label: "Due", render: v => formatDate(v) },
    { key: "total", label: "Total", render: v => formatXAF(v), className: "text-right" },
    { key: "balance", label: "Balance", render: v => formatXAF(v), className: "text-right" },
    { key: "status", label: "Status", render: v => <StatusBadge status={v} /> },
  ];

  if (loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;

  return (
    <div>
      <PageHeader
        title="Sales"
        subtitle={`${orders.length} orders · ${invoices.length} invoices`}
        actions={<Button onClick={() => navigate("/sales/new")}><Plus size={16} className="mr-1" /> New Sale</Button>}
      />
      <Tabs defaultValue="orders">
        <TabsList>
          <TabsTrigger value="orders">Sales Orders</TabsTrigger>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
        </TabsList>
        <TabsContent value="orders" className="mt-4">
          <DataTable columns={orderCols} data={orders} searchFields={["order_number", "customer_name"]} onRowClick={row => navigate(`/sales/${row.id}`)} />
        </TabsContent>
        <TabsContent value="invoices" className="mt-4">
          <DataTable columns={invoiceCols} data={invoices} searchFields={["invoice_number", "customer_name"]} onRowClick={row => navigate(`/sales/invoices/${row.id}`)} />
        </TabsContent>
      </Tabs>
    </div>
  );
}