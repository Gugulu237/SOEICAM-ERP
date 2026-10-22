
/* localized-messages */
import { uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React,{useCallback,useEffect,useRef,useState} from 'react';
import {Link,Navigate,useSearchParams} from '@/lib/router';
import {erp} from '@/api/erpClient';
import {Button} from '@/components/ui/button';
import PageHeader from '@/components/shared/PageHeader';
import StatusPill from '@/components/field/StatusPill';
import HandoverSubmitDialog from '@/components/field/HandoverSubmitDialog';
import {useCurrentUser} from '@/hooks/useCurrentUser';
import {HANDOVER_STATUS,COLLECTION_STATUS,errorMessage} from '@/lib/field-ops';
import {readAll} from '@/lib/field-pos';
import {cashierHandoverPath} from '@/lib/cashier-navigation';
import {formatXAF,formatDate} from '@/lib/formatters';

// Preserve field-agent submission links. Receiving belongs to the Cashier desk.
export default function CashHandovers(){
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const {employee,role,canReceiveHandover,loading}=useCurrentUser(),[params]=useSearchParams();
  if(loading)return <p role="status" className="py-12 text-slate-500">{ui("Opening cash handovers...")}</p>;
  if(canReceiveHandover)return <Navigate to={cashierHandoverPath(params)} replace/>;
  if(role!=='commercial'||!employee?.id)return <Navigate to="/" replace/>;
  return <AgentHandovers employee={employee}/>;
}

function AgentHandovers({employee}){
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [handovers,setHandovers]=useState([]),[collections,setCollections]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[submitting,setSubmitting]=useState(false);
  const sequence=useRef(0);
  const load=useCallback(async()=>{const n=++sequence.current;setLoading(true);setError('');try{
    const [records,cash]=await Promise.all([
      readAll(erp.entities.CashHandover,{commercial_id:employee.id,status:{$in:['submitted','partially_received','disputed','received']}},'-submitted_at'),
      readAll(erp.entities.CashCollection,{commercial_id:employee.id,status:{$in:['held_by_commercial','partially_received']}},'-collection_date'),
    ]);
    if(n===sequence.current){setHandovers(records);setCollections(cash.filter(c=>!c.handover_id));}
  }catch(e){if(n===sequence.current){setError(errorMessage(e));setHandovers([]);setCollections([]);}}finally{if(n===sequence.current)setLoading(false);}},[employee.id]);
  useEffect(()=>{load();if(typeof window==='undefined')return()=>{sequence.current++;};const refresh=()=>{if(document.visibilityState==='visible')load();};const timer=setInterval(refresh,30000);window.addEventListener('focus',refresh);return()=>{sequence.current++;clearInterval(timer);window.removeEventListener('focus',refresh);};},[load]);
  return <div className="mx-auto max-w-4xl space-y-5"><Link to="/commercial" className="inline-block text-sm font-medium text-emerald-700 underline">{ui("Back to Commercial dashboard")}</Link><PageHeader title={ui("My cash handovers")} subtitle={ui("Submit collected cash for the Cashier to count and receive")} actions={<Button disabled={loading||!collections.length} onClick={()=>setSubmitting(true)}>{ui("Hand over cash")}</Button>}/>
    {error&&<p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{uiMessage(error)}<button className="ml-3 underline" onClick={load}>{ui("Retry")}</button></p>}
    {loading?<p role="status" className="py-12 text-slate-500">{ui("Loading your collections...")}</p>:<>
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-5"><div><p className="text-sm text-slate-500">{ui("Cash still available to hand over")}</p><p className="mt-1 text-2xl font-bold">{formatXAF(collections.reduce((sum,c)=>sum+Number(c.outstanding_amount || 0),0))}</p></div><p className="text-sm text-slate-500">{collections.length}{ui(" collection(s)")}</p></section>
      <section className="divide-y rounded-xl border bg-white">{collections.map(c=><div key={c.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="font-medium">{c.collection_number} · {c.customer_name}</p><p className="text-xs text-slate-500">{c.sale_number} · {formatDate(c.collection_date)}</p></div><div className="space-y-1 text-right"><p className="font-semibold">{formatXAF(c.outstanding_amount)}</p><StatusPill map={COLLECTION_STATUS} value={c.status}/></div></div>)}{!collections.length&&<p className="p-5 text-sm text-slate-500">{ui("No unsubmitted cash collections.")}</p>}</section>
      <h2 className="text-sm font-semibold">{ui("My submitted and received handovers")}</h2><section className="divide-y rounded-xl border bg-white">{handovers.map(h=><div key={h.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="font-medium">{h.handover_number}</p>{h.requested_by_cashier && <p className="mt-1 text-xs font-medium text-blue-700">{ui("Requested by ")}{h.cashier_name || ui("cashier")}</p>}<p className="text-xs text-slate-500">{formatDate(h.handover_date)}{h.acknowledgement_reference?' · '+h.acknowledgement_reference:''}</p>{h.variance_reason&&<p className="mt-1 text-xs text-amber-700">{h.variance_reason}</p>}</div><div className="space-y-1 text-right"><p className="font-semibold">{formatXAF(h.status === 'received' ? h.received_amount : Math.max(0, Number(h.expected_amount || 0) - Number(h.received_amount || 0)))}</p><StatusPill map={HANDOVER_STATUS} value={h.status}/></div></div>)}{!handovers.length&&<p className="p-5 text-sm text-slate-500">{ui("No handovers submitted yet.")}</p>}</section>
    </>}
    {submitting&&<HandoverSubmitDialog open employee={employee} collections={collections} onClose={()=>setSubmitting(false)} onDone={load}/>}
  </div>;
}
