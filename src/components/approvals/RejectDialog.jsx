
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

// Collects the reason a decision was refused, so the audit trail explains itself.
export default function RejectDialog({ open, onOpenChange, item, onConfirm, busy }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [reason, setReason] = useState("");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{ui("Reject ")}{item?._ref || ui("this item")}</DialogTitle>
          <DialogDescription>{ui("The requester sees this reason, and it is kept in the audit trail.")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>{ui("Reason")}</Label>
          <Textarea
            rows={3}
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder={ui("Why is this being rejected?")}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>{ui("Cancel")}</Button>
          <Button variant="destructive" onClick={() => onConfirm(reason)} disabled={busy}>
            {busy ? ui("Rejecting…") : ui("Reject")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}