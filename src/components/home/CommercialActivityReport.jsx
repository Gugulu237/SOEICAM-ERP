import MobileInfo from '@/components/shared/MobileInfo';
import React, { useEffect, useState } from 'react';
import {ClipboardList,Package,Users,RotateCcw,Wallet,BarChart3} from 'lucide-react';
import DashboardTaskGrid from '@/components/shared/DashboardTaskGrid';
import PageHeader from '@/components/shared/PageHeader';
import CommercialCustomerList from './CommercialCustomerList';
import { ui } from '@/lib/i18n';
import { formatXAF } from '@/lib/formatters';
import { commercialSnapshot } from '@/lib/employee-dashboard';
import { invokeFieldOps, errorMessage } from '@/lib/field-ops';
import ReadOnlyWorkspaceNotice from './ReadOnlyWorkspaceNotice';
import CommercialDailySupplies from '@/components/field/CommercialDailySupplies';
import CommercialCashSettlement from '@/components/field/CommercialCashSettlement';
import FieldInventoryCards from '@/components/field/FieldInventoryCards';

function ReturnsReport({ employeeId }) {
  const [result,setResult] = useState(null), [error,setError] = useState('');
  useEffect(() => {
    if (!employeeId) return;
    let active=true;
    setResult(null); setError('');
    invokeFieldOps({action:'commercialReturns',commercialId:employeeId}).then(({data}) => {
      if(data.error) throw Error(data.error);
      if(active)setResult(data.returns || []);
    }).catch(error => {if(active)setError(errorMessage(error));});
    return () => {active=false;};
  },[employeeId]);
  return <section className="space-y-3"><h2 className="font-semibold">{ui('Exchanges')}</h2>{error && <p role="alert" className="text-sm text-red-700">{error}</p>}{!result && !error ? <p role="status">{ui('Loading recorded returns...')}</p> : !result?.length ? <p className="text-sm text-slate-500">{ui('No returns recorded by this employee.')}</p> : result.map(row => <article key={row.id} className="rounded-xl border bg-slate-50 p-4 text-sm"><p className="font-semibold">{row.customer_name} / {row.product_name}</p><p className="mt-1">{row.quantity} {row.unit} / {row.reason === 'damaged_at_store' ? ui('Damaged') : ui('Expired')} / {row.reported_date} / {String(row.status || '').replaceAll('_',' ')}</p>{row.source_sale_number && <p className="mt-1 text-xs text-slate-500">{row.source_sale_number}</p>}</article>)}</section>;
}

export default function CommercialActivityReport({ data, loading=false, showReadOnlyNotice=true, hideMobileHero=false, activeTab, onTabChange, onBackToMenu }) {
  const [localTab,setLocalTab] = useState('home');
  const tasks=[['supplies','Daily supplies',ClipboardList],['stock','Vehicle stock',Package],['customers','Acquired customers',Users],['returns','Exchanges',RotateCcw],['cash','Cash',Wallet],['performance','Performance & rewards',BarChart3]];
  const selected=activeTab==='sales'?'supplies':activeTab;
  const tab=['home',...tasks.map(([key])=>key)].includes(selected) ? selected : localTab;
  const setTab=value => onTabChange ? onTabChange(value) : setLocalTab(value);
  const summary=commercialSnapshot(data),ready=!!data?.employee && !loading;
  return <div className="space-y-5">

    <header className={(hideMobileHero ? "hidden sm:block " : "") + "relative rounded-2xl border bg-secondary/50 p-4 pr-12 sm:border-0 sm:bg-transparent sm:p-0"}><p className="text-xs font-semibold uppercase tracking-wide text-emerald-700"><span className="sm:hidden">{ui('Commercial agent')}</span><span className="hidden sm:inline">{ui('Commercial activity report')}</span></p><h1 className="mt-2 text-2xl font-bold">{data?.employee?.full_name || ui('Employee activity')}</h1><MobileInfo title={ui('Commercial activity report')} className="absolute right-1 top-1 sm:static" desktopClassName="mt-2 text-sm text-slate-600"><p>{ui('Recorded sales, customers, stock and cash settlement. This report does not create or change employee activity.')}</p></MobileInfo></header>
    {showReadOnlyNotice && <ReadOnlyWorkspaceNotice employeeName={data?.employee?.full_name}/>}
    {tab==='home'?<DashboardTaskGrid label={ui('Commercial activity report sections')} tasks={tasks.map(([key,label,icon])=>({key,label:ui(label),icon,onSelect:()=>setTab(key)}))}/>:<PageHeader title={ui(tasks.find(([key])=>key===tab)?.[1])} back={{onClick:()=>onBackToMenu?onBackToMenu():setTab('home'),label:ui('Commercial activity report')}}/>}
    {tab==='performance'&&<div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{[
      ['Recorded sales today',formatXAF(summary.today)],['Recorded sales this month',formatXAF(summary.month)],['Cash awaiting clearance',formatXAF(summary.cash)],['Customers this month',summary.registered],
    ].map(([label,value]) => <div key={label} className="rounded-xl border bg-white p-4"><p className="text-xs text-slate-500">{ui(label)}</p><p className="mt-2 break-words text-lg font-bold sm:text-xl">{ready ? value : '-'}</p></div>)}</div>}

    {['supplies','stock','customers','returns'].includes(tab)&&<section className={tab==='stock'?'':'rounded-2xl border bg-white p-4 sm:p-5'}>{tab==='supplies' ? <CommercialDailySupplies employeeId={data?.employee?.id} today={data?.date} readOnly managing/> : tab==='stock' ? <FieldInventoryCards employeeId={data?.employee?.id} enabled={ready}/> : tab==='returns' ? <ReturnsReport employeeId={data?.employee?.id}/> : <CommercialCustomerList customers={data?.customers}/>}</section>}
    {tab==='cash'&&<CommercialCashSettlement days={data?.cashDays || []} ready={ready} commercialId={data?.employee?.id} commercialName={data?.employee?.full_name} managing/>}
  </div>;
}
