
/* localized-messages */
import { uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import ProductThumb from '@/components/shared/ProductThumb';
import { receiptUrl, errorMessage } from '@/lib/field-ops';
import { formatXAF } from '@/lib/formatters';
import { AVAILABILITY, OUTLET_ISSUES } from '@/server/domain/outlet-rules.js';
import OutletDailyReportCard from './OutletDailyReportCard';

export default function OutletReportCard({ report, products = [], preview = false, onReview }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [expanded, setExpanded] = useState(false), [notes, setNotes] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const review = async () => { setBusy(true); setError(''); try { await onReview(report.id, notes); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } };
  const proof = async uri => { try { window.open(await receiptUrl(uri), '_blank', 'noopener,noreferrer'); } catch (e) { setError(errorMessage(e)); } };
  if (['daily_sales', 'delivery_shelf_check'].includes(report.report_type)) return <OutletDailyReportCard report={report} preview={preview} onReview={onReview} />;
  return <article className="rounded-2xl border bg-white p-4"><button onClick={() => setExpanded(value => !value)} aria-expanded={expanded} className="flex w-full items-start justify-between gap-3 text-left"><div><h3 className="text-sm font-semibold">{report.customer_name} Â· {report.location_name}</h3><p className="mt-1 text-xs text-slate-500">{report.visit_date} Â· {report.employee_name} Â· {report.lines?.length || 0}{ui(" products checked")}</p></div><span className={'shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold ' + (report.status === 'reviewed' ? 'bg-emerald-50 text-emerald-800' : report.has_concerns ? 'bg-slate-50 text-slate-800' : 'bg-slate-100 text-slate-700')}>{report.status === 'reviewed' ? ui("Reviewed") : report.has_concerns ? ui("Concerns to review") : ui("Submitted")}</span></button>
    {expanded && <div className="mt-4 space-y-3 border-t pt-3">{(report.lines || []).map(line => <div key={line.product_id} className="flex gap-3 rounded-lg bg-slate-50 p-3"><ProductThumb product={products.find(p => p.id === line.product_id)} name={line.product_name} size={45} /><div className="min-w-0 text-xs"><p className="font-semibold">{line.product_name}</p><p className="mt-1">{AVAILABILITY[line.availability]}{line.quantity != null ? ' Â· ' + line.quantity + ' ' + (line.unit || ui("units")) : ui(" Â· Quantity not counted")}</p>{line.issue !== 'none' && <p className="mt-1 text-slate-800">{OUTLET_ISSUES[line.issue]}</p>}{line.observed_price != null && <p className="mt-1">{ui("Observed price: ")}{formatXAF(line.observed_price)}</p>}{line.expiry_date && <p className="mt-1">{ui("Pack expiry: ")}{line.expiry_date}</p>}</div></div>)}
      {report.notes && <p className="whitespace-pre-wrap text-sm text-slate-700">{report.notes}</p>}
      <div className="flex flex-wrap gap-2">{(report.proof_file_uris || []).map((uri, index) => <Button key={uri} size="sm" variant="outline" onClick={() => proof(uri)}>{ui("View photo ")}{index + 1}</Button>)}</div>
      {report.status === 'reviewed' && <p className="rounded-xl bg-emerald-50 p-3 text-xs text-emerald-900">{ui("Reviewed ")}{report.reviewed_at ? new Date(report.reviewed_at).toLocaleString() : ''}{report.review_notes ? ' Â· ' + report.review_notes : ''}</p>}
      {onReview && report.status !== 'reviewed' && <div className="space-y-2"><label className="block text-xs font-medium">{ui("Review note (optional)")}<Textarea value={notes} maxLength={2000} onChange={e => setNotes(e.target.value)} disabled={busy} /></label><Button size="sm" disabled={busy || preview} onClick={review}>{busy ? ui("Saving...") : ui("Mark reviewed")}</Button><p className="text-xs text-slate-500">{ui("Acknowledges the report; stock corrections or commercial follow-up use their own workflows.")}</p></div>}
    </div>}{error && <p role="alert" className="mt-3 text-sm text-red-700">{uiMessage(error)}</p>}
  </article>;
}
