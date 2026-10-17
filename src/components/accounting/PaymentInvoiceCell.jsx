import React from 'react';
import { Link } from 'react-router-dom';
import { formatXAF } from '@/lib/formatters';

export default function PaymentInvoiceCell({ payment }) {
  if (!payment.invoices?.length) return <span className="text-muted-foreground">{payment.invoice_numbers || 'No invoice linked'}</span>;
  return <div className="space-y-2 min-w-56">{payment.invoices.map(a => <div key={a.invoice_id}>
    <Link to="/accounting/receivables" className="font-medium underline">{a.invoice?.invoice_number || a.invoice_number || a.invoice_id}</Link>
    {a.amount != null && <span className="ml-2">Receipt: {formatXAF(a.amount)}</span>}
    {a.invoice && <div className="text-xs text-muted-foreground">Total {formatXAF(a.invoice.total)} · Posted paid {formatXAF(a.invoice.amount_paid)} · Balance {formatXAF(a.invoice.balance)} · {a.invoice.status === 'paid' ? 'Fully paid' : a.invoice.status === 'partially_paid' ? 'Partially paid' : 'Unpaid'}</div>}
  </div>)}</div>;
}