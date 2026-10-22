
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState, useEffect } from "react";
import { erp } from "@/api/erpClient";
import { formatDate } from "@/lib/formatters";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import StatusBadge from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";

export default function PeriodsManager() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const { user, isAdmin } = useCurrentUser();
  const { toast } = useToast();
  const [periods, setPeriods] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = () => erp.entities.AccountingPeriod.filter({})
    .then((p) => setPeriods(p.sort((a, b) => a.start_date.localeCompare(b.start_date))))
    .finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  async function transition(period, status, actionLabel) {
    try {
      await erp.entities.AccountingPeriod.update(period.id, { status });
      await erp.entities.AuditLog.create({
        action: `period_${status}`, module: "accounting", entity_type: "AccountingPeriod", entity_id: period.id,
        user_id: user?.id || "", description: ui("{0} accounting period {1}", actionLabel, period.name),
      });
      toast({ title: ui("Period {0}", period.name), description: actionLabel });
      load();
    } catch (e) { toast({ title: ui("Error"), description: e.message, variant: "destructive" }); }
  }

  if (loading) return <div className="py-10 text-center text-slate-400">{ui("Loading periods…")}</div>;

  return (
    <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200 text-left text-slate-500">
            <th className="px-4 py-3">{ui("Period")}</th>
            <th className="px-4 py-3">{ui("Fiscal Year")}</th>
            <th className="px-4 py-3">{ui("Start")}</th>
            <th className="px-4 py-3">{ui("End")}</th>
            <th className="px-4 py-3">{ui("Status")}</th>
            <th className="px-4 py-3 text-right">{ui("Actions")}</th>
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
                    <Button size="sm" variant="outline" onClick={() => transition(p, "closed", "Closed")}>{ui("Close")}</Button>
                  )}
                  {p.status === "closed" && isAdmin && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => transition(p, "open", "Reopened")}>{ui("Reopen")}</Button>
                      <Button size="sm" variant="destructive" onClick={() => transition(p, "locked", "Locked")}>{ui("Lock")}</Button>
                    </>
                  )}
                  {p.status === "locked" && isAdmin && (
                    <Button size="sm" variant="outline" onClick={() => transition(p, "closed", "Unlocked to closed")}>{ui("Unlock")}</Button>
                  )}
                  {!isAdmin && <span className="text-xs text-slate-400">{ui("GM only")}</span>}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-4 py-3 text-xs text-slate-500 bg-slate-50 border-t border-slate-200">{ui("Posting into closed or locked periods is blocked by the posting engine. Only the General Manager can close, reopen or lock periods — every change is audited.")}</p>
    </div>
  );
}