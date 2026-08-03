import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate } from "react-router-dom";
import { formatXAF, formatDate } from "@/lib/formatters";
import { agingBucket } from "@/lib/ar-ap";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import StatusBadge from "@/components/shared/StatusBadge";
import AgingTable from "@/components/accounting/AgingTable";
import PartyStatement from "@/components/accounting/PartyStatement";
import DataTable from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, ArrowLeft } from "lucide-react";

export default function Receivables() {
  const navigate = useNavigate();
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    base44.entities.Invoice.filter({}, "-invoice_date", 1000)
      .then((inv) => setInvoices(inv.filter((i) => i.status !== "draft" && i.status !== "cancelled")))
      .finally(() => setLoading(false));
  }, []);

  const open = invoices.filter((i) => (i.balance || 0) > 0);
  const outstanding = open.reduce((s, i) => s + i.balance, 0);
  const overdue = open.filter((i) => agingBucket(i.due_date) !== "current").reduce((s, i) => s + i.balance, 0);

  const cols = [
    { key: "invoice_number", label: "Invoice #", render: (i) => <span className="font-medium">{i.invoice_number}</span> },
    { key: "customer_name", label: "Customer" },
    { key: "invoice_date", label: "Date", render: (i) => formatDate(i.invoice_date) },
    { key: "due_date", label: "Due", render: (i) => formatDate(i.due_date) },
    { key: "total", label: "Total", render: (i) => formatXAF(i.total) },
    { key: "amount_paid", label: "Paid", render: (i) => formatXAF(i.amount_paid) },
    { key: "balance", label: "Balance", render: (i) => <span className="font-semibold">{formatXAF(i.balance)}</span> },
    { key: "status", label: "Status", render: (i) => <StatusBadge status={i.status} /> },
  ];

  if (loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;

  return (
    <div>
      <PageHeader
        title="Accounts Receivable"
        subtitle="Customer invoices, payment allocation, aging and statements"
        actions={
          <div className="flex gap-2">
            <Button onClick={() => navigate("/accounting/payments/new")}><Plus size={16} className="mr-1" /> Receive Payment</Button>
            <Button variant="outline" onClick={() => navigate("/accounting")}><ArrowLeft size={16} className="mr-1" /> Accounting</Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <KPICard title="Total Outstanding" value={formatXAF(outstanding)} subtitle={`${open.length} open invoices`} />
        <KPICard title="Overdue" value={formatXAF(overdue)} subtitle="Past due date" color="text-red-600" />
        <KPICard title="Invoices" value={invoices.length} subtitle="All posted invoices" />
      </div>

      <Tabs defaultValue="invoices">
        <TabsList>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
          <TabsTrigger value="aging">Aging</TabsTrigger>
          <TabsTrigger value="statement">Customer Statement</TabsTrigger>
        </TabsList>
        <TabsContent value="invoices" className="mt-4">
          <DataTable columns={cols} data={invoices} searchFields={["invoice_number", "customer_name"]} />
        </TabsContent>
        <TabsContent value="aging" className="mt-4">
          <AgingTable docs={open.map((i) => ({ party_name: i.customer_name, due_date: i.due_date, balance: i.balance }))} />
        </TabsContent>
        <TabsContent value="statement" className="mt-4">
          <PartyStatement partyType="customer" />
        </TabsContent>
      </Tabs>
    </div>
  );
}