
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React from 'react';
import { Button } from '@/components/ui/button';
import { isConfirmedPendingCustomerReceipt } from '@/lib/customer-receipt-status';

export default function PaymentReceiptActions({ payment, canPost, canReject, busy, onPost, onReject }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  if (payment.payment_type !== 'customer_payment') return null;
  if (['pending_approval', 'approved'].includes(payment.status)) return <div className="space-y-1 min-w-40">
    <div className="flex flex-wrap gap-2">
      {isConfirmedPendingCustomerReceipt(payment)
        ? canPost && <Button size="sm" disabled={busy} onClick={() => onPost(payment)}>{busy ? ui("Processing…") : ui("Post confirmed payment")}</Button>
        : <span className="text-muted-foreground">{ui("Needs reconciliation")}</span>}
      {canReject && payment.receipt_channel !== 'staff_collection' && payment.status === 'pending_approval' && !payment.journal_id && !payment.receipt_posting_snapshot?.invoices &&
        <Button size="sm" variant="outline" disabled={busy} onClick={() => onReject(payment)}>{ui("Reject")}</Button>}
    </div>
    {payment.receipt_posting_error && <p className="text-xs text-destructive">{payment.receipt_posting_error}</p>}
  </div>;
  if (payment.status === 'rejected') return <p className="text-sm text-destructive">{payment.rejection_reason}</p>;
  return <span className="text-muted-foreground">{payment.journal_id ? ui("Posted to ledger") : '—'}</span>;
}