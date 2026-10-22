
/* localized-messages */
import { uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import ProductThumb from '@/components/shared/ProductThumb';
import { formatXAF } from '@/lib/formatters';
import { receiptUrl, errorMessage } from '@/lib/field-ops';

export default function OutletDailyReportCard({ report, preview, onReview }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [expanded, setExpanded] = useState(false), [notes, setNotes] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const delivery = report.report_type === 'delivery_shelf_check';
  const review = async () => { setBusy(true); setError(''); try { await onReview(report.id, notes); } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); } };
  const proof = async uri => { try { window.open(await receiptUrl(uri), '_blank', 'noopener,noreferrer'); } catch (failure) { setError(errorMessage(failure)); } };
  return <article className="rounded-2xl border bg-white p-4 sm:p-5"><button type="button" className="flex w-full flex-wrap items-start justify-between gap-3 text-left" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}><div><p className="text-[10px] font-semibold uppercase tracking-wider text-rose-700">{delivery ? ui("Shelf count after delivery") : ui("Daily units sold & closing stock")} / {report.visit_date}</p><h3 className="mt-2 text-sm font-semibold">{report.customer_name} / {report.location_name}</h3><p className="mt-1 text-xs text-slate-500">{report.employee_name} / {report.lines?.length || 0}{ui(" products")}{delivery && ' / ' + report.delivery_number}</p><p className="mt-2 text-[11px] text-blue-800">{ui("Informational report / No accounting posting")}</p></div><span className={'rounded-full px-3 py-1 text-xs font-medium ' + (report.status === 'reviewed' ? 'bg-emerald-50 text-emerald-800' : report.has_concerns ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-600')}>{report.status === 'reviewed' ? ui("Reviewed") : report.has_concerns ? ui("Needs follow-up") : ui("Submitted")}</span></button>
    {expanded && <div className="mt-4 space-y-4 border-t pt-4">{(report.lines || []).map(line => <section key={line.product_id} className="rounded-xl bg-slate-50 p-4"><div className="flex items-center gap-3"><ProductThumb product={{ id: line.product_id, name: line.product_name, image_url: line.image_url }} size={50} /><div><h4 className="text-sm font-semibold">{line.product_name}</h4><p className="mt-1 text-xs text-slate-500">{line.unit}{line.quantity === 0 ? ui(" / Stock-out") : ''}</p></div></div><dl className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">{(delivery ? [[ui("Supplied in delivery"), line.supplied_quantity], [ui("Counted on shelves"), line.quantity], [ui("Estimate before check"), line.expected_closing]] : [[ui("Available for the day"), line.opening_quantity], [ui("Units sold today"), line.sold_quantity], [ui("Damaged / spoiled"), line.damaged_quantity], [ui("Expected remaining"), line.expected_closing], [ui("Counted remaining"), line.quantity], [ui("Count difference"), line.variance]]).map(([label, value]) => <div key={label}><dt className="text-slate-500">{label}</dt><dd className="mt-1 font-semibold text-slate-900">{value ?? '-'}</dd></div>)}</dl>{line.batches?.length > 0 && <div className="mt-3 space-y-1 text-xs text-slate-500">{line.batches.map((batch, i) => <p key={i}>{ui("Batch ")}{batch.lot_number || ui("not recorded")}: {batch.quantity} {line.unit}{batch.expiry_date ? ' / Expires ' + batch.expiry_date : ''}</p>)}</div>}</section>)}
      {report.notes && <div><h4 className="text-xs font-semibold">{ui("Stock notes")}</h4><p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{report.notes}</p></div>}{report.marketing_feedback && <div className="rounded-xl bg-blue-50 p-3"><h4 className="text-xs font-semibold text-blue-900">{ui("Customer feedback & marketing")}</h4><p className="mt-1 whitespace-pre-wrap text-sm text-blue-900">{report.marketing_feedback}</p></div>}
      {!delivery && report.sales_total != null && <p className="text-xs text-slate-500">{ui("Optional reported retail value: ")}{formatXAF(report.sales_total)}{ui(". This is not added to company sales or accounting.")}</p>}
      <div className="flex flex-wrap gap-2">{(report.proof_file_uris || []).map((uri, index) => <Button key={uri} size="sm" variant="outline" onClick={() => proof(uri)}>{ui("Photo ")}{index + 1}</Button>)}</div>
      {report.status === 'reviewed' && <p className="rounded-xl bg-emerald-50 p-3 text-xs text-emerald-900">{ui("Reviewed")}{report.review_notes ? ' / ' + report.review_notes : ''}</p>}
      {onReview && report.status !== 'reviewed' && <div className="space-y-3"><label className="block text-xs font-medium">{ui("Management feedback")}<Textarea className="mt-2" maxLength={2000} disabled={busy} value={notes} onChange={event => setNotes(event.target.value)} /></label><Button size="sm" disabled={busy || preview} onClick={review}>{busy ? ui("Saving...") : ui("Mark reviewed")}</Button><p className="text-[11px] text-slate-500">{ui("Review acknowledges this report. It does not post money or adjust stock.")}</p></div>}
    </div>}{error && <p role="alert" className="mt-3 text-sm text-red-700">{uiMessage(error)}</p>}
  </article>;
}
