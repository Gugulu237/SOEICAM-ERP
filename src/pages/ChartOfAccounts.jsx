import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate } from "react-router-dom";
import { formatXAF } from "@/lib/formatters";
import PageHeader from "@/components/shared/PageHeader";
import DataTable from "@/components/shared/DataTable";
import StatusBadge from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus } from "lucide-react";
import AccountFormDialog from "@/components/accounting/AccountFormDialog";

const TYPE_FILTERS = ["all", "asset", "liability", "equity", "revenue", "cogs", "expense"];

export default function ChartOfAccounts() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [editAccount, setEditAccount] = useState(null);
  const navigate = useNavigate();

  useEffect(() => { loadAccounts(); }, []);

  async function loadAccounts() {
    try {
      const list = await base44.entities.Account.filter({});
      setAccounts(list.sort((a, b) => a.account_number.localeCompare(b.account_number)));
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  const filtered = typeFilter === "all" ? accounts : accounts.filter(a => a.account_type === typeFilter);

  const cols = [
    { key: "account_number", label: "Code" },
    { key: "name", label: "Account Name" },
    { key: "account_type", label: "Type", render: v => <StatusBadge status={v} /> },
    { key: "subtype", label: "Subtype", render: v => v || "—" },
    { key: "normal_balance", label: "Normal", render: v => <span className="capitalize">{v}</span> },
    { key: "is_posting", label: "Posting", render: v => v === false ? <span className="text-xs text-slate-400">Header</span> : "✓" },
    { key: "is_control_account", label: "Control", render: v => v ? "✓" : "—" },
    { key: "balance", label: "Balance", render: v => formatXAF(v), className: "text-right" },
    { key: "is_active", label: "Status", render: v => <StatusBadge status={v ? "active" : "inactive"} /> },
  ];

  if (loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;

  return (
    <div>
      <PageHeader
        title="Chart of Accounts"
        subtitle={`${accounts.length} accounts · SYSCOHADA-aligned, configurable`}
        actions={<Button onClick={() => { setEditAccount(null); setShowForm(true); }}><Plus size={16} className="mr-1" /> New Account</Button>}
      />
      <div className="flex items-center gap-3 mb-4">
        <span className="text-sm text-slate-500">Filter by type:</span>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {TYPE_FILTERS.filter(t => t !== "all").map(t => <SelectItem key={t} value={t}><span className="capitalize">{t.replace(/_/g, " ")}</span></SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={() => navigate("/accounting/general-ledger")}>View General Ledger</Button>
      </div>
      <DataTable
        columns={cols}
        data={filtered}
        searchFields={["account_number", "name", "subtype"]}
        onRowClick={row => { setEditAccount(row); setShowForm(true); }}
        emptyMessage="No accounts. Create your first account to begin."
      />
      <AccountFormDialog open={showForm} onOpenChange={setShowForm} account={editAccount} onSaved={loadAccounts} />
    </div>
  );
}