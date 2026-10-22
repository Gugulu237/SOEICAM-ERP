
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React from 'react';
import { Link } from '@/lib/router';
import { formatXAF } from '@/lib/formatters';

export default function PaymentInvoiceCell({ payment }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  if (!payment.invoices?.length) return <span className="text-muted-foreground">{payment.invoice_numbers || ui("No invoice linked")}</span>;
  return <div className="space-y-2 min-w-56">{payment.invoices.map(a => <div key={a.invoice_id}>
    <Link to="/accounting/receivables" className="font-medium underline">{a.invoice?.invoice_number || a.invoice_number || a.invoice_id}</Link>
    {a.amount != null && <span className="ml-2">{ui("Receipt: ")}{formatXAF(a.amount)}</span>}
    {a.invoice && <div className="text-xs text-muted-foreground">{ui("Total ")}{formatXAF(a.invoice.total)}{ui(" · Posted paid ")}{formatXAF(a.invoice.amount_paid)}{ui(" · Balance ")}{formatXAF(a.invoice.balance)} · {a.invoice.status === 'paid' ? ui("Fully paid") : a.invoice.status === 'partially_paid' ? ui("Partially paid") : ui("Unpaid")}</div>}
  </div>)}</div>;
}