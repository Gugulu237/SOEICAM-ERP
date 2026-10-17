import React from 'react';
import StatusBadge from '@/components/shared/StatusBadge';
import { formatXAF } from '@/lib/formatters';

export default function CustomerPaymentBadge({ summary, error }) {
  if (error) return <span className="text-xs text-destructive">Payment status unavailable</span>;
  if (!summary) return <span className="text-xs text-muted-foreground">Loading payments…</span>;
  return <div className="space-y-1">
    <StatusBadge status={summary.status} />
    {summary.pending > 0 && <p className="text-xs text-muted-foreground">{formatXAF(summary.pending)} awaiting approval</p>}
  </div>;
}