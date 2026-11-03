import React,{useState} from 'react';
import {ui} from '@/lib/i18n';
import {driverRunStock} from '@/lib/driver-stock';
import {driverLoadSnapshot} from '@/lib/driver-deliveries';
import ProductThumb from '@/components/shared/ProductThumb';
import {DriverLoadReceipt} from './DriverDeliveryPlanner';

export default function DriverReceiveInventory({data,preview,onRefresh}) {
  const [selected,setSelected]=useState('');
  const runs=(data.dispatches||[]).filter(run=>['loaded','in_transit'].includes(run.status)&&!(data.activities||[]).some(row=>row.dispatch_id===run.id&&row.type==='trip_returned'));
  const run=runs.find(row=>row.id===selected)||runs[0];
  if(!run)return <p role="status" className="rounded-xl border bg-white p-5 text-sm text-slate-500">{ui('No loaded inventory awaiting receipt.')}</p>;
  const stock=driverRunStock(data,run);
  return <section className="space-y-4 rounded-2xl border bg-white p-4 sm:p-5">
    <label className="block text-sm font-medium">{ui('My delivery run')}<select aria-label={ui('Load to receive')} value={run.id} onChange={event=>setSelected(event.target.value)} className="mt-2 min-h-11 w-full min-w-0 rounded-lg border bg-white px-3 text-sm">{runs.map(row=><option key={row.id} value={row.id}>{row.vehicle_name} / {row.dispatch_number}</option>)}</select></label>
    <div className="divide-y">{stock.rows.map(row=><div key={row.product.id} className="flex items-center gap-3 py-3"><ProductThumb product={row.product} size={48}/><span className="min-w-0 flex-1 break-words text-sm font-medium">{row.product.name}</span><strong className="shrink-0 text-sm">{row.loaded} {row.unit}</strong></div>)}</div>
    <DriverLoadReceipt key={driverLoadSnapshot(run,data.manifest)} data={data} run={run} preview={preview} onRefresh={onRefresh}/>
  </section>;
}
