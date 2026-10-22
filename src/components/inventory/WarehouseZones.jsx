
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { lazy, Suspense, useMemo, useState } from 'react';
import { ArrowLeft, Plus, Pencil, Download, MapPin, Activity, ChartNoAxesCombined } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePageState } from '@/lib/navigation-context';
import WarehouseArtwork from './WarehouseArtwork';
import WarehouseStockItems from './WarehouseStockItems';
import WarehouseVehicles, { VehicleGroupBanner } from './WarehouseVehicles';
import { matchesVehicleEntry, vehicleStockOverview } from '@/lib/warehouse-vehicles';
import { formatXAF } from '@/lib/formatters';
import { warehouseItemStock } from '@/lib/warehouse-stock';
import { warehousePresentation } from '@/lib/warehouse-presentation';
import { WAREHOUSE_TYPES, MANAGED_WAREHOUSE_TYPES, warehouseSnapshot, downloadCsv } from '@/lib/warehouse-workspace';
const WarehouseDialog = lazy(() => import('@/components/admin/WarehouseDialog'));
const MovementLedger = lazy(() => import('./MovementLedger'));

export function WarehouseScene({ type }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  return <WarehouseArtwork type={type} />;
}

export default function WarehouseZones({ warehouses, balances, products = [], vehicles = [], canManage = false, onSaved, selectedId = '', group = '', panel = 'stock', onSelect, refreshKey, renderItemActions, onEditItem, onAdjust }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [search,setSearch] = usePageState('warehouses:search', '', { scope: 'path' }), [type,setType] = usePageState('warehouses:type', '', { scope: 'path' }), [status,setStatus] = usePageState('warehouses:status', 'active', { scope: 'path' });
  const [dialog,setDialog] = useState(null);
  const selected = warehouses.find(w => w.id === selectedId);
  const canAdjust=!!onAdjust && selected?.is_active!==false && selected && !MANAGED_WAREHOUSE_TYPES.includes(selected.warehouse_type);
  const selectedPresentation = selected ? warehousePresentation(selected) : null;
  const selectedGroup = selected?.warehouse_type === 'vehicle' ? 'vehicles' : '';
  const vehicleEntries = useMemo(() => vehicleStockOverview(warehouses, vehicles, products, balances), [warehouses, vehicles, products, balances]);
  const matchingVehicles = vehicleEntries.filter(entry => matchesVehicleEntry(entry, search, status));
  const showVehicleGroup = (!type || type === 'vehicle') && matchingVehicles.length > 0;
  const stats = selected ? warehouseSnapshot(selected,balances) : null;
  const itemRows = useMemo(() => selected ? warehouseItemStock(selected, products, balances) : [], [selected, products, balances]);
  const filtered = warehouses.filter(w => w.warehouse_type !== 'vehicle' && (!type || w.warehouse_type === type) && (status === 'all' || (w.is_active !== false) === (status === 'active')) && [w.name,w.code,w.address].join(' ').toLowerCase().includes(search.toLowerCase()));
  const exportStock = warehouse => {
    const rows = warehouseItemStock(warehouse, products, balances);
    downloadCsv('SOEICAM-warehouse-'+String(warehouse.code || warehouse.id).replace(/[^a-zA-Z0-9_-]/g,'')+'-stock.csv',[
      [ui("SOEICAM current warehouse stock")],['Warehouse',warehouse.name],['Code',warehouse.code],[ui("Generated at"),new Date().toISOString()],[ui("Current snapshot, not a historical closing balance")],
      ['Item', 'Code', ui("On hand"), ui("Stock U/M"), 'Usable', ui("Held / expired"), ui("Stock value (XAF)"), ui("Stock record")],
      ...rows.map(row => [row.name, row.product?.sku, row.quantity, row.unit, row.usable, row.blocked, row.value, row.hasRecordedBalance ? 'Recorded' : ui("No stock recorded here")]),
      [], [ui("Stock record detail")], ['Item',ui("Batch / lot"),'Expiry',ui("QC status"),'Quantity',ui("Stock U/M"),ui("Unit cost (XAF)"),ui("Stock value (XAF)")],
      ...rows.flatMap(item => item.lots.map(row => [item.name,row.batch_number || row.lot_number,row.expiry_date,row.qc_status || 'approved',Number(row.quantity),item.unit,Number(row.unit_cost || 0),Number(row.total_value || 0)])),
    ]);
  };
  return <div className="space-y-5">
    {selected ? <>
      <div className="overflow-hidden rounded-2xl border bg-white"><div className="grid sm:grid-cols-[220px_1fr]"><WarehouseScene type={selected.warehouse_type} /><div className="p-5"><div className="flex flex-wrap items-center gap-3"><Button variant="ghost" size="icon" aria-label={selectedGroup ? ui("All vehicles") : ui("All warehouses")} onClick={() => onSelect('','stock',selectedGroup)}><ArrowLeft size={17} /></Button><div className="mr-auto"><p className="text-xs text-slate-500">{selected.code}</p><h2 className="mt-1 text-xl font-semibold">{selectedPresentation.title}</h2>{selectedPresentation.subtitle && <p className="mt-1 text-sm text-slate-500">{selectedPresentation.subtitle}</p>}</div>{canManage && <Button variant="outline" size="sm" onClick={() => setDialog(selected)}><Pencil size={14} className="mr-2" />{ui("Edit warehouse")}</Button>}</div><p className="mt-3 flex items-center gap-2 text-xs text-slate-500"><MapPin size={14} />{selected.address || ui("No address recorded")} · {selected.is_active === false ? ui("Inactive") : ui("Active")}</p></div></div></div>
      {selected.warehouse_type==='cold_room' && <p className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">{ui('All active finished assemblies are listed below. Quantities show only stock physically recorded in this Cold Room; held lots stay unavailable until quality release.')}</p>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[[ui("Items in stock"),stats.products],[ui("Stock value"),formatXAF(stats.value)],[ui("Lots on hold"),stats.held],[ui("Expiry attention"),stats.expiring]].map(([label,value]) => <div key={label} className="rounded-xl border bg-white p-4"><p className="text-xs text-slate-500">{label}</p><p className="mt-2 text-xl font-bold">{value}</p></div>)}</div>
      <div className="flex flex-wrap items-center gap-2">{[['stock',ui("Current stock")],['activity','Activity'],['report','Reports']].map(([key,label]) => <Button key={key} variant={panel === key ? 'default' : 'outline'} onClick={() => onSelect(selected.id,key,selectedGroup)}>{label}</Button>)}{canAdjust && <Button variant="outline" onClick={()=>onAdjust(selected)}>{ui("Adjust quantity")}</Button>}<Button variant="outline" className="sm:ml-auto" onClick={() => exportStock(selected)}><Download size={15} className="mr-2" />{ui("Export current stock")}</Button></div>
      {panel === 'stock' ? <WarehouseStockItems key={selected.id} rows={itemRows} renderItemActions={renderItemActions} onEditItem={onEditItem} onAdjust={canAdjust ? product=>onAdjust(selected,product) : undefined} /> : <Suspense fallback={<p role="status">{ui("Loading activity...")}</p>}><MovementLedger key={selected.id+panel} warehouseId={selected.id} warehouses={warehouses} products={products} refreshKey={refreshKey} reportMode={panel === 'report'} /></Suspense>}
    </> : group === 'vehicles' ? <>
      {selectedId && <p role="alert" className="text-sm text-red-700">{ui("This vehicle stock location is unavailable. Choose a van below.")}</p>}
      <WarehouseVehicles entries={vehicleEntries} onBack={() => onSelect('', 'stock', '')} onSelect={onSelect} />
    </> : <>
      {selectedId && <p role="alert" className="text-sm text-red-700">{ui("This warehouse is unavailable. Choose a location below.")}</p>}
      <div className="flex flex-wrap gap-3"><input aria-label={ui("Search warehouses")} placeholder={ui("Search name, code or address...")} className="h-11 min-w-48 flex-1 rounded-lg border bg-white px-3 text-sm" value={search} onChange={e => setSearch(e.target.value)} /><select aria-label={ui("Warehouse type")} className="h-11 rounded-lg border bg-white px-3 text-sm" value={type} onChange={e => setType(e.target.value)}><option value="">{ui("All warehouse types")}</option>{Object.entries(WAREHOUSE_TYPES).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select><select aria-label={ui("Warehouse status")} className="h-11 rounded-lg border bg-white px-3 text-sm" value={status} onChange={e => setStatus(e.target.value)}><option value="active">{ui("Active")}</option><option value="inactive">{ui("Inactive")}</option><option value="all">{ui("All statuses")}</option></select>{canManage && <Button className="h-11" onClick={() => setDialog({})}><Plus size={16} className="mr-2" />{ui("New warehouse")}</Button>}</div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{filtered.map(warehouse => {const snapshot=warehouseSnapshot(warehouse,balances), presentation=warehousePresentation(warehouse);return <article key={warehouse.id} className="overflow-hidden rounded-2xl border bg-white transition hover:border-green-300 hover:shadow-sm"><button className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-green-600" onClick={() => onSelect(warehouse.id,'stock')}><WarehouseScene type={warehouse.warehouse_type} /><div className="px-5 pt-4"><div className="flex items-center justify-between gap-2 text-xs text-slate-500"><span>{warehouse.code}</span></div><h3 className="mt-1 text-lg font-semibold text-slate-900">{presentation.title}</h3>{presentation.subtitle && <p className="mt-1 text-xs leading-5 text-slate-500">{presentation.subtitle}</p>}<div className="mt-4 grid grid-cols-[1fr_auto] items-end gap-3"><div><p className="text-xs text-slate-500">{ui("Current stock value")}</p><p className="mt-1 font-bold text-green-800">{formatXAF(snapshot.value)}</p></div><p className="text-xs text-slate-500">{snapshot.products}{ui(" items · ")}{snapshot.lots.length}{ui(" lots")}</p></div><div className="mt-3 flex min-h-6 flex-wrap gap-2 text-[11px]">{warehouse.is_active === false && <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">{ui("Inactive")}</span>}{snapshot.held > 0 && <span className="rounded-full bg-rose-50 px-2 py-1 text-rose-700">{snapshot.held}{ui(" held lots")}</span>}{snapshot.expiring > 0 && <span className="rounded-full bg-amber-50 px-2 py-1 text-amber-800">{snapshot.expiring}{ui(" expiry alerts")}</span>}</div></div></button><div className="mx-5 mb-4 mt-3 flex flex-wrap gap-2 border-t pt-3"><Button size="sm" variant="ghost" onClick={() => onSelect(warehouse.id,'activity')}><Activity size={14} className="mr-1" />{ui("Activity")}</Button><Button size="sm" variant="ghost" onClick={() => onSelect(warehouse.id,'report')}><ChartNoAxesCombined size={14} className="mr-1" />{ui("Reports")}</Button>{canManage && <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setDialog(warehouse)} aria-label={'Edit '+warehouse.name}><Pencil size={14} /></Button>}</div></article>;})}{showVehicleGroup && <VehicleGroupBanner entries={matchingVehicles} onOpen={() => onSelect('', 'stock', 'vehicles')} />}</div>
      {!filtered.length && !showVehicleGroup && <p className="rounded-2xl border bg-white p-8 text-sm text-slate-500">{ui("No warehouses match these filters.")}</p>}
    </>}
    {dialog && <Suspense fallback={<p role="status">{ui("Opening warehouse editor...")}</p>}><WarehouseDialog open warehouse={dialog.id ? dialog : null} onOpenChange={open => {if (!open) setDialog(null);}} onSaved={onSaved} /></Suspense>}
  </div>;
}
