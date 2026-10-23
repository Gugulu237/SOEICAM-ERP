
/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import { formatNumber } from '@/lib/formatters';
import { warehouseStockLevel } from '@/lib/warehouse-stock';

const tones = {
  negative: ['bg-red-500', 'text-red-700', 'Check negative balance'],
  empty: ['bg-red-500', 'text-red-700', 'Out of stock'],
  low: ['bg-slate-500', 'text-slate-800', 'Low stock'],
  available: ['bg-green-600', 'text-green-700', 'In stock'],
};

export default function StockLevelPill({ row }) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const level = warehouseStockLevel(row.product, row.quantity);
  const [fill, text, label] = tones[level.status];
  const quantity = `${formatNumber(row.quantity, 3)} ${row.unit}`;
  const reference = level.reference ? `${level.referenceLabel}: ${formatNumber(level.reference, 3)} ${row.unit}` : ui("No stock reference set");
  return <div className="min-w-44 max-w-60 space-y-1.5">
    <div className="flex items-baseline justify-between gap-3"><span className="whitespace-nowrap font-semibold tabular-nums text-slate-900">{quantity}</span><span className={`whitespace-nowrap text-[11px] ${text}`}>{label}</span></div>
    <div className="flex items-center gap-0.5" title={ui("{0} on hand. {1}. Item settings apply across warehouses.", quantity, reference)}>
      <div className="h-2.5 flex-1 overflow-hidden rounded-full border border-slate-200 bg-slate-100 p-px"
        role={level.reference ? 'meter' : 'img'} aria-label={ui("{0}: {1} on hand. {2}.", row.name, quantity, reference)}
        aria-valuemin={level.reference ? 0 : undefined} aria-valuemax={level.reference || undefined}
        aria-valuenow={level.reference ? Math.min(level.reference, Math.max(0, row.quantity)) : undefined}
        aria-valuetext={level.reference ? `${quantity} on hand. ${reference}.` : undefined}>
        {level.percent !== null ? <div className={`h-full rounded-full ${fill}`} style={{ width: `${level.percent}%` }} />
          : row.quantity > 0 && <div className="h-full rounded-full opacity-40" style={{ background: 'repeating-linear-gradient(120deg, #94a3b8 0px, #94a3b8 2px, transparent 2px, transparent 5px)' }} />}
      </div><span aria-hidden="true" className="h-1 w-0.5 rounded-r bg-slate-300" />
    </div>
    <p className="text-[10px] text-slate-500">{reference}</p>
  </div>;
}
