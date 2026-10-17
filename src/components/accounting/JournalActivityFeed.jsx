import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { formatDateTime } from "@/lib/formatters";
import { History } from "lucide-react";

const ACTION_LABELS = {
  post_journal: "Journal posted",
  create_draft_journal: "Draft created",
  reverse_journal: "Journal reversed",
};

export default function JournalActivityFeed() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    base44.entities.AuditLog.filter({ module: "accounting" }, { sort: "-created_date", limit: 15 })
      .then((page) => setEvents(page.items))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return null;

  return (
    <div className="mt-6 rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
        <History size={16} className="text-slate-500" />
        <h3 className="font-semibold text-slate-700">Recent journal activity</h3>
        <span className="text-xs text-slate-500">What happened, and exactly when</span>
      </div>
      {events.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-slate-400">No journal activity recorded yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {events.map((e) => (
            <li key={e.id} className="flex items-start justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {ACTION_LABELS[e.action] || e.action.replace(/_/g, " ")}
                </p>
                <p className="truncate text-sm text-slate-700" title={e.description}>{e.description}</p>
                {e.user_name && <p className="text-xs text-slate-400">by {e.user_name}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="whitespace-nowrap text-xs text-slate-500">{formatDateTime(e.created_date)}</span>
                {e.entity_type === "JournalEntry" && e.entity_id && (
                  <Link to={`/accounting/journals/${e.entity_id}`} className="text-xs font-medium text-blue-600 hover:underline">
                    Open
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}