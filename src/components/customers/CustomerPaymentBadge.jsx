
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React from 'react';
import StatusBadge from '@/components/shared/StatusBadge';
import { formatXAF } from '@/lib/formatters';

export default function CustomerPaymentBadge({ summary, error }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  if (error) return <span className="text-xs text-destructive">{ui("Payment status unavailable")}</span>;
  if (!summary) return <span className="text-xs text-muted-foreground">{ui("Loading payments…")}</span>;
  return <div className="space-y-1">
    <StatusBadge status={summary.status} />
    {summary.pending > 0 && <p className="text-xs text-muted-foreground">{formatXAF(summary.pending)}{ui(" awaiting approval")}</p>}
  </div>;
}