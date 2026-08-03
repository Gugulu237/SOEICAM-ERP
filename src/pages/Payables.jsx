import React, { useState, useEffect, useCallback } from "react";
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
import NewBillDialog from "@/components/accounting/NewBillDialog";
import PayBillDialog from "@/components/accounting/PayBillDialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, ArrowLeft, Banknote } from "lucide-react";

export default function Payables() {
  const navigate = useNavigate();
  const [bills, setBills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNewBill, setShowNewBill] = useState(false);
  const [paySupplierId, setPaySupplierId] = useState(null);

  const load = useCallback(() => {
    base44.entities.Bill.filter({}, "-bill_date", 1000).then(setBills).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const open = bills.filter((b) => (b.balance || 0) > 0 && b.status !== "cancelled");
  const outstanding = open.reduce((s, b) => s + b.balance, 0);
  const overdue = open.filter((b) => agingBucket(b.due_date) !== "current").reduce((s, b) => s + b.balance, 0);

  const cols = [
    { key: "bill_number", label: "Bill #", render: (b) => <span className="font-medium">{b.bill_number}</span> },
    { key: "supplier_name", label: "Supplier" },
    { key: "po_number", label: "PO #" },
    { key: "bill_date", label: "Date", render: (b) => formatDate(b.bill_date) },
    { key: "due_date", label: "Due", render: (b) => formatDate(b.due_date) },
    { key: "total", label: "Total", render: (b) => formatXAF(b.total) },
    { key: "balance", label: "Balance", render: (b) => <span className="font-semibold">{formatXAF(b.balance)}</span> },
    { key: "status", label: "Status", render: (b) => <StatusBadge status={b.status} /> },
    {
      key: "actions", label: "", render: (b) => b.balance > 0 && b.status !== "cancelled" ? (
        <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); setPaySupplierId(b.supplier_id); }}>
          <Banknote size={14} className="mr-1" /> Pay
        </Button>
      ) : null,
    },
  ];

  if (loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;

  return (
    <div>
      <PageHeader
        title="Accounts Payable"
        subtitle="Supplier bills, payment allocation, aging and statements"
        actions={
          <div className="flex gap-2">
            <Button onClick={() => setShowNewBill(true)}><Plus size={16} className="mr-1" /> New Bill from PO</Button>
            <Button variant="outline" onClick={() => navigate("/accounting")}><ArrowLeft size={16} className="mr-1" /> Accounting</Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <KPICard title="Total Outstanding" value={formatXAF(outstanding)} subtitle={`${open.length} open bills`} />
        <KPICard title="Overdue" value={formatXAF(overdue)} subtitle="Past due date" color="text-red-600" />
        <KPICard title="Bills" value={bills.length} subtitle="All supplier bills" />
      </div>

      <Tabs defaultValue="bills">
        <TabsList>
          <TabsTrigger value="bills">Bills</TabsTrigger>
          <TabsTrigger value="aging">Aging</TabsTrigger>
          <TabsTrigger value="statement">Supplier Statement</TabsTrigger>
        </TabsList>
        <TabsContent value="bills" className="mt-4">
          <DataTable columns={cols} data={bills} searchFields={["bill_number", "supplier_name", "po_number"]} />
        </TabsContent>
        <TabsContent value="aging" className="mt-4">
          <AgingTable docs={open.map((b) => ({ party_name: b.supplier_name, due_date: b.due_date, balance: b.balance }))} />
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