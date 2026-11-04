import {useMenuBack} from '@/hooks/useMenuBack';
import ReportExport from '@/components/shared/ReportExport';
import {salesStatusDocument} from '@/lib/sales-report-documents';

/* localized-messages */
import { sourceMessage, uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React,{useEffect,useState} from 'react';
import dynamic from 'next/dynamic';
import { erp } from '@/api/erpClient';
import { useNavigate,useSearchParams } from '@/lib/router';
import { readAll } from '@/lib/field-pos';
import { formatXAF,formatDate } from '@/lib/formatters';
import PageHeader from '@/components/shared/PageHeader';
import DataTable from '@/components/shared/DataTable';
import StatusBadge from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import WorkspaceLoading from '@/components/home/WorkspaceLoading';
const CompanySalesRegister=dynamic(()=>import('@/components/sales/CompanySalesRegister'),{loading:WorkspaceLoading});
import { Plus,RefreshCw,ReceiptText,ClipboardList,FileText,Truck,Store } from 'lucide-react';
const InvoiceWorkspace=dynamic(()=>import('@/components/sales/InvoiceWorkspace'));
const FieldSalesPanel=dynamic(()=>import('@/components/sales/FieldSalesPanel'));
const OutletReports=dynamic(()=>import('@/views/OutletReports'));

export default function Sales() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const {role,loading}=useCurrentUser();
  if(loading)return <p role="status" className="py-8 text-sm text-slate-500">{ui("Loading sales…")}</p>;
  return <SalesWorkspace readOnly={['production_manager','warehouse_manager'].includes(role)}/>;
}
function SalesWorkspace({readOnly=false}) {
  useInterfaceLanguage();
  const {role}=useCurrentUser(),navigate=useNavigate(),[params,setParams]=useSearchParams(),backToMenu=useMenuBack('/sales');
  const choices=readOnly?[{key:'all',label:ui('Company sales'),Icon:ReceiptText}]:[
    {key:'new',label:ui('New sale'),Icon:Plus},
    {key:'all',label:ui('All sales'),Icon:ReceiptText},
    {key:'orders',label:ui('Sales orders'),Icon:ClipboardList},
    {key:'invoices',label:ui('Invoices'),Icon:FileText},
    ...(role==='admin'?[{key:'field',label:ui('Field sales'),Icon:Truck},{key:'outlets',label:ui('Outlet reports'),Icon:Store}]:[])
  ];
  const tab=choices.some(choice=>choice.key===params.get('tab')&&choice.key!=='new')?params.get('tab'):'home';
  const selected=choices.find(choice=>choice.key===tab);
  return <div className="min-w-0 space-y-5">
    <PageHeader back={tab!=='home'?{onClick:backToMenu,label:ui('Sales menu')}:undefined} title={selected?.label||ui('Sales')} actions={tab!=='home'&&!readOnly&&<Button onClick={()=>navigate('/sales/new')}><Plus size={16} className="mr-1"/>{ui('New sale')}</Button>}/>
    {tab==='home'?<nav aria-label={ui('Sales sections')} className={'mx-auto grid max-w-5xl grid-cols-2 gap-3 sm:gap-5 '+(choices.length>4?'lg:grid-cols-3':'lg:grid-cols-4')}>
      {choices.map(({key,label,Icon})=><button key={key} type="button" aria-label={label} onClick={()=>key==='new'?navigate('/sales/new'):setParams({tab:key})} className="flex min-h-40 min-w-0 flex-col items-center justify-center gap-4 rounded-2xl border border-slate-200 bg-white px-3 py-6 text-center shadow-sm transition-colors hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 sm:min-h-48">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Icon size={28} strokeWidth={1.7} aria-hidden="true"/></span>
        <span className="break-words text-sm font-semibold text-slate-900 sm:text-base">{label}</span>
      </button>)}
    </nav>:<section aria-label={selected?.label}>
      {tab==='all'&&<CompanySalesRegister readOnly={readOnly}/>}
      {tab==='orders'&&<SalesOrders/>}
      {tab==='invoices'&&<InvoiceWorkspace/>}
      {tab==='field'&&<FieldSalesPanel/>}
      {tab==='outlets'&&<OutletReports embedded/>}
    </section>}
  </div>;
}
function SalesOrders() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const navigate=useNavigate(),[orders,setOrders]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[reload,setReload]=useState(0);
  useEffect(()=>{let active=true;setLoading(true);setError('');readAll(erp.entities.SalesOrder,{},'-created_date').then(rows=>{if(active)setOrders(rows);}).catch(()=>{if(active)setError(sourceMessage("Sales orders could not load. Refresh to retry."));}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[reload]);
  const columns=[{key:'order_number',label:ui("Order #")},{key:'customer_name',label:ui("Customer")},{key:'order_date',label:ui("Date"),render:formatDate},{key:'payment_type',label:ui("Payment"),render:v=><StatusBadge status={v}/>},{key:'total',label:ui("Total"),render:formatXAF,className:'text-right'},{key:'status',label:ui("Status"),render:v=><StatusBadge status={v}/>},{key:'id',label:'',render:(_,row)=>!['invoiced','cancelled','credit_hold'].includes(row.status)?<Button variant="outline" size="sm" onClick={e=>{e.stopPropagation();navigate('/sales?tab=invoices&order='+row.id);}}>{ui("Create invoice")}</Button>:null}];
  return <section className="space-y-3"><div className="flex items-center justify-between"><h2 className="font-semibold">{ui("Sales orders")}</h2><Button variant="outline" disabled={loading} onClick={()=>setReload(n=>n+1)}><RefreshCw size={15} className="mr-2"/>{ui("Refresh")}</Button></div>{error&&<p role="alert" className="text-sm text-red-700">{uiMessage(error)}</p>}{loading?<p role="status" className="py-8 text-sm text-slate-500">{ui("Loading orders…")}</p>:!error&&<><ReportExport getReport={()=>salesStatusDocument("orders",orders)}/><DataTable columns={columns} data={orders} searchFields={['order_number','customer_name']} onRowClick={row=>navigate(row.invoice_id?'/sales/invoices/'+row.invoice_id:'/sales/'+row.id)}/></>}</section>;
}
