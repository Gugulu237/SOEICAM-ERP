import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useEffect, useState } from 'react';
import {useNavigate} from '@/lib/router';
import { ShoppingBag, Users, Wallet, BarChart3, Package, ClipboardList, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ProductCatalog from '@/components/shared/ProductCatalog';
import CommercialDailySupplies from '@/components/field/CommercialDailySupplies';
import CommercialGoalProgress from '@/components/field/CommercialGoalProgress';
import CommercialReturns from '@/components/field/CommercialReturns';
import CommercialCashSettlement from '@/components/field/CommercialCashSettlement';
import { commercialSnapshot } from '@/lib/employee-dashboard';
import { formatXAF } from '@/lib/formatters';
import FieldSaleForm from '@/views/FieldSaleForm';
import FieldInventoryCards from '@/components/field/FieldInventoryCards';
import CommercialQuickActions from '@/components/field/CommercialQuickActions';
import MobileInfo from '@/components/shared/MobileInfo';
import CommercialActivityReport from './CommercialActivityReport';

const tabs = [['sales', 'Sales', ShoppingBag], ['returns', 'Exchanges', RotateCcw], ['customers', 'Customers', Users], ['stock', 'My stock', Package], ['cash', 'Cash', Wallet], ['performance', 'Performance & rewards', BarChart3]];
const tabKey = value => value === 'requests' ? 'stock' : value === 'supplies' ? 'sales' : value;

export default function CommercialDashboard({ data, actorEmployee, preview = false, loading = false, managing = false, showReadOnlyNotice = true, hideMobileHero = false, section = 'workspace', activeTab, onTabChange, openFromLink = false, initialCustomerId = '', onClearEntry, onRefresh, onEntryChange }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;
  const [localTab, setLocalTab] = useState('sales');
  const requested = section === 'performance' ? 'performance' : tabKey(activeTab);
  const tab = tabs.some(([key]) => key === requested) ? requested : localTab;
  const navigate=useNavigate(),canCustomers=!data?.allowedModules||data.allowedModules.includes('customers');
  const setTab = value => value==='customers'&&canCustomers?navigate('/customers'):onTabChange ? onTabChange(value) : setLocalTab(value);
  const [entry, setEntry] = useState(null), [recorded, setRecorded] = useState(null), [history, setHistory] = useState(false);
  const [quickActive, setQuickActive] = useState(false);
  useEffect(() => { onEntryChange?.((!!entry || quickActive) && !managing); }, [entry, quickActive, managing, onEntryChange]);
  const summary = commercialSnapshot(data);
  const ready = !!data?.employee && (!data.employee.status || data.employee.status === 'active') && !loading;
  // Entry loads its own customers and delivery stock. A slow dashboard report
  // must not prevent an authenticated active Commercial from opening the form.
  const salesEmployee = actorEmployee || data?.employee;
  const canRecordSale = !preview && !managing && !!salesEmployee?.id && (!salesEmployee.status || salesEmployee.status === 'active');
  useEffect(() => { if (section === 'pos' && openFromLink && canRecordSale) setEntry({ customerId: initialCustomerId }); }, [section, openFromLink, initialCustomerId, canRecordSale]);
  const openSale = (options = {}) => { if (canRecordSale) setEntry(options); };
  // A management bookmark must never mount employee entry components.
  if (managing) return <CommercialActivityReport showReadOnlyNotice={showReadOnlyNotice} hideMobileHero={hideMobileHero} data={data} loading={loading} activeTab={activeTab} onTabChange={onTabChange}/>;
  if (entry && canRecordSale) return <section className="rounded-2xl border bg-white p-4 sm:p-5"><FieldSaleForm embedded commercialId={salesEmployee.id} commercialName={salesEmployee.full_name} saleId={entry.saleId} initialCustomerId={entry.customerId || ''} initialProductId={entry.productId || ''} initialPaymentType={entry.paymentType || ''} onCancel={() => { setEntry(null); onClearEntry?.(); }} onDone={result => { setEntry(null); onClearEntry?.(); setTab('sales'); setRecorded(result); onRefresh?.(); }} /></section>;
  const runs = (data?.runs || []).filter(run => run.can_supply);
  return <div className="space-y-4 pb-20 sm:pb-0">
    {canRecordSale && <CommercialQuickActions commercialId={salesEmployee.id} onSale={openSale} onActiveChange={setQuickActive} onCustomerSaved={() => onRefresh?.()} />}
    <nav aria-label={ui("Commercial tasks")} className="flex gap-1 overflow-x-auto rounded-xl border bg-white p-1.5">{tabs.filter(([key])=>key!=='customers'||canCustomers).map(([key, label, Icon]) => <Button key={key} type="button" aria-pressed={tab === key} variant={tab === key ? 'default' : 'ghost'} className="min-h-11 shrink-0" onClick={() => setTab(key)}><Icon size={16} className="mr-2" />{ui(label)}</Button>)}</nav>
    {recorded && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{recorded.sale.sale_number}: {recorded.submitted ? ui("Posted to company Sales. Vehicle stock and customer balance are updated.") : ui("Draft saved. Stock has not moved.")}</p>}
    {tab === 'sales' && <section className="space-y-4 rounded-2xl border bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold sm:text-xl">{ui("Record sale")}</h2><MobileInfo title={ui("Record sale")} desktopClassName="mt-1 text-sm text-slate-500"><p>{ui("Tap a product, enter quantities, then collect cash or record credit.")}</p></MobileInfo></div><div className="flex gap-2"><Button variant="outline" aria-pressed={history} onClick={() => setHistory(value => !value)}><ClipboardList size={16} className="mr-2" />{history ? ui("Products") : ui("Sales history")}</Button><Button disabled={!canRecordSale} onClick={() => openSale()}><ShoppingBag size={17} className="mr-2" />{ui("Record sale")}</Button></div></div>
      {!history && <>{runs.map(run => <p key={run.id} className="text-xs text-slate-500">{run.vehicle_name} / {run.driver_name} / {run.dispatch_number}</p>)}{(data?.runs || []).filter(run => run.stock_error).map(run => <p role="alert" key={run.id} className="rounded-lg bg-slate-50 p-3 text-sm text-slate-900">{run.dispatch_number}: {run.stock_error}</p>)}<ProductCatalog products={summary.stock} selecting hidePrice={false} disabled={preview || !ready} onSelect={product => openSale({ productId: product.id })} renderDetails={product => <p className="text-sm font-semibold">{formatXAF(product.selling_price)} / {product.unit_of_measure || product.storage_unit || ui("unit")}</p>} emptyMessage={ready ? ui("No finished products available. Ask Distribution to load your vehicle.") : ui("Loading vehicle stock...")} /></>}
      {history && <CommercialDailySupplies employeeId={data?.employee?.id} today={data?.date} preview={preview} onOpenSale={saleId => openSale({ saleId })} />}
    </section>}
    {tab === 'returns' && <div className="rounded-2xl border bg-white p-4 sm:p-5"><CommercialReturns employeeId={data?.employee?.id} preview={preview} onChanged={onRefresh} /></div>}
    {tab === 'customers' && canCustomers && <Button variant="outline" onClick={()=>navigate('/customers')}>{ui('Open Customers')}</Button>}
    {tab === 'stock' && <section className="rounded-2xl border bg-white p-4 sm:p-5"><h1 className="mb-4 text-xl font-semibold">{ui("Goods in my possession")}</h1><FieldInventoryCards employeeId={data?.employee?.id} enabled={ready && !preview} /></section>}
    {tab === 'cash' && <CommercialCashSettlement days={data?.cashDays || []} ready={ready} commercialId={data?.employee?.id} commercialName={data?.employee?.full_name} preview={preview} onRefresh={onRefresh}/>}
    {tab === 'performance' && <section className="space-y-4"><h1 className="text-xl font-semibold">{ui("My performance & estimated rewards")}</h1><p className="text-xs text-slate-500">{data?.monthStart} / {data?.date}</p><div className="grid grid-cols-2 gap-3">{[[ui("Posted sales this month"), formatXAF(summary.month)], [ui("Verified new customers"), summary.verified], [ui("Customers registered"), summary.registered], [ui("Sales to follow up"), summary.corrections.length + summary.drafts.length + summary.waiting.length]].map(([label, value]) => <div key={label} className="rounded-xl border bg-white p-4"><p className="text-xs text-slate-500">{label}</p><p className="mt-2 text-xl font-semibold">{ready ? value : '-'}</p></div>)}</div><CommercialGoalProgress employee={data?.employee} verified={summary.verified} approvedTotal={summary.month} commission={summary.commission} /><CommercialDailySupplies employeeId={data?.employee?.id} today={data?.date} preview={preview} onOpenSale={saleId => openSale({ saleId })} /></section>}
  </div>;
}
