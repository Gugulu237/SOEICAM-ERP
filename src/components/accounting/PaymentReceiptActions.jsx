
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React from 'react';
import { Button } from '@/components/ui/button';

export default function PaymentReceiptActions({ payment, isGM, busy, onApprove, onReject }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  if (payment.payment_type !== 'customer_payment') return null;
  if (['pending_approval', 'approved'].includes(payment.status)) return <div className="space-y-1 min-w-40">
    {isGM ? <div className="flex gap-2"><Button size="sm" disabled={busy} onClick={() => onApprove(payment)}>{busy ? ui("Processing…") : payment.status === 'approved' ? ui("Retry posting") : ui("Approve & Post")}</Button>{payment.status === 'pending_approval' && !payment.receipt_posting_snapshot?.invoices && <Button size="sm" variant="outline" disabled={busy} onClick={() => onReject(payment)}>{ui("Reject")}</Button>}</div> : <span className="text-muted-foreground">{ui("Awaiting GM approval")}</span>}
    {payment.receipt_posting_error && <p className="text-xs text-destructive">{payment.receipt_posting_error}</p>}
  </div>;
  if (payment.status === 'rejected') return <p className="text-sm text-destructive">{payment.rejection_reason}</p>;
  return <span className="text-muted-foreground">{payment.journal_id ? ui("Posted to ledger") : '—'}</span>;
}