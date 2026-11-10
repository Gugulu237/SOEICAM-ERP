import React,{useEffect,useState} from 'react';
import {BookOpen,Receipt,Truck,Wallet,Package,BarChart3} from 'lucide-react';
import {ui} from '@/lib/i18n';
import {formatXAF} from '@/lib/formatters';
import {businessDate} from '@/lib/business-date';
import {useNavigate} from '@/lib/router';
import {useWorkspaceAccess} from './WorkspaceAccess';
import {useMobileHomeInventory} from './useMobileHomeInventory';
import {loadMobileAccountingSummary} from '@/components/accounting/loadMobileAccountingSummary';
import {StaffDate,StaffMetrics,StaffSection,StaffModules,StaffRow} from './StaffMobileParts';

// Sleek accueil-comptable: actual company figures, six core modules and pending work.
export default function MobileAccountantHome({data,loading,preview,cards=[]}) {
  const {can}=useWorkspaceAccess(),navigate=useNavigate(),date=data?.date||businessDate(),canAccounting=can('accounting');
  const inventory=useMobileHomeInventory(can('inventory'),date),[finance,setFinance]=useState({data:null,error:''});
  useEffect(()=>{if(!canAccounting)return;let active=true;setFinance({data:null,error:''});loadMobileAccountingSummary({date,monthStart:date.slice(0,8)+'01'}).then(value=>{if(active)setFinance({data:value,error:''});}).catch(error=>{if(active)setFinance({data:null,error:error.message});});return()=>{active=false;};},[date,canAccounting]);
  const money=value=>value==null?'—':formatXAF(value);
  const tasks=[...(data?.expenses||[]).map(row=>({id:'expense:'+row.id,title:row.title||row.request_number,detail:ui(row.status?.replaceAll('_',' ')||''),value:formatXAF(row.amount),path:'/expenses'})),...(data?.materialIssueOrders||[]).map(row=>({id:'production:'+row.id,title:row.product_name||row.order_number,detail:row.batch_number||row.order_number,value:ui('Materials awaiting issue'),path:'/manufacturing/'+row.id})),...(data?.riskLots||[]).map(row=>({id:'risk:'+row.id,title:row.product_name,detail:[row.batch_number,row.expiry_date].filter(Boolean).join(' · '),value:row.quantity,path:'/inventory?section=alerts'}))];
  const actions=[{title:'Journals',path:'/accounting?tab=journals',icon:BookOpen},{title:'Expenses',path:'/expenses',icon:Receipt},{title:'Suppliers',path:'/purchases?section=suppliers',icon:Truck},{title:'Payroll',path:'/team-workspaces?section=payroll',icon:Wallet},{title:'Inventory',path:'/inventory',icon:Package},{title:'Financial reports',path:'/accounting/statements',icon:BarChart3}];
  const core=new Set(actions.map(action=>action.path.split('?')[0]));
  return <div data-sleek-screen="accueil-comptable" className="space-y-5">
    <StaffDate date={date}/>
    <StaffMetrics ready={!loading} metrics={[can('inventory')&&{label:'Stock value',value:money(inventory.data?.stock.totalValue)},canAccounting&&{label:'Net profit this month',value:money(finance.data?.netProfit),positive:true},canAccounting&&{label:'Supplier payables',value:money(finance.data?.payables)},canAccounting&&{label:'Customer receivables',value:money(finance.data?.receivables)}]}/>
    {(finance.error||inventory.error)&&<p role="alert" className="rounded-xl border border-red-200 bg-white p-3 text-xs text-red-700">{ui(finance.error||inventory.error)}</p>}
    <StaffSection title="Modules"><StaffModules actions={actions} preview={preview}/></StaffSection>
    <StaffSection title="Pending tasks" action={<span className="text-xs font-bold text-muted-foreground">{tasks.length}</span>}><div className="space-y-2">{tasks.slice(0,8).map(task=><StaffRow key={task.id} {...task} disabled={preview} onClick={()=>navigate(task.path)}/>)}{!loading&&!tasks.length&&<p className="text-sm text-muted-foreground">{ui('No pending tasks.')}</p>}</div></StaffSection>
    <StaffSection title="Other tools"><StaffModules actions={cards.filter(action=>!core.has(action.path.split('?')[0]))} preview={preview}/></StaffSection>
  </div>;
}
