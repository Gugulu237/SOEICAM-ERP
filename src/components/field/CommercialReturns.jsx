
/* localized-messages */
import { sourceMessage, uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { erp } from '@/api/erpClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import CustomerPicker from './CustomerPicker';
import ReceiptUploader from './ReceiptUploader';
import ProductThumb from '@/components/shared/ProductThumb';
import ProductCatalog from '@/components/shared/ProductCatalog';
import { invokeFieldOps, errorMessage, newIdempotencyKey, receiptUrl } from '@/lib/field-ops';
import { readAll, availableCustody } from '@/lib/field-pos';
import { businessDate } from '@/lib/business-date';
import { RotateCcw, RefreshCw } from 'lucide-react';

const blank = () => ({ customerId: '', locationId: '', dispatchId: '', productId: '', quantity: '', expiryDate: '', lotNumber: '', receiptReference: '', receiptFileUris: [], notes: '', replaceNow: true });

export default function CommercialReturns({ employeeId, preview = false, driver = false, onChanged }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [data, setData] = useState(null), [customers, setCustomers] = useState([]), [products, setProducts] = useState([]);
  const [form, setForm] = useState(() => ({ ...blank(), replaceNow: !driver })), [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [uploading, setUploading] = useState(false);
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [reload, setReload] = useState(0), [pendingId, setPendingId] = useState('');
  const requestKey = useRef(newIdempotencyKey()), submitting = useRef(false);
  const date = businessDate();
  const set = patch => { setForm(previous => ({ ...previous, ...patch })); setError(''); setMessage(''); };
  useEffect(() => {
    if (!employeeId || preview) return;
    let active = true;
    setLoading(true); setError('');
    const load = driver ? invokeFieldOps({ action: 'driverReturnsWorkspace', driverId: employeeId }).then(({ data }) => {
      if (data.error) throw Error(data.error);
      return [{ data }, { data: { returns: data.returns, requests: data.requests } }, data.customers, data.products];
    }) : Promise.all([
      invokeFieldOps({ action: 'commercialDailySupplies', commercialId: employeeId, date }),
      invokeFieldOps({ action: 'commercialReturns', commercialId: employeeId }),
      readAll(erp.entities.Customer, { is_active: true }, 'business_name'),
      readAll(erp.entities.Product, { inventory_type: { $in: ['assembly', 'finished_product'] } }, 'name'),
    ]);
    load.then(([inventory, history, people, items]) => {
      if (inventory.data.error || history.data.error) throw new Error(inventory.data.error || history.data.error);
      if (!active) return;
      setData({ ...inventory.data, returns: history.data.returns, requests: history.data.requests || [] }); setCustomers(people); setProducts(items);
      const runs = inventory.data.runs.filter(run => run.can_supply);
      setForm(previous => ({ ...previous, dispatchId: runs.some(run => run.id === previous.dispatchId) ? previous.dispatchId : runs.length === 1 ? runs[0].id : '' }));
    }).catch(failure => { if (active) setError(errorMessage(failure)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [employeeId, preview, driver, reload, date]);
  useEffect(() => {
    let active = true; setLocations([]);
    if (driver) { setLocations((data?.locations || []).filter(l => l.customer_id === form.customerId)); return () => { active = false; }; }
    if (form.customerId) readAll(erp.entities.CustomerLocation, { customer_id: form.customerId, is_active: true })
      .then(rows => { if (active) setLocations(rows); }).catch(() => { if (active) setError(sourceMessage("Customer delivery points could not load. Refresh before recording a return.")); });
    return () => { active = false; };
  }, [form.customerId, driver, data]);
  const selectedProduct = products.find(product => product.id === form.productId);
  const openReceipt = async uri => {
    try { window.open(await receiptUrl(uri), '_blank', 'noopener,noreferrer'); }
    catch (failure) { setError(errorMessage(failure)); }
  };
  const available = useMemo(() => availableCustody((data?.runBalances || []).filter(row => row.dispatch_id === form.dispatchId), form.productId, date), [data, form.dispatchId, form.productId, date]);
  const save = async event => {
    event.preventDefault();
    if (submitting.current || uploading || preview) return;
    if (!form.dispatchId || !form.receiptFileUris.length || !form.receiptReference.trim()) { setError(sourceMessage("Choose the vehicle run and attach a photo with the return/replacement receipt reference.")); return; }
    if (!pendingId && (!form.customerId || !form.productId || !(Number(form.quantity) > 0) || !form.expiryDate || form.expiryDate >= date)) { setError(sourceMessage("Choose the customer, product, exact quantity and past printed expiry date.")); return; }
    if (!pendingId && form.replaceNow && Number(form.quantity) > available) { setError(sourceMessage("Only {0} fresh units are available. Collect the expired goods now and replace them later, or choose a run carrying enough stock.", available)); return; }
    submitting.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const response = await invokeFieldOps({ action: pendingId ? 'replaceExpiredReturn' : 'recordExpiredReturn', ...(driver ? { driverId: employeeId } : { commercialId: employeeId }),
        ...form, receiptReference: form.receiptReference.trim(), quantity: Number(form.quantity), date, requestKey: requestKey.current, returnId: pendingId || undefined });
      if (response.data.error) throw new Error(response.data.error);
      setMessage(sourceMessage("Request sent for Warehouse or GM verification. Stock and accounting will update only after approval."));
      requestKey.current = newIdempotencyKey(); setForm({ ...blank(), replaceNow: !driver }); setPendingId(''); setReload(value => value + 1); onChanged?.();
    } catch (failure) { setError(errorMessage(failure)); }
    finally { submitting.current = false; setBusy(false); }
  };
  if (preview) return <p className="p-5 text-sm text-slate-500">{driver ? ui("Drivers report expired collections. Commercial agents record fresh replacements.") : ui("Choose a live Commercial agent to record customer returns.")}</p>;
  return <section className="space-y-5">
    <div className="flex flex-wrap justify-between gap-3"><div><h2 className="flex items-center gap-2 text-lg font-semibold"><RotateCcw size={19} />{ui("Exchanges")}</h2><p className="mt-2 text-sm leading-6 text-slate-500">{ui("Report expired goods and request a like-for-like exchange. Warehouse or the GM verifies the evidence before stock and accounting update.")}</p></div><Button variant="outline" disabled={busy || loading} onClick={() => setReload(value => value + 1)}><RefreshCw size={16} />{ui("Refresh")}</Button></div>
    {loading && !data ? <p role="status" className="p-5 text-sm">{ui("Loading delivery stock and returns...")}</p> : <form onSubmit={save} className="space-y-4 rounded-xl border bg-slate-50/60 p-4">
      <h3 className="font-semibold">{pendingId ? ui("Request the pending replacement") : ui("Report an expired collection")}</h3>
      <fieldset disabled={busy || uploading} className="space-y-4">
        <label className="block space-y-1 text-sm font-medium">{ui("Vehicle / driver run *")}<select required value={form.dispatchId} onChange={event => set({ dispatchId: event.target.value })} className="h-11 w-full rounded-md border bg-white px-3"><option value="">{ui("Choose the loaded vehicle run")}</option>{(data?.runs || []).filter(run => run.can_supply).map(run => <option key={run.id} value={run.id}>{run.dispatch_number} / {run.driver_name} / {run.vehicle_name}</option>)}</select></label>
        {!pendingId && <>
          <CustomerPicker purpose="return" customers={customers} value={form.customerId} onChange={id => set({ customerId: id, locationId: '' })} disabled={busy} />
          <label className="block space-y-1 text-sm">{ui("Customer delivery point")}<select value={form.locationId} onChange={event => set({ locationId: event.target.value })} className="h-11 w-full rounded-md border bg-white px-3"><option value="">{ui("Main customer address")}</option>{locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</select><span className="block text-xs text-slate-500">{ui("The main address is saved as a delivery point if one is needed for traceability.")}</span></label>
          <div><p className="mb-2 text-sm font-medium">{ui("Expired product *")}</p><ProductCatalog products={products} hidePrice onSelect={product => set({ productId: product.id })} renderDetails={product => product.id === form.productId ? <p className="text-xs font-semibold text-emerald-700">{ui("Selected for collection")}</p> : null} emptyMessage={ui("No finished products available.")} /></div>
          {selectedProduct && <div className="flex items-center gap-3 rounded-lg border bg-white p-3"><ProductThumb product={selectedProduct} size={58} /><div><p className="text-sm font-semibold">{selectedProduct.name}</p><p className="mt-1 text-xs text-slate-500">{available}{ui(" fresh ")}{selectedProduct.unit_of_measure || selectedProduct.storage_unit || ui("units")}{ui(" available on this run")}</p></div></div>}
          <div className="grid gap-3 sm:grid-cols-3"><label className="space-y-1 text-sm">{ui("Quantity collected *")}<Input required type="number" min="0.001" step="0.001" value={form.quantity} onChange={event => set({ quantity: event.target.value })} /></label><label className="space-y-1 text-sm">{ui("Printed expiry date *")}<Input required type="date" max={date} value={form.expiryDate} onChange={event => set({ expiryDate: event.target.value })} /></label><label className="space-y-1 text-sm">{ui("Batch / lot number")}<Input value={form.lotNumber} maxLength={200} onChange={event => set({ lotNumber: event.target.value })} /></label></div>
          {!driver && <label className="flex min-h-11 items-center gap-3 text-sm font-medium"><input type="checkbox" checked={form.replaceNow} onChange={event => set({ replaceNow: event.target.checked })} />{ui("Request the same quantity of the same product as a fresh replacement")}</label>}
        </>}
        {pendingId && <p className="rounded-lg bg-slate-50 p-3 text-sm">{ui("Replacing ")}{form.quantity}{ui(" units of ")}{selectedProduct?.name || ui("the collected product")}{ui(". Expired goods are already registered and will not be collected again.")}</p>}
        <ReceiptUploader reference={form.receiptReference} onReferenceChange={receiptReference => set({ receiptReference })} fileUris={form.receiptFileUris} onChange={receiptFileUris => set({ receiptFileUris })} onBusyChange={setUploading} disabled={busy} purpose="return" />
        <label className="block space-y-1 text-sm">{ui("Notes")}<Textarea maxLength={2000} value={form.notes} onChange={event => set({ notes: event.target.value })} placeholder={ui("Condition, original supply reference, customer acknowledgement...")} /></label>
      </fieldset>
      <div className="flex flex-wrap gap-2"><Button disabled={busy || uploading || loading} type="submit">{busy ? ui("Recording...") : pendingId ? ui("Submit replacement for verification") : form.replaceNow ? ui("Submit exchange for verification") : ui("Submit collection for verification")}</Button>{pendingId && <Button type="button" variant="outline" disabled={busy} onClick={() => { setPendingId(''); setForm(blank()); requestKey.current = newIdempotencyKey(); }}>{ui("Cancel replacement")}</Button>}</div>
    </form>}
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{uiMessage(error)}</p>}
    {message && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{uiMessage(message)}</p>}
    <section><h3 className="mb-3 font-semibold">{ui("Verification requests")}</h3><div className="divide-y rounded-xl border bg-white">{!(data?.requests || []).length && <p className="p-4 text-sm text-slate-500">{ui("No verification requests yet.")}</p>}{[...(data?.requests || [])].reverse().map(record => <article key={record.id} className="space-y-2 p-4 text-sm"><p className="font-semibold">{record.customer_name} / {record.product_name}</p><p>{record.quantity} {record.unit} / {record.reported_date} / {record.replace_now ? ui("Exchange requested") : ui("Collection only")}</p><p className={record.status === 'rejected' ? 'text-red-700' : 'text-slate-800'}>{record.status === 'verified' ? ui("Verified and posted") : record.status === 'rejected' ? ui("Rejected") : ui("Awaiting verification; stock unchanged")}</p>{record.review_note && <p>{record.review_note}</p>}</article>)}</div></section>
    <section><h3 className="mb-3 font-semibold">{ui("Reported collections")}</h3><div className="divide-y rounded-xl border bg-white">{!(data?.returns || []).length && <p className="p-4 text-sm text-slate-500">{ui("No expired collections reported by this agent.")}</p>}{(data?.returns || []).map(record => <article key={record.id} className="flex flex-wrap items-center gap-3 p-4"><ProductThumb product={products.find(product => product.id === record.product_id)} name={record.product_name} size={48} /><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{record.customer_name}</p><p className="mt-1 text-xs text-slate-500">{record.quantity} {record.unit} / {record.product_name} / {record.reported_date}</p><p className="mt-1 text-xs text-slate-500">{record.reason === 'damaged_at_store' ? ui("Damaged") : ui("Expired")} / {record.return_received_at ? ui("Received at warehouse") : ui("Quarantined on vehicle")}{record.source_sale_number ? ' / ' + record.source_sale_number : ''}</p></div><span className="rounded-full bg-slate-50 px-3 py-1 text-xs font-medium">{record.status === 'replaced' ? ui("Replacement completed") : ui("Replacement pending")}</span>{(record.receipt_file_uris || []).map((uri, index) => <Button key={uri} type="button" variant="ghost" size="sm" onClick={() => openReceipt(uri)}>{ui("Collection photo ")}{index + 1}</Button>)}{(record.replacement_receipt_file_uris || []).map((uri, index) => <Button key={'replacement-' + uri} type="button" variant="ghost" size="sm" onClick={() => openReceipt(uri)}>{ui("Replacement photo ")}{index + 1}</Button>)}{!driver && record.status === 'reported' && <Button variant="outline" size="sm" disabled={busy || (data?.requests || []).some(request => request.return_id === record.id && request.status === 'pending_verification')} onClick={() => { requestKey.current = newIdempotencyKey(); setPendingId(record.id); setForm({ ...blank(), productId: record.product_id, quantity: String(record.quantity), receiptReference: record.receipt_reference, dispatchId: (data?.runs || []).find(run => run.can_supply)?.id || '' }); setMessage(''); }}>{ui("Replace from current run")}</Button>}</article>)}</div></section>
  </section>;
}
