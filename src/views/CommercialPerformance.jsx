import ReportExport from '@/components/shared/ReportExport';
import { commercialPerformanceDocument } from '@/lib/report-models';

/* localized-messages */
import { uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useEffect, useState } from 'react';
import { usePageState } from '@/lib/navigation-context';
import { Link, useSearchParams } from '@/lib/router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import PageHeader from '@/components/shared/PageHeader';
import ProductThumb from '@/components/shared/ProductThumb';
import CustomerMapLinks from '@/components/customers/CustomerMapLinks';
import { invokeFieldOps, errorMessage } from '@/lib/field-ops';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { formatXAF } from '@/lib/formatters';
import { Download } from 'lucide-react';
import { canViewAllCommercialReports } from '@/lib/operations-access';
import { businessDate } from '@/lib/business-date';

const today = businessDate;
const statusLabel = (value) => (value || 'pending').replaceAll('_', ' ');
const download = (data) => {
  const rows = [['Period', data.from, data.to], [], ['Agent', 'Registered', ui("Verified unique"), ui("Pending verification"), ui("Customers supplied"), ui("Approved deliveries"), ui("Net supply XAF"), ui("Supply including tax XAF"), ui("Bonus plan")]];
  data.agents.forEach((a) => rows.push([a.full_name, a.registered, a.verified, a.pending, a.customers_supplied, a.deliveries, a.net, a.total, a.bonus_plan]));
  rows.push([], ['Agent', 'Customer', 'Product', 'Unit', ui("Approved quantity")]);
  data.supplies.forEach((s) => s.products.forEach((p) => rows.push([s.commercial_name, s.customer_name, p.name, p.unit, p.quantity])));
  rows.push([], ['Customer', ui("Acquisition agent"), ui("Registered date"), 'Verification']);
  data.registrations.forEach((c) => rows.push([c.business_name, c.acquired_by_name, c.acquisition_date, statusLabel(c.acquisition_verified)]));
  const cell = (value) => { let text = String(value ?? ''); if (/^[\s]*[=+@-]/.test(text)) text = "'" + text; return '"' + text.replaceAll('"', '""') + '"'; };
  const url = URL.createObjectURL(new Blob(['\uFEFF' + rows.map((row) => row.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a'); a.href = url; a.download = `commercial-performance-${data.from}-${data.to}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export default function CommercialPerformance({ embedded = false, selectedAgentId = '', readOnly = false, reviewMode = false }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [params] = useSearchParams();
  const { isAdmin, role, employee, loading: authLoading } = useCurrentUser();
  const canReview = isAdmin && reviewMode && !readOnly;
  const allAgents = canViewAllCommercialReports(role,employee);
  const [from, setFrom] = usePageState('commercial-performance:from', () => today().slice(0, 8) + '01');
  const [to, setTo] = usePageState('commercial-performance:to', today);
  const [commercialId, setCommercialId] = useState(() => selectedAgentId || params.get('commercial') || '');
  const [options, setOptions] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [tab, setTab] = usePageState('commercial-performance:tab'+(reviewMode?':review':''), reviewMode?'registrations':'supplies');
  const [search, setSearch] = usePageState('commercial-performance:search', '');
  const [review, setReview] = useState(null);
  const [status, setStatus] = useState('pending');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [reviewError, setReviewError] = useState('');
  useEffect(() => { if (embedded && isAdmin) setCommercialId(selectedAgentId); }, [embedded, isAdmin, selectedAgentId]);
  useEffect(() => {
    if (authLoading) return;
    let active = true;
    setLoading(true); setError(''); setData(null);
    invokeFieldOps({ action: 'commercialPerformance', from, to, commercialId: allAgents ? commercialId : '' }).then((res) => {
      if (res.data.error) throw new Error(res.data.error);
      if (active) { setData(res.data); setOptions(previous => !commercialId ? res.data.agents : [...new Map([...previous, ...res.data.agents].map(agent => [agent.id, agent])).values()]); }
    }).catch((e) => { if (active) setError(errorMessage(e)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [authLoading, allAgents, from, to, commercialId, reload]);

  const verify = async () => {
    if (saving || !canReview) return;
    setSaving(true); setReviewError('');
    try {
      const res = await invokeFieldOps({ action: 'verifyFieldCustomer', customerId: review.id, status, notes });
      if (res.data.error) throw new Error(res.data.error);
      setReview(null); setReload((n) => n + 1);
    } catch (e) { setReviewError(errorMessage(e)); }
    finally { setSaving(false); }
  };
  const totals = (data?.agents || []).reduce((out, a) => ({ registered: out.registered + a.registered, verified: out.verified + a.verified, deliveries: out.deliveries + a.deliveries, net: out.net + a.net }), { registered: 0, verified: 0, deliveries: 0, net: 0 });
  const matches = (name) => String(name || '').toLowerCase().includes(search.toLowerCase());

  return <div className={embedded ? 'space-y-1' : 'mx-auto max-w-7xl p-4 sm:p-6'}>
    {!embedded && isAdmin && commercialId && <Link to={'/commercial?employee=' + encodeURIComponent(commercialId)} className="mb-4 inline-block text-sm font-medium text-emerald-700 underline">{ui("Back to agent dashboard")}</Link>}
    <PageHeader title={canReview ? ui('Customer acquisition review') : allAgents ? ui("Commercial performance") : ui("My performance")} subtitle={canReview ? ui('Verify reported customer acquisitions as General Manager. The review records your own account and does not create employee sales or operations.') : ui("Customer acquisition and approved supplies for bonus review.")}
      actions={<div className="flex flex-wrap gap-2"><ReportExport disabled={!data || loading || !!error || from>to || data.from!==from || data.to!==to} getReport={()=>commercialPerformanceDocument(data)}/><Button variant="outline" disabled={!data || loading} onClick={() => download(data)}><Download size={16} className="mr-2" />{ui("Export report")}</Button></div>} />
    <div className="mb-5 grid gap-4 rounded-xl border bg-white p-4 sm:grid-cols-3">
      <label className="space-y-1.5 text-sm font-medium">{ui("From")}<Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
      <label className="space-y-1.5 text-sm font-medium">{ui("To")}<Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      {allAgents && (!embedded || !isAdmin) && <label className="space-y-1.5 text-sm font-medium">{ui("Commercial agent")}<select className="h-10 w-full rounded-md border bg-white px-3" value={commercialId} onChange={(e) => setCommercialId(e.target.value)}><option value="">{ui("All agents")}</option>{options.map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}</select></label>}
    </div>
    <p className="mb-5 text-sm text-slate-500">{ui("Supply totals include approved and posted field sales dated in this period. Registrations use their acquisition date. Quantities remain separate by product and unit. Bonus amounts require the agreed bonus plan and management approval.")}</p>
    {loading ? <p role="status" className="py-12 text-center text-slate-500">{ui("Loading performance…")}</p> : error ? <p role="alert" className="text-red-700">{uiMessage(error)} <button className="underline" onClick={() => setReload((n) => n + 1)}>{ui("Retry")}</button></p> : data && <>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">{[[ui("Registered customers"), totals.registered], [ui("Verified unique customers"), totals.verified], [ui("Approved deliveries"), totals.deliveries], [ui("Net supply value"), formatXAF(totals.net)]].map(([label, value]) => <div key={label} className="rounded-xl border bg-white p-4"><p className="text-xs text-slate-500">{label}</p><p className="mt-2 text-xl font-bold text-slate-900">{value}</p></div>)}</div>
      <div className="mb-6 overflow-x-auto rounded-xl border bg-white"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr>{['Agent', 'Registered', 'Verified', 'Pending', ui("Customers supplied"), 'Deliveries', ui("Net XAF"), ui("With tax XAF")].map((label) => <th key={label} className="whitespace-nowrap p-3">{label}</th>)}</tr></thead><tbody>{data.agents.map((a) => <tr key={a.id} className="border-t"><td className="min-w-48 p-3"><p className="font-semibold">{a.full_name}</p><p className="mt-1 max-w-xs whitespace-pre-wrap text-xs text-slate-500">{a.bonus_plan ? 'Bonus plan: ' + a.bonus_plan : ui("No bonus plan recorded")}</p></td>{[a.registered, a.verified, a.pending, a.customers_supplied, a.deliveries, formatXAF(a.net), formatXAF(a.total)].map((v, i) => <td key={i} className="whitespace-nowrap p-3 tabular-nums">{v}</td>)}</tr>)}</tbody></table></div>
      <div className="mb-4 flex flex-wrap items-center gap-2"><Button variant={tab === 'supplies' ? 'default' : 'outline'} onClick={() => setTab('supplies')}>{ui("Supplies by customer")}</Button><Button variant={tab === 'registrations' ? 'default' : 'outline'} onClick={() => setTab('registrations')}>{ui("Customer registrations")}</Button><Input className="h-10 bg-white sm:ml-auto sm:w-64" placeholder={ui("Find a customer…")} aria-label={ui("Search report customers")} value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      {tab === 'supplies' ? <div className="grid gap-4 lg:grid-cols-2">
        {!data.supplies.filter((s) => matches(s.customer_name)).length && <p className="py-8 text-slate-500">{ui("No approved supplies match this period and search.")}</p>}
        {data.supplies.filter((s) => matches(s.customer_name)).map((s) => <article key={s.commercial_id + ':' + s.customer_id} className="space-y-3 rounded-xl border bg-white p-4">
          <div className="flex flex-wrap justify-between gap-2"><div><h3 className="font-semibold">{s.customer_name}</h3><p className="text-xs text-slate-500">{s.commercial_name} · {s.deliveries}{ui(" approved deliveries")}</p></div><div className="text-right"><p className="font-semibold">{formatXAF(s.net)}</p><p className="text-xs text-slate-500">{ui("Net · ")}{formatXAF(s.total)}{ui(" with tax")}</p></div></div>
          <div className="divide-y">{s.products.map((p) => <div key={p.product_id + ':' + p.unit} className="flex items-center gap-3 py-2"><ProductThumb product={data.products?.find((item) => item.id === p.product_id)} name={p.name} size={48} /><span className="flex-1 text-sm">{p.name}</span><span className="text-sm font-semibold">{p.quantity} {p.unit || ui("units")}</span></div>)}</div>
          <CustomerMapLinks customer={s.customer} />
        </article>)}
      </div> : <div className="grid gap-4 lg:grid-cols-2">
        {!data.registrations.filter((c) => matches(c.business_name)).length && <p className="py-8 text-slate-500">{ui("No registrations match this period and search.")}</p>}
        {data.registrations.filter((c) => matches(c.business_name)).map((c) => <article key={c.id} className="space-y-2 rounded-xl border bg-white p-4"><div className="flex flex-wrap items-start justify-between gap-2"><h3 className="font-semibold">{c.business_name}</h3><span className={'rounded-full px-2 py-1 text-xs ' + (c.acquisition_verified === 'verified_unique' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800')}>{statusLabel(c.acquisition_verified)}</span></div>
          <p className="text-sm text-slate-500">{c.acquired_by_name} · {c.acquisition_date}</p><p className="text-sm">{c.phone} · {[c.neighbourhood, c.town].filter(Boolean).join(', ')}</p><CustomerMapLinks customer={c} />
          {c.registered_by_name && <p className="text-xs text-slate-500">{ui("Registered by ")}{c.registered_by_name}</p>}
          {c.acquisition_notes && <p className="text-xs text-slate-600">{ui("Review: ")}{c.acquisition_notes}</p>}
          {canReview && <Button variant="outline" onClick={() => { setReview(c); setStatus(c.acquisition_verified || 'pending'); setNotes(c.acquisition_notes || ''); setReviewError(''); }}>{ui("Review acquisition")}</Button>}
        </article>)}
      </div>}
    </>}
    <Dialog open={!!review && canReview} onOpenChange={(open) => { if (!open && !saving) setReview(null); }}><DialogContent><DialogHeader><DialogTitle>{ui("Review ")}{review?.business_name}</DialogTitle></DialogHeader><p className="text-sm text-slate-500">{ui("Confirm this is a unique customer before counting it towards an acquisition bonus.")}</p>
      <label className="space-y-2 text-sm">{ui("Verification")}<select className="h-11 w-full rounded-md border bg-white px-3" value={status} disabled={saving} onChange={(e) => setStatus(e.target.value)}>{['pending', 'verified_unique', 'duplicate', 'rejected'].map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}</select></label>
      <label className="space-y-2 text-sm">{ui("Review notes")}<Textarea value={notes} maxLength={1000} disabled={saving} onChange={(e) => setNotes(e.target.value)} /></label>
      {reviewError && <p role="alert" className="text-sm text-red-700">{reviewError}</p>}<Button disabled={saving} onClick={verify}>{saving ? ui("Saving review…") : ui("Save verification")}</Button>
    </DialogContent></Dialog>
  </div>;
}
