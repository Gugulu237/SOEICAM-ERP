import React,{useEffect,useState} from 'react';
import {Factory,Package,FlaskConical,ClipboardCheck} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {ui} from '@/lib/i18n';
import {formatNumber,formatDate} from '@/lib/formatters';
import {useNavigate} from '@/lib/router';
import {useWorkspaceAccess} from './WorkspaceAccess';
import {useMobileHomeInventory} from './useMobileHomeInventory';
import {StaffDate,StaffMetrics,StaffSection,StaffModules,StaffRow} from './StaffMobileParts';
import {isAssemblyInventoryType} from '@/lib/item-types';
import {isPackagingItem} from '@/lib/inventory-packaging';
import {readAll} from '@/lib/field-pos';
import {erp} from '@/api/erpClient';
import {businessDate} from '@/lib/business-date';

// Sleek accueil-production: assembly/month output counters, material strip and recent lots.
export default function MobileProductionHome({data,loading,preview}) {
  const {can,canOpen}=useWorkspaceAccess(),navigate=useNavigate(),date=data?.date||businessDate();
  const inventory=useMobileHomeInventory(can('inventory'),date);
  const canManufacturing=can('manufacturing');
  const [month,setMonth]=useState({orders:null,error:''});
  useEffect(()=>{if(!canManufacturing)return;let active=true;setMonth({orders:null,error:''});readAll(erp.entities.ProductionOrder,{production_date:{$gte:date.slice(0,8)+'01',$lte:date}},'-production_date').then(orders=>{if(active)setMonth({orders,error:''});}).catch(error=>{if(active)setMonth({orders:null,error:error.message});});return()=>{active=false;};},[date,canManufacturing]);
  const products=inventory.data?.products||[],materials=products.filter(p=>!isAssemblyInventoryType(p.inventory_type)&&p.inventory_type!=='service'&&p.is_active!==false);
  const monthOrders=month.orders?.filter(order=>!['cancelled','rejected'].includes(order.status));
  const recent=[...(monthOrders||data?.orders||[])].sort((a,b)=>(b.production_date||'').localeCompare(a.production_date||'')).slice(0,5);
  const actions=[{title:'Assemblies',path:'/manufacturing?section=recipes',icon:Factory},{title:'Materials',path:'/inventory?section=items&filter=ingredients',icon:Package},{title:'Quality control',path:'/manufacturing?section=quality',icon:FlaskConical},{title:'Approvals',path:'/approvals',icon:ClipboardCheck}];
  return <div data-sleek-screen="accueil-production" className="space-y-5 pb-20">
    <StaffDate date={date}/>
    <StaffMetrics ready={!loading} columns={3} metrics={[can('inventory')&&{label:'Assemblies',value:inventory.data?products.filter(p=>isAssemblyInventoryType(p.inventory_type)&&p.is_active!==false).length:'—'},can('manufacturing')&&{label:'Batches this month',value:monthOrders?monthOrders.length:'—'},can('manufacturing')&&{label:'Units produced',value:monthOrders?formatNumber(monthOrders.reduce((n,o)=>n+Number(o.actual_output||0),0)):'—'}]}/>
    {can('inventory')&&<StaffSection title="Available materials"><div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">{materials.filter(p=>(inventory.data?.stock.quantities.get(p.id)||0)>0).slice(0,12).map(p=><button type="button" key={p.id} disabled={preview} onClick={()=>navigate('/inventory?section=items&filter='+(isPackagingItem(p)?'packaging':'ingredients'))} className="w-36 shrink-0 rounded-xl border bg-white p-3 text-left"><span className="line-clamp-2 text-xs text-muted-foreground">{p.name}</span><strong className="mt-2 block text-base tabular-nums">{formatNumber(inventory.data.stock.quantities.get(p.id)||0,2)} <span className="text-xs font-normal">{p.storage_unit}</span></strong></button>)}</div>{inventory.loading&&<p className="text-xs text-muted-foreground">{ui('Loading inventory...')}</p>}{inventory.error&&<p role="alert" className="text-xs text-red-700">{ui(inventory.error)}</p>}</StaffSection>}
    {can('manufacturing')&&<StaffSection title="Recent batches"><div className="space-y-2">{recent.map(order=><StaffRow key={order.id} title={order.product_name||order.order_number} detail={[order.batch_number||order.order_number,formatDate(order.production_date)].filter(Boolean).join(' · ')} value={ui(order.status?.replaceAll('_',' ')||'')} disabled={preview} onClick={()=>navigate('/manufacturing/'+order.id)}><span className="mt-2 block text-xs text-muted-foreground">{ui('Recorded output')}: {order.actual_output??'—'} · {ui('Planned')}: {order.planned_output??'—'}</span></StaffRow>)}{!loading&&!recent.length&&<p className="text-sm text-muted-foreground">{ui('No batches in this view.')}</p>}{month.error&&<p role="alert" className="text-xs text-red-700">{ui(month.error)}</p>}</div></StaffSection>}
    <StaffSection title="Modules"><StaffModules actions={actions} preview={preview}/></StaffSection>
    {canOpen('/manufacturing?section=build')&&<div data-mobile-action-bar className="fixed bottom-[calc(64px_+_env(safe-area-inset-bottom))] inset-x-0 z-30 border-t bg-white px-4 py-3"><Button disabled={preview} onClick={()=>navigate('/manufacturing?section=build')} className="min-h-12 w-full gap-2"><Factory size={18}/>{ui('Record production')}</Button></div>}
  </div>;
}
