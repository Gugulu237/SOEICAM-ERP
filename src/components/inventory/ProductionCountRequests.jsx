import React,{useEffect,useState} from 'react';
import {ui,uiMessage} from '@/lib/i18n';
import {invokeFieldOps} from '@/lib/field-ops';
import {Button} from '@/components/ui/button';

export default function ProductionCountRequests({products,onCount}){
  const [rows,setRows]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState('');
  useEffect(()=>{let active=true;invokeFieldOps({action:'productionAuditRequests'}).then(({data})=>{if(active)setRows(data.requests);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[]);
  async function resolve(row){setBusy(row.id);setError('');try{await invokeFieldOps({action:'resolveProductionAudit',requestId:row.id});setRows(values=>values.filter(v=>v.id!==row.id));}catch(e){setError(e.message);}finally{setBusy('');}}
  return <div className="mt-3 space-y-3">{error&&<p role="alert" className="text-xs text-red-700">{uiMessage(error)}</p>}{!rows.length?<p className="text-xs text-slate-500">{ui('No open raw-material count requests.')}</p>:rows.map(row=><div key={row.id} className="flex flex-wrap items-center justify-between gap-2 border-t py-3"><div className="min-w-0 flex-1 text-sm"><strong>{products.find(p=>p.id===row.material_id)?.name || ui('Material')}</strong><p className="text-xs text-slate-500">{row.description}</p></div>{onCount&&<Button size="sm" variant="outline" onClick={onCount}>{ui('Count stock')}</Button>}<Button size="sm" variant="outline" disabled={!!busy} onClick={()=>resolve(row)}>{ui('Mark counted')}</Button></div>)}</div>;
}
