
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useEffect, useState } from "react";
import { erp } from "@/api/erpClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { invokeFieldOps, newIdempotencyKey, errorMessage } from "@/lib/field-ops";
import { formatXAF } from "@/lib/formatters";
import { useToast } from "@/components/ui/use-toast";

export default function HandoverSubmitDialog({ open, onClose, collections, employee, onDone }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const { toast } = useToast();
  const [staff, setStaff] = useState([]);
  const [selected, setSelected] = useState([]);
  const [cashierId, setCashierId] = useState("");
  const [offered, setOffered] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelected(collections.map((c) => c.id));
    setOffered(String(collections.reduce((s, c) => s + (c.outstanding_amount || 0), 0)));
    erp.entities.Employee.list("-created_date", 200).then((rows) => setStaff(rows));
  }, [open, collections]);

  const toggle = (id) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const chosen = collections.filter((c) => selected.includes(c.id));
  const expected = chosen.reduce((s, c) => s + (c.outstanding_amount || 0), 0);
  const receiver = staff.find((s) => s.id === cashierId);

  const submit = async () => {
    setBusy(true);
    try {
      const res = await invokeFieldOps({
        action: "submitHandover",
        collectionIds: selected,
        cashierId,
        cashierName: receiver?.full_name || "",
        offeredAmount: offered === "" ? expected : Number(offered),
        date,
        notes,
        idempotencyKey: newIdempotencyKey(),
      });
      toast({ title: ui("Handover {0} submitted", res.data.handoverNumber), description: ui("The cashier must confirm receipt before the money clears.") });
      onClose();
      onDone();
    } catch (e) {
      toast({ title: ui("Handover not submitted"), description: errorMessage(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{ui("Hand over cash to a cashier")}</DialogTitle></DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>{ui("Collections included")}</Label>
            <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
              {collections.map((c) => (
                <label key={c.id} className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2">
                  <Checkbox checked={selected.includes(c.id)} onCheckedChange={() => toggle(c.id)} />
                  <span className="flex-1 text-sm">
                    <span className="font-medium text-slate-800">{c.collection_number}</span>
                    <span className="text-slate-500"> — {c.customer_name}</span>
                  </span>
                  <span className="text-sm tabular-nums">{formatXAF(c.outstanding_amount)}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
            <span className="text-sm text-slate-600">{ui("Expected from these collections")}</span>
            <span className="font-semibold">{formatXAF(expected)}</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{ui("Amount handed over")}</Label>
              <Input type="number" value={offered} onChange={(e) => setOffered(e.target.value)} />
              {Number(offered) < expected && (
                <p className="text-xs text-amber-600 mt-1">{ui("Short by ")}{formatXAF(expected - Number(offered))}</p>
              )}
            </div>
            <div>
              <Label>{ui("Date")}</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>

          <div>
            <Label>{ui("Receiving cashier")}</Label>
            <Select value={cashierId} onValueChange={setCashierId}>
              <SelectTrigger><SelectValue placeholder={ui("Select staff member")} /></SelectTrigger>
              <SelectContent>
                {staff.filter((s) => s.id !== employee?.id).map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.full_name}{s.role ? ` — ${s.role}` : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>{ui("Notes")}</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={ui("Optional")} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{ui("Cancel")}</Button>
          <Button onClick={submit} disabled={busy || !selected.length || !cashierId}>
            {busy ? ui("Submitting…") : ui("Submit handover")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}