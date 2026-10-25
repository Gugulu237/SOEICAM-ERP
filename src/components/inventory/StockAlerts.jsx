import React from 'react';
import {ui} from '@/lib/i18n';
import {useLocaleRender} from '@/lib/localization';
import {formatNumber} from '@/lib/formatters';
import {stockUnit} from '@/lib/item-units';
import {inventoryLowStock} from '@/lib/stock-alerts';
import {Button} from '@/components/ui/button';

export default function StockAlerts({products,balances,onEdit}) {
  useLocaleRender();
  const alerts=inventoryLowStock(products,balances);
  if(!alerts.length)return <p role="status" className="rounded-xl bg-green-50 p-5 text-sm text-green-800">{ui('All stocked items are above their reorder level.')}</p>;
  return <ul className="divide-y rounded-xl border bg-white">{alerts.map(item=><li key={item.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
    <div className="min-w-0 flex-1"><p className="break-words text-sm font-semibold">{item.name}</p><p className="mt-1 text-xs text-slate-500">{ui('Reorder level')}: {formatNumber(item.reorder,2)} {stockUnit(item)}</p></div>
    <div className="text-right"><p className={'text-sm font-semibold '+(item.stock<=0?'text-red-700':'text-amber-700')}>{formatNumber(item.stock,2)} {stockUnit(item)}</p><p className="text-xs text-slate-500">{item.stock<=0?ui('Out of stock'):ui('Low stock')}</p></div>
    {onEdit&&<Button size="sm" variant="outline" onClick={()=>onEdit(item)}>{ui('Open item')}</Button>}
  </li>)}</ul>;
}
