import { readAll } from '@/lib/field-pos';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState, useEffect, useCallback } from "react";
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
import NewBillDialog from "@/components/accounting/NewBillDialog";
import PayBillDialog from "@/components/accounting/PayBillDialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, ArrowLeft, Banknote } from "lucide-react";

export default function Payables() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const navigate = useNavigate();
  const [bills, setBills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,setError] = useState('');
  const [showNewBill, setShowNewBill] = useState(false);
  const [paySupplierId, setPaySupplierId] = useState(null);

  const load = useCallback(() => {
    setLoading(true);setError('');readAll(erp.entities.Bill,{},"-bill_date").then(setBills).catch(e=>setError(e.message)).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const open = bills.filter((b) => (b.balance || 0) > 0 && b.status !== "cancelled");
  const outstanding = open.reduce((s, b) => s + b.balance, 0);
  const overdue = open.filter((b) => agingBucket(b.due_date) !== "current").reduce((s, b) => s + b.balance, 0);

  const cols = [
    { key: "bill_number", label: ui("Bill #"), render: (v) => <span className="font-medium">{v}</span> },
    { key: "supplier_name", label: ui("Supplier") },
    { key: "po_number", label: ui("PO #") },
    { key: "bill_date", label: ui("Date"), render: (v) => formatDate(v) },
    { key: "due_date", label: ui("Due"), render: (v) => formatDate(v) },
    { key: "total", label: ui("Total"), render: (v) => formatXAF(v) },
    { key: "balance", label: ui("Balance"), render: (v) => <span className="font-semibold">{formatXAF(v)}</span> },
    { key: "status", label: ui("Status"), render: (v) => <StatusBadge status={v} /> },
    {
      key: "actions", label: "", render: (v, bill) => bill.balance > 0 && bill.status !== "cancelled" ? (
        <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); setPaySupplierId(bill.supplier_id); }}>
          <Banknote size={14} className="mr-1" />{ui(" Pay")}</Button>
      ) : null,
    },
  ];

  if (loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;

  if(error) return <p role="alert">{error}</p>;
  return (
    <div>
      <PageHeader
        title={ui("Accounts Payable")}
        subtitle={ui("Supplier bills, payment allocation, aging and statements")}
        actions={
          <div className="flex gap-2">
            <Button onClick={() => setShowNewBill(true)}><Plus size={16} className="mr-1" />{ui(" New Bill from PO")}</Button>
            <Button variant="outline" onClick={() => navigate("/accounting")}><ArrowLeft size={16} className="mr-1" />{ui(" Accounting")}</Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <KPICard title={ui("Total Outstanding")} value={formatXAF(outstanding)} subtitle={ui("{0} open bills", open.length)} />
        <KPICard title={ui("Overdue")} value={formatXAF(overdue)} subtitle={ui("Past due date")} color="text-red-600" />
        <KPICard title={ui("Bills")} value={bills.length} subtitle={ui("All supplier bills")} />
      </div>

      <Tabs defaultValue="bills">
        <TabsList>
          <TabsTrigger value="bills">{ui("Bills")}</TabsTrigger>
          <TabsTrigger value="aging">{ui("Aging")}</TabsTrigger>
          <TabsTrigger value="statement">{ui("Supplier Statement")}</TabsTrigger>
        </TabsList>
        <TabsContent value="bills" className="mt-4">
          <DataTable exportTitle="Supplier bills" columns={cols} data={bills} searchFields={["bill_number", "supplier_name", "po_number"]} />
        </TabsContent>
        <TabsContent value="aging" className="mt-4">
          <AgingTable title="Supplier aging report" docs={open.map((b) => ({ party_name: b.supplier_name, due_date: b.due_date, balance: b.balance }))} />
        </TabsContent>
        <TabsContent value="statement" className="mt-4">
          <PartyStatement partyType="supplier" />
        </TabsContent>
      </Tabs>

      {showNewBill && <NewBillDialog onClose={() => setShowNewBill(false)} onCreated={() => { setShowNewBill(false); load(); }} />}
      {paySupplierId && <PayBillDialog supplierId={paySupplierId} onClose={() => setPaySupplierId(null)} onPaid={() => { setPaySupplierId(null); load(); }} />}
    </div>
  );
}