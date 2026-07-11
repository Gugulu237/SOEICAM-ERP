import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate } from "react-router-dom";
import { formatXAF, formatDate } from "@/lib/formatters";
import PageHeader from "@/components/shared/PageHeader";
import StatusBadge from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export default function JournalEntries() {
  const navigate = useNavigate();
  const [journals, setJournals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    base44.entities.JournalEntry.list("-entry_date", 200)
      .then(setJournals).finally(() => setLoading(false));
  }, []);

  const filtered = filter === "all" ? journals : journals.filter(j => j.status === filter);

  if (loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;

  const statuses = ["all", "draft", "awaiting_review", "approved", "posted", "reversed", "rejected"];

  return (
    <div>
      <PageHeader title="Journal Entries" subtitle="Immutable posted journals — corrections use reversal"
        actions={<Button onClick={() => navigate("/accounting/journals/new")}><Plus size={16} className="mr-1" /> New Journal</Button>} />

      <div className="flex gap-1 mb-4 overflow-x-auto">
        {statuses.map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-3 py-1.5 text-xs rounded-full whitespace-nowrap capitalize ${filter === s ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
            {s.replace(/_/g, " ")}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-slate-50 text-left text-slate-600">
              <th className="px-4 py-3 font-medium">Journal #</th>
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">Description</th>
              <th className="px-4 py-3 font-medium">Reference</th>
              <th className="px-4 py-3 font-medium">Source</th>
              <th className="px-4 py-3 text-right font-medium">Debit</th>
              <th className="px-4 py-3 text-right font-medium">Credit</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(j => (
              <tr key={j.id} className="border-b last:border-0 hover:bg-slate-50 cursor-pointer" onClick={() => navigate(`/accounting/journals/${j.id}`)}>
                <td className="px-4 py-2 font-medium">{j.journal_number}</td>
                <td className="px-4 py-2">{formatDate(j.entry_date)}</td>
                <td className="px-4 py-2 max-w-xs truncate">{j.description}</td>
                <td className="px-4 py-2 text-slate-500">{j.reference || "—"}</td>
                <td className="px-4 py-2 text-slate-500">{j.source_module}</td>
                <td className="px-4 py-2 text-right">{formatXAF(j.total_debit)}</td>
                <td className="px-4 py-2 text-right">{formatXAF(j.total_credit)}</td>
                <td className="px-4 py-2"><StatusBadge status={j.status} /></td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">No journals found</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}