import {itemUnitCost} from '@/lib/item-units';

/* localized-interface */
import { ui, uiMessage } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import { invokeFieldOps } from '@/lib/field-ops';
import { businessDate } from '@/lib/business-date';
import FermentationTimer from "@/components/manufacturing/FermentationTimer";
import React, { useState, useEffect } from "react";
import { erp } from "@/api/erpClient";
import { useBack, useNavigate, useParams, useSearchParams } from "@/lib/router";
import PageHeader from "@/components/shared/PageHeader";
import StatusBadge from "@/components/shared/StatusBadge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { productionColdRoom, isColdRoom } from '@/lib/finished-product-storage';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { formatXAF, formatNumber } from "@/lib/formatters";
import { Save, ArrowLeft, CheckCircle, Play, PackageCheck, Send, ClipboardCheck, ShoppingCart } from "lucide-react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import ProductionPurchaseRequest from '@/components/manufacturing/ProductionPurchaseRequest';
import { readAll } from '@/lib/field-pos';
import { stockUnit, unitFactor } from '@/lib/item-units';
import { productionHandoff, MATERIAL_WAREHOUSE_TYPES } from '@/lib/production-handoff';
import { isYogurt } from '@/lib/yogurt-production';
import YogurtProductionForm from '@/components/manufacturing/YogurtProductionForm';

