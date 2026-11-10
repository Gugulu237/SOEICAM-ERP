import {usePhoneLayout} from '@/hooks/usePhoneLayout';
import MobileAssemblyCatalogue from '@/components/manufacturing/MobileAssemblyCatalogue';
import {manufacturingSection} from '@/lib/manufacturing-workspace';

/* localized-interface */
import dynamic from 'next/dynamic';
import { qualitySections } from '@/lib/quality-workspace';
import { ui,uiMessage } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useState, useEffect } from "react";
import { erp } from "@/api/erpClient";
import { useNavigate,useSearchParams } from "@/lib/router";
import { formatXAF, formatDate } from "@/lib/formatters";
import { readAll } from "@/lib/field-pos";
import { invokeFieldOps } from "@/lib/field-ops";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import PageHeader from "@/components/shared/PageHeader";
import DataTable from "@/components/shared/DataTable";
import StatusBadge from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { Send, CheckCircle, LayoutGrid, Table } from "lucide-react";
import ProductionBoard from "@/components/manufacturing/ProductionBoard";
import ViewToggle from "@/components/shared/ViewToggle";
import ProductionApprovalNotice from '@/components/manufacturing/ProductionApprovalNotice';

const AssemblyBuildPanel=dynamic(()=>import('@/components/manufacturing/AssemblyBuildPanel'),{loading:()=> <p role="status">{ui('Loading assembly builds...')}</p>});
const QualityControl=dynamic(()=>import('@/views/QualityControl'),{loading:()=> <p role="status">{ui('Loading quality and batches...')}</p>});
export default function Manufacturing(){
  useInterfaceLanguage();
  const phone=usePhoneLayout();
  const {role,allowedModules,loading,user,employee}=useCurrentUser(),[params,setParams]=useSearchParams();
  const canProduce=['admin','production_manager','warehouse_manager'].includes(role)&&(!allowedModules||allowedModules.includes('manufacturing'));
  const permittedQuality=qualitySections(role),canQuality=permittedQuality.length>0&&(!allowedModules||allowedModules.includes('quality'));
  const sections=[...(canProduce?[['assemblies','Assemblies'],['build','Build assemblies']]:[]),...(canQuality?[['batches','Batches & expiry']]:[])];
  const requested=manufacturingSection(params.get('section'));
  const section=canProduce&&requested==='history'?'history':sections.some(([key])=>key===requested)?requested:sections[0]?.[0];
  useEffect(()=>{if(!['recipes','orders'].includes(params.get('section')))return;const next=new URLSearchParams(params);next.set('section',manufacturingSection(params.get('section')));setParams(next,{replace:true});},[params,setParams]);
  if(loading)return <p role="status">{ui('Loading manufacturing...')}</p>;
  if(!section)return <p role="alert">{ui('Your role does not have access to manufacturing.')}</p>;
  const choose=(key,quality)=>{const next=new URLSearchParams(params);next.set('section',key);next.delete('assembly');next.delete('product');next.delete('batch');if(quality)next.set('quality',quality);else next.delete('quality');setParams(next);};
  const tools=canProduce||canQuality&&permittedQuality.some(item=>['release','inspections'].includes(item.key));
  return <div className="space-y-4">
    <nav aria-label={ui('Manufacturing sections')} className={phone?'grid gap-2 '+(sections.length===1?'grid-cols-1':sections.length===2?'grid-cols-2':'grid-cols-3'):'flex flex-wrap gap-2 border-b pb-3'}>{sections.map(([key,label])=><Button key={key} className="h-auto min-h-12 min-w-0 whitespace-normal px-2 text-xs sm:px-4 sm:text-sm" variant={section===key?'default':'outline'} aria-current={section===key?'page':undefined} onClick={()=>choose(key,key==='batches'?(permittedQuality.some(item=>item.key==='traceability')?'traceability':'expiry'):undefined)}>{ui(label)}</Button>)}</nav>
    <div className="relative">{tools&&<details className="absolute right-0 top-0 z-10"><summary className="flex min-h-11 cursor-pointer list-none items-center rounded-full border bg-white px-4 text-xs font-semibold text-primary">{ui('Tools')}</summary><nav aria-label={ui('Manufacturing tools')} className="absolute right-0 mt-2 grid w-60 gap-2 rounded-[22px] border bg-white p-3 shadow-lg">{canProduce&&<Button variant="outline" onClick={()=>choose('history')}>{ui('Production history')}</Button>}{canQuality&&permittedQuality.some(item=>['release','inspections'].includes(item.key))&&<Button variant="outline" onClick={()=>choose('batches',permittedQuality.find(item=>['release','inspections'].includes(item.key)).key)}>{ui('Quality controls')}</Button>}</nav></details>}
      {section==='build'?<AssemblyBuildPanel mobile={phone} initialProductId={params.get('product')||''} responsible={employee?.full_name||user?.full_name}/>:section==='batches'?<QualityControl embedded tracking defaultSection="traceability"/>:section==='assemblies'?<MobileAssemblyCatalogue canPlan={['admin','production_manager'].includes(role)}/>:<div className="pt-14"><ManufacturingProduction/></div>}
    </div>
  </div>;
}
function ManufacturingProduction() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [view, setView] = useState("board");
  const [loading, setLoading] = useState(true);
  const [loadError,setLoadError]=useState('');
  const [approvingId,setApprovingId]=useState(null);
  const [approvalCheck,setApprovalCheck]=useState(null);
  const navigate = useNavigate();
  const { role, canApproveProduction } = useCurrentUser();
  const { toast } = useToast();
  const canPlan = ['admin','production_manager'].includes(role);

  async function loadData() {
    setLoading(true);
    setLoadError('');
    try { const [o, p] = await Promise.all([
      readAll(erp.entities.ProductionOrder,{}),
      readAll(erp.entities.Product, { inventory_type: { $in: ['finished_product', 'assembly'] } }),
    ]);
    setOrders(o); setProducts(p);
    }catch(error){setLoadError(error.message);}finally{setLoading(false);}
  }

  useEffect(() => { loadData(); }, []);

  async function handleApprove(order) {
    if (approvingId) return;
    setApprovingId(order.id);setApprovalCheck(null);
    try {
      const {data}=await invokeFieldOps({action:'approveProductionOrder',orderId:order.id});
      if(data.blocked){setApprovalCheck({...data,orderId:order.id,reference:order.order_number});return;}
      toast({ title: ui("Approved"), description: ui("Warehouse can now issue materials") });
      await loadData();
    } catch (e) { toast({ title: ui("Error"), description: e.message, variant: "destructive" }); }
    finally {setApprovingId(null);}
  }

  const orderCols = [
    { key: "order_number", label: ui("Order #") },
    { key: "product_name", label: ui("Product") },
    { key: "production_date", label: ui("Date"), render: v => formatDate(v) },
    { key: "planned_output", label: ui("Planned"), className: "text-right" },
    { key: "actual_output", label: ui("Actual"), className: "text-right" },
    { key: "actual_cost_per_unit", label: ui("Cost/Unit"), render: v => formatXAF(v), className: "text-right" },
    { key: "status", label: ui("Status"), render: v => <StatusBadge status={v} /> },
    { key: "actions", label: "", sortable: false, className: "text-right", render: (_, row) => (
      <div className="flex justify-end gap-1" onClick={e => e.stopPropagation()}>
        {row.status === "draft" && canPlan && <Button size="sm" variant="outline" onClick={() => navigate(`/manufacturing/${row.id}`)}><Send size={14} className="mr-1" />{ui(" Review & submit")}</Button>}
        {row.status === "awaiting_approval" && canApproveProduction && <Button size="sm" disabled={!!approvingId} onClick={() => handleApprove(row)}><CheckCircle size={14} className="mr-1" />{approvingId===row.id?ui('Checking materials...'):ui(" Approve")}</Button>}
      </div>
    )},
  ];

  if (loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-primary rounded-full animate-spin" /></div>;

  return (
    <div>
      <PageHeader title={ui('Production history')} actions={<Button disabled={!canPlan} onClick={()=>navigate('/manufacturing?section=build')}>{ui('Build assemblies')}</Button>}/>
      <ProductionApprovalNotice result={approvalCheck} reference={approvalCheck?.reference} onReview={()=>navigate(`/manufacturing/${approvalCheck.orderId}`)}/>
      {loadError&&<p role="alert" className="mb-4 text-sm text-red-700">{uiMessage(loadError)} <button className="underline" onClick={loadData}>{ui('Retry')}</button></p>}
      <div className="mt-4">
          <div className="flex justify-end mb-3">
            <ViewToggle
              value={view}
              onChange={setView}
              options={[
                { value: "board", label: "Board View", icon: LayoutGrid },
                { value: "table", label: "Table View", icon: Table },
              ]}
            />
          </div>
          {view === "board"
            ? <ProductionBoard orders={orders} products={products} />
            : <DataTable columns={orderCols} data={orders} searchFields={["order_number", "product_name"]} onRowClick={row => navigate(`/manufacturing/${row.id}`)} />}
      </div>
    </div>
  );
}
