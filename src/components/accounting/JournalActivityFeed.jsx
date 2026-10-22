
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useEffect, useState } from "react";
import { Link } from "@/lib/router";
import { erp } from "@/api/erpClient";
import { formatDateTime } from "@/lib/formatters";
import { History } from "lucide-react";
import AuditSourceBadge from "@/components/shared/AuditSourceBadge";

const ACTION_LABELS = {
  get post_journal(){return ui("Journal posted");},
  get create_draft_journal(){return ui("Draft created");},
  get reverse_journal(){return ui("Journal reversed");},
};

export default function JournalActivityFeed() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    erp.entities.AuditLog.filter({ module: "accounting" }, { sort: "-created_date", limit: 15, include_total: false })
      .then((page) => setEvents(page.items))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return null;

  return (
    <div className="mt-6 rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
        <History size={16} className="text-slate-500" />
        <h3 className="font-semibold text-slate-700">{ui("Recent journal activity")}</h3>
        <span className="text-xs text-slate-500">{ui("What happened, and exactly when")}</span>
      </div>
      {events.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-slate-400">{ui("No journal activity recorded yet.")}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {events.map((e) => (
            <li key={e.id} className="flex items-start justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {ACTION_LABELS[e.action] || String(e.action || '').replace(/_/g, " ")}
                </p>
                <p className="truncate text-sm text-slate-700" title={e.description}>{e.description}</p>
                {(e.user_name || e.user_id) && <p className="text-xs text-slate-400">{ui("by ")}{e.user_name || e.user_id}{e.user_name && e.user_id ? ` · ${e.user_id}` : ''}</p>}
                <AuditSourceBadge event={e} />
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="whitespace-nowrap text-xs text-slate-500">{formatDateTime(e.created_date)}</span>
                {e.entity_type === "JournalEntry" && e.entity_id && (
                  <Link to={`/accounting/journals/${e.entity_id}`} className="text-xs font-medium text-blue-600 hover:underline">{ui("Open")}</Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
