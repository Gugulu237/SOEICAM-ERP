import React, { useState } from "react";
import { runDepreciation, monthlyDepreciation, remainingDepreciable } from "@/lib/assets";
import { formatXAF } from "@/lib/formatters";
import { round2 } from "@/lib/posting";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";

export default function DepreciationRunDialog({ assets, onClose, onDone }) {
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [running, setRunning] = useState(false);

  const monthEndDate = (() => {
    const d = new Date(`${month}-01`);
    return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
  })();

  const eligible = assets.filter(
    (a) => a.status === "active" && a.depreciation_method === "straight_line" &&
      a.acquisition_date <= monthEndDate &&
      (!a.last_depreciation_date || a.last_depreciation_date < monthEndDate) &&
      remainingDepreciable(a) > 0
  );
  const preview = eligible.map((a) => ({ a, amount: Math.min(monthlyDepreciation(a), remainingDepreciable(a)) }));
  const total = round2(preview.reduce((s, p) => s + p.amount, 0));

  async function handleRun() {
    setRunning(true);
    try {
      const res = await runDepreciation({ month, userId: user?.id || "" });
      toast({ title: "Depreciation posted", description: `${res.posted} assets — ${formatXAF(res.total)}` });
      onDone();
    } catch (e) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
    finally { setRunning(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Run Monthly Depreciation</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Period (month)</Label>
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            <p className="text-xs text-slate-400 mt-1">Posts on {monthEndDate}. Assets already depreciated for this period are skipped.</p>
          </div>
          <div className="border border-slate-200 rounded-md divide-y max-h-64 overflow-y-auto">
            {preview.length === 0 && <p className="p-4 text-sm text-slate-400 text-center">No assets due for depreciation in this period</p>}
            {preview.map(({ a, amount }) => (
              <div key={a.id} className="flex justify-between px-3 py-2 text-sm">
                <span className="text-slate-600">{a.asset_number} — {a.name}</span>
                <span className="font-medium">{formatXAF(amount)}</span>
              </div>
            ))}
          </div>
          <div className="flex justify-between font-semibold text-sm bg-slate-50 px-3 py-2 rounded">
            <span>Total depreciation</span><span>{formatXAF(total)}</span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={running || preview.length === 0} onClick={handleRun}>Post Depreciation</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}