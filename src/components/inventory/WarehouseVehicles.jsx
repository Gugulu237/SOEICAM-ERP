
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import { usePageState } from '@/lib/navigation-context';
import { ArrowLeft, ArrowRight, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ProductThumb from '@/components/shared/ProductThumb';
import { formatNumber, formatXAF } from '@/lib/formatters';
import { matchesVehicleEntry, vehicleFleetSummary } from '@/lib/warehouse-vehicles';
import WarehouseArtwork from './WarehouseArtwork';

export function VehicleGroupBanner({ entries, onOpen }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const summary = vehicleFleetSummary(entries);
  return <button type="button" onClick={onOpen} className="overflow-hidden rounded-2xl border bg-white text-left transition hover:border-green-300 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600">
    <WarehouseArtwork type="vehicle" />
    <div className="p-5">
      <div className="flex items-center justify-between gap-3"><h3 className="text-lg font-semibold text-slate-900">{ui("Vehicles")}</h3><span className="rounded-full bg-green-50 px-3 py-1 text-xs font-medium text-green-800">{summary.count} {summary.count === 1 ? ui("van") : ui("vans")}</span></div>
      <p className="mt-2 text-xs text-slate-500">{ui("View the vans and the stock they carry.")}</p>
      <div className="mt-4"><p className="text-xs text-slate-500">{ui("Current vehicle stock value")}</p><p className="mt-1 font-bold text-green-800">{formatXAF(summary.value)}</p></div>
      <div className="mt-5 flex items-center justify-between border-t pt-3 text-sm font-medium text-green-800">{ui("View vehicles")}<ArrowRight size={17} aria-hidden="true" /></div>
    </div>
  </button>;
}

export default function WarehouseVehicles({ entries, onBack, onSelect }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [search, setSearch] = usePageState('vehicles:search', ''), [status, setStatus] = usePageState('vehicles:status', 'all');
  const summary = vehicleFleetSummary(entries);
  const filtered = entries.filter(entry => matchesVehicleEntry(entry, search, status));
  return <div className="space-y-4">
    <div className="overflow-hidden rounded-2xl border bg-white sm:grid sm:grid-cols-[200px_1fr]">
      <WarehouseArtwork type="vehicle" />
      <div className="p-5">
        <Button variant="ghost" size="sm" className="-ml-3 mb-3" onClick={onBack}><ArrowLeft size={16} className="mr-2" />{ui("All warehouses")}</Button>
        <h2 className="text-xl font-semibold">{ui("Vehicles")}</h2>
        <p className="mt-1 text-sm text-slate-500">{ui("Select a van to view its products, batches and stock movements.")}</p>
        <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
          <div><dt className="text-xs text-slate-500">{ui("Vans")}</dt><dd className="mt-1 font-semibold">{summary.count}</dd></div>
          <div><dt className="text-xs text-slate-500">{ui("Locations carrying stock")}</dt><dd className="mt-1 font-semibold">{summary.withStock}</dd></div>
          <div><dt className="text-xs text-slate-500">{ui("Current stock value")}</dt><dd className="mt-1 font-semibold text-green-800">{formatXAF(summary.value)}</dd></div>
        </dl>
      </div>
    </div>
    <div className="flex flex-wrap gap-3">
      <div className="relative min-w-48 flex-1"><Search size={16} aria-hidden="true" className="absolute left-3 top-3.5 text-slate-400" /><input aria-label={ui("Search vehicles")} placeholder={ui("Search van name or registration...")} value={search} onChange={event => setSearch(event.target.value)} className="h-11 w-full rounded-lg border bg-white pl-9 pr-3 text-sm" /></div>
      <select aria-label={ui("Vehicle status")} value={status} onChange={event => setStatus(event.target.value)} className="h-11 rounded-lg border bg-white px-3 text-sm"><option value="all">{ui("All vehicles")}</option><option value="active">{ui("Active")}</option><option value="inactive">{ui("Inactive")}</option></select>
    </div>
    <div className="space-y-3">{filtered.map(entry => <article key={entry.id} className="overflow-hidden rounded-2xl border bg-white lg:grid lg:grid-cols-[minmax(230px,1fr)_2fr]">
      <div className="border-b bg-slate-50/60 p-5 lg:border-b-0 lg:border-r">
        <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-medium tracking-wide text-slate-500">{entry.registration || ui("Registration not recorded")}</p><h3 className="mt-1 text-lg font-semibold text-slate-900">{entry.name}</h3></div><span className={`rounded-full px-2 py-1 text-[11px] font-medium ${entry.active ? 'bg-green-100 text-green-800' : 'bg-slate-200 text-slate-600'}`}>{entry.active ? ui("Active") : ui("Inactive")}</span></div>
        {entry.warehouse && <p className="mt-2 text-xs text-slate-500">{ui("Stock location: ")}{entry.warehouse.name}</p>}
        {entry.issue && <p className="mt-3 text-xs leading-5 text-slate-800">{entry.issue}</p>}
        {entry.snapshot && <div className="mt-4 flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-slate-500">{entry.snapshot.products}{ui(" items in stock")}</span><span className="text-sm font-semibold text-green-800">{formatXAF(entry.snapshot.value)}</span></div>}
        {entry.warehouse && <Button variant="outline" size="sm" className="mt-4 w-full justify-between" onClick={() => onSelect(entry.warehouse.id, 'stock', 'vehicles')} aria-label={ui("View inventory for {0}", entry.name)}>{ui("View inventory")}<ArrowRight size={15} /></Button>}
      </div>
      <div className="p-5">
        <p className="mb-3 text-xs font-medium text-slate-500">{ui("Current inventory")}{entry.vehicles.length > 1 ? ui(" · shared location") : ''}</p>
        {entry.items.length ? <><ul className="divide-y">{entry.items.slice(0, 3).map(item => <li key={item.id} className="flex items-center gap-3 py-3 first:pt-0">
          <ProductThumb product={item.product} name={item.name} size={40} /><span className="min-w-0 flex-1 text-sm font-medium text-slate-800">{item.name}</span>
          <div className="shrink-0 text-right"><p className="text-sm font-semibold tabular-nums">{formatNumber(item.quantity, 3)} {item.unit}</p>{item.blocked > 0 && <p className="mt-1 text-[11px] text-slate-800">{formatNumber(item.blocked, 3)}{ui(" held / expired")}</p>}</div>
        </li>)}</ul>{entry.items.length > 3 && <button type="button" onClick={() => onSelect(entry.warehouse.id, 'stock', 'vehicles')} className="mt-2 text-xs font-medium text-green-800 underline">{ui("View all ")}{entry.items.length}{ui(" items")}</button>}</> : <p className="py-6 text-sm text-slate-500">{entry.warehouse ? ui("No stock currently recorded in this van.") : ui("Inventory unavailable until a vehicle stock location is assigned.")}</p>}
      </div>
    </article>)}</div>
    {!filtered.length && <p className="rounded-2xl border bg-white p-8 text-sm text-slate-500">{entries.length ? ui("No vehicles match these filters.") : ui("No vehicles or vehicle stock locations are available.")}</p>}
  </div>;
}
