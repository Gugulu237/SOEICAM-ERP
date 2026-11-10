import React,{useEffect,useState} from 'react';
import {loadMobileAccountingSummary} from '@/components/accounting/loadMobileAccountingSummary';
import {recurringExpenseRequest} from '@/lib/recurring-expense-client';
import ProductThumb from '@/components/shared/ProductThumb';
import { Receipt, Package, Factory, Calculator, ShoppingCart, Users, Bell, ChevronRight, PlusCircle, CheckSquare, BarChart3 } from 'lucide-react';
import { Link } from '@/lib/router';
import { ui,uiMessage } from '@/lib/i18n';
import { managerSnapshot, cashierSnapshot, productionSnapshot } from '@/lib/staff-dashboard';
import { formatXAF } from '@/lib/formatters';
import { useWorkspaceAccess } from './WorkspaceAccess';

// Layout from Sleek Accueil GM v3. Figures are exclusively ERP snapshots.
export default function MobileManagerHome({data, loading, preview}) {
  const summary=managerSnapshot(data || {}), cash=cashierSnapshot(data || {}), production=productionSnapshot(data || {});
  const {canOpen}=useWorkspaceAccess();
  const [finance,setFinance]=useState({data:null,error:''});
  const [recurring,setRecurring]=useState({data:null,error:''});
  const financeAllowed=!preview&&canOpen('/accounting'),recurringAllowed=financeAllowed&&!!data?.date&&canOpen('/accounting/recurring-expenses');
  useEffect(()=>{if(!financeAllowed||!data?.date)return;let active=true;setFinance({data:null,error:''});loadMobileAccountingSummary({monthStart:data.date,date:data.date}).then(value=>{if(active)setFinance({data:value,error:''});}).catch(error=>{if(active)setFinance({data:null,error:error.message});});return()=>{active=false;};},[data?.date,financeAllowed]);
  useEffect(()=>{if(!recurringAllowed)return;let active=true,generation=0;const load=()=>{const current=++generation;setRecurring({data:null,error:''});recurringExpenseRequest(null,{summary:'alerts'}).then(value=>{if(active&&current===generation)setRecurring({data:value,error:''});}).catch(error=>{if(active&&current===generation)setRecurring({data:null,error:error.message});});};load();window.addEventListener('soeicam:recurring-expenses',load);window.addEventListener('focus',load);return()=>{active=false;window.removeEventListener('soeicam:recurring-expenses',load);window.removeEventListener('focus',load);};},[data?.date,recurringAllowed]);
  const financeData=financeAllowed?finance.data:null,recurringData=recurringAllowed&&recurring.data?.date===data?.date?recurring.data:null;
  const ready=!!data&&!loading;
  const modules=[['Sales','/sales?tab=all',Receipt],['Stock','/inventory?section=items&filter=finished&area=all',Package],['Manufacturing','/manufacturing',Factory],['Accounting','/accounting',Calculator],['Purchases','/purchases',ShoppingCart],['Team','/team-workspaces',Users]];
  const queues=(data?.approvalQueues || []).filter(q=>q.count>0);
  const alerts=[...queues.map(q=>({key:q.key,label:q.title,value:q.count,path:q.path})),...(recurringData?.overdue_accrued_count?[{key:'recurring-accrued',label:'Overdue recurring payables',value:formatXAF(recurringData.overdue_accrued_total),detail:ui('{0} accrued unpaid charges',recurringData.overdue_accrued_count),path:'/accounting/recurring-expenses'}]:[]),...(recurringData?.overdue_pending_count?[{key:'recurring-pending',label:'Overdue recurring charges to recognize',value:formatXAF(recurringData.overdue_pending_total),detail:ui('{0} scheduled charges not yet included in profit',recurringData.overdue_pending_count),path:'/accounting/recurring-expenses'}]:[]),...(production.expired.length+production.expiring.length?[{key:'expiry',label:'Expired / expiring lots',value:production.expired.length+production.expiring.length,path:'/manufacturing?section=quality&quality=expiry'}]:[])].filter(a=>canOpen(a.path));
  const money=value=>ready?formatXAF(value):'—';
  const salePath='/sales/new';
  return <div data-sleek-screen="accueil-gm" className="sleek-manager space-y-6">
    <section className="sleek-summary" aria-label={ui('Today')}>
      <div className="flex items-center justify-between"><h2>{ui('Today')}</h2><span className="text-xs text-muted-foreground">SOEICAM</span></div>
      <div className="mt-4 grid grid-cols-2 gap-4">
        <div><p>{ui('Sales today')}</p><strong>{financeData?.sales==null?'—':formatXAF(financeData.sales)}</strong></div>
        <div><p>{ui('Posted net profit today')}</p><strong className="text-primary">{financeData?.netProfit==null?'—':formatXAF(financeData.netProfit)}</strong>{financeAllowed&&<Link to="/accounting/statements" className="mt-1 block text-[10px] underline">{ui('Income statement')}</Link>}</div>
        <div className="col-span-2 border-t pt-3 flex items-center justify-between gap-3"><div><p>{ui('Outstanding invoice balances')}</p><strong>{money(summary.receivables)}</strong></div></div>
      </div>
    </section>
    {financeAllowed&&finance.error&&<p role="alert" className="text-xs text-red-700">{uiMessage(finance.error)}</p>}
    {recurringAllowed&&recurring.error&&<p role="alert" className="text-xs text-red-700">{uiMessage(recurring.error)}</p>}
    <section><h2 className="sleek-section-label">{ui('Modules')}</h2><div className="sleek-module-grid">{modules.filter(([,path])=>canOpen(path)).map(([label,path,Icon])=>preview?<div key={path} className="sleek-module"><span><Icon size={24}/></span>{ui(label)}</div>:<Link key={path} to={path} className="sleek-module"><span><Icon size={24} strokeWidth={1.6}/></span>{ui(label)}</Link>)}</div></section>
    <section><div className="flex items-center justify-between mb-3"><h2 className="sleek-section-label !mb-0">{ui('Alerts')}</h2>{!preview&&<Link to="/?section=approvals" className="text-sm font-semibold text-primary">{ui('Review approvals')}</Link>}</div>
      {!ready||!alerts.length&&recurringAllowed&&!recurringData&&!recurring.error?<p role="status" className="text-sm text-muted-foreground">{ui('Loading live records...')}</p>:!alerts.length?<p className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground">{ui('No pending items in these approval queues.')}</p>:<div className="space-y-2">{alerts.map(alert=><div key={alert.key} className="sleek-alert"><span className="sleek-alert-icon"><Bell size={22}/></span><span className="min-w-0 flex-1 text-sm font-semibold">{ui(alert.label)}{alert.detail&&<span className="mt-1 block text-xs font-normal text-muted-foreground">{alert.detail}</span>}</span><strong className="shrink-0 text-sm tabular-nums">{alert.value}</strong>{!preview&&<Link to={alert.path} aria-label={ui(alert.label)} className="flex min-h-11 min-w-11 items-center justify-center"><ChevronRight size={18}/></Link>}</div>)}</div>}
    </section>
    {!!(data?.riskLots||[]).length&&<section className="space-y-2"><h2 className="sleek-section-label">{ui('Stock alerts')}</h2>{data.riskLots.slice(0,3).map(lot=><Link key={lot.id||lot.batch_number} to="/inventory?section=alerts" className="flex min-h-16 items-center gap-3 rounded-xl border bg-white p-3"><ProductThumb product={data.products?.find(p=>p.id===lot.product_id)||{name:lot.product_name}} size={44}/><span className="min-w-0 flex-1"><strong className="block break-words text-sm">{lot.product_name}</strong><span className="text-xs text-muted-foreground">{[lot.batch_number,lot.expiry_date].filter(Boolean).join(' · ')}</span></span><span className="text-sm font-bold">{lot.quantity}</span></Link>)}</section>}
    <details className="rounded-xl border bg-white p-3"><summary className="min-h-8 cursor-pointer text-sm font-semibold">{ui('Other tools')}</summary><div className="mt-3 space-y-3"><section className="sleek-summary"><p>{ui('Company treasury')}</p><strong>{money(cash.balance)}</strong></section><div className="grid grid-cols-2 gap-3">{[['Approvals','/?section=approvals',CheckSquare],['Quick reports','/?section=quick-reports',BarChart3]].map(([label,path,Icon])=>!preview&&canOpen(path)&&<Link key={path} to={path} className="flex items-center gap-2 rounded-xl border bg-card p-3 text-sm"><Icon size={18}/>{ui(label)}</Link>)}</div></div></details>
    {!preview&&canOpen(salePath)&&<div data-mobile-action-bar className="sleek-home-action"><Link to={salePath}><PlusCircle size={20}/>{ui('Record sale')}</Link></div>}
  </div>;
}
