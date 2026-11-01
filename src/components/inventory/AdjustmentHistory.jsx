import React, {useEffect, useState} from 'react';
import {invokeFieldOps} from '@/lib/field-ops';
import {ui, uiMessage} from '@/lib/i18n';
import {useLocaleRender} from '@/lib/localization';
import {formatDate, formatNumber, formatXAF} from '@/lib/formatters';
import {warehouseAdjustmentDocument} from '@/lib/report-models';
import ReportExport from '@/components/shared/ReportExport';
import {Button} from '@/components/ui/button';
import {Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription} from '@/components/ui/dialog';
import {ClipboardCheck, RefreshCw} from 'lucide-react';

export default function AdjustmentHistory({onAdjust, refreshKey=0}) {
  useLocaleRender();
  const [page,setPage]=useState(1),[reload,setReload]=useState(0),[data,setData]=useState(null);
  const [loading,setLoading]=useState(true),[error,setError]=useState(''),[selected,setSelected]=useState(''),[detail,setDetail]=useState(null),[detailError,setDetailError]=useState('');
  useEffect(()=>{
    let active=true;setLoading(true);setError('');setData(null);
    invokeFieldOps({action:'warehouseAdjustmentHistory',page}).then(({data:next})=>{if(next.error)throw Error(next.error);if(active)setData(next);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[page,reload,refreshKey]);
  useEffect(()=>{
    if(!selected)return;
    let active=true;setDetail(null);setDetailError('');
    invokeFieldOps({action:'warehouseAdjustmentHistory',adjustmentId:selected}).then(({data:next})=>{if(next.error)throw Error(next.error);if(active)setDetail(next);}).catch(e=>{if(active)setDetailError(e.message);});
    return()=>{active=false;};
  },[selected,reload]);
  const result=detail?.adjustment;
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">{onAdjust&&<Button onClick={onAdjust}><ClipboardCheck size={17} className="mr-2"/>{ui('Record physical count')}</Button>}<Button variant="outline" disabled={loading} onClick={()=>setReload(n=>n+1)}><RefreshCw size={16} className="mr-2"/>{ui('Refresh')}</Button></div>
    <p className="text-sm text-slate-600">{ui('Record counted quantities by location and lot. Every posted difference keeps its count reference, responsible staff, stock movement and accounting entry.')}</p>
    {error&&<p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{uiMessage(error)}</p>}
    {loading?<p role="status">{ui('Loading adjustments...')}</p>:<div className="space-y-2">{data?.adjustments.map(row=><button type="button" key={row.id} onClick={()=>setSelected(row.id)} className="flex w-full min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-4 text-left hover:border-primary"><span className="min-w-0"><strong className="block break-words text-sm">{row.reference}</strong><span className="text-xs text-slate-500">{formatDate(row.date)} · {row.warehouse_name}</span><span className="block text-xs text-slate-500">{row.recorded_by} · {ui('{0} counted lots',row.line_count)}</span></span><span className="text-right"><strong className="block text-sm">{formatXAF(row.value_difference)}</strong><span className="text-xs text-slate-500">{row.journal_number||ui('No value change')}</span></span></button>)}{data&&!data.adjustments.length&&<p className="rounded-xl border bg-white p-5 text-sm text-slate-500">{ui('No posted quantity adjustments.')}</p>}</div>}
    <div className="flex items-center justify-end gap-3"><Button variant="outline" disabled={loading||page===1} onClick={()=>setPage(p=>p-1)}>{ui('Previous')}</Button><span className="text-xs">{ui('Page {0}',page)}</span><Button variant="outline" disabled={loading||!data?.has_more} onClick={()=>setPage(p=>p+1)}>{ui('Next')}</Button></div>
    <Dialog open={!!selected} onOpenChange={open=>{if(!open)setSelected('');}}><DialogContent className="max-h-[90dvh] max-w-4xl overflow-y-auto"><DialogHeader><DialogTitle>{ui('Posted stock adjustment')}</DialogTitle><DialogDescription>{result?.reference||ui('Loading adjustments...')}</DialogDescription></DialogHeader>
      {detailError?<p role="alert">{uiMessage(detailError)} <Button variant="outline" onClick={()=>setReload(n=>n+1)}>{ui('Retry')}</Button></p>:!result?<p role="status">{ui('Loading adjustments...')}</p>:<>
        <p className="text-sm">{detail.recorded_by} · {formatDate(result.date)} · {result.warehouse_name||result.rows?.[0]?.warehouse_name}</p><p className="break-words text-sm text-slate-600">{detail.reason}</p>
        <div className="flex flex-wrap items-center justify-between gap-3"><strong className="text-sm">{result.journal_number||ui('No value change')}</strong><ReportExport report={warehouseAdjustmentDocument(result,{warehouse:result.warehouse_name||result.rows?.[0]?.warehouse_name,reason:detail.reason})}/></div>
        <div className="space-y-2">{result.rows.map(row=><div key={row.balance_id} className="rounded-lg border p-3 text-sm"><strong>{row.product_name}</strong><p className="text-xs text-slate-500">{row.lot_number||ui('No batch recorded')}</p><div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">{[['Before count',formatNumber(row.book_quantity,3)],['Counted quantity',formatNumber(row.counted_quantity,3)],['Difference',formatNumber(row.difference,3)],['Value change',formatXAF(row.value_difference)]].map(([label,value])=><p key={label}><span className="block text-xs text-slate-500">{ui(label)}</span>{value}</p>)}</div></div>)}</div>
      </>}
    </DialogContent></Dialog>
  </div>;
}
