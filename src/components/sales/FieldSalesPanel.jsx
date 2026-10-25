import React,{useEffect,useState} from 'react';
import {ui,uiMessage} from '@/lib/i18n';
import {useLocaleRender} from '@/lib/localization';
import {erp} from '@/api/erpClient';
import {useNavigate} from '@/lib/router';
import {readAll} from '@/lib/field-pos';
import {businessDate} from '@/lib/business-date';
import {salesStatusDocument} from '@/lib/sales-report-documents';
import ReportExport from '@/components/shared/ReportExport';
import LearnMore from '@/components/shared/LearnMore';
import DataTable from '@/components/shared/DataTable';
import StatusPill from '@/components/field/StatusPill';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {invokeFieldOps} from '@/lib/field-ops';
import {SALE_STATUS} from '@/lib/field-ops';
import {formatXAF,formatDate} from '@/lib/formatters';
import {ClipboardCheck,Handshake,Coins} from 'lucide-react';

export default function FieldSalesPanel(){
  useLocaleRender();
  const navigate=useNavigate(),today=businessDate(),initial={from:today.slice(0,8)+'01',to:today};
  const [dates,setDates]=useState(initial),[period,setPeriod]=useState(initial),[sales,setSales]=useState([]),[counts,setCounts]=useState({review:0,handovers:0,custody:0}),[loading,setLoading]=useState(true),[error,setError]=useState(''),[reload,setReload]=useState(0);
  useEffect(()=>{
    let active=true;setLoading(true);setError('');
    Promise.all([
      invokeFieldOps({action:'companySales',...period}),
      readAll(erp.entities.FieldSale,{transaction_date:{$gte:period.from,$lte:period.to}},'-created_date'),
      erp.entities.FieldSale.count({status:{$in:['submitted','under_review','posting_failed']}}),
      erp.entities.CashHandover.count({status:{$in:['submitted','partially_received','disputed']}}),
      erp.entities.Dispatch.count({status:{$in:['loaded','in_transit']}}),
    ]).then(([report,rows,review,handovers,custody])=>{if(active){const verified=new Set(report.data.rows.filter(row=>row.source==='Commercial supply').map(row=>row.document_id));setSales(rows.map(row=>({...row,accounting_verified:verified.has(row.id)})));setCounts({review,handovers,custody});}}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[period,reload]);
  const tiles=[
    {key:'review',label:ui('Field Sale Review'),path:'/field-review',icon:ClipboardCheck,description:ui('Review receipts and earlier pending reports'),badge:counts.review,tone:'bg-lime-50 text-lime-700'},
    {key:'custody',label:ui('Delivery runs'),path:'/distribution',icon:Handshake,description:ui('Pair teams and load vehicle stock'),badge:counts.custody,tone:'bg-cyan-50 text-cyan-700'},
    {key:'handovers',label:ui('Cashier handovers'),path:'/cashier?section=handovers',icon:Coins,description:ui('Confirm cash received'),badge:counts.handovers,tone:'bg-emerald-50 text-emerald-700'},
  ];
  const columns=[
    {key:'sale_number',label:ui('Sale #')},{key:'customer_name',label:ui('Customer')},{key:'commercial_name',label:ui('Commercial')},
    {key:'transaction_date',label:ui('Date'),render:formatDate},{key:'payment_type',label:ui('Payment'),render:value=>ui(value==='cash'?'Cash':'Credit')},
    {key:'total',label:ui('Total'),render:formatXAF,className:'text-right'},{key:'status',label:ui('Status'),render:value=><StatusPill map={SALE_STATUS} value={value}/>},
  ];
  return <section className="min-w-0 space-y-4">
    <div className="grid gap-3 sm:grid-cols-3">{tiles.map(tile=><div key={tile.key} className="rounded-xl border bg-white p-4"><button type="button" onClick={()=>navigate(tile.path)} className="w-full text-left"><div className="flex items-start justify-between gap-2"><span className={'rounded-lg p-2 '+tile.tone}><tile.icon size={20}/></span>{tile.badge>0&&<span className="rounded-full bg-slate-900 px-2 py-0.5 text-xs font-semibold text-white">{tile.badge}</span>}</div><span className="mt-3 block min-h-8 text-sm font-semibold">{tile.label}</span></button><LearnMore title={tile.label}><p>{tile.description}</p></LearnMore></div>)}</div>
    <div><h2 className="font-semibold">{ui('Field sales report')}</h2><LearnMore title={ui('Field sales report')}><p>{ui('Reports cover the applied dates. Draft and pending reports are shown separately from posted sales. Search only filters the on-screen list.')}</p></LearnMore></div>
    <form className="flex flex-wrap items-end gap-3" onSubmit={event=>{event.preventDefault();if(dates.from&&dates.to&&dates.from<=dates.to)setPeriod({...dates});}}>
      <label className="text-xs">{ui('From')}<Input required type="date" aria-label={ui('Field sales from')} value={dates.from} max={dates.to} onChange={e=>setDates(d=>({...d,from:e.target.value}))}/></label>
      <label className="text-xs">{ui('To')}<Input required type="date" aria-label={ui('Field sales to')} value={dates.to} min={dates.from} max={today} onChange={e=>setDates(d=>({...d,to:e.target.value}))}/></label>
      <Button type="submit" variant="outline" disabled={loading}>{ui('Apply dates')}</Button><Button type="button" variant="ghost" disabled={loading} onClick={()=>setReload(n=>n+1)}>{ui('Refresh')}</Button>
    </form>
    <ReportExport disabled={loading||!!error||dates.from!==period.from||dates.to!==period.to} getReport={()=>salesStatusDocument('field',sales,period)}/>
    {error&&<p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{uiMessage(error)}</p>}
    {loading?<p role="status" className="p-6 text-sm text-slate-500">{ui('Loading sales.')}</p>:!error&&<DataTable columns={columns} data={sales} searchFields={['sale_number','customer_name','commercial_name']} onRowClick={row=>navigate('/field-review/'+row.id)}/>}
  </section>;
}
