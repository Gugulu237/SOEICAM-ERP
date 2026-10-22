
/* localized-messages */
import { uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React,{useCallback,useEffect,useState} from 'react';
import {erp} from '@/api/erpClient';
import {readAll} from '@/lib/field-pos';
import {formatDate} from '@/lib/formatters';
import DataTable from '@/components/shared/DataTable';
import StatusBadge from '@/components/shared/StatusBadge';
import {Button} from '@/components/ui/button';

export default function QualityInspections({onTrace}){
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [checks,setChecks]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const load=useCallback(async()=>{setLoading(true);setError('');try{setChecks(await readAll(erp.entities.QualityCheck,{},'-check_date'));}catch(e){setError(e.message);}finally{setLoading(false);}},[]);
  useEffect(()=>{load();},[load]);
  const result=v=><StatusBadge status={v==='pass'?'approved':v==='fail'?'rejected':'pending'}/>;
  const cols=[{key:'batch_number',label:ui("Batch #")}, {key:'check_date',label:ui("Date"),render:formatDate},{key:'inspector_name',label:ui("Inspector")}, {key:'taste',label:ui("Taste"),render:result},{key:'texture',label:ui("Texture"),render:result},{key:'seal_quality',label:ui("Seal"),render:result},{key:'overall_status',label:ui("Result"),render:v=><StatusBadge status={v}/>},
    {key:'trace',label:'',render:(_,row)=>row.batch_number&&row.product_id?<Button size="sm" variant="outline" onClick={()=>onTrace?.({lot_number:row.batch_number,product_id:row.product_id})}>{ui("Trace batch")}</Button>:<span className="text-xs text-slate-400">{row.batch_number?ui("Product reference not recorded"):''}</span>}];
  return <section className="space-y-4"><div className="flex items-center justify-between gap-3"><p className="text-sm text-slate-500">{loading?ui("Loading recorded inspections..."):ui("{0} recorded inspections", checks.length)}</p><Button variant="outline" size="sm" disabled={loading} onClick={load}>{ui("Refresh inspections")}</Button></div>{error?<p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{uiMessage(error)}</p>:loading?<p role="status" className="p-8 text-center text-slate-500">{ui("Loading inspections...")}</p>:<DataTable columns={cols} data={checks} searchFields={['batch_number','inspector_name']} emptyMessage={ui("No quality checks recorded yet.")}/>}</section>;
}
