
/* localized-messages */
import { sourceMessage, uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState, useEffect } from "react";
import { Navigate, useNavigate } from "@/lib/router";
import { formatDate, formatXAF } from "@/lib/formatters";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useToast } from "@/components/ui/use-toast";
import PageHeader from "@/components/shared/PageHeader";
import DataTable from "@/components/shared/DataTable";
import StatusBadge from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Check, X, Loader2, RefreshCw } from "lucide-react";
import RejectDialog from "@/components/approvals/RejectDialog";
import ProductionApprovalNotice from '@/components/manufacturing/ProductionApprovalNotice';
import { loadPendingApprovals, approveItem, rejectItem, canDecide, APPROVAL_TYPE_LABELS, APPROVAL_OWNER } from "@/lib/approvals";

export default function Approvals({ embedded = false, preview = false, onDecision }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [productionCheck,setProductionCheck]=useState(null);
  const [typeFilter, setTypeFilter] = useState("all");
  const [rejectTarget, setRejectTarget] = useState(null);
  const navigate = useNavigate();
  const { user, employee, role, principalRole } = useCurrentUser();
  const actualGM=(principalRole||role)==='admin';
  const mayDecide=row=>canDecide(row._type,role) && !(row._type==='expense' && role!=='admin' && row.requester_id===employee?.id);
  const { toast } = useToast();

  const actor = { userId: user?.id, userName: user?.full_name || user?.email || "", role };

  async function loadPending() {
    setLoadError('');
    try { setItems(await loadPendingApprovals(role)); }
    catch (error) { setLoadError(error.message || sourceMessage("Could not load operational requests.")); }
    finally { setLoading(false); }
  }

  useEffect(() => { if (role && !preview && (embedded || !actualGM)) loadPending(); }, [role, actualGM, preview, embedded]);

  async function handleApprove(row) {
    if (busyId) return;
    setBusyId(row.id);setProductionCheck(null);
    try {
      const result=await approveItem(row, actor);
      if(result?.blocked){setProductionCheck({...result,orderId:row.id,reference:row._ref});return;}
      toast({ title: ui("Approved"), description: `${APPROVAL_TYPE_LABELS[row._type]} ${row._ref}` });
      await loadPending();
      onDecision?.();
    } catch (e) {
      toast({ title: ui("Could not approve"), description: e.message, variant: "destructive" });
    }
    finally {setBusyId(null);}
  }

  async function handleReject(reason) {
    const row = rejectTarget;
    setBusyId(row.id);
    try {
      await rejectItem(row, { ...actor, reason });
      toast({ title: ui("Rejected"), description: `${APPROVAL_TYPE_LABELS[row._type]} ${row._ref}` });
      setRejectTarget(null);
      await loadPending();
      onDecision?.();
    } catch (e) {
      toast({ title: ui("Could not reject"), description: e.message, variant: "destructive" });
    }
    setBusyId(null);
  }

  const counts = items.reduce((acc, i) => ({ ...acc, [i._type]: (acc[i._type] || 0) + 1 }), {});
  const visible = typeFilter === "all" ? items : items.filter(i => i._type === typeFilter);
  const canDecideAny = items.some(mayDecide);

  const cols = [
    { key: "_type", label: ui("Type"), render: v => <span className="font-medium text-slate-900">{APPROVAL_TYPE_LABELS[v] || v}</span> },
    { key: "_ref", label: ui("Reference") },
    { key: "_summary", label: ui("Details"), render: v => <span className="text-slate-500">{v || "—"}</span> },
    { key: "_amount", label: ui("Amount"), className: "text-right", render: v => (v ? formatXAF(v) : "—") },
    { key: "created_date", label: ui("Raised"), render: v => formatDate(v) },
    { key: "status", label: ui("Status"), render: v => <StatusBadge status={v} /> },
    {
      key: "actions", label: "", sortable: false, className: "text-right",
      render: (_, row) => (
        <div className="flex justify-end gap-1" onClick={e => e.stopPropagation()}>
          {mayDecide(row) ? (
            <>
              <Button size="sm" disabled={busyId === row.id} onClick={() => handleApprove(row)}>
                {busyId === row.id
                  ? <Loader2 size={14} className="animate-spin" />
                  : <><Check size={14} className="mr-1" />{ui(" Approve")}</>}
              </Button>
              <Button size="sm" variant="outline" disabled={busyId === row.id} onClick={() => setRejectTarget(row)}>
                <X size={14} className="mr-1" />{ui(" Reject")}</Button>
            </>
          ) : (
            <span className="text-xs text-slate-400 whitespace-nowrap">{ui("Awaiting ")}{APPROVAL_OWNER[row._type]}</span>
          )}
        </div>
      ),
    },
  ];

  if (!embedded && actualGM) return <Navigate to="/?section=approvals" replace />;
  if (preview) return <section className="rounded-2xl border bg-white p-6"><h2 className="text-xl font-semibold">{ui("Approvals")}</h2><p className="mt-2 text-sm text-slate-500">{ui("Open the live General Manager dashboard to review and decide approval requests.")}</p></section>;
  if (loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-primary rounded-full animate-spin" /></div>;

  return (
    <div>
      <PageHeader
        title={ui("Pending Approvals")}
        subtitle={ui("{0} item{1} awaiting a decision", items.length, items.length === 1 ? "" : "s")}
        actions={
          <Button variant="outline" onClick={loadPending}><RefreshCw size={16} className="mr-1" />{ui(" Refresh")}</Button>
        }
      />

      {loadError && <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{uiMessage(loadError)}</p>}
      <ProductionApprovalNotice result={productionCheck} reference={productionCheck?.reference} onReview={()=>navigate(`/manufacturing/${productionCheck.orderId}`)}/>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{ui("All types (")}{items.length})</SelectItem>
            {Object.entries(APPROVAL_TYPE_LABELS)
              .filter(([key]) => counts[key])
              .map(([key, label]) => (
                <SelectItem key={key} value={key}>{label} ({counts[key]})</SelectItem>
              ))}
          </SelectContent>
        </Select>
        {!canDecideAny && items.length > 0 && (
          <p className="text-sm text-slate-500">{ui("These items are waiting for another approver — open one to see its detail.")}</p>
        )}
      </div>

      <DataTable
        columns={cols}
        data={visible}
        searchFields={["_ref", "_summary", "_type"]}
        emptyMessage={ui("No pending approvals 🎉")}
        onRowClick={row => row._link && navigate(row._link)}
      />

      <RejectDialog
        key={rejectTarget?.id || "none"}
        open={!!rejectTarget}
        onOpenChange={open => !open && setRejectTarget(null)}
        item={rejectTarget}
        onConfirm={handleReject}
        busy={busyId === rejectTarget?.id}
      />
    </div>
  );
}
