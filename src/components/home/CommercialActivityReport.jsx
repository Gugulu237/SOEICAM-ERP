import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
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
  return <section className="space-y-3"><h2 className="font-semibold">{ui('Expired returns')}</h2>{error && <p role="alert" className="text-sm text-red-700">{error}</p>}{!result && !error ? <p role="status">{ui('Loading recorded returns...')}</p> : !result?.length ? <p className="text-sm text-slate-500">{ui('No returns recorded by this employee.')}</p> : result.map(row => <article key={row.id} className="rounded-xl border bg-slate-50 p-4 text-sm"><p className="font-semibold">{row.customer_name} / {row.product_name}</p><p className="mt-1">{row.quantity} {row.unit} / {row.reported_date} / {String(row.status || '').replaceAll('_',' ')}</p></article>)}</section>;
}

export default function CommercialActivityReport({ data, loading=false, activeTab, onTabChange }) {
  const [localTab,setLocalTab] = useState('supplies');
  const tab=['supplies','stock','customers','returns'].includes(activeTab) ? activeTab : localTab;
  const setTab=value => onTabChange ? onTabChange(value) : setLocalTab(value);
  const summary=commercialSnapshot(data),ready=!!data?.employee && !loading;
  return <div className="space-y-5">
    <ReadOnlyWorkspaceNotice employeeName={data?.employee?.full_name}/>
    <header><p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">{ui('Commercial activity report')}</p><h1 className="mt-2 text-2xl font-bold">{data?.employee?.full_name || ui('Employee activity')}</h1><p className="mt-2 text-sm text-slate-600">{ui('Recorded sales, customers, stock and cash settlement. This report does not create or change employee activity.')}</p></header>
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{[
      ['Recorded sales today',formatXAF(summary.today)],['Recorded sales this month',formatXAF(summary.month)],['Cash awaiting clearance',formatXAF(summary.cash)],['Customers this month',summary.registered],
    ].map(([label,value]) => <div key={label} className="rounded-xl border bg-white p-4"><p className="text-xs text-slate-500">{ui(label)}</p><p className="mt-2 text-xl font-bold">{ready ? value : '-'}</p></div>)}</div>
    <nav aria-label={ui('Commercial activity report sections')} className="flex flex-wrap gap-2">{[['supplies','Daily supplies'],['stock','Vehicle stock'],['customers','Acquired customers'],['returns','Expired returns']].map(([value,label]) => <Button key={value} variant={tab===value?'default':'outline'} onClick={()=>setTab(value)}>{ui(label)}</Button>)}</nav>
    <section className="rounded-2xl border bg-white p-4 sm:p-5">{tab==='supplies' ? <CommercialDailySupplies employeeId={data?.employee?.id} today={data?.date} readOnly managing/> : tab==='stock' ? <FieldInventoryCards employeeId={data?.employee?.id} enabled={ready}/> : tab==='returns' ? <ReturnsReport employeeId={data?.employee?.id}/> : <div className="divide-y">{!(data?.customers || []).length && <p className="py-4 text-sm text-slate-500">{ui('No customer acquisition records for this employee.')}</p>}{(data?.customers || []).map(customer => <article key={customer.id} className="py-4"><h2 className="text-sm font-semibold">{customer.business_name}</h2><p className="mt-1 text-xs text-slate-500">{ui('Acquired ')}{customer.acquisition_date || ui('date not recorded')} / {customer.acquisition_verified === 'verified_unique' ? ui('Verified customer') : ui('Awaiting acquisition review')}</p></article>)}</div>}</section>
    <CommercialCashSettlement days={data?.cashDays || []} ready={ready} commercialId={data?.employee?.id} commercialName={data?.employee?.full_name} managing/>
  </div>;
}
