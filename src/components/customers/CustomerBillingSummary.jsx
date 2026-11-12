import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { erp } from '@/api/erpClient';
import { ui } from '@/lib/i18n';
import { formatAccountingXAF } from '@/lib/formatters';
import { customerAccountBalance, customerGroupBalance, headquartersDeliveryBalanceQuery } from '@/lib/customer-billing-summary';

export default function CustomerBillingSummary({ partner, parentPartner, subPartners, onSelect }) {
  const invoiceQuery = headquartersDeliveryBalanceQuery(partner, parentPartner);
  const deliveredInvoices = useQuery({
    queryKey: ['customer-headquarters-delivery-balance', parentPartner?.id, partner.id],
    enabled: Boolean(invoiceQuery),
    queryFn: () => erp.entities.Invoice.aggregate({ query: invoiceQuery, sum: 'balance' }),
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchInterval: query => query.state.status === 'error' ? false : 15_000,
  });

  if (invoiceQuery) {
    const headquartersBalance = customerAccountBalance(parentPartner);
    const deliveredBalance = deliveredInvoices.data?.sum_balance;
    return <section className="space-y-3 rounded-xl border bg-white p-4">
      <h3 className="text-sm font-semibold">{ui('Headquarters billing')}</h3>
      <button type="button" onClick={() => onSelect?.(parentPartner)} className="flex min-h-12 w-full min-w-0 items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm font-semibold">
        <span className="break-words">{parentPartner.business_name}</span>
        <ChevronRight size={17} aria-hidden="true" className="shrink-0 text-primary" />
      </button>
      <dl className="space-y-2 text-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3"><dt>{ui('Headquarters account balance')}</dt><dd className="font-semibold tabular-nums">{headquartersBalance === null ? '—' : formatAccountingXAF(headquartersBalance)}</dd></div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3"><dt>{ui('Headquarters invoices due for this branch')}</dt><dd className="font-semibold tabular-nums">{deliveredBalance == null ? '—' : formatAccountingXAF(deliveredBalance)}</dd></div>
      </dl>
      {deliveredInvoices.isError ? <p role="alert" className="text-xs text-red-700">{ui('Headquarters invoice balance could not load.')} <button type="button" onClick={() => deliveredInvoices.refetch()} className="underline">{ui('Retry')}</button></p> : deliveredInvoices.isPending ? <p role="status" className="text-xs text-muted-foreground">{ui('Loading...')}</p> : null}
      <p className="text-xs leading-5 text-muted-foreground">{ui('These invoices are payable on the headquarters account. The branch balance above covers its own account.')}</p>
    </section>;
  }

  if (partner.parent_id || !subPartners.length) return null;
  const groupBalance = customerGroupBalance(partner, subPartners);
  return <section className="rounded-xl border bg-white p-4">
    <dl className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm"><dt className="font-semibold">{ui('Group Balance')}</dt><dd className="font-semibold tabular-nums">{groupBalance === null ? '—' : formatAccountingXAF(groupBalance)}</dd></dl>
    <p className="mt-1 text-xs leading-5 text-muted-foreground">{ui('Includes this account and the displayed branches.')}</p>
  </section>;
}
