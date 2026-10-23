
/* localized-messages */
import { uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { lazy, Suspense, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { erp } from "@/api/erpClient";
import { useNavigate, useSearchParams } from "@/lib/router";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { formatNumber, formatDate } from "@/lib/formatters";
import { itemUnits, stockUnit } from "@/lib/item-units";
import { isAssemblyInventoryType } from '@/lib/item-types';
import { usePageState } from '@/lib/navigation-context';
import { purchasePermissions } from '@/lib/purchase-workspace';
import { WAREHOUSE_MANAGERS } from '@/lib/warehouse-workspace';
import { INVENTORY_SECTIONS, ITEM_FILTERS, inventoryWorkspaceState, matchesItemFilter, inventoryItemCounts, inventoryStockIndex } from "@/lib/inventory-workspace";
import { finishedStockOutsideColdRoom } from '@/lib/finished-product-storage';
import { canAdjustInventory } from '@/lib/inventory-adjustment-access';
import DataTable from "@/components/shared/DataTable";
import ProductThumb from "@/components/shared/ProductThumb";
import GroupedItems from "@/components/inventory/GroupedItems";
import ViewToggle from "@/components/shared/ViewToggle";
import ItemAvailabilityAction from '@/components/items/ItemAvailabilityAction';
import QuickItemEditor from "@/components/items/QuickItemEditor";
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus, ArrowLeftRight, ClipboardCheck, Grid2X2, List, RefreshCw, Factory, PackageCheck } from "lucide-react";

const WarehouseDialog = lazy(() => import("@/components/admin/WarehouseDialog"));
const ExpiryRecovery = lazy(() => import("@/components/inventory/ExpiryRecovery"));
const StockAlerts = lazy(() => import("@/components/inventory/StockAlerts"));
const MovementLedger = lazy(() => import("@/components/inventory/MovementLedger"));
const StockTransferDialog = lazy(() => import("@/components/inventory/StockTransferDialog"));
const StockAdjustmentDialog = lazy(() => import("@/components/inventory/StockAdjustmentDialog"));
const ItemForm = lazy(() => import('@/views/ItemForm'));
const SECTIONS = { get items(){return ui("Items");}, get stock(){return ui("Stock on Hand");}, get alerts(){return ui("Alerts");}, get movements(){return ui("Movements");}, get recovery(){return ui("Expiry & recovery");} };
const Pending = () => <p role="status" className="rounded-xl border bg-white p-8 text-sm text-slate-500">{ui("Loading inventory...")}</p>;

export default function Inventory() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const navigate = useNavigate(), [params, setParams] = useSearchParams();
  const workspace = inventoryWorkspaceState(params);
  const { role, employee, allowedModules } = useCurrentUser(), { toast } = useToast();
  const hasModule=key=>role==='admin' || !allowedModules || allowedModules.includes(key);
  const canReceive = purchasePermissions(role, employee?.assigned_role).receive && hasModule('purchases');
  const canManufacture = ['admin','production_manager','warehouse_manager'].includes(role) && hasModule('manufacturing');
  const canBuild=['admin','production_manager'].includes(role) && hasModule('manufacturing');
  const canEdit = ["admin", "warehouse_manager", "procurement", "production_manager"].includes(role);
  const canMoveStock = ["admin", "warehouse_manager", "production_manager"].includes(role);
  const canAdjustStock = canAdjustInventory(role,employee,allowedModules);
  const canManageWarehouses = WAREHOUSE_MANAGERS.includes(role);
  const [products, setProducts] = useState([]), [balances, setBalances] = useState([]), [warehouses, setWarehouses] = useState([]);
  const [loading, setLoading] = useState(true), [refreshing, setRefreshing] = useState(false), [error, setError] = useState("");
  const [view, setView] = usePageState("inventory:view", "visual", { scope: "path" });
  const [locationDialog,setLocationDialog] = useState(null);
  const stockArea = workspace.stockArea;
  const [movementVersion, setMovementVersion] = useState(0);
  const [showTransfer, setShowTransfer] = useState(false), [showAdjust, setShowAdjust] = useState(null);
  const [editingItem,setEditingItem] = useState(null), editorBusy = useRef(false);
  const editItem = item => { if (canEdit) setEditingItem(item); };
  const closeItemEditor = () => { if (!editorBusy.current) setEditingItem(null); };
  const [customUnits, setCustomUnits] = useState([]), [unitsLoading, setUnitsLoading] = useState(false);
  const loadSequence = useRef(0), unitRequest = useRef(null);
  const pendingLoad = useRef(null), lastLoadAt = useRef(0);
  const counts = useMemo(() => inventoryItemCounts(products), [products]);
  const stock = useMemo(() => inventoryStockIndex(balances, warehouses), [balances, warehouses]);
  const productById = useMemo(() => new Map(products.map(product => [product.id, product])), [products]);
  const units = useMemo(() => itemUnits(customUnits, products), [customUnits, products]);
  const filtered = useMemo(() => products.filter(item => matchesItemFilter(item, workspace.filter, workspace.subtype)), [products, workspace.filter, workspace.subtype]);
  const changeWorkspace = changes => setParams(previous => {
    const next = new URLSearchParams(previous);
    next.set("section", workspace.section); next.set("filter", workspace.filter);
    if (workspace.subtype !== "all") next.set("type", workspace.subtype);
    next.set("area", workspace.stockArea);
    next.delete("tab");
    for (const [key, value] of Object.entries(changes)) {
      if (!value || value === "all" && key === "type") next.delete(key); else next.set(key, value);
    }
    return next;
  });

  const loadData = useCallback(async (options = {}) => {
    if (options?.background && (pendingLoad.current || Date.now() - lastLoadAt.current < 5000)) return;
    pendingLoad.current?.abort();
    const controller = new AbortController();
    pendingLoad.current = controller;
    const sequence = ++loadSequence.current;
    setRefreshing(true);
    if (!options?.background) setError("");
    try {
      const response = await fetch("/api/inventory/overview", { cache: "no-store", credentials: "same-origin", signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || ui("Inventory could not load"));
      if (controller.signal.aborted || sequence !== loadSequence.current) return;
      setProducts(data.products); setBalances(data.balances); setWarehouses(data.warehouses);
      lastLoadAt.current = Date.now(); setError("");
      setMovementVersion(value => value + 1);
    } catch (failure) { if (!controller.signal.aborted && sequence === loadSequence.current) setError(failure.message); }
    finally {
      if (pendingLoad.current === controller) pendingLoad.current = null;
      if (sequence === loadSequence.current) { setLoading(false); setRefreshing(false); }
    }
  }, []);
  useEffect(() => {
    loadData();
    const refreshVisible = () => { if (document.visibilityState === 'visible') loadData({ background: true }); };
    const timer = window.setInterval(refreshVisible, 30000);
    window.addEventListener('focus', refreshVisible); document.addEventListener('visibilitychange', refreshVisible);
    return () => { loadSequence.current++; pendingLoad.current?.abort(); window.clearInterval(timer); window.removeEventListener('focus', refreshVisible); document.removeEventListener('visibilitychange', refreshVisible); };
  }, [loadData]);

  function loadUnits() {
    if (unitRequest.current) return unitRequest.current;
    setUnitsLoading(true);
    unitRequest.current = erp.entities.CompanySettings.filter({}, "id", 1)
      .then(settings => setCustomUnits(settings[0]?.item_units || []))
      .catch(failure => { unitRequest.current = null; toast({ title: ui("Custom units could not load"), description: failure.message, variant: "destructive" }); })
      .finally(() => setUnitsLoading(false));
    return unitRequest.current;
  }
  function savedItem(item) {
    // A refresh begun before this save must not overwrite the returned record.
    loadSequence.current++; pendingLoad.current?.abort(); pendingLoad.current = null; setRefreshing(false); setLoading(false);
    setProducts(rows => rows.map(row => row.id === item.id ? item : row));
  }
  const quickEditor = item => canEdit ? <QuickItemEditor item={item} catalogueItems={products} units={units} unitsLoading={unitsLoading} onOpen={loadUnits} onSaved={item=>{savedItem(item);loadData();}} onEditDetails={editItem} /> : null;
  const balanceColumns = [
    { key: "product_name", label: ui("Item"), render: (value, row) => <div className="flex items-center gap-3"><ProductThumb product={productById.get(row.product_id)} name={value} size={40} />{canEdit && productById.has(row.product_id) ? <button type="button" className="text-left font-medium text-green-800 underline-offset-2 hover:underline" onClick={()=>editItem(productById.get(row.product_id))}>{productById.get(row.product_id).name}</button> : <span>{value}</span>}</div> },
    { key: "warehouse_name", label: ui("Warehouse"), render: (value,row) => warehouses.find(w => w.id === row.warehouse_id)?.name || value }, { key: "lot_number", label: ui("Lot") },
    { key: "expiry_date", label: ui("Expiry"), render: value => value ? formatDate(value) : "—" },
    { key: "quantity", label: ui("Quantity"), className: "text-right", render: value => formatNumber(value, 3) },
    { key: "_unit", label: ui("U/M"), sortable: false, render: (_, row) => productById.has(row.product_id) ? stockUnit(productById.get(row.product_id)) : "—" },
  ];
  const misplaced=finishedStockOutsideColdRoom(products,warehouses,balances);
  const buildAction=item=>canBuild && isAssemblyInventoryType(item.inventory_type) && item.is_active!==false && item.configuration_status!=='draft' ? <Button size="sm" variant="outline" className="h-auto min-h-8 max-w-full whitespace-normal text-xs" onClick={event=>{event.stopPropagation();navigate('/manufacturing/new?product='+encodeURIComponent(item.id));}}><Factory size={14} className="mr-1"/>{ui('Build assembly')}</Button>:null;
  const stockRows = balances.filter(row => (!params.get("warehouse") || row.warehouse_id===params.get("warehouse")) && (stockArea === "all" || stock.warehouseTypes.get(row.warehouse_id) === (stockArea === "delivery" ? "vehicle" : "wip")));

  return <div className="space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-bold tracking-tight">{ui("Inventory")}</h1><div className="flex max-w-full flex-wrap items-center gap-2">
      {canReceive && <Button onClick={() => navigate('/purchases?section=receiving')}><PackageCheck size={16} className="mr-1" />{ui('Receive inventory')}</Button>}
      {canManufacture && <Button variant="outline" onClick={() => navigate(canBuild ? '/manufacturing/new' : '/manufacturing')}><Factory size={16} className="mr-1" />{ui('Manufacturing')}</Button>}
      {canMoveStock && hasModule('distribution') && <Button variant="outline" onClick={() => navigate('/distribution?tab=stock&issue=1')}><ArrowLeftRight size={16} className="mr-1" />{ui('Issue to driver & agent')}</Button>}
      {canEdit && <Button onClick={() => navigate('/items/new')}><Plus size={16} className="mr-1" />{ui('New item')}</Button>}
      <Button variant="outline" size="icon" aria-label={ui('Refresh')} title={ui('Refresh')} disabled={refreshing} onClick={loadData}><RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} /></Button>
    </div></header>
    {misplaced.length>0 && <p role="alert" className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900">{ui('Finished stock recorded outside Cold Room needs a physical-location check.')}{canMoveStock && <button type="button" className="ml-2 underline" onClick={()=>setShowTransfer(true)}>{ui('Move stock')}</button>}</p>}
    {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{uiMessage(error)}<button type="button" className="ml-3 underline" onClick={loadData}>{ui("Retry")}</button></div>}
    <Tabs value={workspace.section} onValueChange={section => changeWorkspace({ section })}>
      <TabsList className="h-auto flex-wrap justify-start">{INVENTORY_SECTIONS.filter(section=>section!=='recovery' || ['admin','warehouse_manager','production_manager'].includes(role)).map(section => <TabsTrigger key={section} value={section}>{SECTIONS[section]}</TabsTrigger>)}</TabsList>
      <TabsContent value="items" className="mt-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2" aria-label={ui("Item types")}>{ITEM_FILTERS.map(filter => <button type="button" key={filter.key} aria-pressed={workspace.filter === filter.key} onClick={() => changeWorkspace({ filter: filter.key, type: "all" })} className={"min-h-10 rounded-full border px-3 text-sm font-medium " + (workspace.filter === filter.key ? "border-primary bg-primary text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-400")}>{filter.label}<span className="ml-2 opacity-70">{loading ? "—" : counts[filter.key]}</span></button>)}</div>
          <ViewToggle value={view} onChange={setView} options={[{ value: "visual", label: "Photos", icon: Grid2X2 }, { value: "table", label: "Table", icon: List }]} />
        </div>
        {loading ? <Pending /> : <GroupedItems key={workspace.filter+workspace.subtype} products={filtered} filter={workspace.filter} quantities={stock.quantities} onEdit={canEdit?editItem:undefined} table={view==='table'} renderDetails={item=><div className="flex flex-wrap gap-2">{quickEditor(item)}{canEdit&&<ItemAvailabilityAction item={item} onEdit={editItem} onSaved={item=>{savedItem(item);loadData();}}/>}{buildAction(item)}</div>} />}
      </TabsContent>
      <TabsContent value="stock" className="mt-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ViewToggle value={stockArea} onChange={area => changeWorkspace({ area })} options={[{ value: "all", label: "All stock" }, { value: "wip", label: "Production stock" }, { value: "delivery", label: "Out for delivery" }]} />
          {canMoveStock && <div className="flex flex-wrap gap-2">{canAdjustStock && <Button variant="outline" disabled={loading} onClick={() => setShowAdjust({})}><ClipboardCheck size={16} className="mr-1" />{ui("Adjust quantity")}</Button>}<Button disabled={loading} onClick={() => setShowTransfer(true)}><ArrowLeftRight size={16} className="mr-1" />{ui("Move stock")}</Button></div>}
        </div>
        <label className="flex items-center gap-2 text-sm">{ui('Location')}<select aria-label={ui('Stock location')} value={params.get('warehouse') || ''} onChange={event=>changeWorkspace({warehouse:event.target.value})} className="h-9 rounded-md border bg-white px-3"><option value="">{ui('All locations')}</option>{warehouses.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
        <details className="rounded-lg border bg-white p-3"><summary className="cursor-pointer text-sm font-medium">{ui('Manage storage locations')}</summary><div className="mt-3 divide-y">{warehouses.filter(w=>!['vehicle','commercial_custody'].includes(w.warehouse_type)).map(w=><div key={w.id} className="flex items-center justify-between py-2 text-sm"><span>{w.name} <span className="text-xs text-slate-500">{w.code} · {w.is_active===false?ui('Inactive'):ui('Active')}</span></span>{canManageWarehouses && <Button size="sm" variant="ghost" onClick={()=>setLocationDialog(w)}>{ui('Edit')}</Button>}</div>)}</div>{canManageWarehouses && <Button size="sm" variant="outline" onClick={()=>setLocationDialog({})}>{ui('Add location')}</Button>}</details>
        {loading ? <Pending /> : <DataTable key={stockArea} columns={balanceColumns} data={stockRows} searchFields={["product_name", "warehouse_name", "lot_number"]} emptyMessage={ui("No stock records in this area.")} />}
      </TabsContent>
      <TabsContent value="recovery" className="mt-5"><Suspense fallback={<Pending/>}>{['admin','warehouse_manager','production_manager'].includes(role)?<ExpiryRecovery onSaved={loadData}/>:<p>{ui('Warehouse management handles expired-stock disposal.')}</p>}</Suspense></TabsContent>
      <TabsContent value="alerts" className="mt-5">{loading ? <Pending /> : <Suspense fallback={<Pending />}><StockAlerts products={products} balances={balances} onCount={canAdjustStock ? () => setShowAdjust({}) : undefined} /></Suspense>}</TabsContent>
      <TabsContent value="movements" className="mt-5 space-y-3">
        {canMoveStock && <div className="flex justify-end"><Button disabled={loading} onClick={() => setShowTransfer(true)}><ArrowLeftRight size={16} className="mr-2" />{ui("Move stock")}</Button></div>}
        {loading ? <Pending /> : <Suspense fallback={<Pending />}><MovementLedger warehouseId={params.get('warehouse') || undefined} reportMode={params.get('panel')==='report'} warehouses={warehouses} products={products} refreshKey={movementVersion} /></Suspense>}
      </TabsContent>
    </Tabs>
    <Dialog open={!!editingItem} onOpenChange={open=>{if(!open)closeItemEditor();}}>
      <DialogContent className="max-h-[92dvh] w-[calc(100vw-2rem)] max-w-5xl overflow-y-auto" onEscapeKeyDown={event=>{if(editorBusy.current)event.preventDefault();}} onPointerDownOutside={event=>{if(editorBusy.current)event.preventDefault();}}>
        <DialogHeader><DialogTitle>{ui('Edit item: {0}',editingItem?.name || '')}</DialogTitle><DialogDescription>{ui('Update this item without leaving your current inventory section.')}</DialogDescription></DialogHeader>
        {editingItem && <Suspense fallback={<Pending />}><ItemForm key={editingItem.id} embedded itemId={editingItem.id} onBusyChange={busy=>{editorBusy.current=busy;}} onCancel={closeItemEditor} onSaved={item=>{savedItem(item);setEditingItem(null);loadData();}} /></Suspense>}
      </DialogContent>
    </Dialog>
    <Suspense fallback={<Pending />}>
      {locationDialog && <WarehouseDialog open warehouse={locationDialog.id?locationDialog:null} onOpenChange={open=>{if(!open)setLocationDialog(null);}} onSaved={loadData}/> }
      {showTransfer && <StockTransferDialog open onOpenChange={setShowTransfer} products={products.filter(item => item.inventory_type !== "service")} warehouses={warehouses} onSaved={loadData} />}
      {showAdjust && <StockAdjustmentDialog open onOpenChange={value=>{if(!value)setShowAdjust(null);}} warehouseId={showAdjust.warehouseId} productId={showAdjust.productId} onSaved={loadData} />}
    </Suspense>
  </div>;
}
