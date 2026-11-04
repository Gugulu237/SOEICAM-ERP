import React,{useMemo,useState} from 'react';
import {ui} from '@/lib/i18n';
import {useLocaleRender} from '@/lib/localization';
import {formatNumber} from '@/lib/formatters';
import {stockUnit} from '@/lib/item-units';
import {inventoryLowStock} from '@/lib/stock-alerts';
import {Button} from '@/components/ui/button';
import {businessDate} from '@/lib/business-date';

export default function StockAlerts({products,balances,onEdit}) {
  useLocaleRender();
  const date=businessDate(),[page,setPage]=useState(0);
  const alerts=useMemo(()=>inventoryLowStock(products,balances,date),[products,balances,date]);
  const pages=Math.max(1,Math.ceil(alerts.length/25)),currentPage=Math.min(page,pages-1);
  if(!alerts.length)return <p role="status" className="rounded-xl bg-green-50 p-5 text-sm text-green-800">{ui('No low-stock alerts for items with a configured reorder level.')}</p>;
  return <><p className="mb-3 text-xs text-slate-500">{ui('Reorder alerts exclude expired and held quantities. Stock on hand retains the complete physical balance.')}</p><ul className="divide-y rounded-xl border bg-white">{alerts.slice(currentPage*25,currentPage*25+25).map(item=><li key={item.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
    <div className="min-w-0 flex-1"><p className="break-words text-sm font-semibold">{item.name}</p><p className="mt-1 text-xs text-slate-500">{ui('Reorder level')}: {formatNumber(item.reorder,2)} {stockUnit(item)}</p></div>
    <div className="text-right"><p className={'text-sm font-semibold '+(item.stock<=0?'text-red-700':'text-amber-700')}>{formatNumber(item.stock,2)} {stockUnit(item)}</p><p className="text-xs text-slate-500">{item.stock<=0?ui('Out of stock'):ui('Low stock')}</p></div>
    {onEdit&&<Button size="sm" variant="outline" onClick={()=>onEdit(item)}>{ui('Open item')}</Button>}
  </li>)}</ul>{pages>1&&<nav aria-label={ui('Stock alert pages')} className="mt-3 flex items-center justify-between gap-2 text-xs text-slate-500"><Button type="button" variant="outline" disabled={!currentPage} onClick={()=>setPage(currentPage-1)}>{ui('Previous')}</Button><span>{ui('Showing {0}-{1} of {2} items',currentPage*25+1,Math.min((currentPage+1)*25,alerts.length),alerts.length)}</span><Button type="button" variant="outline" disabled={currentPage>=pages-1} onClick={()=>setPage(currentPage+1)}>{ui('Next')}</Button></nav>}</>;
}
