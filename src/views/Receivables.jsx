import { readAll } from '@/lib/field-pos';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState, useEffect } from "react";
import { erp } from "@/api/erpClient";
import { useNavigate } from "@/lib/router";
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
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const navigate = useNavigate();
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,setError] = useState('');

  useEffect(() => {
    readAll(erp.entities.Invoice,{},"-invoice_date")
      .then((inv) => setInvoices(inv.filter((i) => i.status !== "draft" && i.status !== "cancelled")))
      .catch(e=>setError(e.message)).finally(() => setLoading(false));
  }, []);

  const open = invoices.filter((i) => (i.balance || 0) > 0);
  const outstanding = open.reduce((s, i) => s + i.balance, 0);
  const overdue = open.filter((i) => agingBucket(i.due_date) !== "current").reduce((s, i) => s + i.balance, 0);

  const cols = [
    { key: "invoice_number", label: ui("Invoice #"), render: (i) => <span className="font-medium">{i}</span> },
    { key: "customer_name", label: ui("Customer") },
    { key: "invoice_date", label: ui("Date"), render: (i) => formatDate(i) },
    { key: "due_date", label: ui("Due"), render: (i) => formatDate(i) },
    { key: "total", label: ui("Total"), render: (i) => formatXAF(i) },
    { key: "amount_paid", label: ui("Paid"), render: (i) => formatXAF(i) },
    { key: "balance", label: ui("Balance"), render: (i) => <span className="font-semibold">{formatXAF(i)}</span> },
    { key: "status", label: ui("Status"), render: (i) => <StatusBadge status={i} /> },
  ];

  if (loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;

  if(error) return <p role="alert">{error}</p>;
  return (
    <div>
      <PageHeader
        title={ui("Accounts Receivable")}
        subtitle={ui("Customer invoices, payment allocation, aging and statements")}
        actions={
          <div className="flex gap-2">
            <Button onClick={() => navigate("/accounting/payments/new")}><Plus size={16} className="mr-1" />{ui(" Receive Payment")}</Button>
            <Button variant="outline" onClick={() => navigate("/accounting")}><ArrowLeft size={16} className="mr-1" />{ui(" Accounting")}</Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <KPICard title={ui("Total Outstanding")} value={formatXAF(outstanding)} subtitle={ui("{0} open invoices", open.length)} />
        <KPICard title={ui("Overdue")} value={formatXAF(overdue)} subtitle={ui("Past due date")} color="text-red-600" />
        <KPICard title={ui("Invoices")} value={invoices.length} subtitle={ui("All posted invoices")} />
      </div>

      <Tabs defaultValue="invoices">
        <TabsList>
          <TabsTrigger value="invoices">{ui("Invoices")}</TabsTrigger>
          <TabsTrigger value="aging">{ui("Aging")}</TabsTrigger>
          <TabsTrigger value="statement">{ui("Customer Statement")}</TabsTrigger>
        </TabsList>
        <TabsContent value="invoices" className="mt-4">
          <DataTable exportTitle="Accounts receivable" columns={cols} data={invoices} searchFields={["invoice_number", "customer_name"]} />
        </TabsContent>
        <TabsContent value="aging" className="mt-4">
          <AgingTable title="Customer aging report" docs={open.map((i) => ({ party_name: i.customer_name, due_date: i.due_date, balance: i.balance }))} />
        </TabsContent>
        <TabsContent value="statement" className="mt-4">
          <PartyStatement partyType="customer" />
        </TabsContent>
      </Tabs>
    </div>
  );
}