import ReportExport from '@/components/shared/ReportExport';
import { companySalesDocument } from '@/lib/report-models';

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
import { formatXAF, formatDate } from '@/lib/formatters';
import { useNavigate } from '@/lib/router';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { RefreshCw } from 'lucide-react';
import SalesVolumeChart from './SalesVolumeChart';

export default function CompanySalesRegister({ readOnly = false }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const today = businessDate(), navigate = useNavigate(), { isAdmin, role } = useCurrentUser();
  const viewOnly = readOnly || role === 'production_manager';
  const [period, setPeriod] = usePageState('company-sales:period', { from: today.slice(0, 8) + '01', to: today });
  const [dates,setDates]=usePageState('company-sales:dates', period);
  const [data, setData] = useState(null), [loading, setLoading] = useState(false), [error, setError] = useState(''), [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true, pending = false;
    setData(null);
    const refresh = async () => {
      if (!active || pending) return;
      pending = true; setLoading(true); setError('');
      try {
        const result = await invokeFieldOps({ action: 'companySales', ...period });
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
  }, [period, reload]);
  const columns = [
    { key: 'document_number', label: ui("Sale #") }, { key: 'source', label: ui("Source"),render:value=>ui(value) }, { key: 'customer_name', label: ui("Customer") },
    { key: 'commercial_name', label: ui("Commercial") }, { key: 'date', label: ui("Date"), render: formatDate },
    { key: 'payment_type', label: ui("Terms"), render: value => value === 'credit' ? 'Credit' : value === 'cash' ? 'Cash' : value || '-' },
    { key: 'total', label: ui("Sale total"), render: formatXAF, className: 'text-right' },
    { key: 'receipt_count', label: ui("Supply proof"), render: (value, row) => row.source === 'Commercial supply' ? `${value} photo${value === 1 ? '' : 's'}` : '-' },
    { key: 'status', label: ui("Status"), render: () => <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">{ui("Posted")}</span> },
  ];
  return <section className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="font-semibold">{ui("Company sales")}</h2><p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">{ui("Posted invoices and Commercial supplies appear together. A Commercial supply posts immediately with its receipt photo. Each document is counted once; collecting cash later does not create another sale.")}</p></div><Button variant="outline" disabled={loading} onClick={() => setReload(value => value + 1)}><RefreshCw size={15} className={'mr-2 ' + (loading ? 'animate-spin' : '')} />{ui("Refresh")}</Button></div>
    <form className="flex flex-wrap items-end gap-3" onSubmit={event=>{event.preventDefault();if(dates.from && dates.to && dates.from<=dates.to)setPeriod({...dates});}}><label className="text-xs">{ui("From")}<Input required aria-label={ui("Company sales from")} type="date" value={dates.from} max={dates.to} onChange={event => setDates(previous => ({ ...previous, from: event.target.value }))} /></label><label className="text-xs">{ui("To")}<Input required aria-label={ui("Company sales to")} type="date" value={dates.to} min={dates.from} max={today} onChange={event => setDates(previous => ({ ...previous, to: event.target.value }))} /></label><Button variant="outline" type="submit" disabled={loading}>{ui("Apply dates")}</Button><Button variant="ghost" type="button" onClick={()=>{const next={from:today,to:today};setDates(next);setPeriod(next);}}>{ui("Today")}</Button><Button variant="ghost" type="button" onClick={()=>{const next={from:today.slice(0,8)+'01',to:today};setDates(next);setPeriod(next);}}>{ui("This month")}</Button></form>
    <ReportExport disabled={!data || loading || !!error || dates.from!==period.from || dates.to!==period.to} getReport={() => companySalesDocument(data,period)}/>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{uiMessage(error)}</p>}
    {data?.unverified_documents>0&&<p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-900">{data.unverified_documents}{ui(" documents have no matching posted journal and are excluded from these totals. Review their source accounting before relying on the sales overview.")}</p>}
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">{[[ui("Total sales"),data && formatXAF(data.totals.sales),ui("Selected dates · including tax")],[ui("Cash at sale"),data && formatXAF(data.overview?.cash_sales),ui("Cash collected / recorded at sale")],[ui("Credit at sale"),data && formatXAF(data.overview?.credit_sales),ui("Includes unpaid portion of mixed supplies")],[ui("Customer balances"),data && formatXAF(data.overview?.pending_amount),ui("{0} unpaid documents · all dates", data?.overview?.pending_count || 0)],[ui("Overdue balances"),data && formatXAF(data.overview?.overdue_amount),ui("Current unpaid amounts past their due date")],[ui("Posted transactions"),data?.totals.count,ui("Selected dates")]].map(([label,value,hint])=><div key={label} className="rounded-xl border bg-white p-4"><p className="text-xs text-slate-500">{label}</p><p className="mt-2 text-xl font-bold">{error || !data?'-':value}</p><p className="mt-2 text-[11px] text-slate-400">{hint}</p></div>)}</div>
    {data&&!error&&<><p className="text-xs text-slate-500">{ui("Net sales ")}{formatXAF(data.totals.net)}{ui(" · Tax ")}{formatXAF(data.totals.tax)}{ui(". Cash awaiting the Cashier’s deposit is separate from customer debt. Customer balances are current outstanding amounts across all dates.")}</p><SalesVolumeChart daily={data.overview?.daily || []}/><section className="rounded-xl border bg-white p-4"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-semibold">{ui("Pending customer invoices & supplies")}</h3><p className="mt-1 text-xs text-slate-500">{ui("Current unpaid balances, including supplies still awaiting an invoice.")}</p></div>{!viewOnly&&<Button variant="outline" size="sm" onClick={()=>navigate('/sales?tab=invoices')}>{ui("Manage invoices")}</Button>}</div><DataTable exportTitle="Current unpaid customer documents" exportDisabled={loading || !!error} exportNotes={["Current outstanding balances across all dates."]} data={data.overview?.pending || []} columns={[{key:'document_number',label:'Document'},{key:'customer_name',label:'Customer'},{key:'source',label:'Type'},{key:'due_date',label:'Due',render:(value)=>value?<span className={value<today?'font-medium text-red-600':''}>{formatDate(value)}</span>:'Not set'},{key:'balance',label:'Amount due',render:formatXAF,className:'text-right'},...(!viewOnly?[{key:'invoice_id',label:'',render:(value,row)=><Button size="sm" variant="outline" onClick={()=>navigate(value?'/sales/invoices/'+value:'/sales?tab=invoices&supply='+row.field_sale_id)}>{value?'Open invoice':'Create invoice'}</Button>}]:[])]} searchFields={['document_number','customer_name']} emptyMessage={ui("No pending customer balances.")}/></section></>}
    {loading && !data ? <p role="status" className="py-10 text-sm text-slate-500">{ui("Loading posted company sales...")}</p> : !error && data && <DataTable exportTitle="Posted sales register" exportDisabled={loading || !!error || dates.from!==period.from || dates.to!==period.to} exportMetadata={[["From",period.from],["To",period.to]]} exportNotes={[`${data.unverified_documents||0} unverified documents excluded. Search applies to this register; use Company sales report above for full period totals.`]} columns={columns} data={data.rows} searchFields={['document_number', 'customer_name', 'commercial_name', 'source']} onRowClick={viewOnly ? undefined : row => { if(row.source==='Invoice')navigate('/sales/invoices/'+row.document_id);else if(row.invoice_id)navigate('/sales/invoices/'+row.invoice_id);else if (row.source === 'Commercial supply' && isAdmin) navigate('/field-review/' + row.document_id); else if (row.sales_order_id) navigate('/sales/' + row.sales_order_id); }} emptyMessage={ui("No posted sales in this period.")} />}
    <p className="text-xs text-slate-500">{ui("Refreshes every 30 seconds while visible. Commercial collections and balances remain in the field supply details and cash handover workspace.")}</p>
  </section>;
}
