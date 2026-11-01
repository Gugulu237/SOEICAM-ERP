
/* localized-messages */
import { sourceMessage, uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { erp } from '@/api/erpClient';
import { useNavigate, useParams, useSearchParams } from '@/lib/router';
import { ArrowLeft, ArrowRight, Banknote, Check, CreditCard, Loader2, RefreshCw, ShoppingBag } from 'lucide-react';
import PageBackButton from '@/components/shared/PageBackButton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import SaleProductPicker from '@/components/sales/SaleProductPicker';
import SaleStockPicker,{vehicleSaleLabel} from '@/components/sales/SaleStockPicker';
import FieldSaleLines from '@/components/field/FieldSaleLines';
import FieldCustomerRegistration from '@/components/field/FieldCustomerRegistration';
import CustomerMapLinks from '@/components/customers/CustomerMapLinks';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import CustomerPicker from '@/components/field/CustomerPicker';
import ReceiptUploader from '@/components/field/ReceiptUploader';
import StatusPill from '@/components/field/StatusPill';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { invokeFieldOps, newIdempotencyKey, errorMessage, SALE_STATUS } from '@/lib/field-ops';
import { availableCustody, readAll, roundMoney, roundQuantity, saleIsLocked, saleTotals, validateSale } from '@/lib/field-pos';
import { isFinishedProduct } from '@/lib/product-images';
import { formatXAF } from '@/lib/formatters';
import { useToast } from '@/components/ui/use-toast';
import { validateSaleReplacements,validateReplacementDeclaration } from '@/lib/sale-replacements';
import SaleReplacements from '@/components/field/SaleReplacements';
import MobileInfo from '@/components/shared/MobileInfo';
import { businessDate } from '@/lib/business-date';

const blank = () => ({ customer_id: '', location_id: '', transaction_date: businessDate(),
  dispatch_id: '', payment_type: '', amount_collected: '', payment_terms_days: '', notes: '', receipt_reference: '', receipt_file_uris: [], lines: [], stock_replacements: [], replacements_declared:null });

export default function FieldSaleForm({ embedded = false, commercialId: selectedCommercialId = '', commercialName = '', saleId, initialCustomerId = '', initialProductId = '', initialQuantity = '', initialPaymentType = '', onDone, onCancel }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const routeParams = useParams();
  const id = embedded ? saleId : routeParams.id;
  const [searchParams] = useSearchParams();
  const customerParam = embedded ? initialCustomerId : searchParams.get('customer');
  const navigate = useNavigate();
  const { toast } = useToast();
  const { employee, isAdmin, role, loading: authLoading } = useCurrentUser();
  const commercialId = isAdmin ? (embedded ? selectedCommercialId : searchParams.get('commercial')) || (employee?.role === 'commercial' ? employee.id : '') : employee?.id || '';
  const returnPath = '/commercial?section=pos' + (isAdmin && commercialId ? '&employee=' + encodeURIComponent(commercialId) : '');
  const [form, setForm] = useState(blank);
  const [savedProducts, setSavedProducts] = useState([]);
  const [runProducts, setRunProducts] = useState([]), [runBalances, setRunBalances] = useState([]);
  const [runs, setRuns] = useState([]), [runLoading, setRunLoading] = useState(false), [runError, setRunError] = useState('');
  const [customers, setCustomers] = useState([]);
  const [outlets, setOutlets] = useState([]);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [registrationBusy, setRegistrationBusy] = useState(false);
  const [sale, setSale] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [outletError, setOutletError] = useState('');
  const [outletRetry, setOutletRetry] = useState(0);
  const [saveError, setSaveError] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [reload, setReload] = useState(0);
  const [runReload, setRunReload] = useState(0);
  const [step, setStep] = useState('customer');
  const [pickerOpen,setPickerOpen]=useState(false), [outletLoading,setOutletLoading]=useState(false);
  const [sourcePickerOpen,setSourcePickerOpen]=useState(false);
  const saving = useRef(false);
  const dirty = useRef(false);
  const requestKey = useRef(newIdempotencyKey());
  const checkoutRef = useRef(null);
  const locked = saleIsLocked(sale);
  const wizard=!locked;
  const disabled = locked || busy;
  const canSell = role === 'commercial' && Boolean(employee?.id) && (!employee.status || employee.status === 'active');

  useEffect(() => {
    if (authLoading || !canSell) { setLoading(false); return; }
    let active = true;
    async function load() {
      setLoading(true); setLoadError('');
      try {
        if (!commercialId) { if (active) { setSavedProducts([]); setCustomers([]); } return; }
        const [cust, existing, savedLines] = await Promise.all([
          readAll(erp.entities.Customer, { is_active: true }, 'business_name'),
          id ? erp.entities.FieldSale.get(id) : Promise.resolve(null),
          id ? readAll(erp.entities.FieldSaleLine, { field_sale_id: id }, 'created_date') : Promise.resolve([]),
        ]);
        const ids = [...new Set(savedLines.map((line) => line.product_id))];
        const products = ids.length ? await readAll(erp.entities.Product, { id: { $in: ids } }) : [];
        if (!active) return;
        setSavedProducts(products); setCustomers(cust); setSale(existing); setSaveError(''); dirty.current = false;
        requestKey.current = newIdempotencyKey();
        setForm(existing ? {
          ...blank(), customer_id: existing.customer_id || '', location_id: existing.location_id || '', dispatch_id: existing.dispatch_id || '',
          transaction_date: existing.transaction_date || blank().transaction_date, payment_type: existing.payment_type || '',
          amount_collected: existing.amount_collected == null ? '' : String(existing.amount_collected),
          payment_terms_days: existing.payment_terms_days == null ? '' : String(existing.payment_terms_days), notes: existing.notes || '',
          receipt_reference: existing.receipt_reference || '', receipt_file_uris: existing.receipt_file_uris || [],
          stock_replacements: existing.stock_replacements || [],
      replacements_declared:existing.stock_replacements_declared??Boolean(existing.stock_replacements?.length),
          lines: savedLines.map((line) => ({ product_id: line.product_id, product_name: line.product_name, quantity: line.quantity, unit_price: line.unit_price, tax_rate: line.tax_rate })),
        } : { ...blank(), payment_type: ['cash', 'credit'].includes(initialPaymentType) ? initialPaymentType : '', customer_id: cust.some((c) => c.id === customerParam) ? customerParam : '' });
        setStep(saleIsLocked(existing) ? 'checkout' : 'customer');
      } catch (error) { if (active) setLoadError(errorMessage(error)); }
      finally { if (active) setLoading(false); }
    }
    load();
    return () => { active = false; };
  }, [authLoading, commercialId, id, reload, customerParam, initialPaymentType]);

  useEffect(() => {
    let active = true;
    setOutlets([]); setOutletError('');setOutletLoading(Boolean(form.customer_id));
    if (form.customer_id) readAll(erp.entities.CustomerLocation, { customer_id: form.customer_id }).then((locations) => {
      if (active) {const points=locations.filter(location=>location.is_active!==false);setOutlets(points);if(points.length===1&&points[0].customer_reporting_point)setForm(previous=>({...previous,location_id:previous.location_id||points[0].id}));}
    }).catch(() => { if (active) setOutletError(ui("Outlets could not be loaded. Choose the customer again to retry.")); }).finally(()=>{if(active)setOutletLoading(false);});
    return () => { active = false; };
  }, [form.customer_id, outletRetry]);

  useEffect(() => {
    if (authLoading || loading || !commercialId || locked) return;
    let active = true, pending = false;
    setRuns([]); setRunProducts([]); setRunBalances([]);
    const refresh = async () => {
      if (pending || !active) return;
      pending = true; setRunLoading(true); setRunError('');
      try {
        const res = await invokeFieldOps({ action: 'commercialDailySupplies', commercialId, date: form.transaction_date });
        if (res.data.error) throw new Error(res.data.error);
        if (!active) return;
        const assigned = res.data.runs || [];
        const saleableRuns = assigned.filter((run) => run.can_supply === true);
        setRuns(assigned); setRunProducts(res.data.runProducts || []); setRunBalances(res.data.runBalances || []);
        setForm(previous => ({ ...previous, dispatch_id: assigned.some(run => run.id === previous.dispatch_id) ? previous.dispatch_id : saleableRuns.length === 1 ? saleableRuns[0].id : '' }));
      } catch (reason) { if (active) setRunError(errorMessage(reason)); }
      finally { pending = false; if (active) setRunLoading(false); }
    };
    const onFocus = () => { if (!document.hidden) refresh(); };
    refresh();
    const timer = window.setInterval(onFocus, 30000);
    window.addEventListener('focus', onFocus); document.addEventListener('visibilitychange', onFocus);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus); };
  }, [authLoading, loading, commercialId, form.transaction_date, locked, runReload]);

  useEffect(() => {
    const warn = (event) => { if (dirty.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  const set = (patch) => { if (disabled) return; dirty.current = true; setSaveError(''); setForm((previous) => ({ ...previous, ...patch })); };
  const selectedRun = runs.find((run) => run.id === form.dispatch_id);
  const trackedOutlet = outlets.some(location => location.assigned_hotesse_ids?.length);
  const stock = useMemo(() => {
    const products = new Map(savedProducts.map((product) => [product.id, product]));
    runProducts.forEach((product) => products.set(product.id, product));
    const balances = runBalances.filter((balance) => balance.dispatch_id === form.dispatch_id);
    return [...products.values()].map((product) => ({ ...product, product_id: product.id, product_name: product.name, quantity: availableCustody(balances, product.id, form.transaction_date) }));
  }, [savedProducts, runProducts, runBalances, form.dispatch_id, form.transaction_date]);
  const calculated = saleTotals(form.lines, stock);
  const totals = locked && sale ? { subtotal: sale.subtotal || 0, tax: sale.tax_total || 0, total: sale.total || 0 } : calculated;
  const collected = form.payment_type === 'cash' ? roundMoney(form.amount_collected) : 0;
  const due = locked && sale ? roundMoney(sale.amount_due) : roundMoney(totals.total - collected);
  const availableProducts = stock.filter((p) => p.is_active !== false && isFinishedProduct(p) && p.quantity > 0);
  const validation = validateSale(form, stock, { isAdmin }) || validateSaleReplacements(form, stock);
  const goTo = next => {setStep(next);setSaveError('');if(typeof window!=='undefined')window.scrollTo?.({top:0,behavior:'smooth'});};
  const customerProblem = () => !form.customer_id||!customers.some(c=>c.id===form.customer_id) ? ui('Choose a customer for this sale.')
    : !form.transaction_date||form.transaction_date>businessDate()?ui('Choose a valid sale date that is not in the future.')
    : outletLoading?ui('Wait while delivery points are loaded.'):outletError?outletError
    : trackedOutlet&&!outlets.some(o=>o.id===form.location_id)?ui('Choose supplied point of sale')
    : '';
  const stockProblem = () => runLoading?ui('Wait while delivery stock is refreshed.'):runError?runError
    : !selectedRun||selectedRun.can_supply!==true?ui('Choose a loaded delivery run paired with your driver before recording this supply.') : '';
  const nextProducts = () => {const problem=customerProblem();if(problem){setSaveError(problem);return;}goTo('products');};
  const review = () => {
    if(wizard){const problem=customerProblem()||stockProblem()||validateSale({...form,payment_type:'',amount_collected:''},stock,{isAdmin})||validateReplacementDeclaration(form.replacements_declared,form.stock_replacements)||validateSaleReplacements(form,stock);if(problem){setSaveError(problem);return;}goTo('checkout');}
    else {setStep('checkout');requestAnimationFrame(() => checkoutRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));}
  };
  const setProductQuantity = (item,value) => {
    if(disabled||runLoading||runError)return;
    const product=availableProducts.find(row=>row.id===item.id);if(!product)return;
    dirty.current=true;setSaveError('');
    setForm(previous=>{
      const line=previous.lines.find(row=>row.product_id===product.id);
      if(value===null)return {...previous,lines:previous.lines.filter(row=>row.product_id!==product.id)};
      if(!line&&(!(Number(product.selling_price)>0)||previous.lines.length>=50))return previous;
      return {...previous,lines:line?previous.lines.map(row=>row.product_id===product.id?{...row,quantity:value}:row):[...previous.lines,{product_id:product.id,product_name:product.name,quantity:value,unit_price:product.selling_price}]};
    });
  };
  const initialProductAdded = useRef(false);
  useEffect(() => {
    if (initialProductAdded.current || !initialProductId || id || loading || runLoading || !canSell) return;
    const product = availableProducts.find(item => item.id === initialProductId);
    if (!product || !(Number(product.selling_price) > 0)) return;
    initialProductAdded.current = true;
    setProductQuantity(product,initialQuantity);
  }, [initialProductId, initialQuantity, id, loading, runLoading, canSell, stock]);
  const back = () => { if (!busy && (!dirty.current || window.confirm(ui("Leave this sale? Unsaved changes will be lost.")))) { if (embedded) onCancel?.(); else navigate(returnPath); } };

  const save = async (submit) => {
    if (saving.current || disabled || uploading || !canSell) return;
    const runProblem = submit && (runLoading ? ui("Wait while delivery stock is refreshed.") : runError ? ui("Delivery stock could not be refreshed. Try again before recording this supply.") : !selectedRun || selectedRun.can_supply !== true ? ui("Choose a loaded delivery run paired with your driver before recording this supply.") : '');
    const problem = runProblem || validateSale(form, stock, { isAdmin, submit }) || (submit&&validateReplacementDeclaration(form.replacements_declared,form.stock_replacements)) || validateSaleReplacements(form, stock);
    if (submit && trackedOutlet && !form.location_id) { setSaveError(sourceMessage("Choose the exact supplied point of sale so its Hotesse receives the batch details.")); setStep(wizard?'customer':'checkout'); return; }
    if (problem) { setSaveError(problem); setStep('checkout'); return; }
    saving.current = true; setBusy(true); setSaveError('');
    try {
      const res = await invokeFieldOps({ action: 'saveSale', saleId: id || undefined,
        commercialId,
        dispatchId: form.dispatch_id || undefined,
        customerId: form.customer_id, locationId: form.location_id || undefined, transactionDate: form.transaction_date,
        paymentType: form.payment_type, amountCollected: form.amount_collected, collectionDate: form.transaction_date,
        paymentTermsDays: form.payment_terms_days, notes: form.notes, receiptReference: form.receipt_reference.trim(),
        receiptFileUris: form.receipt_file_uris,
        stockReplacements: form.stock_replacements,
        replacementsDeclared:form.replacements_declared,
        lines: form.lines.map((line) => ({ product_id: line.product_id, quantity: roundQuantity(line.quantity), unit_price: roundMoney(line.unit_price) })),
        submit, idempotencyKey: requestKey.current,
      });
      if (res.data.error) throw new Error(res.data.error);
      dirty.current = false;
      toast({ title: submit ? `${res.data.sale.sale_number} recorded` : ui("{0} saved as a draft", res.data.sale.sale_number),
        description: submit ? ui("Posted to company Sales. Customer balance and vehicle stock have been updated.") : ui("Stock and sales are unchanged until you record this supply.") });
      if (embedded) onDone?.({ sale: res.data.sale, submitted: submit });
      else navigate(returnPath);
    } catch (error) {
      setSaveError(sourceMessage("{0} If the connection was interrupted, check My sales before trying again.", errorMessage(error)));
    } finally { saving.current = false; setBusy(false); }
  };

  if (authLoading || loading) return <div role="status" className="flex items-center justify-center gap-3 py-24 text-sm text-slate-500"><Loader2 className="h-5 w-5 animate-spin" />{ui("Loading your products…")}</div>;
  if (loadError) return <div className="mx-auto max-w-lg rounded-2xl border bg-white p-8 text-center"><h2 className="font-semibold">{ui("Your sales workspace could not be loaded")}</h2><p role="alert" className="my-4 text-sm text-red-600">{uiMessage(loadError)}</p><Button onClick={() => setReload((n) => n + 1)}><RefreshCw size={16} className="mr-2" />{ui("Try again")}</Button></div>;
  if (!canSell) return <div className="mx-auto max-w-lg rounded-2xl border bg-white p-8"><h2 className="font-semibold">{isAdmin ? ui("Employee sales entry is read-only for management") : ui("Field POS needs a linked sales employee")}</h2><p className="mt-2 text-sm text-slate-600">{isAdmin ? ui("The Commercial employee must record sales from their own account. Open Commercial reports to review their activity.") : ui("Ask an administrator to link your login to an active Commercial employee before recording field sales.")}</p><Button className="mt-4" variant="outline" onClick={() => navigate('/commercial')}>{ui("Open Commercial workspace")}</Button></div>;

  return <div className="mx-auto w-full min-w-0 max-w-3xl pb-8">
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <div data-page-heading className="flex min-w-0 items-start gap-2"><PageBackButton onClick={back} disabled={busy} label={ui('My field sales')}/><div className="flex min-w-0 flex-wrap items-center gap-2 self-center"><h1 className="break-words text-2xl font-bold tracking-tight text-slate-900">{sale ? sale.sale_number : ui("Record sale / supply")}</h1><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-800">{ui("Field POS")}</span>{sale && <StatusPill map={SALE_STATUS} value={sale.status} />}</div></div>
        <MobileInfo title={ui("Record sale")} desktopClassName="mt-2 text-sm text-slate-500"><p>{ui("Enter exactly what was delivered, declare cash or credit and photograph the supply receipt.")}</p></MobileInfo>
      </div>
      <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs text-slate-600"><span className="h-2 w-2 rounded-full bg-emerald-500" />{commercialName || sale?.commercial_name || employee?.full_name || ui("Selected Commercial agent")}</div>
    </div>
    <Dialog open={registerOpen} onOpenChange={(open) => { if (!registrationBusy) setRegisterOpen(open); }}><DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto" onPointerDownOutside={(e) => e.preventDefault()}><DialogHeader><DialogTitle>{ui("Register a field customer")}</DialogTitle></DialogHeader>
      {registerOpen && <FieldCustomerRegistration commercialId={commercialId} onBusyChange={setRegistrationBusy} onCancel={() => setRegisterOpen(false)} onSaved={(customer) => {
        setCustomers((rows) => [customer, ...rows.filter((c) => c.id !== customer.id)]);
        set({ customer_id: customer.id, location_id: '',stock_replacements:[],replacements_declared:null }); setRegisterOpen(false);
        toast({ title: 'Customer registered', description: 'This customer and delivery location are now traced to your employee account.' });
      }} />}
    </DialogContent></Dialog>
    {sale?.duplicate_flag && <p className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800">{ui("Possible duplicate: ")}{sale.duplicate_note}</p>}
    {sale?.decision_reason && <p className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800">{ui("Review note: ")}{sale.decision_reason}</p>}
    {locked && <p className="mb-4 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">{ui("This supply has been recorded and is read-only. Contact an administrator for corrections so stock, cash and customer balances stay consistent.")}</p>}
    {wizard&&<div className="mb-5"><p className="mb-3 text-xs font-semibold uppercase tracking-wide text-green-700">{ui('Step {0} of 3',['customer','products','checkout'].indexOf(step)+1)}</p><nav aria-label={ui('Sale steps')} className="grid grid-cols-3 gap-2">{[['customer','Customer'],['products','Products'],['checkout','Review']].map(([key,label],index)=><button type="button" key={key} disabled={busy||index>['customer','products','checkout'].indexOf(step)} aria-current={step===key?'step':undefined} onClick={()=>goTo(key)} className={'min-h-12 rounded-xl border px-2 text-sm font-semibold '+(step===key?'border-green-700 bg-green-700 text-white':'bg-white text-slate-600')}>{index+1}. {ui(label)}</button>)}</nav></div>}
    {wizard&&saveError&&<p role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{uiMessage(saveError)}</p>}
    <div className="grid min-w-0 items-start gap-6">
      <section aria-label={ui("Available products")} className={`min-w-0 ${!wizard || step === 'products' ? '' : 'hidden'}`}>
          <div className="space-y-2 rounded-xl border border-slate-100 bg-slate-50/50 p-3">
            <Label className="text-xs">{ui("Paired driver & delivery run *")}</Label>
            {locked ? <p className="text-sm">{[sale?.driver_name, sale?.vehicle_name, sale?.dispatch_number].filter(Boolean).join(' / ') || ui("No driver pairing recorded on this historical sale")}</p> : <>
              <SaleStockPicker open={sourcePickerOpen} onOpenChange={setSourcePickerOpen} value={form.dispatch_id} options={runs.filter(run=>run.can_supply===true).map(run=>({id:run.id,kind:'vehicle',label:vehicleSaleLabel(run)}))} disabled={disabled||runLoading} onChange={value=>{
                if(value===form.dispatch_id)return;
                if(!form.lines.length||window.confirm(ui('Change delivery run? Products in this unsaved supply will be cleared.')))set({dispatch_id:value,lines:[],stock_replacements:[]});
              }}/>
              {selectedRun && <p className="text-xs font-medium text-slate-900">{selectedRun.stock_warehouse_name || ui("Delivery stock")} / {selectedRun.status?.replaceAll('_', ' ')}</p>}
              {selectedRun?.stock_error && <p role="alert" className="text-xs text-slate-800">{selectedRun.stock_error}</p>}
              {runError && <p role="alert" className="text-xs text-red-700">{runError} <button type="button" className="underline" onClick={() => setRunReload((value) => value + 1)}>{ui("Try again")}</button></p>}
              {!runLoading && !runs.some((run) => run.can_supply === true) && <p className="text-xs leading-5 text-slate-800">{ui("The warehouse must load finished products onto a run paired with you and a driver before supplies can be recorded.")}</p>}
            </>}
            <MobileInfo title={ui("Delivery stock")} desktopClassName="text-[11px] leading-5 text-slate-500"><p>{ui("Sales automatically deduct from the current stock on your paired vehicle. Only approved, unexpired finished products are available. Quantities refresh while this page is open and are checked again when you record the supply.")}</p></MobileInfo>
          </div>
        <div className="mb-4 flex items-center justify-between gap-2"><div><h2 className="font-semibold text-slate-900">{ui("Your products")}</h2><p className="mt-1 text-xs text-slate-500">{ui("Approved, unexpired finished products on your selected driver run")}</p></div></div>
        <Button type="button" className="min-h-12 w-full" disabled={disabled||runLoading||Boolean(runError)||!availableProducts.length} onClick={()=>setPickerOpen(true)}>{ui('Choose products')}</Button>
        {!availableProducts.length&&<p className="mt-3 text-sm text-slate-500">{ui('Choose a loaded driver run to see its finished products. The warehouse loads stock before departure.')}</p>}
        {wizard&&step==='products'&&<div className="mt-5 space-y-4 rounded-2xl border bg-white p-4"><FieldSaleLines lines={form.lines} stock={stock} disabled={disabled} isAdmin={isAdmin} onChange={lines=>set({lines})}/><SaleReplacements declared={form.replacements_declared} onDeclare={value=>set({replacements_declared:value})} rows={form.stock_replacements} stock={stock} lines={form.lines} date={form.transaction_date} disabled={disabled} onChange={rows=>set({stock_replacements:rows})}/><p className="flex justify-between font-semibold"><span>{ui('Total')}</span>{formatXAF(totals.total)}</p></div>}

      </section>
      <section ref={checkoutRef} aria-label={ui("Sale checkout")} className={`min-w-0 scroll-mt-6 rounded-2xl border border-slate-200 bg-white shadow-sm ${!wizard || step !== 'products' ? '' : 'hidden'}`}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><h2 className="flex items-center gap-2 font-semibold"><ShoppingBag size={18} />{ui("Current sale")}</h2><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">{form.lines.length}{ui(" products")}</span></div>
        <div className="space-y-5 p-4 sm:p-5">
          {(!wizard||step==='customer')&&<>
          <CustomerPicker customers={customers} value={form.customer_id} fallbackName={sale?.customer_name} disabled={disabled} onChange={(value) => { set({ customer_id: value, location_id: '',...(value!==form.customer_id?{stock_replacements:[],replacements_declared:null}:{}) }); if (value === form.customer_id && outletError) setOutletRetry((n) => n + 1); }} />
          <Button type="button" variant="outline" className="w-full" disabled={disabled} onClick={() => setRegisterOpen(true)}>{ui("+ Register a new customer")}</Button>
          {!locked && <p className="-mt-3 text-[11px] leading-5 text-slate-500">{ui("Customers you register remain linked to you for follow-up and acquisition goals.")}</p>}
          {form.customer_id && <CustomerMapLinks customer={outlets.find((o) => o.id === form.location_id) || customers.find((c) => c.id === form.customer_id)} />}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><div><Label htmlFor="pos-outlet" className="text-xs text-slate-500">{ui("Outlet")}</Label><select id="pos-outlet" value={form.location_id} disabled={disabled || !form.customer_id || Boolean(outletError)} onChange={(e) => set({ location_id: e.target.value })} className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"><option value="">{trackedOutlet ? ui("Choose supplied point of sale") : ui("Head office")}</option>{outlets.map((outlet) => <option value={outlet.id} key={outlet.id}>{outlet.name}</option>)}</select></div>
            <div><Label htmlFor="pos-date" className="text-xs text-slate-500">{ui("Delivery date")}</Label><Input id="pos-date" className="mt-1 min-w-0" type="date" max={businessDate()} value={form.transaction_date} disabled={disabled} onChange={(e) => { if (e.target.value !== form.transaction_date && (!form.lines.length || window.confirm('Change delivery date? Products in this unsaved supply will be cleared.'))) set({ transaction_date: e.target.value, dispatch_id: '', lines: [], stock_replacements: [] }); }} /></div></div>
          {outletError && <p role="alert" className="text-xs text-red-600">{outletError}</p>}
          </>}
          {(!wizard||step==='checkout')&&<>
          {wizard&&<div className="rounded-xl bg-green-50 p-3"><p className="font-semibold">{customers.find(c=>c.id===form.customer_id)?.business_name}</p><p className="mt-1 text-xs text-slate-600">{[outlets.find(o=>o.id===form.location_id)?.name,form.transaction_date,employee?.full_name].filter(Boolean).join(' / ')}</p><Button type="button" variant="ghost" disabled={busy} onClick={()=>goTo('customer')}>{ui('Edit customer')}</Button></div>}
          <FieldSaleLines lines={form.lines} stock={stock} disabled={disabled} isAdmin={isAdmin} onChange={(lines) => set({ lines })} />
          <SaleReplacements declared={form.replacements_declared} onDeclare={value=>set({replacements_declared:value})} key={sale?.id || "new"} rows={form.stock_replacements} stock={stock} lines={form.lines} date={form.transaction_date} disabled={disabled} onChange={rows => set({ stock_replacements: rows })} />
          <div className="space-y-2 border-t border-slate-100 pt-4 text-sm">{!locked&&<p className="text-xs text-slate-500">{ui('Selling prices already include VAT. The total will not have VAT added on top.')}</p>}<div className="flex justify-between text-slate-500"><span>{ui("Subtotal")}</span><span>{formatXAF(totals.subtotal)}</span></div>{totals.tax !== 0 && <div className="flex justify-between text-slate-500"><span>{ui(!locked||sale?.price_includes_vat?"VAT included":"Tax")}</span><span>{formatXAF(totals.tax)}</span></div>}<div className="flex items-center justify-between text-lg font-bold text-slate-900"><span>{ui("Total")}</span><span aria-live="polite">{formatXAF(totals.total)}</span></div></div>
          <div><h3 className="mb-2 text-sm font-semibold">{ui("Did the customer pay cash or receive credit? *")}</h3><div className="grid grid-cols-2 gap-2">
            {[{ value: 'cash', label: ui("Cash collected"), Icon: Banknote }, { value: 'credit', label: ui("On credit"), Icon: CreditCard }].map(({ value, label, Icon }) => <button type="button" key={value} disabled={disabled} aria-pressed={form.payment_type === value} onClick={() => set({ payment_type: value, amount_collected: '', payment_terms_days: '' })} className={`flex h-12 items-center justify-center gap-2 rounded-xl border text-sm font-semibold ${form.payment_type === value ? 'border-primary bg-primary/10 text-primary' : 'border-slate-200 text-slate-500'}`}><Icon size={18} />{label}{form.payment_type === value && <Check size={14} />}</button>)}
          </div></div>
          {form.payment_type === 'cash' && <div><div className="mb-1 flex items-center justify-between"><Label htmlFor="pos-cash" className="text-xs">{ui("Exact cash collected (XAF) *")}</Label><button type="button" disabled={disabled} onClick={() => set({ amount_collected: String(totals.total) })} className="min-h-8 text-xs font-semibold text-slate-700">{ui("Full amount")}</button></div><Input id="pos-cash" type="number" min="0.01" max={totals.total} step="0.01" inputMode="decimal" disabled={disabled} value={form.amount_collected} placeholder={ui("Enter cash received")} onChange={(e) => set({ amount_collected: e.target.value })} /><p className="mt-1 text-[11px] leading-5 text-slate-500">{ui("Enter the amount actually received. Any unpaid balance stays on the customer's account. If no cash was collected, choose On credit.")}</p></div>}
          {form.payment_type === 'credit' && <div><Label htmlFor="pos-terms" className="text-xs">{ui("Payment terms (days)")}</Label><Input id="pos-terms" type="number" min="0" step="1" inputMode="numeric" disabled={disabled} value={form.payment_terms_days} onChange={(e) => set({ payment_terms_days: e.target.value })} placeholder={ui("Customer's agreed terms")} /><p className="mt-1 text-[11px] text-slate-500">{ui("No cash collected. The full supply total is recorded as customer credit.")}</p></div>}
          {form.payment_type && due !== 0 && <div className={`flex justify-between rounded-lg p-3 text-sm ${due > 0 ? 'bg-slate-50 text-slate-800' : 'bg-red-50 text-red-700'}`}><span>{ui("Customer balance due")}</span><strong>{formatXAF(due)}</strong></div>}
          <details className="rounded-xl border border-slate-200 p-3" open><summary className="min-h-8 cursor-pointer text-sm font-semibold">{ui("Receipt & notes ")}{form.receipt_file_uris.length > 0 && `(${form.receipt_file_uris.length} attached)`}</summary><div className="mt-3 space-y-4"><ReceiptUploader fileUris={form.receipt_file_uris} onChange={(uris) => set({ receipt_file_uris: uris })} reference={form.receipt_reference} onReferenceChange={(value) => set({ receipt_reference: value })} disabled={disabled} onBusyChange={setUploading} /><div><Label htmlFor="pos-notes" className="text-xs">{ui("Notes")}</Label><Textarea id="pos-notes" rows={2} disabled={disabled} value={form.notes} onChange={(e) => set({ notes: e.target.value })} placeholder={ui("Delivery instructions or comments")} /></div></div></details>
          {!locked && <><MobileInfo title={ui("Recording this sale")} desktopClassName="text-xs leading-relaxed text-slate-500"><p>{ui("Recording this supply posts the sale and reduces your delivery stock immediately. Exact quantities, a cash or credit declaration and a receipt photo are required.")}</p></MobileInfo>
            {(saveError || (form.lines.length > 0 && validation)) && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{uiMessage(saveError || validation)}</p>}
            <div className="grid grid-cols-1 gap-2"><Button variant="outline" className="h-12" disabled={busy || uploading || Boolean(validation)} onClick={() => save(false)}>{ui("Save draft")}</Button><Button className="order-first h-12 w-full bg-primary font-semibold text-primary-foreground hover:bg-primary/90" disabled={busy || uploading || runLoading || Boolean(validation)} onClick={() => save(true)}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}{uploading ? ui("Uploading…") : busy ? ui("Saving…") : ui("Record supply")}{!busy && !uploading && <ArrowRight size={16} className="ml-2" />}</Button></div></>}
          </>}
        </div>
      </section>
    </div>
    {wizard&&<div className="mt-5 flex gap-3">{step!=='customer'&&<Button type="button" variant="outline" className="min-h-12 flex-1" disabled={busy} onClick={()=>goTo(step==='checkout'?'products':'customer')}><ArrowLeft size={16} className="mr-2"/>{ui('Back')}</Button>}{step!=='checkout'&&<Button type="button" className="min-h-12 flex-1" disabled={busy||runLoading||outletLoading} onClick={step==='customer'?nextProducts:review}>{ui(step==='customer'?'Continue to products':'Review sale')}<ArrowRight size={16} className="ml-2"/></Button>}</div>}
    <SaleProductPicker open={pickerOpen} onOpenChange={setPickerOpen} products={availableProducts.map(p=>({...p,available:p.quantity,unit:p.unit_of_measure||p.storage_unit}))} lines={form.lines} onQuantityChange={setProductQuantity} disabled={disabled||runLoading||Boolean(runError)}/>

  </div>;
}
