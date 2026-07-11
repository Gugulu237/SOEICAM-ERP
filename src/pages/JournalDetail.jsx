import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import PageHeader from "@/components/shared/PageHeader";
import StatusBadge from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { formatXAF, formatDateTime } from "@/lib/formatters";
import { ArrowLeft, RotateCcw, CheckCircle2, FileText } from "lucide-react";

export default function JournalDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [journal, setJournal] = useState(null);
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showReverse, setShowReverse] = useState(false);
  const [reason, setReason] = useState("");
  const [reversing, setReversing] = useState(false);

  useEffect(() => { loadData(); }, [id]);

  async function loadData() {
    try {
      const [je, allLines] = await Promise.all([
        base44.entities.JournalEntry.get(id),
        base44.entities.JournalLine.filter({ journal_id: id }),
      ]);
      setJournal(je);
      setLines(allLines.sort((a, b) => (a.account_number || "").localeCompare(b.account_number || "")));
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  async function handleReverse() {
    if (!reason.trim()) { toast({ title: "Reversal reason is required", variant: "destructive" }); return; }
    setReversing(true);
    try {
      const reversedLines = lines.map(l => ({
        account_id: l.account_id,
        description: `Reversal: ${l.description || ""}`,
        debit: l.credit || 0,
        credit: l.debit || 0
      }));
      const res = await base44.functions.invoke("postJournal", {
        entry_date: journal.entry_date,
        description: `Reversal of ${journal.journal_number}: ${journal.description}`,
        reference: journal.reference,
        source_module: "manual",
        source_document_type: "journal_reversal",
        source_document_id: journal.id,
        posting_type: "reversal",
        reversal_of: journal.id,
        reversal_reason: reason,
        lines: reversedLines
      });
      toast({ title: "Journal reversed", description: res.data.journal_number });
      navigate(`/accounting/journals/${res.data.journal_id}`);
    } catch (e) {
      toast({ title: "Reversal failed", description: e.response?.data?.error || e.message, variant: "destructive" });
    }
    setReversing(false);
  }

  if (loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;
  if (!journal) return <div className="text-center py-20 text-slate-500">Journal not found.</div>;

  const isPosted = journal.status === "posted";
  const isReversed = journal.status === "reversed";
  const totalDebit = lines.reduce((s, l) => s + (l.debit || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (l.credit || 0), 0);

  return (
    <div>
      <PageHeader
        title={journal.journal_number}
        subtitle={journal.description}
        actions={<Button variant="outline" onClick={() => navigate("/accounting/journals")}><ArrowLeft size={16} className="mr-1" /> Back</Button>}
      />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
            <h3 className="font-semibold text-slate-700">Journal Lines</h3>
            <StatusBadge status={journal.status} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-2 text-left font-semibold text-slate-600">Account</th>
                  <th className="px-4 py-2 text-left font-semibold text-slate-600">Description</th>
                  <th className="px-4 py-2 text-left font-semibold text-slate-600">Party</th>
                  <th className="px-4 py-2 text-right font-semibold text-slate-600">Debit</th>
                  <th className="px-4 py-2 text-right font-semibold text-slate-600">Credit</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-2.5"><div className="font-medium">{l.account_number}</div><div className="text-xs text-slate-500">{l.account_name}</div></td>
                    <td className="px-4 py-2.5 text-slate-600">{l.description || "—"}</td>
                    <td className="px-4 py-2.5 text-slate-600">{l.party_name || "—"}</td>
                    <td className="px-4 py-2.5 text-right">{l.debit ? formatXAF(l.debit) : ""}</td>
                    <td className="px-4 py-2.5 text-right">{l.credit ? formatXAF(l.credit) : ""}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 border-t-2 border-slate-200 font-semibold">
                  <td colSpan={3} className="px-4 py-3 text-right">Totals</td>
                  <td className="px-4 py-3 text-right">{formatXAF(totalDebit)}</td>
                  <td className="px-4 py-3 text-right">{formatXAF(totalCredit)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {isPosted && (
            <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-green-600"><CheckCircle2 size={16} /> Balanced & posted — immutable</div>
              <Button variant="outline" onClick={() => setShowReverse(true)} className="text-amber-600 border-amber-300 hover:bg-amber-50"><RotateCcw size={15} className="mr-1" /> Reverse Journal</Button>
            </div>
          )}
          {isReversed && (
            <div className="px-6 py-4 border-t border-slate-200 bg-red-50 text-sm text-red-600">
              This journal has been reversed. Corrections are recorded via the reversal journal.
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h3 className="font-semibold text-slate-700 mb-3 flex items-center gap-2"><FileText size={16} /> Journal Info</h3>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">Entry Date</dt><dd>{journal.entry_date}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Reference</dt><dd>{journal.reference || "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Source Module</dt><dd className="capitalize">{journal.source_module?.replace(/_/g, " ") || "manual"}</dd></div>
              {journal.source_document_id && <div className="flex justify-between"><dt className="text-slate-500">Source Doc</dt><dd className="font-mono text-xs">{journal.source_document_type}</dd></div>}
              <div className="flex justify-between"><dt className="text-slate-500">Currency</dt><dd>{journal.currency || "XAF"}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Posted By</dt><dd>{journal.posted_by || "—"}</dd></div>
              {journal.posted_at && <div className="flex justify-between"><dt className="text-slate-500">Posted At</dt><dd>{formatDateTime(journal.posted_at)}</dd></div>}
              {journal.reversal_of && <div className="flex justify-between"><dt className="text-slate-500">Reversal Of</dt><dd className="text-amber-600">Yes</dd></div>}
              {journal.reversed_by_journal && <div className="flex justify-between"><dt className="text-slate-500">Reversed By</dt><dd className="text-red-600">Reversal posted</dd></div>}
            </dl>
          </div>
        </div>
      </div>

      <Dialog open={showReverse} onOpenChange={setShowReverse}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Reverse Journal {journal.journal_number}?</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-500">This creates a balanced reversal journal that negates the effect of this entry. The original remains immutable and marked as reversed.</p>
          <div className="mt-3"><Label>Reversal Reason *</Label><Input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Posted to wrong account" /></div>
          <div className="mt-4 flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setShowReverse(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleReverse} disabled={reversing}><RotateCcw size={15} className="mr-1" /> {reversing ? "Reversing..." : "Post Reversal"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}