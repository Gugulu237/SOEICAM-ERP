import React, { useCallback, useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useToast } from "@/components/ui/use-toast";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ACCOUNT_TYPES, buildAccountTree } from "@/lib/account-hierarchy";
import { loadAccountBalances, ledgerTotals } from "@/lib/account-balances";
import AccountStats from "@/components/accounting/AccountStats";
import AccountTree from "@/components/accounting/AccountTree";
import AccountFormDialog from "@/components/accounting/AccountFormDialog";
import { Plus, Search } from "lucide-react";

const ALL = "all";

export default function ChartOfAccountsManager() {
  const { toast } = useToast();
  const { isAdmin } = useCurrentUser();
  const [accounts, setAccounts] = useState([]);
  const [balances, setBalances] = useState({});
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [dialog, setDialog] = useState(null);

  const load = useCallback(async () => {
    const [accs, bals] = await Promise.all([
      base44.entities.Account.list("account_number", 1000),
      loadAccountBalances(),
    ]);
    setAccounts(accs);
    setBalances(bals);
  }, []);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const visible = useMemo(() => {
    const byId = new Map(accounts.map((a) => [a.id, a]));
    let list = accounts;
    if (typeFilter !== ALL) list = list.filter((a) => a.account_type === typeFilter);
    if (statusFilter === "active") list = list.filter((a) => a.is_active !== false);
    if (statusFilter === "inactive") list = list.filter((a) => a.is_active === false);

    const q = query.trim().toLowerCase();
    if (q) {
      const keep = new Set();
      list
        .filter((a) => `${a.account_number} ${a.name}`.toLowerCase().includes(q))
        .forEach((a) => {
          keep.add(a.id);
          let parentId = a.parent_id;
          while (parentId && byId.has(parentId)) {
            keep.add(parentId);
            parentId = byId.get(parentId).parent_id;
          }
        });
      list = list.filter((a) => keep.has(a.id));
    }
    return list;
  }, [accounts, typeFilter, statusFilter, query]);

  const tree = useMemo(() => buildAccountTree(visible, balances), [visible, balances]);
  const totals = useMemo(() => ledgerTotals(balances), [balances]);

  const toggleCollapse = (id) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandAll = () => setCollapsed(new Set());
  const collapseAll = () =>
    setCollapsed(new Set(accounts.filter((a) => accounts.some((c) => c.parent_id === a.id)).map((a) => a.id)));

  async function toggleActive(node) {
    try {
      await base44.entities.Account.update(node.id, { is_active: node.is_active === false });
      toast({
        title: node.is_active === false ? "Account activated" : "Account deactivated",
        description: `${node.account_number} — ${node.name}`,
      });
      await load();
    } catch (e) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  }

  if (loading) {
    return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;
  }

  return (
    <div>
      <AccountStats accounts={accounts} balances={balances} totals={totals} />

      <div className="flex flex-col lg:flex-row lg:items-center gap-2 mb-4">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            className="pl-9"
            placeholder="Search by account number or name"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="lg:w-52"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All account types</SelectItem>
            {ACCOUNT_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="lg:w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Active & inactive</SelectItem>
            <SelectItem value="active">Active only</SelectItem>
            <SelectItem value="inactive">Inactive only</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex gap-2">
          <Button variant="outline" onClick={expandAll}>Expand all</Button>
          <Button variant="outline" onClick={collapseAll}>Collapse all</Button>
          {isAdmin && (
            <Button onClick={() => setDialog({ parentId: "" })}>
              <Plus size={16} className="mr-1" /> New Account
            </Button>
          )}
        </div>
      </div>

      {tree.sections.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white py-16 text-center text-slate-400">
          {accounts.length === 0 ? "No accounts yet — create the first one." : "No accounts match these filters."}
        </div>
      ) : (
        <AccountTree
          sections={tree.sections}
          childrenMap={tree.childrenMap}
          rollups={tree.rollups}
          entryCounts={tree.entryCounts}
          collapsed={collapsed}
          onToggleCollapse={toggleCollapse}
          onEdit={(node) => setDialog({ account: node })}
          onAddChild={(node) => setDialog({ parentId: node.id })}
          onToggleActive={toggleActive}
          canManage={isAdmin}
        />
      )}

      {dialog && (
        <AccountFormDialog
          account={dialog.account || null}
          accounts={accounts}
          balances={balances}
          defaultParentId={dialog.parentId || ""}
          onClose={() => setDialog(null)}
          onDone={() => { setDialog(null); load(); }}
        />
      )}
    </div>
  );
}