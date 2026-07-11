import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { formatXAF } from "@/lib/formatters";
import { trialBalanceRows } from "@/lib/accountingReports";
import PageHeader from "@/components/shared/PageHeader";
import StatusBadge from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { Plus } from "lucide-react";

const TYPES = ["asset", "liability", "equity", "revenue", "cogs", "expense", "other_income", "other_expense"];

export default function ChartOfAccounts() {
  const { toast } = useToast();
  const [accounts, setAccounts] = useState([]);
  const [journals, setJournals] = useState([]);
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ account_number: "", name: "", account_type: "asset", normal_balance: "debit", description: "" });

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    const [a, j, l] = await Promise.all([
      base44.entities.Account.filter({}),
      base44.entities.JournalEntry.list("-entry_date", 500),
      base44.entities.JournalLine.list("-created_date", 1000),
    ]);
    setAccounts(a); setJournals(j); setLines(l);
    setLoading(false);
  }

  const rows = trialBalanceRows(accounts, journals, lines);
  const balanceMap = {};
  for (const r of rows) balanceMap[r.account.id] = r.balance;

  async function handleAdd() {
    if (!form.account_number || !form.name) { toast({ title: "Error", description: "Account number and name required", variant: "destructive" }); return; }
    const normal = ["asset", "expense", "cogs"].includes(form.account_type) ? "debit" : "credit";
    await base44.entities.Account.create({ ...form, normal_balance: normal, is_posting: true, is_active: true, financial_statement: ["asset", "liability", "equity"].includes(form.account_type) ? "balance_sheet" : "income_statement" });
    toast({ title: "Account created" });
    setShowAdd(false);
    setForm({ account_number: "", name: "", account_type: "asset", normal_balance: "debit", description: "" });
    loadData();
  }

  const sorted = [...accounts].sort((a, b) => (a.account_number || "").localeCompare(b.account_number || ""));

  if (loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;

  return (
    <div>
      <PageHeader title="Chart of Accounts" subtitle="SYSCOHADA-aligned, configurable account structure"
        actions={<Button onClick={() => setShowAdd(true)}><Plus size={16} className="mr-1" /> New Account</Button>} />

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-slate-50 text-left text-slate-600">
              <th className="px-4 py-3 font-medium">Account #</th>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Subtype</th>
              <th className="px-4 py-3 font-medium">Normal</th>
              <th className="px-4 py-3 font-medium">Flags</th>
              <th className="px-4 py-3 text-right font-medium">Balance</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(a => (
              <tr key={a.id} className="border-b last:border-0 hover:bg-slate-50">
                <td className="px-4 py-2 font-mono font-medium">{a.account_number}</td>
                <td className="px-4 py-2">{a.name}</td>
                <td className="px-4 py-2"><StatusBadge status={a.account_type} /></td>
                <td className="px-4 py-2 text-slate-500">{a.subtype || "—"}</td>
                <td className="px-4 py-2 capitalize text-slate-500">{a.normal_balance}</td>
                <td className="px-4 py-2 text-xs text-slate-500">
                  {a.is_control_account && <span className="mr-1 text-purple-600">control</span>}
                  {a.is_treasury && <span className="mr-1 text-emerald-600">treasury</span>}
                  {a.is_posting === false && <span className="mr-1 text-slate-400">header</span>}
                </td>
                <td className="px-4 py-2 text-right font-medium">{formatXAF(balanceMap[a.id] || 0)}</td>
                <td className="px-4 py-2"><StatusBadge status={a.is_active !== false ? "active" : "inactive"} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Account</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label>Account Number *</Label><Input value={form.account_number} onChange={e => setForm(f => ({ ...f, account_number: e.target.value }))} placeholder="e.g. 8150" /></div>
            <div><Label>Account Name *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div>
              <Label>Account Type</Label>
              <Select value={form.account_type} onValueChange={v => setForm(f => ({ ...f, account_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{TYPES.map(t => <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Description</Label><Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
          </div>
          <DialogFooter><Button onClick={handleAdd}>Create Account</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}