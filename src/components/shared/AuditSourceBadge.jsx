import React from 'react';
import { ui } from '@/lib/i18n';
import { auditProvenance } from '@/lib/audit-provenance';

const colors = {
  verified: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  reported: 'border-amber-200 bg-amber-50 text-amber-800',
  unknown: 'border-slate-200 bg-slate-50 text-slate-600',
};
export default function AuditSourceBadge({ event }) {
  const source = auditProvenance(event);
  return <span title={ui(source.description)} className={`inline-flex whitespace-nowrap rounded border px-2 py-0.5 text-xs ${colors[source.tone]}`}>{ui(source.label)}</span>;
}
