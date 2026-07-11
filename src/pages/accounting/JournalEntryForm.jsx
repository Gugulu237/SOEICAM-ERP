import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate } from "react-router-dom";
import { formatXAF } from "@/lib/formatters";
import PageHeader from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { Save, ArrowLeft, Plus, Trash2 } from "lucide-react";

export default function JournalEntryForm() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [accounts, setAccounts] = useState([]);
  const [branches, setBranches] = useState([]);
  const [form, setForm] = useState({
    entry_date: new Date().toISOString().split("T")[0],
    description: "", reference: "", branch_id: ""
  });
  const [lines, setLines] = useState([
    { account_id: "", debit: 0, credit: 0, description: "" },
    { account_id: "", debit: 0, credit: 0, description: "" },
  ]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      base44.entities.Account.filter({ is_active: true }),
      base44.entities.Branch.filter({}),
    ]).then(([a, b]) => {
      setAccounts(a.filter(x => x.is_posting !== false));
      setBranches(b);
    });
  }, []);

  const totals = lines.reduce((s, l) => ({ d: s.d + (Number(l.debit) || 0), c: s.c + (Number(l.credit) || 0) }), { d: 0, c: 0 });
  const balanced = totals.d === totals.c && totals.d > 0;

  function addLine() { setLines(l => [...l, { account_id: "", debit: 0, credit: 0, description: "" }]); }
  function removeLine(i) { setLines(l => l.filter((_, idx) => idx !== i)); }
  function updateLine(i, field, value) {
    setLines(prev => { const arr = [...prev]; arr[i] = { ...arr[i], [field]: value }; return arr; });
  }

  async function handleSave() {
    if (!form.description) { toast({ title: "Error", description: "Description required", variant: "destructive" }); return; }
    if (!balanced) { toast({ title: "Not balanced", description: `Debits ${totals.d} ≠ Credits ${totals.c}`, variant: "destructive" }); return; }
    const validLines = lines.filter(l => l.account_id && (Number(l.debit) > 0 || Number(l.credit) > 0));
    if (validLines.length < 2) { toast({ title: "Error", description: "At least two valid lines required", variant: "destructive" }); return; }

    setSaving(true);
    try {
      const res = await base44.functions.invoke("postJournal", {
        source_module: "manual_journal",
        source_document_type: "ManualJournal",
        idempotency_key: `manual:${Date.now()}`,
        entry_date: form.entry_date,
        description: form.description,
        reference: form.reference,
        branch_id: form.branch_id,
        lines: validLines.map(l => ({
          account_id: l.account_id,
          debit: Number(l.debit) || 0,
          credit: Number(l.credit) || 0,
          description: l.description || "",
          branch_id: form.branch_id
        }))
      });
      toast({ title: "Journal posted", description: res.data.journal_number });
      navigate(`/accounting/journals/${res.data.journal_id}`);
    } catch (e) {
      toast({ title: "Posting failed", description: e.response?.data?.error || e.message, variant: "destructive" });
    }
    setSaving(false);
  }

  return (
    <div>
      <PageHeader title="New Journal Entry" subtitle="Manual double-entry journal — must balance before posting"
        actions={<Button variant="outline" onClick={() => navigate("/accounting/journals")}><ArrowLeft size={16} className="mr-1" /> Back</Button>} />

      <div className="bg-white rounded-xl border border-slate-200 p-6 max-w-5xl">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <div><Label>Entry Date *</Label><Input type="date" value={form.entry_date} onChange={e => setForm(f => ({ ...f, entry_date: e.target.value }))} /></div>
          <div><Label>Reference</Label><Input value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} placeholder="Optional reference" /></div>
          <div>
            <Label>Branch</Label>
            <Select value={form.branch_id} onValueChange={v => setForm(f => ({ ...f, branch_id: v }))}>
              <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
              <SelectContent>{branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-3"><Label>Description *</Label><Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} /></div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-slate-600">
                <th className="pb-2">Account</th>
                <th className="pb-2 w-32">Debit</th>
                <th className="pb-2 w-32">Credit</th>
                <th className="pb-2">Line description</th>
                <th className="pb-2 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="py-2 pr-2">
                    <Select value={l.account_id} onValueChange={v => updateLine(i, "account_id", v)}>
                      <SelectTrigger className="h-9"><SelectValue placeholder="Select account" /></SelectTrigger>
                      <SelectContent>
                        {[...accounts].sort((a, b) => (a.account_number || "").localeCompare(b.account_number || ""))
                          .map(a => <SelectItem key={a.id} value={a.id}>{a.account_number} — {a.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="py-2 pr-2"><Input type="number" className="h-9" value={l.debit} onChange={e => updateLine(i, "debit", Number(e.target.value))} /></td>
                  <td className="py-2 pr-2"><Input type="number" className="h-9" value={l.credit} onChange={e => updateLine(i, "credit", Number(e.target.value))} /></td>
                  <td className="py-2 pr-2"><Input className="h-9" value={l.description} onChange={e => updateLine(i, "description", e.target.value)} /></td>
                  <td className="py-2"><button onClick={() => removeLine(i)} className="p-1 text-red-400 hover:text-red-600"><Trash2 size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between mt-3">
          <Button variant="outline" size="sm" onClick={addLine}><Plus size={14} className="mr-1" /> Add Line</Button>
          <div className="text-sm text-right space-y-1">
            <div>Total Debit: <span className={`font-bold ${balanced ? "text-emerald-600" : "text-rose-600"}`}>{formatXAF(totals.d)}</span></div>
            <div>Total Credit: <span className={`font-bold ${balanced ? "text-emerald-600" : "text-rose-600"}`}>{formatXAF(totals.c)}</span></div>
            <div className="text-xs">{balanced ? "✓ Balanced" : "Out of balance"}</div>
          </div>
        </div>

        <div className="mt-6 flex gap-3">
          <Button onClick={handleSave} disabled={saving || !balanced}><Save size={16} className="mr-1" /> {saving ? "Posting..." : "Post Journal"}</Button>
        </div>
      </div>
    </div>
  );
}