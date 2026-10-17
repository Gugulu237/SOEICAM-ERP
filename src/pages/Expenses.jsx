import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import PageHeader from "@/components/shared/PageHeader";
import DataTable from "@/components/shared/DataTable";
import StatusBadge from "@/components/shared/StatusBadge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { formatXAF, formatDate, statusLabel } from "@/lib/formatters";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { canApproveExpense, canPayExpense, submitExpense, approveExpense, rejectExpense } from "@/lib/expenses";
import ExpenseBoard from "@/components/expenses/ExpenseBoard";
import ExpenseRequestDialog from "@/components/expenses/ExpenseRequestDialog";
import PayExpenseDialog from "@/components/expenses/PayExpenseDialog";
import BudgetManager from "@/components/expenses/BudgetManager";
import ExpenseRegister from "@/components/expenses/ExpenseRegister";
import ExpenseReport from "@/components/expenses/ExpenseReport";
import { Plus } from "lucide-react";

export default function Expenses() {
  const { toast } = useToast();
  const { user, employee, role, departmentId } = useCurrentUser();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newOpen, setNewOpen] = useState(false);
  const [payTarget, setPayTarget] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const rs = await base44.entities.ExpenseRequest.list("-created_date", 200);
    setRequests(rs);
    setLoading(false);
  }

  const approver = canApproveExpense(role);
  const payer = canPayExpense(role);
  const userName = user?.full_name || "";

  async function handleSubmit(r) { await submitExpense(r); toast({ title: "Submitted for approval" }); load(); }
  async function handleApprove(r) { await approveExpense(r, userName); toast({ title: "Approved" }); load(); }
  async function handleReject(r) {
    const reason = window.prompt("Why is this being rejected?");
    if (reason === null) return;
    await rejectExpense(r, userName, reason);
    toast({ title: "Rejected" });
    load();
  }

  const pending = requests.filter(r => r.status === "pending_approval");
  const toPay = requests.filter(r => r.status === "approved");
  const paid = requests.filter(r => r.status === "paid");

  const cols = [
    { key: "request_number", label: "Request #" },
    { key: "title", label: "Description" },
    { key: "request_date", label: "Date", render: v => formatDate(v) },
    { key: "category", label: "Category", render: v => statusLabel(v) },
    { key: "department_name", label: "Department" },
    { key: "requester_name", label: "Requested By" },
    { key: "amount", label: "Amount", render: v => formatXAF(v), className: "text-right" },
    { key: "status", label: "Status", render: v => <StatusBadge status={v} /> },
  ];

  if (loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;

  return (
    <div>
      <PageHeader
        title="Expenses & Budgets"
        subtitle="Request, approve, categorise and report every operating expense paid out of treasury"
        actions={<Button onClick={() => setNewOpen(true)}><Plus size={16} className="mr-1" /> New Expense Request</Button>}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Awaiting Approval</p>
          <p className="text-xl font-bold text-slate-900">{formatXAF(pending.reduce((s, r) => s + (r.amount || 0), 0))}</p>
          <p className="text-xs text-slate-400">{pending.length} requests</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Approved — To Pay</p>
          <p className="text-xl font-bold text-blue-700">{formatXAF(toPay.reduce((s, r) => s + (r.amount || 0), 0))}</p>
          <p className="text-xs text-slate-400">{toPay.length} requests</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Paid</p>
          <p className="text-xl font-bold text-green-700">{formatXAF(paid.reduce((s, r) => s + (r.amount || 0), 0))}</p>
          <p className="text-xs text-slate-400">{paid.length} requests</p>
        </div>
      </div>

      <Tabs defaultValue="register">
        <TabsList>
          <TabsTrigger value="register">Expense Register</TabsTrigger>
          <TabsTrigger value="board">Requests Board</TabsTrigger>
          <TabsTrigger value="list">All Requests</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
          <TabsTrigger value="budgets">Budgets</TabsTrigger>
        </TabsList>
        <TabsContent value="register" className="mt-4">
          <ExpenseRegister />
        </TabsContent>
        <TabsContent value="board" className="mt-4">
          <ExpenseBoard
            requests={requests}
            canApprove={approver}
            canPay={payer}
            isOwner={r => !employee?.id || r.requester_id === employee.id || approver}
            onSubmit={handleSubmit}
            onApprove={handleApprove}
            onReject={handleReject}
            onPay={setPayTarget}
          />
        </TabsContent>
        <TabsContent value="list" className="mt-4">
          <DataTable columns={cols} data={requests} searchFields={["request_number", "title", "requester_name", "department_name"]} />
        </TabsContent>
        <TabsContent value="reports" className="mt-4">
          <ExpenseReport />
        </TabsContent>
        <TabsContent value="budgets" className="mt-4">
          <BudgetManager />
        </TabsContent>
      </Tabs>

      <ExpenseRequestDialog
        open={newOpen} onOpenChange={setNewOpen} onSaved={load}
        employee={employee} departmentId={departmentId}
      />
      <PayExpenseDialog
        request={payTarget}
        onOpenChange={() => setPayTarget(null)}
        onPaid={load}
        user={user}
      />
    </div>
  );
}