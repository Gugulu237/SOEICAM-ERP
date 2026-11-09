import React,{useEffect,useState} from 'react';
import {ui,uiMessage} from '@/lib/i18n';
import {useLocaleRender} from '@/lib/localization';
import {useNavigate} from '@/lib/router';
import {invokeFieldOps} from '@/lib/field-ops';
import {businessDate} from '@/lib/business-date';
import {formatDateTime,formatXAF} from '@/lib/formatters';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import PageHeader from '@/components/shared/PageHeader';
import DataTable from '@/components/shared/DataTable';
import CompanyStockRows,{companyStockProducts} from './CompanyStockRows';
import CentralDegustationForm from '@/components/distribution/CentralDegustationForm';
import DegustationHistory from '@/components/distribution/DegustationHistory';
import CustomerCommissionReport from '@/components/employees/CustomerCommissionReport';
import {RefreshCw} from 'lucide-react';

export default function CentralStockWorkspace({data,error,busy,enabled,role,refresh,embedded=false,initialTab='stock'}){
  useLocaleRender();
  const navigate=useNavigate(),[tab,setTab]=useState(initialTab),[search,setSearch]=useState(''),[giveaway,setGiveaway]=useState(false),[history,setHistory]=useState(null),[historyError,setHistoryError]=useState(''),[historyLoading,setHistoryLoading]=useState(false),[reload,setReload]=useState(0);
  const canRecord=enabled&&role!=='driver'&&!busy&&!error,month=(data.date||businessDate()).slice(0,7);
  useEffect(()=>{
    if(tab!=='degustation')return;
    let active=true;setHistory(null);setHistoryError('');setHistoryLoading(true);
    invokeFieldOps({action:'centralDegustationHistory',from:month+'-01',to:data.date||businessDate()}).then(({data:value})=>{if(value?.error)throw Error(value.error);if(active)setHistory(Array.isArray(value)?value:value.history||value.records||[]);}).catch(failure=>{if(active)setHistoryError(failure.message);}).finally(()=>{if(active)setHistoryLoading(false);});
    return()=>{active=false;};
  },[tab,month,data.date,data.updated_at,reload]);
  const products=companyStockProducts(data),needle=search.trim().toLowerCase(),visible=products.filter(product=>[product.name,product.sku,product.size].filter(Boolean).join(' ').toLowerCase().includes(needle));
  const actions=<div className="flex flex-wrap gap-2">{role!=='driver'&&<>{data.can_record_sales!==false&&<Button disabled={!canRecord} onClick={()=>navigate('/my-stock/new')}>{ui('Record sale')}</Button>}<Button variant="outline" disabled={!canRecord} onClick={()=>setGiveaway(true)}>{ui('Record Dégustation')}</Button></>}<Button variant="outline" aria-label={ui('Refresh company stock')} disabled={!enabled||busy} onClick={refresh}><RefreshCw size={15} className={'mr-1 '+(busy?'animate-spin':'')}/>{ui('Refresh')}</Button></div>;
  return <section aria-label={ui('Company stock')} className="min-w-0 space-y-4">
    {embedded?<div className="space-y-3"><h2 className="font-semibold">{ui('Company stock')}</h2>{actions}</div>:<PageHeader title={ui('Company stock')} subtitle={data.employeeName} actions={actions}/>}
    {error&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{ui('Stock refresh failed. Showing the last confirmed quantities.')} {uiMessage(error)} <button disabled={busy} className="underline" onClick={refresh}>{ui('Retry')}</button></p>}
    <p className="text-xs text-slate-500">{ui('Company unsold stock includes goods out for supply. Available quantities exclude held and expired goods.')}</p>
    <div className="flex flex-wrap gap-2" role="group" aria-label={ui('My stock and activity')}>{[['stock','Company stock'],...(role==='driver'?[]:[['sales','My sales this month'],['degustation','Dégustation history'],['commissions','My customers & commissions']])].map(([key,label])=><Button key={key} variant={tab===key?'default':'outline'} aria-pressed={tab===key} onClick={()=>setTab(key)}>{ui(label)}</Button>)}</div>
    {tab==='stock'&&<><Input className="sm:max-w-sm" aria-label={ui('Search company stock')} placeholder={ui('Search company stock')} value={search} onChange={event=>setSearch(event.target.value)}/><section className="rounded-xl border bg-white p-4"><CompanyStockRows products={visible}/>{!visible.length&&<p className="py-5 text-sm text-slate-500">{ui(products.length?'No products match this view.':'No saleable company stock is currently available.')}</p>}</section>{data.updated_at&&<p className="text-xs text-slate-500">{ui('Last stock update')}: {formatDateTime(data.updated_at)}</p>}</>}
    {tab==='sales'&&<DataTable data={data.sales||[]} columns={[{key:'order_date',label:ui('Date')},{key:'order_number',label:ui('Reference')},{key:'customer_name',label:ui('Customer')},{key:'payment_type',label:ui('Payment')},{key:'total',label:ui('Amount'),render:formatXAF},{key:'status',label:ui('Status')}]} emptyMessage={ui('No sales recorded this month')}/>}
    {tab==='degustation'&&<section className="space-y-3">{historyLoading&&<p role="status">{ui('Loading Dégustation history...')}</p>}{historyError&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{uiMessage(historyError)} <Button variant="outline" onClick={()=>setReload(value=>value+1)}>{ui('Retry')}</Button></p>}{history&&!historyLoading&&!historyError&&<DegustationHistory records={history}/>}</section>}
    {tab==='commissions'&&<CustomerCommissionReport selectedAgentId={data.employee?.id} embedded/>}
    {giveaway&&enabled&&role!=='driver'&&<CentralDegustationForm onClose={()=>setGiveaway(false)} onSaved={()=>{setGiveaway(false);setReload(value=>value+1);refresh();}}/>}
  </section>;
}
