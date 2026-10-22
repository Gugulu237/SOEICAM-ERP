
/* localized-messages */
import { uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React from 'react';
import { Landmark } from 'lucide-react';
import { Button } from '@/components/ui/button';
import CustomerPaymentBadge from '@/components/customers/CustomerPaymentBadge';
import { formatXAF } from '@/lib/formatters';

export default function CustomerPaymentSummary({ customer, summary, error, onReceive, onRetry }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  return <section className="mb-5 rounded-xl border border-border bg-card p-4 text-card-foreground">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h3 className="mb-1 font-semibold">{ui("Customer Payments · ")}{customer.business_name}</h3><CustomerPaymentBadge summary={summary} error={uiMessage(error)} /></div>
      <Button size="sm" onClick={() => onReceive(customer)}><Landmark size={14} className="mr-1" />{ui("Receive Payment")}</Button>
    </div>
    {error ? <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>{ui("Reload payment status")}</Button> : summary && <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
      {[[ui("Paid on invoices"), summary.paid], [ui("Outstanding invoices"), summary.outstanding], ['Overdue', summary.overdue], [ui("Awaiting GM approval"), summary.pending]].map(([label, amount]) => <div key={label}><p className="text-xs text-muted-foreground">{label}</p><p className="font-semibold">{formatXAF(amount)}</p></div>)}
    </div>}
    <p className="mt-3 text-xs text-muted-foreground">{ui("Amounts cover this customer’s invoices only. Pending receipts do not reduce the balance until approved.")}</p>
  </section>;
}