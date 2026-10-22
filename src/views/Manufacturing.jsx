import RecipeDeleteButton from '@/components/manufacturing/RecipeDeleteButton';

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
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/use-toast";
import { Plus, Send, CheckCircle, LayoutGrid, Table } from "lucide-react";
import ProductionBoard from "@/components/manufacturing/ProductionBoard";
import ViewToggle from "@/components/shared/ViewToggle";
import ProductionApprovalNotice from '@/components/manufacturing/ProductionApprovalNotice';

const QualityControl=dynamic(()=>import('@/views/QualityControl'),{loading:()=> <p role="status">{ui('Loading quality and batches...')}</p>});
export default function Manufacturing(){
  useInterfaceLanguage();
  const {role,allowedModules,loading}=useCurrentUser(),[params,setParams]=useSearchParams();
  const canProduce=['admin','production_manager','warehouse_manager'].includes(role)&&(!allowedModules||allowedModules.includes('manufacturing'));
  const canQuality=qualitySections(role).length>0&&(!allowedModules||allowedModules.includes('quality'));
  const sections=[...(canProduce?[['orders','Production orders'],['recipes','Recipes']]:[]),...(canQuality?[['quality','Quality & batches']]:[])];
  const section=sections.some(([key])=>key===params.get('section'))?params.get('section'):sections[0]?.[0];
  if(loading)return <p role="status">{ui('Loading manufacturing...')}</p>;
  if(!section)return <p role="alert">{ui('Your role does not have access to manufacturing.')}</p>;
  return <div className="space-y-4"><PageHeader title={ui('Manufacturing')}/><nav aria-label={ui('Manufacturing sections')} className="flex flex-wrap gap-2 border-b pb-3">{sections.map(([key,label])=><Button key={key} variant={section===key?'default':'outline'} aria-current={section===key?'page':undefined} onClick={()=>{const next=new URLSearchParams(params);next.set('section',key);setParams(next);}}>{ui(label)}</Button>)}</nav>{section==='quality'?<QualityControl embedded/>:<ManufacturingProduction section={section}/>}</div>;
}
function ManufacturingProduction({section}) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [orders, setOrders] = useState([]);
  const [recipes, setRecipes] = useState([]);
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
    try { const [o, r, p] = await Promise.all([
      readAll(erp.entities.ProductionOrder,{}),
      readAll(erp.entities.Recipe,{}),
      readAll(erp.entities.Product, { inventory_type: { $in: ['finished_product', 'assembly'] } }),
    ]);
    setOrders(o); setRecipes(r.filter(recipe=>!recipe.recipe_deleted_at)); setProducts(p);
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

  const recipeCols = [
    { key: "recipe_name", label: ui("Recipe") },
    { key: "product_name", label: ui("Product") },
    { key: "version", label: ui("Version") },
    { key: "batch_output", label: ui("Batch Output"), className: "text-right" },
    { key: "status", label: ui("Status"), render: v => <StatusBadge status={v} /> },
    {key:'actions',label:ui('Actions'),sortable:false,render:(_,recipe)=><div className="flex flex-wrap gap-2" onClick={event=>event.stopPropagation()}><Button size="sm" variant="outline" onClick={()=>navigate('/manufacturing/recipes/'+recipe.id)}>{ui(canPlan?'Edit recipe':'Open recipe')}</Button>{canPlan&&<RecipeDeleteButton recipe={recipe} onDeleted={loadData}/>}</div>},
  ];

  if (loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>;

  return (
    <div>
      <PageHeader
        title={ui(section==='recipes'?'Recipes':'Production orders')}
        actions={
          <div className="flex gap-2">
            <Button disabled={!canPlan} variant="outline" onClick={() => navigate("/manufacturing/recipes/new")}><Plus size={16} className="mr-1" />{ui(" New Recipe")}</Button>
            <Button disabled={!canPlan} onClick={() => navigate("/manufacturing/new")}><Plus size={16} className="mr-1" />{ui(" New Production Order")}</Button>
          </div>
        }
      />
      <ProductionApprovalNotice result={approvalCheck} reference={approvalCheck?.reference} onReview={()=>navigate(`/manufacturing/${approvalCheck.orderId}`)}/>
      {loadError&&<p role="alert" className="mb-4 text-sm text-red-700">{uiMessage(loadError)} <button className="underline" onClick={loadData}>{ui('Retry')}</button></p>}
      <Tabs value={section}>
        <TabsContent value="orders" className="mt-4">
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
        </TabsContent>
        <TabsContent value="recipes" className="mt-4">
          <DataTable columns={recipeCols} data={recipes} searchFields={["recipe_name", "product_name"]} onRowClick={row => navigate(`/manufacturing/recipes/${row.id}`)} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
