
/* localized-interface */
import { ui, uiMessage } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState, useEffect } from "react";
import { erp } from "@/api/erpClient";
import { readAll } from "@/lib/field-pos";
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
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const { toast } = useToast();
  const { user, employee, role, departmentId } = useCurrentUser();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,setError]=useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [payTarget, setPayTarget] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    setError('');
    try {const rs=await readAll(erp.entities.ExpenseRequest,{},'-created_date');setRequests(rs);}
    catch(e){setError(e.message);} finally{setLoading(false);}
  }

  const approver = canApproveExpense(role);
  const payer = canPayExpense(role);
  const userName = user?.full_name || "";

  async function handleSubmit(r) { await submitExpense(r); toast({ title: ui("Submitted for approval") }); load(); }
  async function handleApprove(r) { await approveExpense(r, userName); toast({ title: ui("Approved") }); load(); }
  async function handleReject(r) {
    const reason = window.prompt(ui("Why is this being rejected?"));
    if (reason === null) return;
    await rejectExpense(r, userName, reason);
    toast({ title: ui("Rejected") });
    load();
  }

  const pending = requests.filter(r => r.status === "pending_approval");
  const toPay = requests.filter(r => r.status === "approved");
  const paid = requests.filter(r => r.status === "paid");

  const cols = [
    { key: "request_number", label: ui("Request #") },
    { key: "title", label: ui("Description") },
    { key: "request_date", label: ui("Date"), render: v => formatDate(v) },
    { key: "category", label: ui("Category"), render: v => statusLabel(v) },
    { key: "department_name", label: ui("Department") },
    { key: "requester_name", label: ui("Requested By") },
    { key: "amount", label: ui("Amount"), render: v => formatXAF(v), className: "text-right" },
    { key: "status", label: ui("Status"), render: v => <StatusBadge status={v} /> },
  ];

  if (loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-primary rounded-full animate-spin" /></div>;

  return (
    <div>
      <PageHeader
        title={ui("Expenses & Budgets")}
        subtitle={ui("Request, approve, categorise and report every operating expense paid out of treasury")}
        actions={<Button onClick={() => setNewOpen(true)}><Plus size={16} className="mr-1" />{ui(" New Expense Request")}</Button>}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">{ui("Awaiting Approval")}</p>
          <p className="text-xl font-bold text-slate-900">{formatXAF(pending.reduce((s, r) => s + (r.amount || 0), 0))}</p>
          <p className="text-xs text-slate-400">{pending.length}{ui(" requests")}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">{ui("Approved — To Pay")}</p>
          <p className="text-xl font-bold text-blue-700">{formatXAF(toPay.reduce((s, r) => s + (r.amount || 0), 0))}</p>
          <p className="text-xs text-slate-400">{toPay.length}{ui(" requests")}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">{ui("Paid")}</p>
          <p className="text-xl font-bold text-green-700">{formatXAF(paid.reduce((s, r) => s + (r.amount || 0), 0))}</p>
          <p className="text-xs text-slate-400">{paid.length}{ui(" requests")}</p>
        </div>
      </div>

      {error&&<p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{uiMessage(error)}</p>}
      <Tabs defaultValue={payer?"register":"board"}>
        <TabsList>
          {payer&&<TabsTrigger value="register">{ui("Expense Register")}</TabsTrigger>}
          <TabsTrigger value="board">{ui("Requests Board")}</TabsTrigger>
          <TabsTrigger value="list">{ui("All Requests")}</TabsTrigger>
          {payer&&<TabsTrigger value="reports">{ui("Reports")}</TabsTrigger>}
          {payer&&<TabsTrigger value="budgets">{ui("Budgets")}</TabsTrigger>}
        </TabsList>
        {payer&&<TabsContent value="register" className="mt-4">
          <ExpenseRegister />
        </TabsContent>}
        <TabsContent value="board" className="mt-4">
          <ExpenseBoard
            requests={requests}
            canApprove={approver}
            canApproveRequest={r=>role==='admin' || r.requester_id!==employee?.id}
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
        {payer&&<TabsContent value="reports" className="mt-4">
          <ExpenseReport />
        </TabsContent>}
        {payer&&<TabsContent value="budgets" className="mt-4">
          <BudgetManager />
        </TabsContent>}
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