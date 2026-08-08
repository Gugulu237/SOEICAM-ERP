import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { setLotQcStatus } from "@/lib/inventory";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import StatusBadge from "@/components/shared/StatusBadge";
import { formatNumber, formatDate } from "@/lib/formatters";
import { ShieldCheck, ShieldX } from "lucide-react";

// Finished batches sit in quarantine until Quality releases them for sale.
export default function BatchReleasePanel() {
  const { toast } = useToast();
  const [lots, setLots] = useState([]);
  const [notes, setNotes] = useState({});
  const [busy, setBusy] = useState("");

  useEffect(() => { load(); }, []);

  async function load() {
    const held = await base44.entities.StockBalance.filter({ qc_status: "quarantine" });
    setLots(held.filter(l => (l.quantity || 0) > 0));
  }

  async function decide(lot, status) {
    setBusy(lot.id);
    try {
      await setLotQcStatus({ balanceId: lot.id, status, notes: notes[lot.id] || "" });
      if (lot.production_order_id) {
        await base44.entities.ProductionOrder.update(lot.production_order_id, {
          status: status === "approved" ? "released" : "rejected",
        });
      }
      toast({ title: status === "approved" ? "Batch released for sale" : "Batch rejected" });
      load();
    } catch (e) {
      toast({ title: "Could not update batch", description: e.message, variant: "destructive" });
    }
    setBusy("");
  }

  if (!lots.length) {
    return <p className="text-sm text-slate-500 bg-white border border-slate-200 rounded-xl p-6 text-center">No batches are waiting for quality release.</p>;
  }

  return (
    <div className="space-y-3">
      {lots.map(lot => (
        <div key={lot.id} className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <div>
              <p className="font-semibold text-slate-900">{lot.product_name}</p>
              <p className="text-xs text-slate-500">
                Batch {lot.lot_number || "—"} · {formatNumber(lot.quantity, 2)} units · {lot.warehouse_name}
                {lot.expiry_date ? ` · expires ${formatDate(lot.expiry_date)}` : ""}
              </p>
            </div>
            <StatusBadge status="quarantine" />
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              placeholder="QC notes (pH, taste, seal…)"
              value={notes[lot.id] || ""}
              onChange={e => setNotes(n => ({ ...n, [lot.id]: e.target.value }))}
            />
            <Button onClick={() => decide(lot, "approved")} disabled={busy === lot.id}>
              <ShieldCheck size={16} className="mr-1" /> Release
            </Button>
            <Button variant="outline" onClick={() => decide(lot, "rejected")} disabled={busy === lot.id}>
              <ShieldX size={16} className="mr-1" /> Reject
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}