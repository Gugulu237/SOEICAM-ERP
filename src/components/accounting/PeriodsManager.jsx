import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { formatDate } from "@/lib/formatters";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import StatusBadge from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";

export default function PeriodsManager() {
  const { user, isAdmin } = useCurrentUser();
  const { toast } = useToast();
  const [periods, setPeriods] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = () => base44.entities.AccountingPeriod.filter({})
    .then((p) => setPeriods(p.sort((a, b) => a.start_date.localeCompare(b.start_date))))
    .finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  async function transition(period, status, actionLabel) {
    try {
      await base44.entities.AccountingPeriod.update(period.id, { status });
      await base44.entities.AuditLog.create({
        action: `period_${status}`, module: "accounting", entity_type: "AccountingPeriod", entity_id: period.id,
        user_id: user?.id || "", description: `${actionLabel} accounting period ${period.name}`,
      });
      toast({ title: `Period ${period.name}`, description: actionLabel });
      load();
    } catch (e) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
  }

  if (loading) return <div className="py-10 text-center text-slate-400">Loading periods…</div>;

  return (
    <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200 text-left text-slate-500">
            <th className="px-4 py-3">Period</th>
            <th className="px-4 py-3">Fiscal Year</th>
            <th className="px-4 py-3">Start</th>
            <th className="px-4 py-3">End</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {periods.map((p) => (
            <tr key={p.id} className="border-b border-slate-100">
              <td className="px-4 py-3 font-medium">{p.name}</td>
              <td className="px-4 py-3">{p.fiscal_year}</td>
              <td className="px-4 py-3">{formatDate(p.start_date)}</td>
              <td className="px-4 py-3">{formatDate(p.end_date)}</td>
              <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
              <td className="px-4 py-3 text-right">
                <div className="flex justify-end gap-1">
                  {p.status === "open" && isAdmin && (
                    <Button size="sm" variant="outline" onClick={() => transition(p, "closed", "Closed")}>Close</Button>
                  )}
                  {p.status === "closed" && isAdmin && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => transition(p, "open", "Reopened")}>Reopen</Button>
                      <Button size="sm" variant="destructive" onClick={() => transition(p, "locked", "Locked")}>Lock</Button>
                    </>
                  )}
                  {p.status === "locked" && isAdmin && (
                    <Button size="sm" variant="outline" onClick={() => transition(p, "closed", "Unlocked to closed")}>Unlock</Button>
                  )}
                  {!isAdmin && <span className="text-xs text-slate-400">GM only</span>}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-4 py-3 text-xs text-slate-500 bg-slate-50 border-t border-slate-200">
        Posting into closed or locked periods is blocked by the posting engine. Only the General Manager can close, reopen or lock periods — every change is audited.
      </p>
    </div>
  );
}