export default function ProductionOrderForm() {
  const {id}=useParams(),[params]=useSearchParams();
  const [loaded,setLoaded]=useState(null),[error,setError]=useState('');
  useEffect(()=>{let active=true;setLoaded(null);setError('');if(id)erp.entities.ProductionOrder.get(id).then(row=>{if(active){if(!row)throw Error('Production order not found.');setLoaded(row);}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[id]);
  if(error)return <p role="alert">{error}</p>;
  if(id&&loaded?.id!==id)return <p role="status">{ui('Loading production order…')}</p>;
  if(id&&isYogurt(loaded) || !id&&!params.get('product')&&params.get('mode')!=='assembly')return <YogurtProductionForm key={id || 'new'} initialOrder={id?loaded:null}/>;
  return <LegacyProductionOrderForm key={id || params.get('product') || 'new'} initialOrder={id?loaded:null}/>;
}

function LegacyProductionOrderForm({initialOrder=null}) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;
  const [,tickTimer]=useState(0);
  useEffect(()=>{const timer=setInterval(()=>tickTimer(v=>v+1),30000);return()=>clearInterval(timer);},[]);

  const { id } = useParams();
  const navigate = useNavigate(), goBack = useBack('/manufacturing');
  const { toast } = useToast();
  const { role, canApproveProduction, canIssueMaterials } = useCurrentUser();
  const isEdit = !!id;
  const [params]=useSearchParams(),selectedProduct=params.get('product');
  const [catalogueLoaded,setCatalogueLoaded]=useState(false),[catalogueError,setCatalogueError]=useState('');
  const [completion,setCompletion]=useState(null);
  const canPlan = ['admin','production_manager'].includes(role);
  const [requestKey] = useState(() => crypto.randomUUID());

  const [recipes, setRecipes] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const coldRooms=warehouses.filter(isColdRoom);
  const [form, setForm] = useState({
    recipe_id: initialOrder?.recipe_id || "", planned_output: initialOrder?.planned_output || 0, production_date: initialOrder?.production_date || businessDate(), expiry_date: initialOrder?.expiry_date || "", warehouse_id: initialOrder?.warehouse_id || "", material_warehouses: initialOrder?.material_warehouses || {}, notes: initialOrder?.notes || ""
  });
  const [materials, setMaterials] = useState([]);
  const [order, setOrder] = useState(initialOrder);
  const [saving, setSaving] = useState(false);
  const [availability, setAvailability] = useState(null);
  const [checking, setChecking] = useState(false);
  const [purchaseDraft, setPurchaseDraft] = useState(null);
  const [auditSent, setAuditSent] = useState(false);
  const [checkError,setCheckError]=useState('');
  const canCheck = !isEdit || ['draft','awaiting_approval','approved'].includes(order?.status);
  const materialContext = isEdit && order?.status !== 'draft' ? {orderId:id,sourceWarehouses:form.material_warehouses} : {orderId:id || undefined,plan:form};

  useEffect(() => {
    setAuditSent(false);setPurchaseDraft(null);
    if (!form.recipe_id || !(Number(form.planned_output)>0) || !canCheck) {setAvailability(null);setChecking(false);return;}
    let active=true;setChecking(true);setCheckError('');setAvailability(null);
    const timer=setTimeout(()=>invokeFieldOps({action:'checkProductionMaterials',...materialContext})
      .then(({data})=>{if(active)setAvailability(data);})
      .catch(e=>{if(active)setCheckError(e.message);})
      .finally(()=>{if(active)setChecking(false);}),350);
    return ()=>{active=false;clearTimeout(timer);};
  },[id,form.recipe_id,form.planned_output,form.warehouse_id,form.material_warehouses,canCheck,order?.status]);

  async function refreshMaterials() {
    setChecking(true);setCheckError('');
    try {
      if(isEdit && order?.status!=='draft') {
        const latest=await erp.entities.ProductionOrder.get(id);
        if(latest.status!==order.status){await loadOrder();return;}
      }
      const {data}=await invokeFieldOps({action:'checkProductionMaterials',...materialContext});setAvailability(data);
    }
    catch(e){setCheckError(e.message);} finally{setChecking(false);}
  }
  useEffect(()=>{
    if(!canCheck || !form.recipe_id || !(Number(form.planned_output)>0) || typeof window==='undefined')return;
    const refresh=()=>{if(document.visibilityState==='visible' && !saving && !purchaseDraft)refreshMaterials();};
    const timer=window.setInterval(refresh,30000);
    window.addEventListener('focus',refresh);
    return ()=>{window.clearInterval(timer);window.removeEventListener('focus',refresh);};
  },[id,canCheck,form.recipe_id,form.planned_output,form.warehouse_id,form.material_warehouses,order?.status,saving,purchaseDraft]);
  async function preparePurchase() {
    setSaving(true);
    try {const {data}=await invokeFieldOps({action:'productionPurchaseOptions',...materialContext});setPurchaseDraft(data);}
    catch(e){toast({title:ui('Unable to prepare purchase'),description:e.message,variant:'destructive'});} finally{setSaving(false);}
  }

  async function requestAudit() {
    setSaving(true);
    try {
      const { data } = await invokeFieldOps({ action: 'requestProductionAudit', ...materialContext, materialIds: availability.shortages.map(row => row.material_id) });
      setAuditSent(true);
      toast({ title: ui("Inventory count requested"), description: ui("{0} missing materials flagged in Inventory alerts.", data.requested) });
    } catch (e) { toast({ title: ui("Audit request failed"), description: e.message, variant: 'destructive' }); }
    finally { setSaving(false); }
  }

  useEffect(() => {
    Promise.all([
      readAll(erp.entities.Recipe,{ status: "approved" }),
      readAll(erp.entities.Warehouse,{ is_active: true }),
    ]).then(([r, w]) => { setRecipes(r.filter(recipe=>!isYogurt(recipe))); setWarehouses(w);setCatalogueLoaded(true);
      if(!isEdit && selectedProduct){const yogurt=r.filter(isYogurt).filter(recipe=>recipe.yogurt_config.outputs.some(o=>o.product_id===selectedProduct)).sort((a,b)=>Number(b.version)-Number(a.version))[0];if(yogurt){navigate('/manufacturing/new?recipe='+yogurt.id);return;}const recipe=r.filter(x=>!isYogurt(x)&&x.product_id===selectedProduct).sort((a,b)=>Number(b.version)-Number(a.version))[0];if(recipe)setForm(f=>({...f,recipe_id:recipe.id,product_id:recipe.product_id}));}
    }).catch(e=>setCatalogueError(e.message));
    if (isEdit) loadOrder(initialOrder);
  }, [id,selectedProduct]);

  async function loadOrder(knownOrder=null) {
    const o = knownOrder || await erp.entities.ProductionOrder.get(id);
    setOrder(o);
    setForm({ recipe_id: o.recipe_id, planned_output: o.planned_output, production_date: o.production_date, expiry_date: o.expiry_date || "", warehouse_id: o.warehouse_id || "", material_warehouses: o.material_warehouses || {}, notes: o.notes || "" });
    const mats = await readAll(erp.entities.ProductionMaterial,{ production_order_id: id });
    setMaterials(mats);
  }

  async function calculateMaterials(recipeId, plannedOutput) {
    if (!recipeId || !plannedOutput) return;
    const recipe = recipes.find(r => r.id === recipeId);
    if (!recipe) return;
    const recipeLines = await readAll(erp.entities.RecipeLine,{ recipe_id: recipeId });
    const scaleFactor = Number(plannedOutput) / recipe.batch_output;
    const products = await Promise.all(recipeLines.map(rl => erp.entities.Product.get(rl.material_id)));
    const calc = recipeLines.map((rl, index) => {
      const prod = products[index], unit = prod ? stockUnit(prod) : rl.unit;
      return { material_id: rl.material_id, material_name: prod?.name || rl.material_name,
        standard_quantity: Math.round(rl.quantity * scaleFactor * unitFactor(rl.unit || unit, unit) * 1000) / 1000,
        unit, unit_cost: prod?itemUnitCost(prod):0 };
    });
    setMaterials(calc);
  }

  async function handleRecipeChange(recipeId) {
    setForm(f => ({ ...f, recipe_id: recipeId }));
    const recipe = recipes.find(r => r.id === recipeId);
    if (recipe) setForm(f => ({ ...f, product_id: recipe.product_id }));
    await calculateMaterials(recipeId, form.planned_output);
  }

  async function handleOutputChange(val) {
    const num = Number(val);
    setForm(f => ({ ...f, planned_output: num }));
    await calculateMaterials(form.recipe_id, num);
  }

  const standardCost = materials.reduce((s, m) => s + (m.standard_quantity || 0) * (m.unit_cost || 0), 0);
  const costPerUnit = form.planned_output > 0 ? standardCost / form.planned_output : 0;

  async function handleSave(submitStatus = "draft") {
    if (!form.recipe_id || form.planned_output <= 0) {
      toast({ title: ui("Error"), description: ui("Select a recipe and enter planned output"), variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const { data } = await invokeFieldOps({ action: 'saveProductionPlan', requestKey, orderId: id || undefined, status: submitStatus, plan: form });
      if (data.blocked) {
        setAvailability(data);
        setPurchaseDraft(null);
        toast({ title: ui("Insufficient raw materials"), description: ui("Review the missing assembly components below before submitting."), variant: 'destructive' });
        return;
      }

      toast({ title: submitStatus === "awaiting_approval" ? "Submitted" : "Saved", description: submitStatus === "awaiting_approval" ? (data.order?.status==='approved' ? ui("Production order submitted to Warehouse") : ui("Production order submitted for GM approval")) : ui("Production order saved as draft") });
      navigate("/manufacturing");
    } catch (e) {
      toast({ title: ui("Error"), description: e.message, variant: "destructive" });
    }
    finally { setSaving(false); }
  }

  async function handleApprove() {
    if (saving) return;
    setSaving(true);
    try {
      const {data}=await invokeFieldOps({action:'approveProductionOrder',orderId:id,sourceWarehouses:form.material_warehouses});
      if (data.blocked) {
        setAvailability(data);setPurchaseDraft(null);
        toast({title:role==='production_manager'?ui('Production submission blocked'):ui('Production approval blocked'),description:ui('Required materials must be available in the selected warehouses before continuing.'),variant:'destructive'});
        return;
      }
      toast({ title: role==='production_manager'?ui("Submitted"):ui("Approved"), description: role==='production_manager'?ui("Production order submitted to Warehouse"):ui("Production order approved - warehouse can now issue materials") });
      await loadOrder();
    } catch (e) { toast({ title: ui("Error"), description: e.message, variant: "destructive" }); }
    finally {setSaving(false);}
  }

  async function handleIssueMaterials() {
    if (saving) return;
    setSaving(true);
    try {
      const {data}=await invokeFieldOps({action:'issueProductionMaterials',orderId:id,sourceWarehouses:form.material_warehouses});
      if (data.blocked) {setAvailability(data);setPurchaseDraft(null);toast({title:ui('Insufficient raw materials'),description:ui('Review the missing materials below and send a purchase request.'),variant:'destructive'});return;}
      toast({title:ui('Materials issued'),description:ui('All material quantities and stock movements were recorded together.')});
      await loadOrder();
    } catch(e) {toast({title:ui('Materials not issued'),description:e.message,variant:'destructive'});await refreshMaterials();}
    finally {setSaving(false);}
  }

  async function handleStartFermentation() {
    if(saving)return;setSaving(true);
    try {const {data}=await invokeFieldOps({action:'startFermentation',orderId:id});setOrder(data.order);toast({title:ui('Fermentation started'),description:ui('Eight-hour timer started. Production staff receive reminders 30 minutes before completion and when the timer finishes.')});}
    catch(e){toast({title:ui('Fermentation could not start'),description:e.message,variant:'destructive'});}
    finally{setSaving(false);}
  }
  function openCompletion() {
    setCompletion({quantity:String(order?.planned_output || ''),warehouseId:coldRooms.length===1?coldRooms[0].id:''});
  }
  async function handleComplete() {
    if(saving)return;
    try{productionColdRoom(warehouses,completion?.warehouseId);if(!(Number(completion?.quantity)>0))throw Error(ui('Enter a positive actual output quantity'));}
    catch(e){toast({title:ui('Production not completed'),description:e.message,variant:'destructive'});return;}
    setSaving(true);
    try {
      const {data}=await invokeFieldOps({action:'completeProduction',orderId:id,quantity:Number(completion.quantity),warehouseId:completion.warehouseId});
      toast({title:ui('Production completed'),description:ui('Finished output is stored in Cold Room and held until quality release.')});
      setOrder(data.order);setCompletion(null);await loadOrder();
    } catch(e){toast({title:ui('Production not completed'),description:e.message,variant:'destructive'});}
    finally{setSaving(false);}
  }

  return (
    <div>
      <PageHeader
        title={isEdit ? ui("Production Order {0}", order?.order_number || "") : ui("New Production Order")}
        subtitle={isEdit && order ? <StatusBadge status={order.status} /> : null}
        actions={
          <div className="flex gap-2">
            {isEdit && order?.status === "awaiting_approval" && (role==='production_manager' || role==='admin' && canApproveProduction) && <Button variant="outline" disabled={saving || checking} onClick={handleApprove}><CheckCircle size={16} className="mr-1" />{saving?ui('Checking materials...'):(role==='production_manager'?ui('Submit production order'):ui(" Approve"))}</Button>}
            {isEdit && order?.status === "approved" && ['admin','warehouse_manager'].includes(role) && canIssueMaterials && <Button variant="outline" disabled={saving || checking} onClick={handleIssueMaterials}><Play size={16} className="mr-1" />{ui(" Issue Materials")}</Button>}
            {isEdit && (order?.status==='materials_issued' || order?.status==='in_production' && !order?.fermentation_started_at) && ['admin','production_manager'].includes(role) && <Button disabled={saving} onClick={handleStartFermentation}><Play size={16} className="mr-1"/>{ui('Start fermentation')}</Button>}
            {isEdit && order?.status==='in_production' && order?.fermentation_started_at && ["admin","production_manager"].includes(role) && <Button disabled={saving || Date.parse(order.fermentation_due_at)>Date.now()} onClick={openCompletion}><PackageCheck size={16} className="mr-1" />{ui(" Complete Production")}</Button>}
            <Button variant="outline" onClick={goBack}><ArrowLeft size={16} className="mr-1" />{ui(" Back")}</Button>
          </div>
        }
      />
      <FermentationTimer order={order}/>
      {catalogueError && <p role="alert" className="mb-4 text-red-700">{uiMessage(catalogueError)}</p>}
      {!isEdit && catalogueLoaded && canPlan && (!recipes.length || selectedProduct && !recipes.some(r=>r.product_id===selectedProduct)) && <div className="mb-4 rounded-xl border bg-slate-50 p-4"><p className="text-sm">{ui('This assembly needs an approved production recipe before it can be built.')}</p><Button className="mt-2" variant="outline" onClick={()=>navigate('/manufacturing/recipes/new'+(selectedProduct?'?product='+encodeURIComponent(selectedProduct):''))}>{ui('Set up recipe / BOM')}</Button></div>}
      {order?.output_warehouse_name && <p className="mb-4 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm">{ui('Finished output storage')}: <strong>{order.output_warehouse_name}</strong></p>}
      {completion && <Dialog open onOpenChange={open=>{if(!open && !saving)setCompletion(null);}}><DialogContent><DialogHeader><DialogTitle>{ui('Complete production into Cold Room')}</DialogTitle></DialogHeader><div><Label htmlFor="completed-quantity">{ui('Actual acceptable output quantity')}</Label><Input id="completed-quantity" type="number" min="0.001" step="0.001" value={completion.quantity} onChange={e=>setCompletion(f=>({...f,quantity:e.target.value}))}/></div><div><Label htmlFor="completed-warehouse">{ui('Cold Room destination')}</Label><select id="completed-warehouse" className="mt-1 h-10 w-full rounded-md border bg-white px-3" value={completion.warehouseId} onChange={e=>setCompletion(f=>({...f,warehouseId:e.target.value}))}><option value="">{ui('Select Cold Room')}</option>{coldRooms.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></div><p className="text-sm text-slate-600">{ui('Finished output is stored in Cold Room and held until quality release.')}</p>{!coldRooms.length && <p role="alert" className="text-sm text-red-700">{ui('Create an active Cold Room warehouse before completing production.')}</p>}<DialogFooter><Button variant="outline" disabled={saving} onClick={()=>setCompletion(null)}>{ui('Cancel')}</Button><Button disabled={saving || !completion.warehouseId || !(Number(completion.quantity)>0)} onClick={handleComplete}>{saving?ui('Saving...'):ui('Receive into Cold Room')}</Button></DialogFooter></DialogContent></Dialog>}
      {role==='production_manager' && <p className="mb-4 rounded-xl border border-sky-100 bg-sky-50 p-4 text-sm text-sky-900">{ui('View available warehouse materials and submit your production order directly to Warehouse. Warehouse Management issues the materials.')}</p>}
      {productionHandoff(order?.status) && <div className="mb-4 rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm"><strong>{ui('Next responsible team')}: {ui(productionHandoff(order.status).owner)}</strong><p className="mt-1 text-blue-900">{ui(productionHandoff(order.status).task)}</p></div>}
      <div className="bg-white rounded-xl border border-slate-200 p-6 max-w-5xl">
        <div className="mb-5 rounded-xl border border-violet-200 bg-violet-50 p-4"><div className="flex flex-wrap justify-between gap-3"><div><p className="text-xs font-semibold text-violet-700">{ui("Production batch")}</p><p className="mt-1 font-mono text-lg font-bold">{order?.batch_number || ui("Assigned automatically when saved")}</p></div><div><p className="text-xs text-violet-700">{ui("Expiry date")}</p><p className="mt-1 font-semibold">{order?.expiry_date || ui("Calculated from production date and product shelf life")}</p></div></div>{order?.batch_number && <button type="button" className="mt-3 text-sm font-medium text-violet-800 underline" onClick={() => navigate('/quality?section=traceability&batch=' + encodeURIComponent(order.batch_number) + '&product=' + encodeURIComponent(order.product_id))}>{ui("Trace batch and customer supplies")}</button>}</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <div>
            <Label>{ui("Recipe *")}</Label>
            <Select value={form.recipe_id} disabled={!canPlan || (isEdit && order?.status !== 'draft')} onValueChange={handleRecipeChange}>
              <SelectTrigger><SelectValue placeholder={ui("Select approved recipe")} /></SelectTrigger>
              <SelectContent>{recipes.map(r => <SelectItem key={r.id} value={r.id}>{r.recipe_name}{ui(" (v")}{r.version})</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>{ui("Planned Output *")}</Label>
            <Input type="number" value={form.planned_output} disabled={!canPlan || (isEdit && order?.status !== 'draft')} onChange={e => handleOutputChange(e.target.value)} />
          </div>
          <div>
            <Label>{ui("Production Date")}</Label>
            <Input type="date" value={form.production_date} disabled={!canPlan || (isEdit && order?.status !== 'draft')} onChange={e => setForm(f => ({ ...f, production_date: e.target.value }))} />
          </div>
          <div>
            <Label>{ui("Expiry date override (optional)")}</Label>
            <Input type="date" value={form.expiry_date} min={form.production_date} onChange={e => setForm(f => ({ ...f, expiry_date: e.target.value }))} disabled={!canPlan || (isEdit && order?.status !== 'draft')} />
            <p className="mt-1 text-xs text-slate-500">{ui("Leave blank to use the product shelf life.")}</p>
          </div>
          <div>
            <Label>{ui("Warehouse")}</Label>
            <Select value={form.warehouse_id} disabled={!canPlan || (isEdit && order?.status !== 'draft')} onValueChange={v => setForm(f => ({ ...f, warehouse_id: v }))}>
              <SelectTrigger><SelectValue placeholder={ui("Select")} /></SelectTrigger>
              <SelectContent>{warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>

        {materials.length > 0 && (
          <div className="mb-6">
            <h3 className="font-semibold text-slate-900 mb-3">{ui("Required Materials (auto-calculated)")}</h3>
            <table className="mobile-table-cards w-full text-sm">
              <thead>
                <tr className="border-b text-left text-slate-600">
                  <th className="pb-2">{ui("Material")}</th>
                  <th className="pb-2 text-right">{ui("Required Qty")}</th>
                  <th className="pb-2">{ui("Unit")}</th>
                  <th className="pb-2 text-right">{ui("Unit Cost")}</th>
                  <th className="pb-2 text-right">{ui("Total Cost")}</th>
                  {isEdit && <th className="pb-2 text-right">{ui("Issued")}</th>}
                  {isEdit && <th className="pb-2 text-right">{ui("Consumed")}</th>}
                </tr>
              </thead>
              <tbody>
                {materials.map((m, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td data-label={ui("Material")} className="py-2 font-medium">{m.material_name}</td>
                    <td data-label={ui("Required Qty")} className="py-2 text-right">{formatNumber(m.standard_quantity, 3)}</td>
                    <td data-label={ui("Unit")} className="py-2">{m.unit}</td>
                    <td data-label={ui("Unit Cost")} className="py-2 text-right">{formatXAF(m.unit_cost)}</td>
                    <td data-label={ui("Total Cost")} className="py-2 text-right">{formatXAF(m.standard_quantity * m.unit_cost)}</td>
                    {isEdit && <td data-label={ui("Issued")} className="py-2 text-right">{formatNumber(m.issued_quantity || 0, 3)}</td>}
                    {isEdit && <td data-label={ui("Consumed")} className="py-2 text-right">{formatNumber(m.consumed_quantity || 0, 3)}</td>}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 font-bold">
                  <td colSpan={4} className="py-2">{ui("Total Standard Material Cost")}</td>
                  <td className="py-2 text-right">{formatXAF(standardCost)}</td>
                  {isEdit && <td colSpan={2}></td>}
                </tr>
                <tr>
                  <td colSpan={4} className="py-1 text-slate-600">{ui("Standard Cost per Unit")}</td>
                  <td className="py-1 text-right font-semibold text-blue-700">{formatXAF(costPerUnit)}</td>
                  {isEdit && <td colSpan={2}></td>}
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {canCheck && form.recipe_id && Number(form.planned_output)>0 && <section className="mb-6 space-y-3 rounded-xl border border-slate-200 p-4" aria-label={ui('Raw-material availability')}>
          <div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">{ui('Material availability and source warehouses')}</h3><Button variant="outline" size="sm" disabled={checking || saving} onClick={refreshMaterials}>{checking?ui('Checking usable lots...'):ui('Refresh material availability')}</Button></div>
          <p className="text-sm text-slate-600">{ui('Production Managers submit orders directly to Warehouse. Only approved, unexpired stock in each selected warehouse is usable.')}</p>
          {checkError && <p role="alert" className="text-sm text-red-700">{uiMessage(checkError)}</p>}
          {availability && <div className="overflow-x-auto"><table className="mobile-table-cards w-full min-w-[660px] text-sm"><thead><tr className="border-b text-left text-slate-500"><th className="py-2">{ui('Material')}</th><th>{ui('Source warehouse')}</th><th className="text-right">{ui('Required')}</th><th className="text-right">{ui('Available')}</th><th className="text-right">{ui('Short')}</th></tr></thead><tbody>{availability.availability.map(row=><tr className="border-b" key={row.material_id}><td data-label={ui("Material")} className="py-3 pr-2 font-medium">{row.material_name}</td><td data-label={ui("Source warehouse")} className="py-2 pr-3"><select aria-label={ui('Source warehouse for {0}',row.material_name)} className="h-10 w-full rounded-md border bg-white px-2" disabled={saving} value={row.warehouse_id || ''} onChange={e=>setForm(f=>({...f,material_warehouses:{...f.material_warehouses,[row.material_id]:e.target.value}}))}><option value="">{ui('Select source warehouse')}</option>{warehouses.filter(w=>MATERIAL_WAREHOUSE_TYPES.includes(w.warehouse_type)).map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></td><td data-label={ui("Required")} className="text-right">{formatNumber(row.required,3)} {row.unit}</td><td data-label={ui("Available")} className="text-right">{formatNumber(row.available,3)} {row.unit}</td><td data-label={ui("Short")} className={'text-right font-semibold '+(row.missing>0?'text-red-700':'text-emerald-700')}>{formatNumber(row.missing,3)} {row.unit}</td></tr>)}</tbody></table></div>}
          {availability?.shortages?.length>0 ? <><p role="alert" className="text-sm text-slate-900">{ui('Materials are missing. Check the selected warehouse, request a physical count, or send a purchase request. No material will be deducted until the entire issue can succeed.')}</p><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={saving || checking || availability.availability.some(row=>!row.warehouse_id)} onClick={preparePurchase}><ShoppingCart size={16} className="mr-2"/>{ui('Prepare purchase request')}</Button><Button variant="outline" disabled={saving || auditSent} onClick={requestAudit}><ClipboardCheck size={16} className="mr-2"/>{auditSent?ui('Inventory audit requested'):ui('Request quick inventory audit')}</Button></div></> : availability && <p className="text-sm text-emerald-700">{ui('All required components are available for this plan.')}</p>}
          {purchaseDraft && <ProductionPurchaseRequest key={JSON.stringify(materialContext)} data={purchaseDraft} context={materialContext} onClose={()=>setPurchaseDraft(null)} onRefresh={()=>{setPurchaseDraft(null);refreshMaterials();}} onNavigate={navigate}/>}
        </section>}

        {isEdit && order?.actual_output > 0 && (
          <div className="bg-green-50 rounded-lg p-4 mb-4">
            <h4 className="font-semibold text-green-900 mb-2">{ui("Production Results")}</h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div><span className="text-green-700">{ui("Actual Output:")}</span> <strong>{order.actual_output}</strong></div>
              <div><span className="text-green-700">{ui("Actual Cost/Unit:")}</span> <strong>{formatXAF(order.actual_cost_per_unit)}</strong></div>
              <div><span className="text-green-700">{ui("Total Cost:")}</span> <strong>{formatXAF(order.total_material_cost)}</strong></div>
              <div><span className="text-green-700">{ui("Yield:")}</span> <strong>{formatNumber(order.actual_output / order.planned_output * 100, 1)}%</strong></div>
            </div>
          </div>
        )}

        {canPlan && isEdit && order?.status === "draft" && (
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => handleSave("draft")} disabled={saving}><Save size={16} className="mr-1" /> {saving ? ui("Saving...") : ui("Save Draft")}</Button>
            <Button onClick={() => handleSave("awaiting_approval")} disabled={saving}><Send size={16} className="mr-1" /> {saving ? ui("Submitting...") : (role==='production_manager'?ui('Submit production order'):ui("Submit for Approval"))}</Button>
          </div>
        )}
        {canPlan && !isEdit && (
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => handleSave("draft")} disabled={saving}><Save size={16} className="mr-1" /> {saving ? ui("Saving...") : ui("Save Draft")}</Button>
            <Button onClick={() => handleSave("awaiting_approval")} disabled={saving}><Send size={16} className="mr-1" /> {saving ? ui("Submitting...") : (role==='production_manager'?ui('Submit production order'):ui("Submit for Approval"))}</Button>
          </div>
        )}
      </div>
    </div>
  );
}
