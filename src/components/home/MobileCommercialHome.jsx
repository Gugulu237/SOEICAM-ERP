import React from 'react';
import { ShoppingBag, UserPlus, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ui } from '@/lib/i18n';
import { formatXAF,formatDate } from '@/lib/formatters';
import { commercialSnapshot } from '@/lib/employee-dashboard';
import { StaffDate,StaffMetrics,StaffSection,StaffModules,StaffRow } from './StaffMobileParts';

// Sleek accueil-commercial: action pair, personal figures, acquired clients and activity.
export default function MobileCommercialHome({data,ready,preview,canRecordSale,canCustomers,openSale,setTab,menuTabs,onModuleSelect}) {
  const summary=commercialSnapshot(data),customers=data?.customers||[],activity=[...(data?.sales||[])].sort((a,b)=>(b.transaction_date||b.created_date||'').localeCompare(a.transaction_date||a.created_date||'')).slice(0,5);
  return <div data-sleek-screen="accueil-commercial" className="space-y-5">
    <StaffDate date={data?.date}/>
    <p className="flex items-center gap-2 rounded-lg border border-l-4 border-l-primary bg-white px-3 py-2 text-xs font-semibold text-primary"><Users size={16}/>{ui('Your sales and customers only')}</p>
    <div className="space-y-2"><Button className="min-h-14 w-full gap-2" disabled={preview||!canRecordSale} onClick={()=>openSale()}><ShoppingBag size={20}/>{ui('Record sale')}</Button>{canCustomers&&<Button variant="outline" className="min-h-12 w-full gap-2" disabled={preview||!canRecordSale} onClick={()=>setTab('new-customer')}><UserPlus size={19}/>{ui('New customer')}</Button>}</div>
    <StaffMetrics grouped ready={ready} metrics={[{label:'My sales today',prominent:true,value:formatXAF(summary.today)},{label:'Sales this month',prominent:true,value:formatXAF(summary.month)},{label:'Customers acquired this month',value:summary.registered},{label:'Estimated commission',value:summary.commission.configured?formatXAF(summary.commission.estimate):ui('Not configured'),positive:true,note:'Subject to monthly review'}]}/>
    {canCustomers&&<StaffSection title="My acquired customers" action={<button className="min-h-12 text-xs font-semibold text-primary" onClick={()=>setTab('customers')}>{ui('View all')} · {customers.length}</button>}><div className="space-y-2">{customers.slice(0,3).map(customer=><StaffRow key={customer.id} title={customer.business_name||customer.customer_name||customer.name} detail={[customer.zone_name,customer.neighborhood,customer.town].filter(Boolean).join(' · ')} onClick={()=>setTab('customers')}/>)}{ready&&!customers.length&&<p className="text-sm text-muted-foreground">{ui('No customers registered yet.')}</p>}</div></StaffSection>}
    <StaffSection title="Recent activity"><div className="divide-y overflow-hidden rounded-[22px] border bg-white">{activity.map(sale=><StaffRow framed={false} key={sale.id} title={sale.customer_name||sale.sale_number} detail={[sale.sale_number,formatDate(sale.transaction_date),ui(sale.status?.replaceAll('_',' ')||'')].filter(Boolean).join(' · ')} value={formatXAF(sale.total)} onClick={()=>setTab('supplies')}/>)}{ready&&!activity.length&&<p className="p-4 text-sm text-muted-foreground">{ui('No sales recorded yet.')}</p>}</div></StaffSection>
    <details className="rounded-[22px] border bg-white p-3"><summary className="flex min-h-12 cursor-pointer items-center text-sm font-semibold">{ui('Modules')}</summary><StaffModules preview={preview} onSelect={onModuleSelect} actions={menuTabs.filter(([key])=>!['new-sale','new-customer'].includes(key)&&(!['customers'].includes(key)||canCustomers)).map(([key,title,icon])=>({key,title,icon,disabled:key==='degustation'&&!canRecordSale}))}/></details>
  </div>;
}
