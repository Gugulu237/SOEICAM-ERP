import React from 'react';
import {ui} from '@/lib/i18n';
import {formatQuantity} from '@/lib/formatters';
import {stockUnit} from '@/lib/item-units';
import ProductThumb from '@/components/shared/ProductThumb';

export function currentStockRows(data, {dispatchId, kind} = {}) {
  const products = new Map((data?.products || []).map(p => [p.id, p]));
  const groups = new Map();
  for (const balance of data?.balances || []) {
    if (!(Number(balance.quantity) > 0) || dispatchId && balance.dispatch_id !== dispatchId || kind && balance.stock_kind !== kind) continue;
    const stockKind = balance.stock_kind || 'issued', key = balance.product_id + ':' + stockKind;
    const product = products.get(balance.product_id) || {id:balance.product_id, name:balance.product_name || balance.product_id};
    const row = groups.get(key) || {key, product, kind:stockKind, unit:stockUnit(product), quantity:0, sale:0, giveaway:0, held:0, lots:[]};
    row.quantity += Number(balance.quantity); row.sale += Number(balance.usable_quantity || 0);
    row.giveaway += Number(balance.degustation_quantity || 0); row.held += Number(balance.held_quantity || 0);
    row.lots.push(balance); groups.set(key, row);
  }
  return [...groups.values()].sort((a, b) => a.product.name.localeCompare(b.product.name));
}

export default function IssuedStockRows({rows, details = false}) {
  return <ul className="divide-y divide-slate-100">{rows.map(row => <li key={row.key} className="min-w-0 py-3">
    <div className="flex min-w-0 items-center gap-3">
      <ProductThumb product={row.product} size={44}/>
      <div className="min-w-0 flex-1"><p className="break-words text-sm font-semibold">{row.product.name}</p>
        {row.kind !== 'issued' && <p className="mt-1 text-xs text-amber-800">{ui(row.kind === 'customer_return' ? 'Collected returns / recovered packaging' : 'Stock awaiting reconciliation')}</p>}
      </div>
      <div className="max-w-[40%] shrink-0 text-right"><p className="text-[11px] text-slate-500">{ui('On hand')}</p><p className="break-words text-xl font-bold tabular-nums text-green-800">{formatQuantity(row.quantity)} <span className="text-xs font-medium">{row.unit}</span></p></div>
    </div>
    <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {row.kind === 'issued' && <div className="flex gap-1"><dt className="text-slate-500">{ui('For sale')}:</dt><dd className="font-semibold tabular-nums">{formatQuantity(row.sale)}</dd></div>}
      {row.giveaway > 0 && <div className="flex gap-1"><dt className="text-slate-500">{ui('Dégustation')}:</dt><dd className="font-semibold tabular-nums">{formatQuantity(row.giveaway)}</dd></div>}
      {row.held > 0 && <div className="flex gap-1 text-amber-800"><dt>{ui('Held / expired')}:</dt><dd className="font-semibold tabular-nums">{formatQuantity(row.held)}</dd></div>}
    </dl>
    {details && <details className="mt-2 text-xs text-slate-500"><summary className="cursor-pointer py-2">{ui('Batch details')}</summary><div className="space-y-2 pb-2">{row.lots.map(lot => <p key={lot.id} className="break-words">{lot.lot_number || ui('No batch recorded')} · {formatQuantity(lot.quantity)} {row.unit} · {ui(lot.qc_status || 'approved')}{lot.expiry_date ? ' · ' + ui('Expiry') + ': ' + lot.expiry_date : ''}</p>)}</div></details>}
  </li>)}</ul>;
}
