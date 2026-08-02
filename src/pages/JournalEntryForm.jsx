import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate } from "react-router-dom";
import { formatXAF } from "@/lib/formatters";
import { postJournal, validateJournal, round2 } from "@/lib/posting";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import PageHeader from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { Plus, Trash2 } from "lucide-react";

const emptyLine = () => ({ account_id: "", account_number: "", account_name: "", description: "", debit: 0, credit: 0 });

export default function JournalEntryForm() {
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const [accounts, setAccounts] = useState([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ entry_date: new Date().toISOString().slice(0, 10), description: "" });
  const [lines, setLines] = useState([emptyLine(), emptyLine()]);

  useEffect(() => {
    base44.entities.Account.filter({ is_active: true }).then((accs) =>
      setAccounts(accs.filter((a) => a.is_posting !== false && a.allow_manual_journal !== false)
        .sort((a, b) => a.account_number.localeCompare(b.account_number)))
    );
  }, []);

  const updateLine = (i, field, value) => {
    setLines((prev) => prev.map((l, idx) => {
      if (idx !== i) return l;
      if (field === "account_id") {
        const acc = accounts.find((a) => a.id === value);
        return { ...l, account_id: value, account_number: acc?.account_number || "", account_name: acc?.name || "" };
      }
      return { ...l, [field]: value };
    }));
  };

  const { errors, totalDebit, totalCredit } = validateJournal(lines);
  const balanced = errors.length === 0;

  async function save(status) {
    if (!form.description) { toast({ title: "Description required", variant: "destructive" }); return; }
    if (status === "posted" && !balanced) { toast({ title: "Cannot post", description: errors[0], variant: "destructive" }); return; }
    setSaving(true);
    try {
      const journal = await postJournal({
        entryDate: form.entry_date,
        description: form.description,
        sourceModule: "manual",
        sourceDocumentType: "manual_journal",
        lines,
        userId: user?.id || "",
        status,
      });
      toast({ title: status === "posted" ? "Journal posted" : "Draft saved", description: journal.journal_number });
      navigate("/accounting");
    } catch (e) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally { setSaving(false); }
  }

  return (
    <div>
      <PageHeader title="New Journal Entry" subtitle="Manual double-entry journal — debits must equal credits" />
      <div className="bg-white rounded-lg border border-slate-200 p-6 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <Label>Transaction Date</Label>
            <Input type="date" value={form.entry_date} onChange={(e) => setForm({ ...form, entry_date: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <Label>Description</Label>
            <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="e.g. Opening balance adjustment" />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="py-2 pr-2 w-[35%]">Account</th>
                <th className="py-2 pr-2">Line Description</th>
                <th className="py-2 pr-2 text-right w-32">Debit</th>
                <th className="py-2 pr-2 text-right w-32">Credit</th>
                <th className="py-2 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="py-2 pr-2">
                    <Select value={line.account_id} onValueChange={(v) => updateLine(i, "account_id", v)}>
                      <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                      <SelectContent>
                        {accounts.map((a) => (
                          <SelectItem key={a.id} value={a.id}>{a.account_number} — {a.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="py-2 pr-2"><Input value={line.description} onChange={(e) => updateLine(i, "description", e.target.value)} /></td>
                  <td className="py-2 pr-2"><Input type="number" min="0" className="text-right" value={line.debit || ""} onChange={(e) => updateLine(i, "debit", e.target.value)} /></td>
                  <td className="py-2 pr-2"><Input type="number" min="0" className="text-right" value={line.credit || ""} onChange={(e) => updateLine(i, "credit", e.target.value)} /></td>
                  <td className="py-2">
                    {lines.length > 2 && (
                      <Button variant="ghost" size="icon" onClick={() => setLines(lines.filter((_, idx) => idx !== i))}>
                        <Trash2 size={14} className="text-red-500" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td className="py-3" colSpan={2}>
                  <Button variant="outline" size="sm" onClick={() => setLines([...lines, emptyLine()])}>
                    <Plus size={14} className="mr-1" /> Add Line
                  </Button>
                </td>
                <td className="py-3 pr-2 text-right">{formatXAF(totalDebit)}</td>
                <td className="py-3 pr-2 text-right">{formatXAF(totalCredit)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className={`text-sm font-medium ${balanced ? "text-green-700" : "text-red-600"}`}>
          {balanced
            ? `✓ Balanced — ${formatXAF(totalDebit)}`
            : round2(totalDebit) !== round2(totalCredit)
              ? `Out of balance by ${formatXAF(Math.abs(round2(totalDebit) - round2(totalCredit)))}`
              : errors[0]}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => navigate("/accounting")}>Cancel</Button>
          <Button variant="secondary" disabled={saving} onClick={() => save("draft")}>Save as Draft</Button>
          <Button disabled={saving || !balanced} onClick={() => save("posted")}>Post Journal</Button>
        </div>
      </div>
    </div>
  );
}