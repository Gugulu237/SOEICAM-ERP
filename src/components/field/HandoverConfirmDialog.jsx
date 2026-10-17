import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { base44 } from "@/api/base44Client";
import { invokeFieldOps, errorMessage } from "@/lib/field-ops";
import { formatXAF } from "@/lib/formatters";
import { useToast } from "@/components/ui/use-toast";

export default function HandoverConfirmDialog({ handover, onClose, onDone }) {
  const { toast } = useToast();
  const [accounts, setAccounts] = useState([]);
  const [treasuryAccountId, setTreasuryAccountId] = useState("");
  const [received, setReceived] = useState("");
  const [varianceReason, setVarianceReason] = useState("");
  const [disputed, setDisputed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!handover) return;
    setReceived(String(handover.offered_amount || 0));
    setVarianceReason("");
    setDisputed(false);
    base44.entities.TreasuryAccount.list("-created_date", 100)
      .then((rows) => setAccounts(rows.filter((a) => a.is_active !== false)));
  }, [handover]);

  if (!handover) return null;

  const expected = Number(handover.expected_amount || 0);
  const shortfall = Number(received || 0) - expected;

  const confirm = async () => {
    setBusy(true);
    try {
      const res = await invokeFieldOps({
        action: "confirmHandover",
        handoverId: handover.id,
        treasuryAccountId,
        receivedAmount: Number(received || 0),
        varianceReason,
        disputed,
      });
      toast({
        title: `Received — ${res.data.acknowledgementReference}`,
        description: res.data.outstandingAgainstCommercial > 0
          ? `${formatXAF(res.data.outstandingAgainstCommercial)} still outstanding against ${handover.commercial_name}.`
          : "The cashier receipt is recorded and posted.",
      });
      onClose();
      onDone();
    } catch (e) {
      toast({ title: "Not confirmed", description: errorMessage(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Receive {handover.handover_number}</DialogTitle></DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="rounded-lg bg-slate-50 px-3 py-2 space-y-1">
            <div className="flex justify-between"><span className="text-slate-500">Commercial</span><span className="font-medium">{handover.commercial_name}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Expected</span><span className="font-medium">{formatXAF(expected)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Offered</span><span className="font-medium">{formatXAF(handover.offered_amount)}</span></div>
          </div>

          <div>
            <Label>Account receiving the money *</Label>
            <Select value={treasuryAccountId} onValueChange={setTreasuryAccountId}>
              <SelectTrigger><SelectValue placeholder="Select treasury account" /></SelectTrigger>
              <SelectContent>
                {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Amount physically received</Label>
            <Input type="number" value={received} onChange={(e) => setReceived(e.target.value)} />
            {shortfall !== 0 && (
              <p className={`text-xs mt-1 ${shortfall < 0 ? "text-red-600" : "text-amber-600"}`}>
                {shortfall < 0 ? `Short by ${formatXAF(Math.abs(shortfall))}` : `Over by ${formatXAF(shortfall)}`}
              </p>
            )}
          </div>

          <div>
            <Label>Variance reason</Label>
            <Input value={varianceReason} onChange={(e) => setVarianceReason(e.target.value)} placeholder="Explain any difference" />
          </div>

          <label className="flex items-center gap-2">
            <Checkbox checked={disputed} onCheckedChange={(v) => setDisputed(!!v)} />
            <span className="text-sm text-slate-700">Flag this handover as disputed</span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={confirm} disabled={busy || !treasuryAccountId}>
            {busy ? "Confirming…" : "Confirm receipt"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}