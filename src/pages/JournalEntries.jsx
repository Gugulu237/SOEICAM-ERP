import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate } from "react-router-dom";
import { formatXAF, formatDate } from "@/lib/formatters";
import PageHeader from "@/components/shared/PageHeader";
import DataTable from "@/components/shared/DataTable";
import StatusBadge from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus } from "lucide-react";

const STATUS_FILTERS = ["all", "draft", "awaiting_review", "approved", "posted", "reversed"];

export default function JournalEntries() {
  const [journals, setJournals] = useState([]);
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const navigate = useNavigate();

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      const [j, l] = await Promise.all([
        base44.entities.JournalEntry.list("-entry_date", 200),
        base44.entities.JournalLine.list("-created_date", 500),
      ]);
      setJournals(j);
      setLines(l);
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  const lineCountMap = {};
  lines.forEach(l => { lineCountMap[l.journal_id] = (lineCountMap[l.journal_id] || 0) + 1; });

  const filtered = statusFilter === "all" ? journals : journals.filter(j => j.status === statusFilter);

  const cols = [
    { key: "journal_number", label: "Journal #" },
    { key: "entry_date", label: "Date", render: v => formatDate(v) },
    { key: "reference", label: "Reference", render: v => v || "—" },
    { key: "description", label: "Description" },
    { key: "source_module", label: "Source", render: v => v?.replace(/_/g, " ") || "—" },
    { key: "id", label: "Lines", sortable: false, render: (_, row) => lineCountMap[row.id] || 0, className: "text-center" },
    { key: "total_debit", label: "Debit", render: v => formatXAF(v), className: "text-right" },
    { key: "total_credit", label: "Credit", render: v => formatXAF(v), className: "text-right" },
    { key: "status", label: "Status", render: v => <StatusBadge status={v} /> },
  ];

  if (loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;

  return (
    <div>
      <PageHeader
        title="Journal Entries"
        subtitle={`${journals.length} entries · ${journals.filter(j => j.status === "posted").length} posted`}
        actions={<Button onClick={() => navigate("/accounting/journals/new")}><Plus size={16} className="mr-1" /> New Journal Entry</Button>}
      />
      <div className="flex items-center gap-3 mb-4">
        <span className="text-sm text-slate-500">Status:</span>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            {STATUS_FILTERS.filter(s => s !== "all").map(s => <SelectItem key={s} value={s}><span className="capitalize">{s.replace(/_/g, " ")}</span></SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <DataTable
        columns={cols}
        data={filtered}
        searchFields={["journal_number", "description", "reference"]}
        onRowClick={row => navigate(`/accounting/journals/${row.id}`)}
        emptyMessage="No journal entries yet. Create a new journal entry to post a transaction."
      />
    </div>
  );
}