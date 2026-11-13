import {usePhoneLayout} from '@/hooks/usePhoneLayout';
import {useSearchParams} from '@/lib/router';
import MobileSalesRegister from './MobileSalesRegister';
import SalesReportExplorer from './SalesReportExplorer';
import {productSalesDocument} from '@/lib/sales-report-drilldown';
import {erp} from '@/api/erpClient';
import {readAll} from '@/lib/field-pos';
import ReportExport from '@/components/shared/ReportExport';
import {salesAnalysisDocument} from '@/lib/sales-report-documents';
import LearnMore from '@/components/shared/LearnMore';

/* localized-messages */
import { uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useEffect, useState } from 'react';
import { usePageState } from '@/lib/navigation-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import DataTable from '@/components/shared/DataTable';
import { invokeFieldOps, errorMessage } from '@/lib/field-ops';
import { businessDate } from '@/lib/business-date';
import { formatAccountingXAF as formatXAF, formatDate } from '@/lib/formatters';
import { useNavigate } from '@/lib/router';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { RefreshCw,ArrowLeft } from 'lucide-react';
import SalesVolumeChart from './SalesVolumeChart';

export default function CompanySalesRegister({ readOnly = false, onMenu, onPromotions }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const phone=usePhoneLayout(),[params]=useSearchParams();
  const includeDetails=phone&&params.get('detailed')!=='1';
  const [exchanges,setExchanges]=useState([]),[exchangeError,setExchangeError]=useState('');
  const [reportKind,setReportKind]=useState('summary'),[analysisOpen,setAnalysisOpen]=useState(false),[selection,setSelection]=useState(null);
  const compact=phone&&params.get('detailed')!=='1'&&!analysisOpen;
  const includeProducts=reportKind==='products'&&!compact;
  const today = businessDate(), navigate = useNavigate(), { isAdmin, role } = useCurrentUser();
  const viewOnly = readOnly || role === 'production_manager';
  const [period, setPeriod] = usePageState('company-sales:period', { from: phone?today:today.slice(0, 8) + '01', to: today });
  const [dates,setDates]=usePageState('company-sales:dates', period);
  const [data, setData] = useState(null), [loading, setLoading] = useState(false), [error, setError] = useState(''), [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true, pending = false;
    setData(null);
    const refresh = async () => {
      if (!active || pending) return;
      pending = true; setLoading(true); setError('');
      try {
        const result = await invokeFieldOps({ action: 'companySales', ...period, includeReport:true,...(includeDetails?{includeDetails:true}:{}),...(includeProducts?{includeProducts:true}:{}) });
        if (result.data.error) throw new Error(result.data.error);
        if (active) setData(result.data);
      } catch (failure) { if (active) setError(errorMessage(failure)); }
      finally { pending = false; if (active) setLoading(false); }
    };
    const onFocus = () => { if (!document.hidden) refresh(); };
    refresh();
    const timer = window.setInterval(onFocus, 30000);
    window.addEventListener('focus', onFocus); document.addEventListener('visibilitychange', onFocus);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus); };
  }, [period, reload, includeDetails, includeProducts]);
  useEffect(()=>{if(!phone)return;let active=true;setExchangeError('');readAll(erp.entities.SalesOrder,{supply_kind:'exchange',status:'delivered'},'-order_date').then(rows=>{if(active)setExchanges(rows);}).catch(failure=>{if(active)setExchangeError(errorMessage(failure));});return()=>{active=false;};},[phone,reload]);
  useEffect(()=>{setSelection(null);},[period.from,period.to]);
  const inspect=next=>{setSelection(next?.kind==='products'?null:next||null);if(next?.kind==='products')setReportKind('products');setAnalysisOpen(true);};
  if(compact)return <MobileSalesRegister onExplore={inspect} onMenu={onMenu} onPromotions={onPromotions} data={data} exchanges={exchanges} exchangeError={exchangeError} error={error} loading={loading} period={period} setPeriod={next=>{setDates(next);setPeriod(next);}} today={today} onReload={()=>setReload(n=>n+1)} viewOnly={viewOnly} isAdmin={isAdmin}/>;
  return <section data-sales-register className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3"><div>{phone&&params.get('detailed')!=='1'&&<Button variant="outline" size="sm" aria-label={ui('Back to sales')} className="mb-2" onClick={()=>{setAnalysisOpen(false);setSelection(null);}}><ArrowLeft size={16} className="mr-1"/>{ui('Back to sales')}</Button>}<h2 className="font-semibold">{ui("Company sales")}</h2><LearnMore title={ui("Company sales")}><p className="text-xs leading-5 text-slate-500">{ui("Posted invoices and Commercial supplies appear together. A Commercial supply posts immediately with its receipt photo. Each document is counted once; collecting cash later does not create another sale.")}</p></LearnMore></div><Button variant="outline" disabled={loading} onClick={() => setReload(value => value + 1)}><RefreshCw size={15} className={'mr-2 ' + (loading ? 'animate-spin' : '')} />{ui("Refresh")}</Button></div>
    <form className="flex flex-wrap items-end gap-3" onSubmit={event=>{event.preventDefault();if(dates.from && dates.to && dates.from<=dates.to)setPeriod({...dates});}}><label className="text-xs">{ui("From")}<Input required aria-label={ui("Company sales from")} type="date" value={dates.from} max={dates.to} onChange={event => setDates(previous => ({ ...previous, from: event.target.value }))} /></label><label className="text-xs">{ui("To")}<Input required aria-label={ui("Company sales to")} type="date" value={dates.to} min={dates.from} max={today} onChange={event => setDates(previous => ({ ...previous, to: event.target.value }))} /></label><Button variant="outline" type="submit" disabled={loading}>{ui("Apply dates")}</Button><Button variant="ghost" type="button" onClick={()=>{const next={from:today,to:today};setDates(next);setPeriod(next);}}>{ui("Today")}</Button><Button variant="ghost" type="button" onClick={()=>{const next={from:today.slice(0,8)+'01',to:today};setDates(next);setPeriod(next);}}>{ui("This month")}</Button></form>
    <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-white p-3"><label className="text-xs">{ui("Report")}<select aria-label={ui("Sales report")} value={reportKind} onChange={event=>{setSelection(null);setReportKind(event.target.value);}} className="mt-1 block h-11 w-full rounded-lg border bg-white px-3 text-sm">{[["summary","Sales summary"],["daily","Sales by day"],["customers","Sales by customer"],["commercials","Sales by salesperson"],["products","Products and demand"]].map(([value,label])=><option key={value} value={value}>{ui(label)}</option>)}</select></label><ReportExport disabled={!data || loading || !!error || reportKind==='products'&&!data.product_report || dates.from!==period.from || dates.to!==period.to} getReport={() => reportKind==='products'?productSalesDocument(data.product_report,period):salesAnalysisDocument(data,period,reportKind)}/></div>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{uiMessage(error)}</p>}
    {data?.unverified_documents>0&&<p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-900">{data.unverified_documents}{ui(" documents have no matching posted journal and are excluded from these totals. Review their source accounting before relying on the sales overview.")}</p>}
    {data?.unverified_vat_corrections>0&&<p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">{ui('Original amounts are shown for {0} VAT corrections that need review.',data.unverified_vat_corrections)}</p>}
    {reportKind==='summary'&&!selection&&<>
    <div className="grid grid-cols-1 gap-3 min-[380px]:grid-cols-2 xl:grid-cols-4">{[
      ['Total sales',data?.totals.sales,'Selected dates · including tax',{kind:'all',title:ui('All posted sales and reversals')}],
      ['Revenue excluding tax',data?.totals.net,'Revenue after recorded discounts',{kind:'subtotal',title:ui('Revenue excluding tax')}],
      ['Tax',data?.totals.tax,'Selected dates',{kind:'tax',title:ui('Tax')}],
      ['Cash at sale',data?.overview?.cash_sales,'Cash collected / recorded at sale',{kind:'collected',title:ui('Cash at sale')}],
      ['Credit at sale',data?.overview?.credit_sales,'Includes unpaid portion of mixed supplies',{kind:'credit',title:ui('Credit at sale')}],
      ['Customer balances',data?.overview?.pending_amount,'Current unpaid balances · all dates',{kind:'balances',title:ui('Customer balances'),metric:'balance'}],
      ['Overdue balances',data?.overview?.overdue_amount,'Current unpaid amounts past their due date',{kind:'overdue',title:ui('Overdue balances'),metric:'balance'}],
      ['Posted transactions',data?.totals.count,'Original sales rows · corrections shown separately',{kind:'sales',title:ui('Posted sales · original rows')}]
    ].map(([label,value,hint,target])=><button type="button" key={label} disabled={!data||!!error} aria-label={ui('View details: {0}',ui(label))} onClick={()=>setSelection(target)} className="rounded-xl border bg-white p-4 text-left disabled:opacity-60"><span className="block text-xs text-slate-500">{ui(label)}</span><strong className="mt-2 block break-words text-base tabular-nums sm:text-xl">{error||!data?'—':label==='Posted transactions'?value:formatXAF(value)}</strong><span className="mt-2 block text-[11px] text-muted-foreground">{ui(hint)}</span></button>)}</div>

    {data&&!error&&<><LearnMore title={ui("Sales calculations")}><p className="text-xs text-slate-500">{ui("Net sales ")}{formatXAF(data.totals.net)}{ui(" · Tax ")}{formatXAF(data.totals.tax)}{ui(". Cash awaiting the Cashier’s deposit is separate from customer debt. Customer balances are current outstanding amounts across all dates.")}</p></LearnMore><SalesVolumeChart daily={data.overview?.daily || []}/><section className="rounded-xl border bg-white p-4"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-semibold">{ui("Pending customer invoices & supplies")}</h3><LearnMore title={ui("Customer balances")}><p>{ui("Current unpaid balances, including supplies still awaiting an invoice.")}</p></LearnMore></div>{!viewOnly&&<Button variant="outline" size="sm" onClick={()=>navigate('/sales?tab=invoices')}>{ui("Manage invoices")}</Button>}</div><DataTable data={data.overview?.pending || []} columns={[{key:'document_number',label:'Document'},{key:'customer_name',label:'Customer'},{key:'source',label:'Type'},{key:'due_date',label:'Due',render:(value)=>value?<span className={value<today?'font-medium text-red-600':''}>{formatDate(value)}</span>:'Not set'},{key:'balance',label:'Amount due',render:formatXAF,className:'text-right'},...(!viewOnly?[{key:'invoice_id',label:'',render:(value,row)=><Button size="sm" variant="outline" onClick={()=>navigate(value?'/sales/invoices/'+value:'/sales?tab=invoices&supply='+row.field_sale_id)}>{value?'Open invoice':'Create invoice'}</Button>}]:[])]} searchFields={['document_number','customer_name']} emptyMessage={ui("No pending customer balances.")}/></section></>}
    </>}
    {!error&&<SalesReportExplorer data={data} period={period} today={today} kind={reportKind} selection={selection} onSelect={setSelection} onKindChange={kind=>{setSelection(null);setReportKind(kind);}} onBack={undefined} loading={loading}/>}

    <LearnMore title={ui("Sales refresh")}><p>{ui("Refreshes every 30 seconds while visible. Commercial collections and balances remain in the field supply details and cash handover workspace.")}</p></LearnMore>
  </section>;
}
