import React from 'react';
import {formatXAF} from '@/lib/formatters';
import {ui} from '@/lib/i18n';

export default function SaleBillingPreview({customerName, amountDue}) {
  if (!customerName) return null;

  return <dl className="space-y-2 rounded-xl border bg-white p-3 text-sm">
    <div className="flex flex-wrap items-baseline justify-between gap-1">
      <dt className="text-muted-foreground">{ui('Customer account')}</dt>
      <dd className="min-w-0 break-words font-semibold">{customerName}</dd>
    </div>
    {amountDue > 0 && <div className="flex flex-wrap items-baseline justify-between gap-1">
      <dt className="text-muted-foreground">{ui('Amount added to customer balance')}</dt>
      <dd className="font-semibold tabular-nums">{formatXAF(amountDue)}</dd>
    </div>}
  </dl>;
}
