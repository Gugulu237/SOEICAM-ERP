import React, { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { base44 } from "@/api/base44Client";
import { useToast } from "@/components/ui/use-toast";
import { formatXAF } from "@/lib/formatters";
import { Camera, Loader2, CheckCircle2, Upload } from "lucide-react";

export default function ConfirmDeliveryDialog({ order, lines, onClose, onConfirmed }) {
  const { toast } = useToast();
  const [quantities, setQuantities] = useState(() => {
    const q = {};
    (lines || []).forEach(l => { q[l.id] = l.quantity; });
    return q;
  });
  const [paymentType, setPaymentType] = useState(order?.payment_type || "cash");
  const [cashCollected, setCashCollected] = useState(order?.total || 0);
  const [notes, setNotes] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const res = await base44.integrations.Core.UploadFile({ file });
      setImageUrl(res.file_url);
      toast({ title: "Proof attached", description: "Delivery photo uploaded" });
    } catch (err) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally { setUploading(false); }
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const delivered_lines = (lines || []).map(l => ({ line_id: l.id, delivered_qty: Number(quantities[l.id] || 0) }));
      const res = await base44.functions.invoke("confirmDelivery", {
        sales_order_id: order.id,
        payment_type: paymentType,
        cash_collected: paymentType === "cash" ? Number(cashCollected) : 0,
        confirmation_image_url: imageUrl,
        delivered_lines,
        notes,
      });
      toast({ title: "Delivery confirmed", description: `Invoice ${res.data?.invoice_number || ""} created` });
      onConfirmed();
    } catch (err) {
      toast({ title: "Failed to confirm", description: err.message, variant: "destructive" });
    } finally { setSubmitting(false); }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Confirm Delivery</DialogTitle>
          <DialogDescription>{order?.order_number} — {order?.customer_name}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg bg-slate-50 p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">Order Total</span>
              <span className="font-semibold">{formatXAF(order?.total)}</span>
            </div>
          </div>

          <div>
            <Label className="text-xs uppercase text-slate-500">Items Delivered</Label>
            <div className="mt-2 space-y-2">
              {(lines || []).map(l => (
                <div key={l.id} className="flex items-center gap-2">
                  <div className="flex-1 text-sm">
                    <div className="font-medium text-slate-800">{l.product_name}</div>
                    <div className="text-xs text-slate-500">Ordered: {l.quantity} {l.unit}</div>
                  </div>
                  <Input
                    type="number"
                    min="0"
                    max={l.quantity}
                    value={quantities[l.id]}
                    onChange={e => setQuantities(q => ({ ...q, [l.id]: e.target.value }))}
                    className="w-20 text-right"
                  />
                </div>
              ))}
              {(!lines || lines.length === 0) && <p className="text-xs text-slate-400">No line items found.</p>}
            </div>
          </div>

          <div>
            <Label>Payment</Label>
            <Select value={paymentType} onValueChange={setPaymentType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Cash — collected on delivery</SelectItem>
                <SelectItem value="credit">Credit — invoiced to account</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {paymentType === "cash" && (
            <div>
              <Label>Cash Collected (XAF)</Label>
              <Input type="number" value={cashCollected} onChange={e => setCashCollected(e.target.value)} />
            </div>
          )}

          <div>
            <Label>Delivery Proof (photo / signature)</Label>
            <label className="mt-1 flex items-center justify-center gap-2 border-2 border-dashed border-slate-300 rounded-lg py-6 cursor-pointer hover:border-amber-400 hover:bg-amber-50">
              <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleUpload} />
              {uploading ? <Loader2 className="animate-spin text-amber-500" size={20} /> : imageUrl ? <CheckCircle2 className="text-green-600" size={20} /> : <Camera className="text-slate-400" size={20} />}
              <span className="text-sm text-slate-600">{imageUrl ? "Photo attached" : "Take / upload photo"}</span>
            </label>
          </div>

          <div>
            <Label>Notes</Label>
            <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any delivery remarks..." />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting || uploading}>
            {submitting ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Confirm Delivery
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}