import React, { useState } from "react";
import { attachReceipt } from "@/lib/petty-cash";
import { formatXAF, formatDate } from "@/lib/formatters";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import ReceiptField from "./ReceiptField";

// Filing the paper voucher against an expense that was already paid.
export default function ReceiptCollectDialog({ request, userId, onClose, onDone }) {
  const { toast } = useToast();
  const [fileUri, setFileUri] = useState(request.receipt_url || "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!fileUri) {
      toast({ title: "Attach the receipt first", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await attachReceipt({ request, fileUri, userId });
      toast({ title: "Receipt filed", description: `${request.request_number} is now backed by its receipt` });
      onDone();
    } catch (e) {
      toast({ title: "Not filed", description: e.message, variant: "destructive" });
    }
    setSaving(false);
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>File Receipt — {request.request_number}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="bg-slate-50 rounded-lg p-3 text-sm">
            <div className="flex justify-between mb-1"><span className="text-slate-500">Expense:</span><span className="font-medium text-right">{request.title}</span></div>
            <div className="flex justify-between mb-1"><span className="text-slate-500">Paid to:</span><span>{request.payee || request.requester_name || "—"}</span></div>
            <div className="flex justify-between mb-1"><span className="text-slate-500">Amount:</span><span className="font-bold">{formatXAF(request.amount)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Date:</span><span>{formatDate(request.request_date)}</span></div>
          </div>
          <ReceiptField fileUri={fileUri} onChange={setFileUri} label="Receipt photograph or scan" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={saving} onClick={handleSave}>{saving ? "Filing…" : "File receipt"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}