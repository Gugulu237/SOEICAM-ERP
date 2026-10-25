import LearnMore from '@/components/shared/LearnMore';
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
import { Tabs,TabsContent,TabsList,TabsTrigger } from '@/components/ui/tabs';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import CompanySalesRegister from '@/components/sales/CompanySalesRegister';
import { Plus,RefreshCw } from 'lucide-react';
const InvoiceWorkspace=dynamic(()=>import('@/components/sales/InvoiceWorkspace'));
const FieldSalesPanel=dynamic(()=>import('@/components/sales/FieldSalesPanel'));
const OutletReports=dynamic(()=>import('@/views/OutletReports'));

export default function Sales() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const {role,loading}=useCurrentUser();
  if(loading)return <p role="status" className="py-8 text-sm text-slate-500">{ui("Loading sales…")}</p>;
  if(['production_manager','warehouse_manager'].includes(role))return <div className="space-y-5"><PageHeader title={ui("Company sales")} subtitle={<LearnMore title={ui("Company sales")}><p>{ui("Sales activity and current customer balances.")}</p></LearnMore>}/><CompanySalesRegister readOnly/></div>;
  return <SalesWorkspace/>;
}
function SalesWorkspace() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const {role}=useCurrentUser(),navigate=useNavigate(),[params,setParams]=useSearchParams();
  const allowed=['all','orders','invoices',...(role==='admin'?['field','outlets']:[])];
  const tab=allowed.includes(params.get('tab'))?params.get('tab'):'all';
  return <div><PageHeader title={ui("Sales")} subtitle={<LearnMore title={ui("Sales")}><p>{ui("Company sales, customer invoices and supply reports")}</p></LearnMore>} actions={<div className="flex flex-wrap gap-2"><Button variant="outline" onClick={()=>navigate('/sales?tab=invoices')}>{ui("Customer invoices")}</Button><Button onClick={()=>navigate('/sales/new')}><Plus size={16} className="mr-1"/>{ui("New sale")}</Button></div>}/><Tabs value={tab} onValueChange={value=>setParams({tab:value})}><TabsList className="h-auto flex-wrap justify-start"><TabsTrigger value="all">{ui("All sales")}</TabsTrigger><TabsTrigger value="orders">{ui("Sales orders")}</TabsTrigger><TabsTrigger value="invoices">{ui("Invoices")}</TabsTrigger>{role==='admin'&&<><TabsTrigger value="field">{ui("Field sales")}</TabsTrigger><TabsTrigger value="outlets">{ui("Outlet reports")}</TabsTrigger></>}</TabsList>
    <TabsContent value="all" className="mt-4">{tab==='all'&&<CompanySalesRegister/>}</TabsContent>
    <TabsContent value="orders" className="mt-4">{tab==='orders'&&<SalesOrders/>}</TabsContent>
    <TabsContent value="invoices" className="mt-4">{tab==='invoices'&&<InvoiceWorkspace/>}</TabsContent>
    {role==='admin'&&<><TabsContent value="field" className="mt-4">{tab==='field'&&<FieldSalesPanel/>}</TabsContent><TabsContent value="outlets" className="mt-4">{tab==='outlets'&&<OutletReports embedded/>}</TabsContent></>}
  </Tabs></div>;
}
function SalesOrders() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const navigate=useNavigate(),[orders,setOrders]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[reload,setReload]=useState(0);
  useEffect(()=>{let active=true;setLoading(true);setError('');readAll(erp.entities.SalesOrder,{},'-created_date').then(rows=>{if(active)setOrders(rows);}).catch(()=>{if(active)setError(sourceMessage("Sales orders could not load. Refresh to retry."));}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[reload]);
  const columns=[{key:'order_number',label:ui("Order #")},{key:'customer_name',label:ui("Customer")},{key:'order_date',label:ui("Date"),render:formatDate},{key:'payment_type',label:ui("Payment"),render:v=><StatusBadge status={v}/>},{key:'total',label:ui("Total"),render:formatXAF,className:'text-right'},{key:'status',label:ui("Status"),render:v=><StatusBadge status={v}/>},{key:'id',label:'',render:(_,row)=>!['invoiced','cancelled','credit_hold'].includes(row.status)?<Button variant="outline" size="sm" onClick={e=>{e.stopPropagation();navigate('/sales?tab=invoices&order='+row.id);}}>{ui("Create invoice")}</Button>:null}];
  return <section className="space-y-3"><div className="flex items-center justify-between"><h2 className="font-semibold">{ui("Sales orders")}</h2><Button variant="outline" disabled={loading} onClick={()=>setReload(n=>n+1)}><RefreshCw size={15} className="mr-2"/>{ui("Refresh")}</Button></div>{error&&<p role="alert" className="text-sm text-red-700">{uiMessage(error)}</p>}{loading?<p role="status" className="py-8 text-sm text-slate-500">{ui("Loading orders…")}</p>:!error&&<><ReportExport getReport={()=>salesStatusDocument("orders",orders)}/><DataTable columns={columns} data={orders} searchFields={['order_number','customer_name']} onRowClick={row=>navigate(row.invoice_id?'/sales/invoices/'+row.invoice_id:'/sales/'+row.id)}/></>}</section>;
}
