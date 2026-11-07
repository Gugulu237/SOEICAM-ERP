import React from 'react';
import {Link} from '@/lib/router';
import {ui, uiMessage} from '@/lib/i18n';
import {useLocaleRender} from '@/lib/localization';
import {formatDateTime} from '@/lib/formatters';
import {useMyStock} from '@/hooks/useMyStock';
import {Button} from '@/components/ui/button';
import {Package, RefreshCw, ArrowRight} from 'lucide-react';
import IssuedStockRows, {currentStockRows} from './IssuedStockRows';

export default function MyStockOverview() {
  useLocaleRender();
  const {data, error, busy, enabled, refresh} = useMyStock();
  if (!enabled) return null;
  const rows = currentStockRows(data), pending = data?.runs.some(run => run.pending_return);
  const needsReview = data?.runs.some(run => run.stock_error) || data?.legacy?.some(location => location.stock_error);
  return <section aria-label={ui('My current stock')} className="min-w-0 rounded-2xl border border-green-200 bg-white p-4 shadow-sm sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="flex items-center gap-2 text-base font-semibold"><Package size={20} className="text-green-700"/>{ui('My current stock')}</h2><Button variant="ghost" size="sm" aria-label={ui('Refresh my stock')} disabled={busy} onClick={refresh}><RefreshCw size={15} className={'mr-1 ' + (busy ? 'animate-spin' : '')}/>{ui('Refresh')}</Button></div>
    {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-xs text-red-800">{ui(data ? 'Stock refresh failed. Showing the last confirmed quantities.' : 'Could not load your current stock.')} {uiMessage(error)} <button className="underline" disabled={busy} onClick={refresh}>{ui('Retry')}</button></p>}
    {!data && !error && <p role="status" className="py-5 text-sm text-slate-500">{ui('Loading assigned inventory...')}</p>}
    {data && <>
      {pending && <p className="mt-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">{ui('Awaiting warehouse receipt. These goods are still in your possession.')}</p>}
      {needsReview && <p role="status" className="mt-3 text-xs text-amber-900">{ui('Some stock needs review. Open the full list for details.')}</p>}
      <IssuedStockRows rows={rows.slice(0, 4)}/>
      {!rows.length && !needsReview && <p className="py-5 text-sm text-slate-500">{ui('No goods currently assigned')}</p>}
      {rows.length > 4 && <p className="mt-1 text-xs text-slate-500">{ui('Showing {0} of {1} stock items', 4, rows.length)}</p>}
      {data.updated_at && <p className="mt-2 text-[11px] text-slate-500">{ui('Last stock update')}: {formatDateTime(data.updated_at)}</p>}
    </>}
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3"><Link to="/my-stock" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-green-700 px-3 py-2 text-sm font-semibold text-white hover:bg-green-800">{ui('View all stock')}<ArrowRight size={16}/></Link><Link to="/my-stock/returns" className="inline-flex min-h-11 items-center rounded-lg px-3 py-2 text-sm font-medium text-green-800 hover:bg-green-50">{ui('Return goods')}</Link></div>
  </section>;
}
