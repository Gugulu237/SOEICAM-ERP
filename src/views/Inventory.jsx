import { usePhoneLayout } from '@/hooks/usePhoneLayout';
import {watchItemCatalogue} from '@/lib/item-catalogue-sync';

/* localized-messages */
import { uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { lazy, Suspense, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { erp } from "@/api/erpClient";
import { useNavigate, useSearchParams } from "@/lib/router";
import { useMenuBack } from '@/hooks/useMenuBack';
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { formatNumber } from "@/lib/formatters";
import { itemUnits, stockUnit } from "@/lib/item-units";
import { usePageState } from '@/lib/navigation-context';
import { purchasePermissions } from '@/lib/purchase-workspace';
import { canIssueDeliveryStock } from '@/lib/operations-access';
import { WAREHOUSE_MANAGERS } from '@/lib/warehouse-workspace';
import { ITEM_FILTERS, inventoryWorkspaceState, matchesItemFilter, inventoryItemCounts, inventoryStockIndex } from "@/lib/inventory-workspace";
import { finishedStockOutsideColdRoom } from '@/lib/finished-product-storage';
import { inventoryLowStock } from '@/lib/stock-alerts';
import { isAssemblyInventoryType } from '@/lib/item-types';
import { canAdjustInventory } from '@/lib/inventory-adjustment-access';
const StockOnHand=lazy(()=>import("@/components/inventory/StockOnHand"));
import GroupedItems from "@/components/inventory/GroupedItems";
import ViewToggle from "@/components/shared/ViewToggle";
const QuickItemEditor=lazy(()=>import("@/components/items/QuickItemEditor"));
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import PageBackButton from '@/components/shared/PageBackButton';
import { Plus, ArrowLeftRight, Grid2X2, List, RefreshCw, PackageCheck, MoreHorizontal, Package, Warehouse, Bell, Truck } from "lucide-react";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

const StockAlerts = lazy(() => import('@/components/inventory/StockAlerts'));
const ProductionCountRequests = lazy(() => import('@/components/inventory/ProductionCountRequests'));
const WarehouseDialog = lazy(() => import("@/components/admin/WarehouseDialog"));
const ExpiryRecovery = lazy(() => import("@/components/inventory/ExpiryRecovery"));
import InventoryAlertsMenu from '@/components/inventory/InventoryAlertsMenu';
const MovementLedger = lazy(() => import("@/components/inventory/MovementLedger"));
const StockTransferDialog = lazy(() => import("@/components/inventory/StockTransferDialog"));
const ItemForm = lazy(() => import('@/views/ItemForm'));
const IssueGoods = lazy(() => import('@/components/distribution/IssueGoods'));
const Pending = () => <p role="status" className="rounded-xl border bg-white p-8 text-sm text-slate-500">{ui("Loading inventory...")}</p>;

export default function Inventory() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const navigate = useNavigate(), [params, setParams] = useSearchParams();
  const phone=usePhoneLayout();
  const requestedWorkspace=inventoryWorkspaceState(params);
  const workspace=phone&&requestedWorkspace.section==='home'?{...requestedWorkspace,section:'items'}:requestedWorkspace;
  const backToMenu = useMenuBack('/inventory');
  const { user,role, principalRole, employee, allowedModules, loading: authLoading } = useCurrentUser(), { toast } = useToast();
  const hasModule=key=>role==='admin' || !allowedModules || allowedModules.includes(key);
  const canReceive = purchasePermissions(role, employee?.assigned_role).receive && hasModule('purchases');
  const showCatalogueReceiving = canReceive && workspace.filter!=='finished';
  const canEdit = ["admin", "warehouse_manager", "procurement", "production_manager"].includes(role);
  const canMoveStock = ["admin", "warehouse_manager", "production_manager"].includes(role);
  const [centralizedInventory,setCentralizedInventory]=useState(()=>user?.centralized_inventory||null);
  useEffect(()=>{if(user?.centralized_inventory)setCentralizedInventory(user.centralized_inventory);},[user?.centralized_inventory]);
  const canIssueStock = canIssueDeliveryStock(role) && hasModule('distribution') && !centralizedInventory?.enabled;
  const canAdjustStock = canAdjustInventory(principalRole||role,employee,allowedModules);
  const canManageWarehouses = WAREHOUSE_MANAGERS.includes(role);
  const [removedProducts,setRemovedProducts]=useState([]);
  const showRemoved=canEdit&&params.get('deleted')==='1';
  const [products, setProducts] = useState([]), [balances, setBalances] = useState([]), [warehouses, setWarehouses] = useState([]);
  const [loading, setLoading] = useState(true), [refreshing, setRefreshing] = useState(false), [error, setError] = useState("");
  const [view, setView] = usePageState("inventory:view", "visual", { scope: "path" });
  const [locationDialog,setLocationDialog] = useState(null);
  const [alertsOpen,setAlertsOpen]=useState(false);
  const [showIssue, setShowIssue] = useState(false), [showRecoveryReceipt, setShowRecoveryReceipt] = useState(false);
  const [issueAgent,setIssueAgent]=useState('');
  useEffect(()=>{
    if(authLoading||params.get('issue')!=='1')return;
    if(canIssueStock){setIssueAgent(params.get('commercial')||'');setShowIssue(true);}
    const next=new URLSearchParams(params);next.delete('issue');next.delete('commercial');setParams(next,{replace:true});
  },[authLoading,canIssueStock,params,setParams]);
  useEffect(()=>{
if(!authLoading && workspace.section==='adjustments' && canAdjustStock){const query=new URLSearchParams({view:'adjustments',filter:workspace.filter});if(params.get('warehouse'))query.set('warehouse',params.get('warehouse'));navigate('/accounting/inventory?'+query.toString(),{replace:true});}
  },[authLoading,workspace.section,workspace.filter,params,canAdjustStock,navigate]);
  const lowStock = useMemo(() => inventoryLowStock(products, balances), [products, balances]);
  const [movementVersion, setMovementVersion] = useState(0);
  const [showTransfer, setShowTransfer] = useState(false);
  const [editingItem,setEditingItem] = useState(null), editorBusy = useRef(false);
  const editItem = item => { if (canEdit) { if(phone)navigate('/items/'+item.id);else setEditingItem(item); } };
  const closeItemEditor = () => { if (!editorBusy.current) setEditingItem(null); };
  const [customUnits, setCustomUnits] = useState([]), [unitsLoading, setUnitsLoading] = useState(false);
  const loadSequence = useRef(0), unitRequest = useRef(null);
  const pendingLoad = useRef(null), lastLoadAt = useRef(0), overviewTag = useRef(null);
  const catalogue=showRemoved?removedProducts:products;
  const counts = useMemo(() => inventoryItemCounts(catalogue), [catalogue]);
  const stock = useMemo(() => inventoryStockIndex(balances, warehouses, undefined, products), [balances, warehouses, products]);
  const units = useMemo(() => itemUnits(customUnits, products), [customUnits, products]);
  const filtered = useMemo(() => catalogue.filter(item => matchesItemFilter(item, workspace.filter, workspace.subtype)), [catalogue, workspace.filter, workspace.subtype]);
  const changeWorkspace = changes => setParams(previous => {
    const next = new URLSearchParams(previous);
    next.set("section", workspace.section); next.set("filter", workspace.filter);
    if (workspace.subtype !== "all") next.set("type", workspace.subtype);
    next.delete("area");
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
      const url="/api/inventory/overview?compact=1"+(showRemoved?"&removed=1":"");
      if(overviewTag.current?.url!==url&&!options?.background)setLoading(true);
      const tag=overviewTag.current?.url===url?overviewTag.current.value:null;
      const response = await fetch(url, { cache: "no-store", credentials: "same-origin", signal: controller.signal,headers:tag?{"If-None-Match":tag}:{} });
      if(controller.signal.aborted||sequence!==loadSequence.current)return;
      if(response.status===304){lastLoadAt.current=Date.now();setError("");return;}
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || ui("Inventory could not load"));
      if (controller.signal.aborted || sequence !== loadSequence.current) return;
      overviewTag.current={url,value:response.headers?.get?.("etag")||null};
      setProducts(data.products); setRemovedProducts(data.removedProducts||[]); setBalances(data.balances); setWarehouses(data.warehouses);
      setCentralizedInventory(data.centralized_inventory||{enabled:false});
      lastLoadAt.current = Date.now(); setError("");
      setMovementVersion(value => value + 1);
    } catch (failure) { if (!controller.signal.aborted && sequence === loadSequence.current) setError(failure.message); }
    finally {
      if (pendingLoad.current === controller) pendingLoad.current = null;
      if (sequence === loadSequence.current) { setLoading(false); setRefreshing(false); }
    }
  }, [showRemoved]);
  const needsOverview = ['items','stock','movements','alerts','locations','counts'].includes(workspace.section) || alertsOpen || showTransfer;
  useEffect(() => {
    if(authLoading || !needsOverview)return;
    loadData();
    const browser=globalThis.window,doc=globalThis.document;
    const refreshVisible = () => { if (doc?.visibilityState === 'visible') loadData({ background: true }); };
    const timer = browser?.setInterval?.(refreshVisible, 30000);
    browser?.addEventListener?.('focus', refreshVisible); doc?.addEventListener?.('visibilitychange', refreshVisible);
    return () => { loadSequence.current++; pendingLoad.current?.abort(); browser?.clearInterval?.(timer); browser?.removeEventListener?.('focus', refreshVisible); doc?.removeEventListener?.('visibilitychange', refreshVisible); };
  }, [loadData,authLoading,needsOverview]);

  useEffect(()=>{if(!authLoading&&needsOverview)return watchItemCatalogue(event=>loadData({background:!['soeicam:item-catalogue-changed','storage'].includes(event?.type)}),{interval:0});},[loadData,authLoading,needsOverview]);

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
    overviewTag.current=null;
    loadSequence.current++; pendingLoad.current?.abort(); pendingLoad.current = null; setRefreshing(false); setLoading(false);
    setProducts(rows => item.item_removed_at ? rows.filter(row => row.id !== item.id) : rows.some(row => row.id === item.id) ? rows.map(row => row.id === item.id ? item : row) : [...rows, item]);
    setRemovedProducts(rows => !item.item_removed_at ? rows.filter(row => row.id !== item.id) : rows.some(row => row.id === item.id) ? rows.map(row => row.id === item.id ? item : row) : [...rows, item]);
  }
  const quickEditor = item => canEdit ? <Suspense fallback={<span role="status" className="text-xs">{ui("Loading...")}</span>}><QuickItemEditor className="min-w-0 [&>button]:h-full [&>button]:w-full" item={item} catalogueItems={products} units={units} unitsLoading={unitsLoading} onOpen={loadUnits} onSaved={item=>{savedItem(item);loadData();}} onEditDetails={editItem} /></Suspense> : null;
  const misplaced=useMemo(()=>finishedStockOutsideColdRoom(products,warehouses,balances),[products,warehouses,balances]);

  useEffect(() => {
    if (workspace.section !== 'recovery') return;
    if (role === 'admin' || role === 'cashier') navigate('/accounting/recovery', { replace: true });
    else {
      if (['warehouse_manager','production_manager'].includes(role)) setShowRecoveryReceipt(true);
      setParams(previous => { previous.set('section','items'); previous.delete('tab'); return previous; }, { replace: true });
    }
  }, [workspace.section, role, navigate, setParams]);
  const sectionTitle = {items:'Items & pricing',stock:'Stock on Hand',movements:'Movements',alerts:'Stock alerts',adjustments:'Stock counts & adjustments',locations:'Storage locations',counts:'Production count requests'}[workspace.section];
  const menu = [
    {key:'items',label:'Items & pricing',icon:Package,open:()=>changeWorkspace({section:'items'})},
    ...(canReceive?[{key:'receiving',label:'Receive inventory',icon:PackageCheck,open:()=>navigate('/purchases?section=receiving')}]:[]),
    ...(canIssueStock?[{key:'issue',label:'Issue goods',icon:Truck,open:()=>{setIssueAgent('');setShowIssue(true);}}]:[]),
    {key:'alerts',label:'Stock alerts',icon:Bell,open:()=>changeWorkspace({section:'alerts'})},
    ...(canManageWarehouses?[{key:'locations',label:'Storage locations',icon:Warehouse,open:()=>changeWorkspace({section:'locations'})}]:[]),
  ];

  const availableFinished=filtered.reduce((sum,item)=>sum+(stock.availableQuantities?.get(item.id)||0),0);
  return <div data-sleek-screen="stock" data-inventory-workspace className="min-w-0 space-y-4">
    <header className="flex items-center justify-between gap-2">
      <div data-page-heading className="flex min-w-0 items-center gap-2">{workspace.section!=='home' && !(phone&&workspace.section==='items') && <PageBackButton onClick={backToMenu} label={ui('Inventory menu')}/>}<h1 className="min-w-0 break-words text-xl font-bold tracking-tight sm:text-2xl">{ui(phone&&workspace.section==='items'?'Stock':sectionTitle || 'Inventory')}</h1></div>
      <div className="flex shrink-0 items-center gap-2">
        {['items','stock','movements'].includes(workspace.section) && <InventoryAlertsMenu items={lowStock} loading={loading} open={alertsOpen} onOpenChange={setAlertsOpen} onOpenItem={canEdit?item=>{setAlertsOpen(false);editItem(item);}:undefined}/>}
        {canEdit && !phone && workspace.section==='items' && <Button aria-label={ui('New item')} className="h-11 gap-1.5 rounded-xl px-3" onClick={() => navigate('/items/new')}><Plus size={17}/><span className="hidden sm:inline">{ui('New item')}</span></Button>}
      </div>
    </header>
    {workspace.section==='home' && !authLoading && <nav aria-label={ui('Inventory sections')} className="mx-auto grid max-w-5xl grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">{menu.map(({key,label,icon:Icon,open})=><button key={key} type="button" aria-label={ui(label)} onClick={open} className="group flex min-h-40 min-w-0 flex-col items-center justify-center gap-4 rounded-2xl border border-slate-200 bg-white px-3 py-6 text-center shadow-sm transition-colors hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 sm:min-h-48"><span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Icon size={28} strokeWidth={1.7} aria-hidden="true"/></span><span className="break-words text-sm font-semibold text-slate-900 sm:text-base">{ui(label)}</span></button>)}</nav>}
    {authLoading && <Pending/>}
    {workspace.section==='items' && !phone && (showCatalogueReceiving || canIssueStock) && <div role="group" aria-label={ui('Inventory actions')} className={'grid gap-2 '+(showCatalogueReceiving&&canIssueStock?'grid-cols-2':'grid-cols-1')}>
      {showCatalogueReceiving && <Button aria-label={ui('Receive inventory')} className="h-auto min-h-12 min-w-0 gap-2 whitespace-normal rounded-xl px-2 py-3 text-xs sm:px-4 sm:text-sm" onClick={() => navigate('/purchases?section=receiving')}><PackageCheck size={18} className="shrink-0"/><span>{ui('Receive inventory')}</span></Button>}
      {canIssueStock && <Button aria-label={ui('Issue goods')} variant="outline" className="h-auto min-h-12 min-w-0 gap-2 whitespace-normal rounded-xl border-primary/30 px-2 py-3 text-xs text-primary sm:px-4 sm:text-sm" onClick={() => {setIssueAgent('');setShowIssue(true);}}><Truck size={18} className="shrink-0"/><span>{ui('Issue goods')}</span></Button>}
    </div>}
    {workspace.section==='items'&&showRemoved&&<div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-slate-50 p-3 text-sm"><strong>{ui('Deleted items')}</strong><Button variant="outline" onClick={()=>changeWorkspace({deleted:''})}>{ui('Back to catalogue')}</Button></div>}
    {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{uiMessage(error)}<button type="button" className="ml-3 underline" onClick={loadData}>{ui("Retry")}</button></div>}
    {workspace.section==='items' && <>
    <nav aria-label={ui("Item types")} className={phone?"-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none]":"grid grid-cols-2 gap-2 sm:flex sm:flex-wrap"}>
      {ITEM_FILTERS.map(filter => <button type="button" key={filter.key} aria-pressed={workspace.filter === filter.key} onClick={() => changeWorkspace({ section: 'items', filter: filter.key, type: 'all' })} className={(phone?"flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-semibold ":"flex min-h-11 min-w-0 items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-sm font-medium sm:justify-center ") + (workspace.filter === filter.key ? "border-primary bg-primary text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-400")}>{filter.label}<span className="text-xs opacity-70">{loading ? "-" : counts[filter.key]}</span></button>)}
    </nav>
    {phone&&hasModule('manufacturing')&&<button type="button" onClick={()=>navigate('/manufacturing?section=recipes')} className="flex min-h-16 w-full items-center gap-3 rounded-[22px] border bg-white p-4 text-left"><span className="rounded-lg bg-secondary p-2"><Package size={22} className="text-primary"/></span><span className="min-w-0 flex-1"><strong className="block text-sm">{ui('Manufacturing')}</strong><span className="block text-xs text-muted-foreground">{ui('Assemblies and production batches')}</span></span><span className="text-xs font-semibold text-primary">{ui('Open')}</span></button>}
    {phone&&<section className="grid grid-cols-3 gap-2 rounded-[22px] border bg-white p-4">{[[workspace.filter==='finished'?'Available units':'Items',workspace.filter==='finished'?availableFinished:filtered.length],['References',filtered.length],['Alerts',lowStock.filter(row=>filtered.some(item=>item.id===row.id)).length]].map(([label,value])=><div key={label} className="min-w-0"><p className="text-[10px] text-muted-foreground">{ui(label)}</p><strong className="mt-1 block text-base tabular-nums">{loading?'—':formatNumber(value,3)}</strong></div>)}</section>}
    <div className="flex items-center justify-between gap-2">
      {phone?<div className="flex min-w-0 items-center gap-2">{showCatalogueReceiving?<Button variant="outline" className="min-h-11 gap-2 rounded-xl text-sm" onClick={()=>navigate('/purchases?section=receiving')}><PackageCheck size={17}/>{ui('Receive inventory')}</Button>:<span className="text-xs text-muted-foreground">{ui("{0} items",filtered.length)}</span>}</div>:<ViewToggle value={view} onChange={setView} options={[{ value: "visual", label: "Photos", icon: Grid2X2 }, { value: "table", label: "Table", icon: List }]} />}
      <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-11 w-11 shrink-0 rounded-xl" aria-label={ui('More inventory tools')}><MoreHorizontal size={20}/></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64 [&_[role=menuitem]]:min-h-11">
          {phone&&canIssueStock&&<DropdownMenuItem onSelect={()=>{setIssueAgent('');setShowIssue(true);}}><Truck size={16} className="mr-2"/>{ui('Issue goods')}</DropdownMenuItem>}
          {phone&&canEdit&&<DropdownMenuItem onSelect={()=>navigate('/items/new')}><Plus size={16} className="mr-2"/>{ui('New item')}</DropdownMenuItem>}
          {phone&&<DropdownMenuItem onSelect={()=>changeWorkspace({section:'alerts'})}><Bell size={16} className="mr-2"/>{ui('Stock alerts')}</DropdownMenuItem>}
          {phone&&canManageWarehouses&&<DropdownMenuItem onSelect={()=>changeWorkspace({section:'locations'})}><Warehouse size={16} className="mr-2"/>{ui('Storage locations')}</DropdownMenuItem>}
          <DropdownMenuItem disabled={refreshing} onSelect={() => loadData()}><RefreshCw size={16} className="mr-2"/>{ui('Refresh')}</DropdownMenuItem>
          {canEdit&&<DropdownMenuItem onSelect={()=>changeWorkspace({section:'items',filter:'all',deleted:showRemoved?'':'1'})}>{ui(showRemoved?'Back to catalogue':'Deleted items')}</DropdownMenuItem>}
          <DropdownMenuItem onSelect={() => changeWorkspace({ section: 'stock' })}>{ui('Stock on Hand')}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => changeWorkspace({ section: 'movements' })}>{ui('Movements')}</DropdownMenuItem>
          {canMoveStock && <DropdownMenuItem disabled={loading} onSelect={() => setShowTransfer(true)}>{ui('Move stock')}</DropdownMenuItem>}
          {canMoveStock && <DropdownMenuItem onSelect={() => setShowRecoveryReceipt(true)}>{ui('Recovered packaging')}</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    {loading ? <Pending/> : <GroupedItems key={workspace.filter + workspace.subtype} products={filtered} filter={workspace.filter} quantities={stock.quantities} onEdit={canEdit ? editItem : undefined} table={view === 'table'} renderActions={item=>!item.item_removed_at?quickEditor(item):null} renderDetails={item=>canEdit?null:<p className="text-xs font-medium text-slate-700">{ui(isAssemblyInventoryType(item.inventory_type)?'Available for sale: {0}':'Available for production use: {0}',formatNumber(item.is_active===false||!isAssemblyInventoryType(item.inventory_type)&&item.configuration_status==='draft'?0:stock.availableQuantities.get(item.id)||0,3))} {stockUnit(item)}</p>}/>}
    </>}
    {workspace.section==='alerts' && (loading?<Pending/>:<Suspense fallback={<Pending/>}><StockAlerts products={products} balances={balances} onEdit={canEdit?editItem:undefined}/></Suspense>)}
    {workspace.section==='adjustments' && (canAdjustStock?<Pending/>:<p role="alert">{ui('Stock adjustments are managed in Accounting by top administrators.')}</p>)}
    <section className="min-w-0">
        {workspace.section === 'stock' && <div className="space-y-4">
          {misplaced.length > 0 && <p role="alert" className="rounded-md border bg-slate-50 p-3 text-xs">{ui('Finished stock recorded outside Cold Room needs a physical-location check.')}</p>}
        <div className="grid gap-3 xl:flex xl:items-end xl:justify-between">
          <label className="grid w-full min-w-0 gap-1 text-xs text-slate-600 xl:max-w-sm">{ui('Location')}<select aria-label={ui('Stock location')} value={params.get('warehouse') || ''} onChange={event=>changeWorkspace({warehouse:event.target.value})} className="h-11 w-full min-w-0 rounded-xl border bg-white px-3 text-sm"><option value="">{ui('All locations')}</option>{warehouses.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
          <div className="flex flex-wrap gap-2"><Button variant="ghost" size="icon" className="h-11 w-11" aria-label={ui('Refresh stock')} disabled={refreshing} onClick={()=>loadData()}><RefreshCw size={17}/></Button>{canMoveStock && <Button className="min-h-11" disabled={loading} onClick={()=>setShowTransfer(true)}><ArrowLeftRight size={16} className="mr-1"/>{ui('Move stock')}</Button>}</div>
        </div>
        {loading ? <Pending/> : <Suspense fallback={<Pending/>}><StockOnHand key={params.get('warehouse') || 'all'} products={products} balances={balances} warehouses={warehouses} warehouseId={params.get('warehouse') || ''}/></Suspense>}

        </div>}
        {workspace.section === 'locations' && canManageWarehouses && <div className="space-y-3"><div className="flex justify-end"><Button className="min-h-11" onClick={()=>setLocationDialog({})}>{ui('Add location')}</Button></div>{loading?<Pending/>:<div className="divide-y rounded-xl border bg-white">{warehouses.filter(w=>!['vehicle','commercial_custody'].includes(w.warehouse_type)).map(w=><div key={w.id} className="flex items-center justify-between gap-3 p-3 text-sm"><div className="min-w-0 break-words"><strong>{w.name}</strong><p className="text-xs text-slate-500">{w.code} · {ui(w.is_active===false?'Inactive':'Active')}</p></div><Button variant="outline" className="min-h-11 shrink-0" onClick={()=>setLocationDialog(w)}>{ui('Edit')}</Button></div>)}</div>}</div>}
        {workspace.section === 'counts' && canMoveStock && hasModule('manufacturing') && (loading?<Pending/>:<Suspense fallback={<Pending/>}><ProductionCountRequests products={products} onCount={canAdjustStock?()=>navigate('/accounting/inventory'):undefined}/></Suspense>)}
        {workspace.section === 'movements' && <div className="space-y-3">
        {canMoveStock && <div className="flex justify-end"><Button disabled={loading} onClick={() => setShowTransfer(true)}><ArrowLeftRight size={16} className="mr-2" />{ui("Move stock")}</Button></div>}
        {loading ? <Pending /> : <Suspense fallback={<Pending />}><MovementLedger warehouseId={params.get('warehouse') || undefined} reportMode={params.get('panel')==='report'} warehouses={warehouses} products={products} refreshKey={movementVersion} /></Suspense>}

        </div>}

    </section>
    {showRecoveryReceipt && <Dialog open onOpenChange={setShowRecoveryReceipt}><DialogContent className="max-h-[92dvh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>{ui('Recovered packaging')}</DialogTitle><DialogDescription>{ui('Receive recovered packaging after accounting treatment. Quality inspection is required before reuse.')}</DialogDescription></DialogHeader><Suspense fallback={<Pending/>}><ExpiryRecovery mode="warehouse" onSaved={loadData}/></Suspense></DialogContent></Dialog>}
    {canIssueStock && showIssue && <Suspense fallback={<Pending/>}><IssueGoods initialAgent={issueAgent} onClose={() => setShowIssue(false)} onSaved={() => { setShowIssue(false); loadData(); }}/></Suspense>}
    <Dialog open={!!editingItem} onOpenChange={open=>{if(!open)closeItemEditor();}}>
      <DialogContent className="max-h-[92dvh] w-[calc(100vw_-_2rem)] max-w-5xl overflow-y-auto" onEscapeKeyDown={event=>{if(editorBusy.current)event.preventDefault();}} onPointerDownOutside={event=>{if(editorBusy.current)event.preventDefault();}}>
        <DialogHeader><DialogTitle>{ui('Edit item: {0}',editingItem?.name || '')}</DialogTitle><DialogDescription>{ui('Update this item without leaving your current inventory section.')}</DialogDescription></DialogHeader>
        {editingItem && <Suspense fallback={<Pending />}><ItemForm key={editingItem.id} embedded itemId={editingItem.id} onBusyChange={busy=>{editorBusy.current=busy;}} onCancel={closeItemEditor} onSaved={item=>{savedItem(item);setEditingItem(null);loadData();}} /></Suspense>}
      </DialogContent>
    </Dialog>
    <Suspense fallback={<Pending />}>
      {canManageWarehouses && locationDialog && <WarehouseDialog open warehouse={locationDialog.id?locationDialog:null} onOpenChange={open=>{if(!open)setLocationDialog(null);}} onSaved={loadData}/> }
      {showTransfer && <StockTransferDialog open onOpenChange={setShowTransfer} products={products.filter(item => item.inventory_type !== "service")} warehouses={warehouses} onSaved={loadData} />}
    </Suspense>
  </div>;
}
