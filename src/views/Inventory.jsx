
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
import { usePageState } from '@/lib/navigation-context';
import { purchasePermissions } from '@/lib/purchase-workspace';
import { WAREHOUSE_MANAGERS } from '@/lib/warehouse-workspace';
import { ITEM_FILTERS, inventoryWorkspaceState, matchesItemFilter, inventoryItemCounts, inventoryStockIndex } from "@/lib/inventory-workspace";
import { finishedStockOutsideColdRoom } from '@/lib/finished-product-storage';
import { inventoryLowStock } from '@/lib/stock-alerts';
import { canAdjustInventory } from '@/lib/inventory-adjustment-access';
import DataTable from "@/components/shared/DataTable";
import ProductThumb from "@/components/shared/ProductThumb";
import GroupedItems from "@/components/inventory/GroupedItems";
import ViewToggle from "@/components/shared/ViewToggle";
import ItemAvailabilityAction from '@/components/items/ItemAvailabilityAction';
import QuickItemEditor from "@/components/items/QuickItemEditor";
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus, ArrowLeftRight, ClipboardCheck, Grid2X2, List, RefreshCw, PackageCheck, MoreHorizontal } from "lucide-react";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

const ProductionCountRequests = lazy(() => import('@/components/inventory/ProductionCountRequests'));
const WarehouseDialog = lazy(() => import("@/components/admin/WarehouseDialog"));
const ExpiryRecovery = lazy(() => import("@/components/inventory/ExpiryRecovery"));
import InventoryAlertsMenu from '@/components/inventory/InventoryAlertsMenu';
const MovementLedger = lazy(() => import("@/components/inventory/MovementLedger"));
const StockTransferDialog = lazy(() => import("@/components/inventory/StockTransferDialog"));
const StockAdjustmentDialog = lazy(() => import("@/components/inventory/StockAdjustmentDialog"));
const ItemForm = lazy(() => import('@/views/ItemForm'));
const IssueGoods = lazy(() => import('@/components/distribution/IssueGoods'));
const SECTIONS = { get stock(){return ui('Stock on Hand');}, get alerts(){return ui('Stock alerts');}, get movements(){return ui('Movements');} };
const Pending = () => <p role="status" className="rounded-xl border bg-white p-8 text-sm text-slate-500">{ui("Loading inventory...")}</p>;

