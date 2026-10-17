import React, { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate } from "react-router-dom";
import { formatXAF, formatDate } from "@/lib/formatters";
import PageHeader from "@/components/shared/PageHeader";
import DataTable from "@/components/shared/DataTable";
import StatusBadge from "@/components/shared/StatusBadge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Plus, BookOpen, Scale, Wallet } from "lucide-react";
import PeriodsManager from "@/components/accounting/PeriodsManager";
import PostingRulesManager from "@/components/accounting/PostingRulesManager";
import ChartOfAccountsManager from "@/components/accounting/ChartOfAccountsManager";
import JournalRegister from "@/components/accounting/JournalRegister";

export default function Accounting() {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const load = useCallback(() => {
    return base44.entities.Payment.list("-created_date", 50)
      .then(setPayments)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const paymentCols = [
    { key: "payment_number", label: "Payment #" },
    { key: "payment_date", label: "Date", render: v => formatDate(v) },
    { key: "party_name", label: "Party" },
    { key: "payment_type", label: "Type" },
    { key: "amount", label: "Amount", render: v => formatXAF(v), className: "text-right" },
    { key: "payment_method", label: "Method" },
    { key: "status", label: "Status", render: v => <StatusBadge status={v} /> },
  ];

  if (loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;

  return (
    <div>
      <PageHeader
        title="Accounting"
        subtitle="Chart of Accounts · Journals · Ledger · Payments · Periods"
        actions={
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" onClick={() => navigate("/expenses")}><Wallet size={16} className="mr-1" /> Expenses</Button>
            <Button variant="outline" onClick={() => navigate("/accounting/receivables")}>Receivables</Button>
            <Button variant="outline" onClick={() => navigate("/accounting/payables")}>Payables</Button>
            <Button variant="outline" onClick={() => navigate("/accounting/treasury")}>Treasury</Button>
            <Button variant="outline" onClick={() => navigate("/accounting/statements")}>Statements</Button>
            <Button variant="outline" onClick={() => navigate("/accounting/assets")}>Fixed Assets</Button>
            <Button variant="outline" onClick={() => navigate("/accounting/ledger")}><BookOpen size={16} className="mr-1" /> General Ledger</Button>
            <Button variant="outline" onClick={() => navigate("/accounting/trial-balance")}><Scale size={16} className="mr-1" /> Trial Balance</Button>
            <Button variant="outline" onClick={() => navigate("/accounting/payments/new")}><Plus size={16} className="mr-1" /> Record Payment</Button>
            <Button onClick={() => navigate("/accounting/journals/new")}><Plus size={16} className="mr-1" /> New Journal</Button>
          </div>
        }
      />
      <Tabs defaultValue="accounts">
        <TabsList>
          <TabsTrigger value="accounts">Chart of Accounts</TabsTrigger>
          <TabsTrigger value="journals">Journal Entries</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="periods">Periods</TabsTrigger>
          <TabsTrigger value="rules">Posting Rules</TabsTrigger>
        </TabsList>
        <TabsContent value="accounts" className="mt-4">
          <ChartOfAccountsManager />
        </TabsContent>
        <TabsContent value="journals" className="mt-4">
          <JournalRegister />
        </TabsContent>
        <TabsContent value="payments" className="mt-4">
          <DataTable columns={paymentCols} data={payments} searchFields={["payment_number", "party_name"]} />
        </TabsContent>
        <TabsContent value="periods" className="mt-4">
          <PeriodsManager />
        </TabsContent>
        <TabsContent value="rules" className="mt-4">
          <PostingRulesManager />
        </TabsContent>
      </Tabs>

    </div>
  );
}