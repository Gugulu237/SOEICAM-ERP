import React from 'react';
import { ui } from '@/lib/i18n';
import { formatNumber } from '@/lib/formatters';
import { Button } from '@/components/ui/button';

export default function ProductionApprovalNotice({ result, reference, onReview }) {
  if (!result?.blocked) return null;
  return <section role="alert" className="mb-5 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
    <h3 className="font-semibold text-slate-950">{ui('Production approval blocked')}{reference ? ` — ${reference}` : ''}</h3>
    <p>{ui('Approval remains pending until all required materials are available in the selected warehouses.')}</p>
    <div className="overflow-x-auto"><table className="mobile-table-cards w-full min-w-[560px] text-left">
      <thead><tr><th>{ui('Material')}</th><th>{ui('Source warehouse')}</th><th className="text-right">{ui('Required')}</th><th className="text-right">{ui('Available')}</th><th className="text-right">{ui('Short')}</th></tr></thead>
      <tbody>{result.shortages.map(row=><tr key={row.material_id} className="border-t border-slate-200"><td data-label={ui("Material")} className="py-2">{row.material_name}</td><td data-label={ui("Source warehouse")}>{row.warehouse_id ? row.warehouse_name : ui('Select source warehouse')}</td><td data-label={ui("Required")} className="text-right">{formatNumber(row.required,3)} {row.unit}</td><td data-label={ui("Available")} className="text-right">{formatNumber(row.available,3)} {row.unit}</td><td data-label={ui("Short")} className="text-right font-semibold">{formatNumber(row.missing,3)} {row.unit}</td></tr>)}</tbody>
    </table></div>
    {onReview && <Button variant="outline" onClick={onReview}>{ui('Review materials and purchasing')}</Button>}
  </section>;
}
