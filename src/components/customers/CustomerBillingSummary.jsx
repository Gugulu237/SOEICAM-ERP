import React from 'react';
import { ChevronRight } from 'lucide-react';
import { ui } from '@/lib/i18n';
import { formatAccountingXAF } from '@/lib/formatters';
import { customerAccountBalance, headquartersDueForBranch } from '@/lib/customer-billing-summary';

export default function CustomerBillingSummary({ partner, parentPartner, subPartners, deliveryBalances, onSelect }) {
  if (parentPartner) {
    const accountBalance = customerAccountBalance(partner);
    const deliveredBalance = headquartersDueForBranch(deliveryBalances.data, partner.id);
    return <section className="space-y-3 rounded-xl border bg-white p-4">
      <h3 className="text-sm font-semibold">{ui('Headquarters billing')}</h3>
      <button type="button" onClick={() => onSelect?.(parentPartner)} className="flex min-h-12 w-full min-w-0 items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm font-semibold">
        <span className="break-words">{parentPartner.business_name}</span>
        <ChevronRight size={17} aria-hidden="true" className="shrink-0 text-primary" />
      </button>
      <dl className="space-y-2 text-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3"><dt>{ui('Branch account balance')}</dt><dd className="font-semibold tabular-nums">{accountBalance === null ? '—' : formatAccountingXAF(accountBalance)}</dd></div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3"><dt>{ui('Headquarters invoices due for this branch')}</dt><dd className="font-semibold tabular-nums">{deliveredBalance == null ? '—' : formatAccountingXAF(deliveredBalance)}</dd></div>
      </dl>
      {deliveryBalances.isError ? <p role="alert" className="text-xs text-red-700">{ui('Headquarters invoice balance could not load.')} <button type="button" onClick={() => deliveryBalances.refetch()} className="underline">{ui('Retry')}</button></p> : deliveryBalances.isPending ? <p role="status" className="text-xs text-muted-foreground">{ui('Loading...')}</p> : null}
    </section>;
  }

  if (partner.parent_id || !subPartners.length) return null;
  const headquartersBalance = customerAccountBalance(partner);
  return <section className="rounded-xl border bg-white p-4">
    <dl className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm"><dt className="font-semibold">{ui('Headquarters account balance')}</dt><dd className="font-semibold tabular-nums">{headquartersBalance === null ? '—' : formatAccountingXAF(headquartersBalance)}</dd></dl>
    {deliveryBalances.isError&&<p role="alert" className="mt-2 text-xs text-red-700">{ui('Headquarters invoice balance could not load.')} <button type="button" onClick={()=>deliveryBalances.refetch()} className="underline">{ui('Retry')}</button></p>}
  </section>;
}
