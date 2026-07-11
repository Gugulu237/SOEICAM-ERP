import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate, useParams } from "react-router-dom";
import { formatXAF, formatDate, formatDateTime } from "@/lib/formatters";
import PageHeader from "@/components/shared/PageHeader";
import StatusBadge from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { ArrowLeft, Undo2, FileText } from "lucide-react";

export default function JournalEntryDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [journal, setJournal] = useState(null);
  const [lines, setLines] = useState([]);
  const [reversing, setReversing] = useState(false);

  useEffect(() => {
    Promise.all([
      base44.entities.JournalEntry.get(id),
      base44.entities.JournalLine.filter({ journal_id: id }),
    ]).then(([j, l]) => { setJournal(j); setLines(l); });
  }, [id]);

  async function handleReverse() {
    if (!journal) return;
    if (!confirm("Reverse this journal? A new reversing journal will be posted (negated). The original becomes immutable 'reversed'.")) return;
    setReversing(true);
    try {
      const res = await base44.functions.invoke("postJournal", {
        source_module: "reversal",
        source_document_type: "JournalEntry",
        source_document_id: journal.id,
        idempotency_key: `reversal:JournalEntry:${journal.id}`,
        entry_date: new Date().toISOString().split("T")[0],
        description: `Reversal of ${journal.journal_number} — ${journal.description}`,
        reversal_of: journal.id,
        reversal_reason: "Manual reversal",
        lines: lines.map(l => ({
          account_id: l.account_id,
          debit: Number(l.credit) || 0,
          credit: Number(l.debit) || 0,
          description: `Reversal — ${l.description || ""}`,
          party_type: l.party_type, party_id: l.party_id,
          branch_id: l.branch_id, department_id: l.department_id
        }))
      });
      toast({ title: "Reversed", description: `Reversing journal ${res.data.journal_number} posted` });
      navigate(`/accounting/journals/${res.data.journal_id}`);
    } catch (e) {
      toast({ title: "Reversal failed", description: e.response?.data?.error || e.message, variant: "destructive" });
    }
    setReversing(false);
  }

  if (!journal) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;

  const canReverse = journal.status === "posted" && !journal.reversed_by_journal;

  return (
    <div>
      <PageHeader title={journal.journal_number} subtitle={<StatusBadge status={journal.status} />}
        actions={
          <div className="flex gap-2">
            {canReverse && <Button variant="destructive" onClick={handleReverse} disabled={reversing}><Undo2 size={16} className="mr-1" /> {reversing ? "Reversing..." : "Reverse"}</Button>}
            <Button variant="outline" onClick={() => navigate("/accounting/journals")}><ArrowLeft size={16} className="mr-1" /> Back</Button>
          </div>
        } />

      {journal.reversed_by_journal && (
        <div className="bg-rose-50 border border-rose-200 rounded-lg p-3 mb-4 text-rose-800 text-sm">
          This journal has been reversed. See reversing journal.
        </div>
      )}
      {journal.reversal_of && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 text-blue-800 text-sm">
          This is a reversing journal.
        </div>
      )}

      <Card className="mb-4">
        <CardContent className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div><p className="text-xs text-slate-500">Entry Date</p><p className="font-medium">{formatDate(journal.entry_date)}</p></div>
          <div><p className="text-xs text-slate-500">Posted Date</p><p className="font-medium">{formatDate(journal.posting_date)}</p></div>
          <div><p className="text-xs text-slate-500">Source Module</p><p className="font-medium">{journal.source_module || "—"}</p></div>
          <div><p className="text-xs text-slate-500">Reference</p><p className="font-medium">{journal.reference || "—"}</p></div>
          <div className="sm:col-span-2"><p className="text-xs text-slate-500">Description</p><p className="font-medium">{journal.description}</p></div>
          <div><p className="text-xs text-slate-500">Posted At</p><p className="font-medium">{journal.posted_at ? formatDateTime(journal.posted_at) : "—"}</p></div>
          <div><p className="text-xs text-slate-500">Currency</p><p className="font-medium">{journal.currency}</p></div>
        </CardContent>
      </Card>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-slate-50 text-left text-slate-600">
              <th className="px-4 py-3 font-medium">Account #</th>
              <th className="px-4 py-3 font-medium">Account Name</th>
              <th className="px-4 py-3 font-medium">Description</th>
              <th className="px-4 py-3 font-medium">Party</th>
              <th className="px-4 py-3 text-right font-medium">Debit</th>
              <th className="px-4 py-3 text-right font-medium">Credit</th>
            </tr>
          </thead>
          <tbody>
            {lines.map(l => (
              <tr key={l.id} className="border-b last:border-0">
                <td className="px-4 py-2 font-mono">{l.account_number}</td>
                <td className="px-4 py-2">{l.account_name}</td>
                <td className="px-4 py-2 text-slate-600">{l.description || "—"}</td>
                <td className="px-4 py-2 text-xs text-slate-500">{l.party_type ? `${l.party_type}` : "—"}</td>
                <td className="px-4 py-2 text-right">{l.debit ? formatXAF(l.debit) : ""}</td>
                <td className="px-4 py-2 text-right">{l.credit ? formatXAF(l.credit) : ""}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-slate-50 font-bold">
              <td colSpan={4} className="px-4 py-3 text-right">Totals</td>
              <td className="px-4 py-3 text-right">{formatXAF(journal.total_debit)}</td>
              <td className="px-4 py-3 text-right">{formatXAF(journal.total_credit)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}