import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import PageHeader from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { ArrowLeft, Plus, Trash2, Save, Scale } from "lucide-react";
import AccountSelect from "@/components/accounting/AccountSelect";
import { formatXAF } from "@/lib/formatters";

const today = () => new Date().toISOString().slice(0, 10);

export default function JournalEntryForm() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [header, setHeader] = useState({ entry_date: today(), reference: "", description: "" });
  const [lines, setLines] = useState([
    { account_id: "", description: "", debit: 0, credit: 0 },
    { account_id: "", description: "", debit: 0, credit: 0 },
  ]);
  const [posting, setPosting] = useState(false);

  const setH = (k, v) => setHeader(h => ({ ...h, [k]: v }));

  const updateLine = (idx, field, value) => {
    setLines(ls => ls.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  };
  const addLine = () => setLines(ls => [...ls, { account_id: "", description: "", debit: 0, credit: 0 }]);
  const removeLine = (idx) => setLines(ls => ls.filter((_, i) => i !== idx));

  const totalDebit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const difference = totalDebit - totalCredit;
  const isBalanced = Math.abs(difference) < 0.01;
  const validLines = lines.filter(l => l.account_id && ((Number(l.debit) || 0) > 0 || (Number(l.credit) || 0) > 0) && !((Number(l.debit) || 0) > 0 && (Number(l.credit) || 0) > 0));
  const canPost = isBalanced && validLines.length >= 2 && header.description && header.entry_date;

  async function handlePost() {
    if (!canPost) {
      toast({ title: "Cannot post", description: !isBalanced ? "Debits and credits must be equal" : "Ensure at least 2 valid lines with a description", variant: "destructive" });
      return;
    }
    setPosting(true);
    try {
      const res = await base44.functions.invoke("postJournal", {
        entry_date: header.entry_date,
        description: header.description,
        reference: header.reference,
        source_module: "manual",
        source_document_type: "manual_journal",
        posting_type: "manual_entry",
        lines: validLines.map(l => ({
          account_id: l.account_id,
          description: l.description,
          debit: Number(l.debit) || 0,
          credit: Number(l.credit) || 0
        }))
      });
      toast({ title: "Journal posted", description: res.data.journal_number });
      navigate(`/accounting/journals/${res.data.journal_id}`);
    } catch (e) {
      const msg = e.response?.data?.error || e.message;
      toast({ title: "Posting failed", description: msg, variant: "destructive" });
    }
    setPosting(false);
  }

  return (
    <div>
      <PageHeader
        title="New Journal Entry"
        subtitle="Manual double-entry journal — debits must equal credits"
        actions={<Button variant="outline" onClick={() => navigate("/accounting/journals")}><ArrowLeft size={16} className="mr-1" /> Back</Button>}
      />
      <div className="bg-white rounded-xl border border-slate-200 p-6 max-w-5xl">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <div><Label>Entry Date *</Label><Input type="date" value={header.entry_date} onChange={e => setH("entry_date", e.target.value)} /></div>
          <div><Label>Reference</Label><Input value={header.reference} onChange={e => setH("reference", e.target.value)} placeholder="e.g. INV-2026-001" /></div>
          <div><Label>Description *</Label><Input value={header.description} onChange={e => setH("description", e.target.value)} placeholder="e.g. Credit sale to customer" /></div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-slate-600 w-64">Account</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-600">Description</th>
                <th className="px-3 py-2 text-right font-semibold text-slate-600 w-32">Debit</th>
                <th className="px-3 py-2 text-right font-semibold text-slate-600 w-32">Credit</th>
                <th className="px-3 py-2 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, idx) => {
                const hasBoth = (Number(line.debit) || 0) > 0 && (Number(line.credit) || 0) > 0;
                return (
                  <tr key={idx} className="border-b border-slate-100 last:border-0">
                    <td className="px-3 py-2"><AccountSelect value={line.account_id} onValueChange={v => updateLine(idx, "account_id", v)} /></td>
                    <td className="px-3 py-2"><Input value={line.description} onChange={e => updateLine(idx, "description", e.target.value)} placeholder="Line memo" className="h-8" /></td>
                    <td className="px-3 py-2"><Input type="number" value={line.debit || ""} onChange={e => updateLine(idx, "debit", Number(e.target.value))} className={`h-8 text-right ${hasBoth ? "border-red-400" : ""}`} disabled={(Number(line.credit) || 0) > 0} /></td>
                    <td className="px-3 py-2"><Input type="number" value={line.credit || ""} onChange={e => updateLine(idx, "credit", Number(e.target.value))} className={`h-8 text-right ${hasBoth ? "border-red-400" : ""}`} disabled={(Number(line.debit) || 0) > 0} /></td>
                    <td className="px-3 py-2 text-center">{lines.length > 2 && <button onClick={() => removeLine(idx)} className="text-slate-400 hover:text-red-500"><Trash2 size={15} /></button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Button variant="outline" size="sm" className="mt-3" onClick={addLine}><Plus size={14} className="mr-1" /> Add Line</Button>

        <div className="mt-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-t border-slate-200 pt-4">
          <div className="flex items-center gap-6 text-sm">
            <div><span className="text-slate-500">Total Debit: </span><span className="font-semibold">{formatXAF(totalDebit)}</span></div>
            <div><span className="text-slate-500">Total Credit: </span><span className="font-semibold">{formatXAF(totalCredit)}</span></div>
            <div className={`flex items-center gap-1 font-semibold ${isBalanced ? "text-green-600" : "text-red-600"}`}>
              <Scale size={15} /> {isBalanced ? "Balanced" : `Difference: ${formatXAF(difference)}`}
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate("/accounting/journals")}>Cancel</Button>
            <Button onClick={handlePost} disabled={!canPost || posting}><Save size={16} className="mr-1" /> {posting ? "Posting..." : "Post Journal"}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}