
/* localized-messages */
import { uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useEffect, useState } from 'react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { Button } from '@/components/ui/button';
import { invokeFieldOps, errorMessage, receiptUrl } from '@/lib/field-ops';
import { DRIVER_ACTIVITY_LABELS } from '@/lib/employee-dashboard';

export default function DriverReports({ dispatchId }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const { role } = useCurrentUser();
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    invokeFieldOps({ action: 'dispatchActivity', dispatchId }).then((res) => {
      if (res.data.error) throw new Error(res.data.error);
      if (active) setActivities(res.data.activities);
    }).catch((e) => { if (active) setError(errorMessage(e)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [dispatchId, reload]);
  const viewProof = async (uri) => {
    try { const url = await receiptUrl(uri); window.open(url, '_blank', 'noopener,noreferrer'); }
    catch (e) { setError(errorMessage(e)); }
  };
  return <section className="space-y-4 rounded-xl border bg-white p-5"><div className="flex items-center justify-between"><div><h2 className="font-semibold">{ui("Driver reports")}</h2><p className="mt-1 text-sm text-slate-500">{ui("Review delivery outcomes and evidence alongside sales orders and stock reconciliation.")}</p></div><Button variant="outline" disabled={loading} onClick={() => setReload((n) => n + 1)}>{ui("Refresh")}</Button></div>
    {error && <p role="alert" className="text-sm text-red-700">{uiMessage(error)}</p>}{loading ? <p role="status" className="text-sm text-slate-500">{ui("Loading reports…")}</p> : !activities.length && !error ? <p className="text-sm text-slate-500">{ui("No driver reports for this run.")}</p> : null}
    {[...activities].sort((a, b) => b.recorded_at.localeCompare(a.recorded_at)).map((a) => <article key={a.id} className="space-y-2 rounded-xl border p-4"><div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">{DRIVER_ACTIVITY_LABELS[a.type]}</h3><span className="text-xs text-slate-500">{a.driver_name} · {new Date(a.recorded_at).toLocaleString()}</span></div>{a.customer_name && <p className="text-sm">{a.customer_name}{a.receiver ? ' · Received by ' + a.receiver : ''}</p>}{a.notes && <p className="whitespace-pre-wrap text-sm text-slate-600">{a.notes}</p>}{a.receipt_reference && <p className="text-xs text-slate-500">{ui("Delivery note: ")}{a.receipt_reference}</p>}
      <div className="flex flex-wrap gap-2">{a.order_id && role !== 'production_manager' && <a href={'/sales/' + encodeURIComponent(a.order_id)} className="inline-flex min-h-10 items-center text-sm text-blue-700 underline">{ui("Open sales order")}</a>}{(a.proof_file_uris || []).map((uri, i) => <Button key={uri} variant="outline" size="sm" onClick={() => viewProof(uri)}>{ui("Evidence ")}{i + 1}</Button>)}</div>
    </article>)}
  </section>;
}