export default function Inventory() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const navigate = useNavigate(), [params, setParams] = useSearchParams();
  const workspace = inventoryWorkspaceState(params);
  const { role, employee, allowedModules } = useCurrentUser(), { toast } = useToast();
  const hasModule=key=>role==='admin' || !allowedModules || allowedModules.includes(key);
  const canReceive = purchasePermissions(role, employee?.assigned_role).receive && hasModule('purchases');
  const canEdit = ["admin", "warehouse_manager", "procurement", "production_manager"].includes(role);
  const canMoveStock = ["admin", "warehouse_manager", "production_manager"].includes(role);
  const canAdjustStock = canAdjustInventory(role,employee,allowedModules);
  const canManageWarehouses = WAREHOUSE_MANAGERS.includes(role);
  const [products, setProducts] = useState([]), [balances, setBalances] = useState([]), [warehouses, setWarehouses] = useState([]);
  const [loading, setLoading] = useState(true), [refreshing, setRefreshing] = useState(false), [error, setError] = useState("");
  const [view, setView] = usePageState("inventory:view", "visual", { scope: "path" });
  const [locationDialog,setLocationDialog] = useState(null);
  const [countsOpen,setCountsOpen]=useState(false);
  const [alertsOpen,setAlertsOpen]=useState(false);
  const [showIssue, setShowIssue] = useState(false), [showRecoveryReceipt, setShowRecoveryReceipt] = useState(false);
  const lowStock = useMemo(() => inventoryLowStock(products, balances), [products, balances]);
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
  const stockRows = balances.filter(row => (!params.get("warehouse") || row.warehouse_id===params.get("warehouse")) && (stockArea === "all" || stock.warehouseTypes.get(row.warehouse_id) === (stockArea === "delivery" ? "vehicle" : "wip")));

  useEffect(() => {
    if (workspace.section !== 'recovery') return;
    if (role === 'admin' || role === 'cashier') navigate('/accounting/recovery', { replace: true });
    else {
      if (['warehouse_manager','production_manager'].includes(role)) setShowRecoveryReceipt(true);
      setParams(previous => { previous.set('section','items'); previous.delete('tab'); return previous; }, { replace: true });
    }
  }, [workspace.section, role, navigate, setParams]);
  const closePanel = () => changeWorkspace({ section: 'items' });

  return <div className="min-w-0 space-y-4">
    <header className="flex items-center justify-between gap-2">
      <h1 className="min-w-0 text-xl font-bold tracking-tight sm:text-2xl">{ui('Inventory')}</h1>
      <div className="flex shrink-0 items-center gap-2">
        <InventoryAlertsMenu items={lowStock} loading={loading} open={alertsOpen || workspace.section==='alerts'} onOpenChange={open=>{setAlertsOpen(open);if(!open && workspace.section==='alerts')setParams(q=>{q.set('section','items');q.delete('tab');return q;},{replace:true});}} onOpenItem={canEdit?item=>{setAlertsOpen(false);if(workspace.section==='alerts')closePanel();editItem(item);}:undefined}/>
        {canEdit && <Button className="h-11 gap-1.5 rounded-xl px-3" onClick={() => navigate('/items/new')}><Plus size={17}/>{ui('New item')}</Button>}
      </div>
    </header>
    {(canReceive || canMoveStock && hasModule('distribution')) && <div className="grid gap-2 sm:flex">
      {canReceive && <Button className="h-auto min-h-11 gap-2 whitespace-normal rounded-xl px-4 py-3" onClick={() => navigate('/purchases?section=receiving')}><PackageCheck size={18} className="shrink-0"/>{ui('Receive inventory')}</Button>}
      {canMoveStock && hasModule('distribution') && <Button variant="outline" className="h-auto min-h-11 gap-2 whitespace-normal rounded-xl px-4 py-3" onClick={() => setShowIssue(true)}><ArrowLeftRight size={18} className="shrink-0"/>{ui('Issue to driver & agent')}</Button>}
    </div>}
    {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{uiMessage(error)}<button type="button" className="ml-3 underline" onClick={loadData}>{ui("Retry")}</button></div>}
    <nav aria-label={ui("Item types")} className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
      {ITEM_FILTERS.map(filter => <button type="button" key={filter.key} aria-pressed={workspace.filter === filter.key} onClick={() => changeWorkspace({ section: 'items', filter: filter.key, type: 'all' })} className={"flex min-h-11 min-w-0 items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-sm font-medium sm:justify-center " + (workspace.filter === filter.key ? "border-primary bg-primary text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-400")}>{filter.label}<span className="text-xs opacity-70">{loading ? "-" : counts[filter.key]}</span></button>)}
    </nav>
    <div className="flex items-center justify-between gap-2">
      <ViewToggle value={view} onChange={setView} options={[{ value: "visual", label: "Photos", icon: Grid2X2 }, { value: "table", label: "Table", icon: List }]} />
      <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-11 w-11 shrink-0 rounded-xl" aria-label={ui('More inventory tools')}><MoreHorizontal size={20}/></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64 [&_[role=menuitem]]:min-h-11">
          <DropdownMenuItem disabled={refreshing} onSelect={() => loadData()}><RefreshCw size={16} className="mr-2"/>{ui('Refresh')}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => changeWorkspace({ section: 'stock' })}>{ui('Stock on Hand')}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => changeWorkspace({ section: 'movements' })}>{ui('Movements')}</DropdownMenuItem>
          {canAdjustStock && <DropdownMenuItem disabled={loading} onSelect={() => setShowAdjust({})}>{ui('Adjust quantity')}</DropdownMenuItem>}
          {canMoveStock && <DropdownMenuItem disabled={loading} onSelect={() => setShowTransfer(true)}>{ui('Move stock')}</DropdownMenuItem>}
          {canMoveStock && <DropdownMenuItem onSelect={() => setShowRecoveryReceipt(true)}>{ui('Recovered packaging')}</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    {loading ? <Pending/> : <GroupedItems key={workspace.filter + workspace.subtype} products={filtered} filter={workspace.filter} quantities={stock.quantities} onEdit={canEdit ? editItem : undefined} table={view === 'table'} renderDetails={item => <div className="flex flex-wrap gap-2">{quickEditor(item)}{canEdit && <ItemAvailabilityAction item={item} onEdit={editItem} onSaved={item => { savedItem(item); loadData(); }}/>}</div>}/>}
    <Dialog open={['stock','movements'].includes(workspace.section)} onOpenChange={open => { if (!open) closePanel(); }}>
      <DialogContent className="max-h-[92dvh] max-w-5xl overflow-y-auto">
        <DialogHeader><DialogTitle>{SECTIONS[workspace.section] || ui('Inventory')}</DialogTitle><DialogDescription className="sr-only">{ui('Inventory details')}</DialogDescription></DialogHeader>
        {workspace.section === 'stock' && <div className="space-y-4">
          {misplaced.length > 0 && <p role="alert" className="rounded-md border bg-slate-50 p-3 text-xs">{ui('Finished stock recorded outside Cold Room needs a physical-location check.')}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ViewToggle value={stockArea} onChange={area => changeWorkspace({ area })} options={[{ value: "all", label: "All stock" }, { value: "wip", label: "Production stock" }, { value: "delivery", label: "Out for delivery" }]} />
          {canMoveStock && <div className="flex flex-wrap gap-2">{canAdjustStock && <Button variant="outline" disabled={loading} onClick={() => setShowAdjust({})}><ClipboardCheck size={16} className="mr-1" />{ui("Adjust quantity")}</Button>}<Button disabled={loading} onClick={() => setShowTransfer(true)}><ArrowLeftRight size={16} className="mr-1" />{ui("Move stock")}</Button></div>}
        </div>
        <label className="flex items-center gap-2 text-sm">{ui('Location')}<select aria-label={ui('Stock location')} value={params.get('warehouse') || ''} onChange={event=>changeWorkspace({warehouse:event.target.value})} className="h-11 min-w-0 max-w-full rounded-md border bg-white px-3"><option value="">{ui('All locations')}</option>{warehouses.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
        <details className="rounded-lg border bg-white p-3"><summary className="cursor-pointer text-sm font-medium">{ui('Manage storage locations')}</summary><div className="mt-3 divide-y">{warehouses.filter(w=>!['vehicle','commercial_custody'].includes(w.warehouse_type)).map(w=><div key={w.id} className="flex items-center justify-between py-2 text-sm"><span>{w.name} <span className="text-xs text-slate-500">{w.code} · {w.is_active===false?ui('Inactive'):ui('Active')}</span></span>{canManageWarehouses && <Button size="sm" variant="ghost" onClick={()=>setLocationDialog(w)}>{ui('Edit')}</Button>}</div>)}</div>{canManageWarehouses && <Button size="sm" variant="outline" onClick={()=>setLocationDialog({})}>{ui('Add location')}</Button>}</details>
        {canMoveStock && hasModule('manufacturing') && <details className="rounded-xl border bg-white p-3" onToggle={event=>setCountsOpen(event.currentTarget.open)}><summary className="cursor-pointer text-sm font-medium">{ui('Production count requests')}</summary>{countsOpen && <Suspense fallback={<Pending/>}><ProductionCountRequests products={products} onCount={canAdjustStock?()=>setShowAdjust({}):undefined}/></Suspense>}</details>}
        {loading ? <Pending /> : <DataTable key={stockArea} columns={balanceColumns} data={stockRows} searchFields={["product_name", "warehouse_name", "lot_number"]} emptyMessage={ui("No stock records in this area.")} />}

        </div>}
        {workspace.section === 'movements' && <div className="space-y-3">
        {canMoveStock && <div className="flex justify-end"><Button disabled={loading} onClick={() => setShowTransfer(true)}><ArrowLeftRight size={16} className="mr-2" />{ui("Move stock")}</Button></div>}
        {loading ? <Pending /> : <Suspense fallback={<Pending />}><MovementLedger warehouseId={params.get('warehouse') || undefined} reportMode={params.get('panel')==='report'} warehouses={warehouses} products={products} refreshKey={movementVersion} /></Suspense>}

        </div>}

      </DialogContent>
    </Dialog>
    {showRecoveryReceipt && <Dialog open onOpenChange={setShowRecoveryReceipt}><DialogContent className="max-h-[92dvh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>{ui('Recovered packaging')}</DialogTitle><DialogDescription>{ui('Receive recovered packaging after accounting treatment. Quality inspection is required before reuse.')}</DialogDescription></DialogHeader><Suspense fallback={<Pending/>}><ExpiryRecovery mode="warehouse" onSaved={loadData}/></Suspense></DialogContent></Dialog>}
    {showIssue && <Suspense fallback={<Pending/>}><IssueGoods onClose={() => setShowIssue(false)} onSaved={() => { setShowIssue(false); loadData(); }}/></Suspense>}
    <Dialog open={!!editingItem} onOpenChange={open=>{if(!open)closeItemEditor();}}>
      <DialogContent className="max-h-[92dvh] w-[calc(100vw_-_2rem)] max-w-5xl overflow-y-auto" onEscapeKeyDown={event=>{if(editorBusy.current)event.preventDefault();}} onPointerDownOutside={event=>{if(editorBusy.current)event.preventDefault();}}>
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
