import React, { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate } from "react-router-dom";
import { formatXAF, formatDate } from "@/lib/formatters";
import PageHeader from "@/components/shared/PageHeader";
import StatusBadge from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  BookOpen, ListTree, Scale, FileText, Plus, ArrowRight,
  Wallet, TrendingUp, TrendingDown, Banknote, Package, Users, Truck, AlertTriangle
} from "lucide-react";

export default function Accounting() {
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState([]);
  const [journals, setJournals] = useState([]);
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      const [a, j, l] = await Promise.all([
        base44.entities.Account.filter({}),
        base44.entities.JournalEntry.list("-entry_date", 100),
        base44.entities.JournalLine.list("-created_date", 2000),
      ]);
      setAccounts(a);
      setJournals(j);
      setLines(l);
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  const postedJournalIds = useMemo(() => {
    const s = new Set();
    journals.forEach(j => { if (j.status === "posted") s.add(j.id); });
    return s;
  }, [journals]);

  const accountMap = useMemo(() => { const m = {}; accounts.forEach(a => { m[a.id] = a; }); return m; }, [accounts]);

  const balances = useMemo(() => {
    const m = {};
    lines.forEach(l => {
      if (!postedJournalIds.has(l.journal_id)) return;
      const acc = accountMap[l.account_id];
      if (!acc) return;
      if (!m[l.account_id]) m[l.account_id] = { debit: 0, credit: 0 };
      m[l.account_id].debit += (l.debit || 0);
      m[l.account_id].credit += (l.credit || 0);
    });
    return m;
  }, [lines, postedJournalIds, accountMap]);

  const netBalance = (accId) => {
    const acc = accountMap[accId];
    if (!acc) return 0;
    const t = balances[accId] || { debit: 0, credit: 0 };
    return acc.normal_balance === "debit" ? (t.debit - t.credit) : (t.credit - t.debit);
  };

  const sumByType = (type) => accounts.filter(a => a.account_type === type).reduce((s, a) => s + netBalance(a.id), 0);
  const sumByKeyword = (kw) => accounts.filter(a => a.account_type === "asset" && new RegExp(kw, "i").test(a.name)).reduce((s, a) => s + netBalance(a.id), 0);

  const cash = sumByKeyword("cash|bank|mobile|savings|petty|undeposited");
  const receivables = accounts.filter(a => /receivable/i.test(a.name) && a.account_type === "asset").reduce((s, a) => s + netBalance(a.id), 0);
  const inventory = accounts.filter(a => /inventory|work in progress|wip/i.test(a.name) && a.account_type === "asset").reduce((s, a) => s + netBalance(a.id), 0);
  const fixedAssets = accounts.filter(a => /fixed asset|machinery|vehicle|building|equipment|computer|furniture|cold/i.test(a.name) && a.account_type === "asset").reduce((s, a) => s + netBalance(a.id), 0);
  const payables = accounts.filter(a => /payable/i.test(a.name) && a.account_type === "liability").reduce((s, a) => s + netBalance(a.id), 0);
  const salariesPayable = accounts.filter(a => /salaries payable/i.test(a.name)).reduce((s, a) => s + netBalance(a.id), 0);
  const taxesPayable = accounts.filter(a => /tax/i.test(a.name) && a.account_type === "liability").reduce((s, a) => s + netBalance(a.id), 0);
  const loans = accounts.filter(a => /loan/i.test(a.name) && a.account_type === "liability").reduce((s, a) => s + netBalance(a.id), 0);

  const netSales = sumByType("revenue");
  const cogs = sumByType("cogs");
  const expenses = sumByType("expense") + sumByType("other_expense");
  const otherIncome = sumByType("other_income");
  const grossMargin = netSales - cogs;
  const netProfit = grossMargin + otherIncome - expenses;

  const currentAssets = cash + receivables + inventory;
  const currentLiabilities = payables + salariesPayable + taxesPayable + accounts.filter(a => a.account_type === "liability" && !/payable|tax|loan/i.test(a.name)).reduce((s, a) => s + netBalance(a.id), 0) + loans;
  const workingCapital = currentAssets - currentLiabilities;
  const currentRatio = currentLiabilities > 0 ? (currentAssets / currentLiabilities) : 0;

  const draftJournals = journals.filter(j => j.status === "draft" || j.status === "awaiting_review");
  const totalDebit = lines.filter(l => postedJournalIds.has(l.journal_id)).reduce((s, l) => s + (l.debit || 0), 0);
  const totalCredit = lines.filter(l => postedJournalIds.has(l.journal_id)).reduce((s, l) => s + (l.credit || 0), 0);
  const tbBalanced = Math.abs(totalDebit - totalCredit) < 0.01;

  const kpis = [
    { label: "Cash & Equivalents", value: cash, icon: Banknote, tone: "green" },
    { label: "Customer Receivables", value: receivables, icon: Users, tone: "blue" },
    { label: "Inventory Value", value: inventory, icon: Package, tone: "amber" },
    { label: "Supplier Payables", value: payables, icon: Truck, tone: "red" },
    { label: "Net Sales", value: netSales, icon: TrendingUp, tone: "green" },
    { label: "Direct-Material COGS", value: cogs, icon: TrendingDown, tone: "orange" },
    { label: "Material Gross Margin", value: grossMargin, icon: TrendingUp, tone: grossMargin >= 0 ? "green" : "red" },
    { label: "Net Profit / (Loss)", value: netProfit, icon: netProfit >= 0 ? TrendingUp : TrendingDown, tone: netProfit >= 0 ? "green" : "red" },
  ];

  const toneClasses = {
    green: "bg-green-50 text-green-700 border-green-200",
    blue: "bg-blue-50 text-blue-700 border-blue-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    red: "bg-red-50 text-red-700 border-red-200",
    orange: "bg-orange-50 text-orange-700 border-orange-200",
  };

  const quickLinks = [
    { label: "Chart of Accounts", icon: ListTree, path: "/accounting/accounts", desc: "Manage accounts & control accounts" },
    { label: "Journal Entries", icon: BookOpen, path: "/accounting/journals", desc: "View & post double-entry journals" },
    { label: "New Journal Entry", icon: Plus, path: "/accounting/journals/new", desc: "Post a manual balanced journal" },
    { label: "General Ledger", icon: FileText, path: "/accounting/general-ledger", desc: "Account transactions & drill-down" },
    { label: "Trial Balance", icon: Scale, path: "/accounting/trial-balance", desc: "Validate debits equal credits" },
  ];

  if (loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;

  return (
    <div>
      <PageHeader
        title="Financial Command Centre"
        subtitle="Live financial position computed from posted general-ledger transactions"
        actions={<Button onClick={() => navigate("/accounting/journals/new")}><Plus size={16} className="mr-1" /> New Journal</Button>}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {kpis.map(k => (
          <Card key={k.label} className={`p-4 border ${toneClasses[k.tone]}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium uppercase tracking-wide opacity-80">{k.label}</span>
              <k.icon size={18} className="opacity-70" />
            </div>
            <div className="text-xl font-bold">{formatXAF(k.value)}</div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <Card className="p-5">
          <h3 className="font-semibold text-slate-700 mb-3 flex items-center gap-2"><Wallet size={16} /> Liquidity & Working Capital</h3>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">Cash & equivalents</dt><dd className="font-medium">{formatXAF(cash)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Customer receivables</dt><dd className="font-medium">{formatXAF(receivables)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Inventory value</dt><dd className="font-medium">{formatXAF(inventory)}</dd></div>
            <div className="flex justify-between border-t border-slate-100 pt-2"><dt className="text-slate-500">Current assets</dt><dd className="font-semibold">{formatXAF(currentAssets)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Current liabilities</dt><dd className="font-medium">{formatXAF(currentLiabilities)}</dd></div>
            <div className="flex justify-between border-t border-slate-100 pt-2"><dt className="text-slate-500">Working capital</dt><dd className="font-semibold">{formatXAF(workingCapital)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Current ratio</dt><dd className="font-semibold">{currentRatio.toFixed(2)}</dd></div>
          </dl>
        </Card>

        <Card className="p-5">
          <h3 className="font-semibold text-slate-700 mb-3 flex items-center gap-2"><TrendingUp size={16} /> Profitability</h3>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">Net sales</dt><dd className="font-medium">{formatXAF(netSales)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Direct-material COGS</dt><dd className="font-medium">{formatXAF(cogs)}</dd></div>
            <div className="flex justify-between border-t border-slate-100 pt-2"><dt className="text-slate-500">Material gross margin</dt><dd className="font-semibold">{formatXAF(grossMargin)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Operating expenses</dt><dd className="font-medium">{formatXAF(expenses)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Other income</dt><dd className="font-medium">{formatXAF(otherIncome)}</dd></div>
            <div className="flex justify-between border-t border-slate-100 pt-2"><dt className="text-slate-500">Net profit / (loss)</dt><dd className={`font-bold ${netProfit >= 0 ? "text-green-600" : "text-red-600"}`}>{formatXAF(netProfit)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Margin %</dt><dd className="font-semibold">{netSales > 0 ? `${((grossMargin / netSales) * 100).toFixed(1)}%` : "—"}</dd></div>
          </dl>
        </Card>

        <Card className="p-5">
          <h3 className="font-semibold text-slate-700 mb-3 flex items-center gap-2"><Scale size={16} /> Ledger Integrity</h3>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">Total posted debits</dt><dd className="font-medium">{formatXAF(totalDebit)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Total posted credits</dt><dd className="font-medium">{formatXAF(totalCredit)}</dd></div>
            <div className="flex justify-between border-t border-slate-100 pt-2">
              <dt className="text-slate-500">Trial balance</dt>
              <dd className={`font-semibold flex items-center gap-1 ${tbBalanced ? "text-green-600" : "text-red-600"}`}>
                {tbBalanced ? "Balanced" : "Out of balance"}
              </dd>
            </div>
            <div className="flex justify-between"><dt className="text-slate-500">Posted journals</dt><dd className="font-medium">{postedJournalIds.size}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Draft journals</dt><dd className="font-medium text-amber-600">{draftJournals.length}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Salaries payable</dt><dd className="font-medium">{formatXAF(salariesPayable)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Taxes payable</dt><dd className="font-medium">{formatXAF(taxesPayable)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Loans outstanding</dt><dd className="font-medium">{formatXAF(loans)}</dd></div>
          </dl>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-5">
          <h3 className="font-semibold text-slate-700 mb-3">Accounting Modules</h3>
          <div className="space-y-2">
            {quickLinks.map(link => (
              <button key={link.path} onClick={() => navigate(link.path)} className="w-full flex items-center justify-between p-3 rounded-lg border border-slate-200 hover:border-amber-300 hover:bg-amber-50/50 transition-colors text-left">
                <div className="flex items-center gap-3">
                  <link.icon size={18} className="text-amber-500" />
                  <div><div className="font-medium text-slate-800 text-sm">{link.label}</div><div className="text-xs text-slate-500">{link.desc}</div></div>
                </div>
                <ArrowRight size={16} className="text-slate-400" />
              </button>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <h3 className="font-semibold text-slate-700 mb-3">Recent Journal Entries</h3>
          {journals.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-sm">
              <AlertTriangle size={24} className="mx-auto mb-2 opacity-40" />
              No journal entries yet. Post your first journal to populate the ledger.
              <div className="mt-3"><Button size="sm" onClick={() => navigate("/accounting/journals/new")}><Plus size={14} className="mr-1" /> New Journal Entry</Button></div>
            </div>
          ) : (
            <div className="space-y-1">
              {journals.slice(0, 8).map(j => (
                <button key={j.id} onClick={() => navigate(`/accounting/journals/${j.id}`)} className="w-full flex items-center justify-between p-2.5 rounded-lg hover:bg-slate-50 text-left">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2"><span className="font-mono text-xs text-amber-600">{j.journal_number}</span><StatusBadge status={j.status} /></div>
                    <div className="text-sm text-slate-700 truncate">{j.description}</div>
                  </div>
                  <div className="text-right ml-2 shrink-0"><div className="text-xs text-slate-400">{formatDate(j.entry_date)}</div><div className="text-sm font-medium">{formatXAF(j.total_debit)}</div></div>
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}