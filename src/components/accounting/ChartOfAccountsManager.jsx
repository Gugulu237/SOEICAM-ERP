
/* localized-messages */
import { sourceMessage, uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import AccountPosition from './AccountPosition';
import React, { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { erp } from "@/api/erpClient";
import { useToast } from "@/components/ui/use-toast";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ACCOUNT_TYPES, buildAccountTree, visibleAccounts } from "@/lib/account-hierarchy";
import { ledgerTotals } from "@/lib/account-balances";
import AccountStats from "@/components/accounting/AccountStats";
import AccountTree from "@/components/accounting/AccountTree";
import AccountFormDialog from "@/components/accounting/AccountFormDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Plus, Search } from "lucide-react";

const ALL = "all";

export default function ChartOfAccountsManager() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const { toast } = useToast();
  const { isAdmin, isCashier } = useCurrentUser();
  const canManage = isAdmin || isCashier;
  const [view, setView] = useState('accounts');
  const [asOf, setAsOf] = useState('');
  const [error, setError] = useState('');
  const [accounts, setAccounts] = useState([]);
  const [balances, setBalances] = useState({});
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState("visible");
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [dialog, setDialog] = useState(null);
  const [deleting,setDeleting]=useState(null),[deleteError,setDeleteError]=useState(''),[busy,setBusy]=useState(false);
  const mutationRef=useRef(false);

  const load = useCallback(async () => {
    setError('');
    const { data } = await erp.functions.invoke('fieldOps', { action: 'accountPosition' });
    setAccounts(data.accounts); setBalances(data.balances); setAsOf(data.date);
  }, []);

  useEffect(() => {
    setLoading(true);
    load().catch(e => setError(e.message || sourceMessage("Could not load posted account balances"))).finally(() => setLoading(false));
  }, [load]);

  const visible = useMemo(()=>visibleAccounts(accounts,balances,{type:typeFilter,status:statusFilter,query}),[accounts,balances,typeFilter,statusFilter,query]);
  const tree = useMemo(() => {
    const full=buildAccountTree(accounts,balances), filtered=buildAccountTree(visible,balances);
    return {...filtered,rollups:full.rollups,entryCounts:full.entryCounts,sections:filtered.sections.map(s=>({...s,net:s.roots.reduce((sum,a)=>sum+(full.rollups.get(a.id)||0),0)}))};
  }, [accounts,visible,balances]);
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
      await erp.accounting.saveAccount({accountId:node.id, updatedDate:node.updated_date, account:{is_active:node.is_active === false}});
      toast({
        title: node.is_active === false ? ui("Account activated") : ui("Account deactivated"),
        description: `${node.account_number} — ${node.name}`,
      });
      await load();
    } catch (e) {
      toast({ title: ui("Error"), description: e.message, variant: "destructive" });
    }
  }

  async function toggleHidden(node) {
    if(mutationRef.current)return;mutationRef.current=true;setBusy(true);
    try {await erp.accounting.saveAccount({accountId:node.id,updatedDate:node.updated_date,requestKey:crypto.randomUUID(),account:{is_hidden:!node.is_hidden}});await load();}
    catch(e){toast({title:ui("Error"),description:e.message,variant:"destructive"});}
    finally{mutationRef.current=false;setBusy(false);}
  }
  async function deleteAccount() {
    if(mutationRef.current)return;mutationRef.current=true;setBusy(true);setDeleteError('');
    try{await erp.accounting.saveAccount({action:'delete',accountId:deleting.account.id,updatedDate:deleting.account.updated_date,requestKey:deleting.requestKey});setDeleting(null);await load();}
    catch(e){setDeleteError(e.message);}
    finally{mutationRef.current=false;setBusy(false);}
  }

  if (loading) {
    return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;
  }

  return (
    <div>
      {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{uiMessage(error)}<button type="button" className="ml-3 underline" onClick={() => load().catch(e => setError(e.message))}>{ui("Retry")}</button></p>}
      {!error && <AccountStats accounts={accounts} balances={balances} totals={totals} />}

      <div className="mb-4 flex flex-wrap gap-2"><Button variant={view === 'position' ? 'default' : 'outline'} onClick={() => setView('position')}>{ui("Assets & liabilities (T view)")}</Button><Button variant={view === 'accounts' ? 'default' : 'outline'} onClick={() => setView('accounts')}>{ui("Account list")}</Button><Button variant="outline" onClick={() => load().catch(e => setError(e.message))}>{ui("Refresh balances")}</Button></div>
      {view === 'position' && !error && <AccountPosition accounts={accounts} balances={balances} date={asOf}/>}
      {view === 'accounts' && <>
      <div className="flex flex-col lg:flex-row lg:items-center gap-2 mb-4">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            className="pl-9"
            placeholder={ui("Search by account number or name")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="lg:w-52"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{ui("All account types")}</SelectItem>
            {ACCOUNT_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="lg:w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="visible">{ui("Visible accounts")}</SelectItem>
            <SelectItem value="used">{ui("Used accounts")}</SelectItem>
            <SelectItem value="hidden">{ui("Hidden accounts")}</SelectItem>
            <SelectItem value={ALL}>{ui("All accounts")}</SelectItem>
            <SelectItem value="active">{ui("Active only")}</SelectItem>
            <SelectItem value="inactive">{ui("Inactive only")}</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex gap-2">
          <Button variant="outline" onClick={expandAll}>{ui("Expand all")}</Button>
          <Button variant="outline" onClick={collapseAll}>{ui("Collapse all")}</Button>
          {canManage && (
            <Button onClick={() => setDialog({ parentId: "" })}>
              <Plus size={16} className="mr-1" />{ui(" New Account")}</Button>
          )}
        </div>
      </div>

      <p className="mb-3 text-xs text-slate-500">{ui("Hiding only changes this list. All transactions and financial reports remain complete. Used accounts includes accounts with postings or opening balances.")}</p>
      {tree.sections.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white py-16 text-center text-slate-400">
          {accounts.length === 0 ? ui("No accounts yet — create the first one.") : ui("No accounts match these filters.")}
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
          onToggleHidden={toggleHidden}
          onDelete={node=>{setDeleteError('');setDeleting({account:node,requestKey:crypto.randomUUID()});}}
          busy={busy}
          canManage={canManage}
        />
      )}

      </>}
      {deleting && <Dialog open onOpenChange={open=>{if(!open && !busy)setDeleting(null);}}><DialogContent><DialogHeader><DialogTitle>{ui("Delete unused account")}</DialogTitle></DialogHeader><p>{deleting.account.account_number} — {deleting.account.name}</p><p className="text-sm text-slate-600">{ui("Only accounts without transactions, balances, sub-accounts or configuration links can be permanently deleted. Hide accounts you may need again.")}</p>{deleteError && <p role="alert" className="text-sm text-red-700">{uiMessage(deleteError)}</p>}<DialogFooter><Button variant="outline" disabled={busy} onClick={()=>setDeleting(null)}>{ui("Cancel")}</Button><Button variant="destructive" disabled={busy} onClick={deleteAccount}>{busy?ui("Deleting..."):ui("Delete account permanently")}</Button></DialogFooter></DialogContent></Dialog>}
      {dialog && (
        <AccountFormDialog
          account={dialog.account || null}
          accounts={accounts}
          balances={balances}
          defaultParentId={dialog.parentId || ""}
          onClose={() => setDialog(null)}
          onDone={() => { setDialog(null); load().catch(e => setError(e.message)); }}
        />
      )}
    </div>
  );
}