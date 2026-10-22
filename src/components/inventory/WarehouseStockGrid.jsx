
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import ProductThumb from '@/components/shared/ProductThumb';
import { formatNumber } from '@/lib/formatters';
import { warehouseItemStock } from '@/lib/warehouse-stock';

// Use the same catalogue + recorded-balance union as an individual warehouse.
export default function WarehouseStockGrid({ products, warehouses, balances, onEditItem }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const locations = warehouses.filter(w => w.is_active !== false || balances.some(b => b.warehouse_id === w.id));
  const cells = new Map(), items = new Map();
  for (const warehouse of locations) {
    for (const row of warehouseItemStock(warehouse, products, balances)) {
      cells.set(`${row.id}|${warehouse.id}`, row);
      items.set(row.id, row);
    }
  }
  const rows = [...items.values()].sort((a, b) => a.name.localeCompare(b.name));
  if (!rows.length) return <p className="rounded-lg border bg-white p-8 text-sm text-slate-500">{ui("No warehouse items to display.")}</p>;
  return <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
    <table className="w-full text-sm">
      <caption className="border-b px-4 py-3 text-left text-xs text-slate-500">{ui("Zero means no quantity is recorded here. A dash means this item has no catalogue or stock association with that warehouse.")}</caption>
      <thead><tr className="border-b bg-slate-50">
        <th scope="col" className="px-4 py-3 text-left font-semibold text-slate-600">{ui("Item")}</th>
        {locations.map(w => <th scope="col" key={w.id} className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-600">{w.name}</th>)}
        <th scope="col" className="px-4 py-3 text-right font-semibold text-slate-900">{ui("Total")}</th>
      </tr></thead>
      <tbody>{rows.map(item => {
        const total = locations.reduce((sum, w) => sum + (cells.get(`${item.id}|${w.id}`)?.quantity || 0), 0);
        return <tr key={item.id} className="border-b border-slate-100 last:border-0">
          <th scope="row" className="min-w-60 px-4 py-3 text-left font-normal"><div className="flex items-center gap-3"><ProductThumb product={item.product} name={item.name} size={44} /><div>{item.product && onEditItem ? <button type="button" aria-label={ui('Edit {0}',item.name)} onClick={()=>onEditItem(item.product)} className="text-left font-medium text-green-800 underline-offset-2 hover:underline">{item.name}</button> : <p className="font-medium text-slate-900">{item.name}</p>}<p className="text-xs text-slate-500">{item.product?.sku || ui("No code")} · {item.unit}</p></div></div></th>
          {locations.map(w => {
            const row = cells.get(`${item.id}|${w.id}`);
            return <td key={w.id} title={row && !row.hasRecordedBalance ? ui("No stock recorded here") : undefined} className={`px-4 py-3 text-right tabular-nums ${row?.quantity ? 'text-slate-800' : 'text-slate-400'}`}>{row ? formatNumber(row.quantity, 3) : '—'}</td>;
          })}
          <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-900">{formatNumber(total, 3)}</td>
        </tr>;
      })}</tbody>
    </table>
  </div>;
}
