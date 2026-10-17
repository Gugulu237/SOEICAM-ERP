import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PageHeader from "@/components/shared/PageHeader";
import StatusPill from "@/components/field/StatusPill";
import HandoverConfirmDialog from "@/components/field/HandoverConfirmDialog";
import HandoverSubmitDialog from "@/components/field/HandoverSubmitDialog";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { HANDOVER_STATUS, COLLECTION_STATUS } from "@/lib/field-ops";
import { formatXAF, formatDate } from "@/lib/formatters";
import { Loader2 } from "lucide-react";

export default function CashHandovers() {
  const { employee, canReceiveHandover, loading: authLoading } = useCurrentUser();
  const [tab, setTab] = useState(canReceiveHandover ? "queue" : "mine");
  const [handovers, setHandovers] = useState([]);
  const [collections, setCollections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    const [queue, history, cash] = await Promise.all([
      base44.entities.CashHandover.filter({ status: { $in: ["submitted", "partially_received", "disputed"] } }, { sort: "-submitted_at", limit: 100 }),
      base44.entities.CashHandover.filter({ status: "received" }, { sort: "-confirmed_at", limit: 50 }),
      employee
        ? base44.entities.CashCollection.filter(
            { commercial_id: employee.id, status: { $in: ["held_by_commercial", "partially_received"] } },
            { sort: "-collection_date", limit: 100 }
          )
        : Promise.resolve({ items: [] }),
    ]);
    setHandovers([...queue.items, ...history.items]);
    setCollections(cash.items);
    setLoading(false);
  };

  useEffect(() => { if (!authLoading) load(); }, [authLoading, employee?.id]);

  const queue = handovers.filter((h) => h.status !== "received");
  const history = handovers.filter((h) => h.status === "received");
  const cashHeld = collections.reduce((s, c) => s + (c.outstanding_amount || 0), 0);

  const list = (rows, onClick) => (
    <Card><CardContent className="p-0 divide-y divide-slate-100">
      {!rows.length && <p className="p-4 text-sm text-slate-500">Nothing here.</p>}
      {rows.map((h) => (
        <button
          key={h.id}
          onClick={() => onClick && onClick(h)}
          className="w-full text-left flex items-center justify-between px-4 py-3 hover:bg-slate-50"
        >
          <div>
            <div className="font-medium text-slate-800">{h.handover_number} — {h.commercial_name}</div>
            <div className="text-xs text-slate-500">
              {formatDate(h.handover_date)}
              {h.acknowledgement_reference ? ` · ${h.acknowledgement_reference}` : ""}
            </div>
            {h.variance_reason && <div className="text-xs text-amber-700">{h.variance_reason}</div>}
          </div>
          <div className="text-right space-y-1">
            <div className="font-semibold tabular-nums">{formatXAF(h.received_amount || h.offered_amount)}</div>
            <StatusPill map={HANDOVER_STATUS} value={h.status} />
          </div>
        </button>
      ))}
    </CardContent></Card>
  );

  if (loading) return <div className="flex justify-center py-24"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>;

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <PageHeader
        title="Cash Handovers"
        subtitle={canReceiveHandover
          ? "Confirm the cash you physically receive from a Commercial"
          : "Hand the cash you collected over to a cashier"}
        actions={!canReceiveHandover ? (
          <Button onClick={() => setSubmitting(true)} disabled={!collections.length}>Hand over cash</Button>
        ) : null}
      />

      {canReceiveHandover ? (
        <>
          <Tabs value={tab} onValueChange={setTab} className="mb-4">
            <TabsList>
              <TabsTrigger value="queue">Awaiting receipt ({queue.length})</TabsTrigger>
              <TabsTrigger value="history">Received</TabsTrigger>
            </TabsList>
          </Tabs>
          {tab === "queue" ? list(queue, setConfirming) : list(history)}
        </>
      ) : (
        <>
          <Card className="mb-4"><CardContent className="flex items-center justify-between py-4">
            <div>
              <div className="text-sm text-slate-500">Cash still held by you</div>
              <div className="text-2xl font-bold text-slate-900">{formatXAF(cashHeld)}</div>
            </div>
            <div className="text-sm text-slate-500">{collections.length} collection(s)</div>
          </CardContent></Card>

          <Card className="mb-4"><CardContent className="p-0 divide-y divide-slate-100">
            {!collections.length && <p className="p-4 text-sm text-slate-500">Nothing outstanding.</p>}
            {collections.map((c) => (
              <div key={c.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <div className="font-medium text-slate-800">{c.collection_number} — {c.customer_name}</div>
                  <div className="text-xs text-slate-500">{c.sale_number} · {formatDate(c.collection_date)}</div>
                </div>
                <div className="text-right space-y-1">
                  <div className="font-semibold tabular-nums">{formatXAF(c.outstanding_amount)}</div>
                  <StatusPill map={COLLECTION_STATUS} value={c.status} />
                </div>
              </div>
            ))}
          </CardContent></Card>

          <h2 className="text-sm font-semibold text-slate-700 mb-2">My handovers</h2>
          {list(handovers.filter((h) => !employee || h.commercial_id === employee.id))}
        </>
      )}

      {confirming && (
        <HandoverConfirmDialog handover={confirming} onClose={() => setConfirming(null)} onDone={load} />
      )}
      <HandoverSubmitDialog
        open={submitting}
        onClose={() => setSubmitting(false)}
        collections={collections}
        employee={employee}
        onDone={load}
      />
    </div>
  );
}