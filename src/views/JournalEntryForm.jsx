
/* localized-interface */
import { ui, uiMessage } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState, useEffect, useRef } from "react";
import { erp } from "@/api/erpClient";
import { useNavigate } from "@/lib/router";
import { formatXAF } from "@/lib/formatters";
import { validateJournal, round2 } from "@/lib/posting";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import PageHeader from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import JournalAccountPicker from "@/components/accounting/JournalAccountPicker";
import { readAll } from "@/lib/field-pos";
import { useToast } from "@/components/ui/use-toast";
import { Plus, Trash2 } from "lucide-react";

import { balancingAmount } from "@/lib/journal-balancing";

const emptyLine = () => ({ account_id: "", account_number: "", account_name: "", description: "", debit: 0, credit: 0 });

export default function JournalEntryForm() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const navigate = useNavigate();
  useCurrentUser();
  const saveRef = useRef(false);
  const pickerTrigger = useRef(null);
  const requestKey = useRef(crypto.randomUUID());
  const [autoBalance, setAutoBalance] = useState(true);
  const [loadError, setLoadError] = useState("");
  const { toast } = useToast();
  const [accounts, setAccounts] = useState([]);
  const [pickerLine, setPickerLine] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ entry_date: new Date().toISOString().slice(0, 10), description: "" });
  const [lines, setLines] = useState([emptyLine(), emptyLine()]);

  useEffect(() => {
    readAll(erp.entities.Account, { is_active: { $ne: false } }, "account_number").then((accs) =>
      setAccounts(accs.filter((a) => a.is_posting !== false && a.allow_manual_journal !== false)
        .sort((a, b) => String(a.account_number || "").localeCompare(String(b.account_number || ""), undefined, { numeric: true })))
    ).catch(e => setLoadError(e.message));
  }, []);

  const updateLine = (i, field, value) => {
    setLines((prev) => prev.map((l, idx) => {
      if (idx !== i) return l;
      if (field === "account_id") {
        const acc = accounts.find((a) => a.id === value);
        return { ...l, ...(autoBalance && value ? balancingAmount(prev, i) : null), account_id: value, account_number: acc?.account_number || "", account_name: acc?.name || "" };
      }
      return { ...l, [field]: value, ...((field === "debit" || field === "credit") && Number(value)>0 ? {[field === "debit" ? "credit" : "debit"]:0} : {}) };
    }));
  };

  const { errors, totalDebit, totalCredit } = validateJournal(lines);
  const balanced = errors.length === 0;

  async function save(status) {
    if (saveRef.current) return;
    if (!form.description) { toast({ title: ui("Description required"), variant: "destructive" }); return; }
    if (status === "posted" && !balanced) { toast({ title: ui("Cannot post"), description: errors[0], variant: "destructive" }); return; }
    saveRef.current = true;
    setSaving(true);
    try {
      const journal = await erp.accounting.saveJournal({
        requestKey: requestKey.current,
        entryDate: form.entry_date,
        description: form.description,
        sourceModule: "manual",
        sourceDocumentType: "manual_journal",
        lines,
        status,
      });
      toast({ title: status === "posted" ? ui("Journal posted") : ui("Draft saved"), description: journal.journal_number });
      navigate("/accounting?tab=journals");
    } catch (e) {
      toast({ title: ui("Error"), description: e.message, variant: "destructive" });
    } finally { saveRef.current = false; setSaving(false); }
  }

  return (
    <div>
      <PageHeader title={ui("New Journal Entry")} subtitle={ui("Manual double-entry journal — debits must equal credits")} />
      <div className="bg-white rounded-lg border border-slate-200 p-6 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <Label>{ui("Transaction Date")}</Label>
            <Input type="date" value={form.entry_date} onChange={(e) => setForm({ ...form, entry_date: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <Label>{ui("Description")}</Label>
            <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder={ui("e.g. Opening balance adjustment")} />
          </div>
        </div>

        {loadError && <p role="alert" className="text-sm text-red-700">{uiMessage(loadError)}</p>}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={autoBalance} onChange={e=>setAutoBalance(e.target.checked)}/>{ui("Auto-fill the balancing amount when selecting an empty account line")}</label>
        <div className="overflow-x-auto">
          <table className="mobile-table-cards w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="py-2 pr-2 w-[35%]">{ui("Account")}</th>
                <th className="py-2 pr-2">{ui("Line Description")}</th>
                <th className="py-2 pr-2 text-right w-32">{ui("Debit")}</th>
                <th className="py-2 pr-2 text-right w-32">{ui("Credit")}</th>
                <th className="py-2 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td data-label={ui("Account")} className="py-2 pr-2">
                    <Button type="button" variant="outline" className="h-auto min-h-10 w-full justify-start whitespace-normal text-left" aria-label={ui("Choose account for line {0}",i+1)} aria-haspopup="dialog" aria-expanded={pickerLine===i} disabled={saving} onClick={event=>{pickerTrigger.current=event?.currentTarget || null;setPickerLine(current=>current===i?null:i);}}>
                      {line.account_id ? <span><span className="font-mono">{line.account_number}</span> · {line.account_name}</span> : <span className="text-slate-500">{ui("Select account")}</span>}
                    </Button>
                  </td>
                  <td data-label={ui("Line Description")} className="py-2 pr-2"><Input aria-label={ui("Line description {0}",i+1)} value={line.description} onChange={(e) => updateLine(i, "description", e.target.value)} /></td>
                  <td data-label={ui("Debit")} className="py-2 pr-2"><Input aria-label={ui("Debit line {0}",i+1)} type="number" min="0" step="0.01" className="text-right" value={line.debit || ""} onChange={(e) => updateLine(i, "debit", e.target.value)} /></td>
                  <td data-label={ui("Credit")} className="py-2 pr-2"><Input aria-label={ui("Credit line {0}",i+1)} type="number" min="0" step="0.01" className="text-right" value={line.credit || ""} onChange={(e) => updateLine(i, "credit", e.target.value)} /></td>
                  <td data-label={ui("Actions")} className="py-2">
                    {line.account_id && balancingAmount(lines,i) && <Button title={ui("Fill balancing amount")} variant="outline" size="sm" onClick={()=>setLines(prev=>prev.map((l,n)=>n===i?{...l,...balancingAmount(prev,i)}:l))}>{ui("Balance")}</Button>}
                    {lines.length > 2 && (
                      <Button aria-label={ui("Remove") + ": " + (i + 1)} variant="ghost" size="icon" onClick={() => setLines(lines.filter((_, idx) => idx !== i))}>
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
                    <Plus size={14} className="mr-1" />{ui(" Add Line")}</Button>
                </td>
                <td className="py-3 pr-2 text-right"><span className="sm:hidden">{ui("Debit")}: </span>{formatXAF(totalDebit)}</td>
                <td className="py-3 pr-2 text-right"><span className="sm:hidden">{ui("Credit")}: </span>{formatXAF(totalCredit)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className={`text-sm font-medium ${balanced ? "text-green-700" : "text-red-600"}`}>
          {balanced
            ? ui("✓ Balanced — {0}", formatXAF(totalDebit))
            : round2(totalDebit) !== round2(totalCredit)
              ? ui("Out of balance by {0}", formatXAF(Math.abs(round2(totalDebit) - round2(totalCredit))))
              : uiMessage(errors[0])}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => navigate("/accounting")}>{ui("Cancel")}</Button>
          <Button variant="secondary" disabled={saving} onClick={() => save("draft")}>{ui("Save as Draft")}</Button>
          <Button disabled={saving || !balanced} onClick={() => save("posted")}>{ui("Post Journal")}</Button>
        </div>
      </div>
      {pickerLine!==null && <JournalAccountPicker key={pickerLine} open returnFocusRef={pickerTrigger} accounts={accounts} selectedId={lines[pickerLine]?.account_id || ""} lineNumber={pickerLine+1} onOpenChange={open=>{if(!open)setPickerLine(null);}} onSelect={id=>{updateLine(pickerLine,"account_id",id);setPickerLine(null);}}/>}
    </div>
  );
}