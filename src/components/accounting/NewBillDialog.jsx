import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { formatXAF } from "@/lib/formatters";
import { createBillFromPO } from "@/lib/ar-ap";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";

export default function NewBillDialog({ onClose, onCreated }) {
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const [pos, setPos] = useState([]);
  const [poId, setPoId] = useState("");
  const [billDate, setBillDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    base44.entities.PurchaseOrder.filter({}, "-order_date", 500).then((all) =>
      setPos(all.filter((p) => ["received", "partially_received"].includes(p.status)))
    );
  }, []);

  const po = pos.find((p) => p.id === poId);

  useEffect(() => {
    if (!po) return;
    base44.entities.Supplier.get(po.supplier_id).then((s) => {
      const d = new Date(billDate);
      d.setDate(d.getDate() + (s?.payment_terms_days || 30));
      setDueDate(d.toISOString().slice(0, 10));
    });
  }, [poId]); // eslint-disable-line

  async function handleCreate() {
    if (!po) return;
    setSaving(true);
    try {
      const bill = await createBillFromPO({ po, billDate, dueDate: dueDate || billDate, userId: user?.id || "" });
      toast({ title: "Bill registered", description: `${bill.bill_number} — payable to ${po.supplier_name}` });
      onCreated();
    } catch (e) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
    finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>New Supplier Bill</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Received Purchase Order</Label>
            <Select value={poId} onValueChange={setPoId}>
              <SelectTrigger><SelectValue placeholder="Select received PO" /></SelectTrigger>
              <SelectContent>
                {pos.length === 0 && <div className="px-3 py-2 text-sm text-slate-400">No received POs awaiting billing</div>}
                {pos.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.po_number} — {p.supplier_name} ({formatXAF(p.total)})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Bill Date</Label>
              <Input type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} />
            </div>
            <div>
              <Label>Due Date</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>
          {po && <p className="text-sm text-slate-600">Bill amount: <span className="font-bold">{formatXAF(po.total)}</span> — posts inventory against supplier payable.</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!po || saving} onClick={handleCreate}>Register Bill</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}