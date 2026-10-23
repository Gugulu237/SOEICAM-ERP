
/* localized-messages */
import { uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React,{useEffect,useRef,useState} from 'react';
import {useSearchParams} from '@/lib/router';
import {invokeFieldOps,errorMessage,HANDOVER_STATUS} from '@/lib/field-ops';
import {formatXAF,formatDate} from '@/lib/formatters';
import {businessDate} from '@/lib/business-date';
import StatusPill from '@/components/field/StatusPill';
import {WorkspacePanel} from '@/components/home/WorkspaceParts';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import DailyCommercialCash from './DailyCommercialCash';

function Table({headings,rows,render,empty}) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  return <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b bg-slate-50 text-xs text-slate-500">{headings.map(h=><th className="whitespace-nowrap px-3 py-3 font-medium" key={h}>{h}</th>)}</tr></thead><tbody>{rows.map(row=><tr className="border-b border-slate-100 last:border-0" key={row.id}>{render(row).map((cell,i)=><td className="px-3 py-3 align-top" key={i}>{cell}</td>)}</tr>)}</tbody></table>{!rows.length&&<p className="py-6 text-sm text-slate-500">{empty}</p>}</div>;
}
const match=(row,search)=>[row.commercial_name,row.handover_number,row.acknowledgement_reference,row.treasury_account_name,row.customer_name,row.collection_number].some(v=>String(v || '').toLowerCase().includes(search.toLowerCase().trim()));

export default function CashHandoverPanel({handovers=[],collections=[],dailyCash=[],commercials=[],date,canAct=false,preview=false,onReceive,onResolve,onRefresh,refreshKey=0}) {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [params,setParams]=useSearchParams(),commercial=preview?'':params.get('commercial') || '';
  const [localView,setLocalView]=useState('queue'),view=preview?localView:params.get('handover_view')==='history'?'history':'queue';
  const [search,setSearch]=useState(''),[status,setStatus]=useState('all'),[from,setFrom]=useState(''),[to,setTo]=useState('');
  const [history,setHistory]=useState([]),[cursor,setCursor]=useState(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const sequence=useRef(0);
  const load=async (next,token)=>{
    setLoading(true);setError('');
    try{const {data}=await invokeFieldOps({action:'cashierHandoverHistory',commercialId:commercial || undefined,from:from || undefined,to:to || undefined,cursor:next});if(token!==sequence.current)return;setHistory(rows=>next?[...rows,...data.records.filter(r=>!rows.some(p=>p.id===r.id))]:data.records);setCursor(data.next_cursor);}catch(e){if(token===sequence.current)setError(errorMessage(e));}finally{if(token===sequence.current)setLoading(false);}
  };
  useEffect(()=>{const n=++sequence.current;setHistory([]);setCursor(null);setError('');if(view==='history'&&!preview)load(null,n);return()=>{sequence.current++;};},[view,commercial,from,to,refreshKey,preview]);
  function changeView(value){setSearch('');setStatus('all');if(preview)setLocalView(value);else setParams(q=>{q.set('section','handovers');if(value==='history')q.set('handover_view','history');else q.delete('handover_view');return q;});}
  const own=rows=>rows.filter(h=>!commercial || h.commercial_id===commercial),queue=own(handovers.filter(h=>h.status!=='received')),cash=own(collections);
  const selectedName=[...handovers,...collections,...history].find(r=>r.commercial_id===commercial)?.commercial_name;
  const visibleQueue=queue.filter(h=>(status==='all'||h.status===status)&&match(h,search)),visibleHistory=(preview?own(handovers.filter(h=>h.status==='received')):history).filter(h=>match(h,search));
  return <div className="space-y-5">
    {commercial&&<p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{ui("Handovers for ")}{selectedName || ui("the selected Commercial")}<button className="ml-3 font-semibold underline" onClick={()=>setParams(q=>{q.delete('commercial');return q;})}>{ui("Show all Commercials")}</button></p>}
    <div role="tablist" aria-label={ui("Cash handover views")} className="flex flex-wrap gap-2"><Button role="tab" aria-selected={view==='queue'} variant={view==='queue'?'default':'outline'} onClick={()=>changeView('queue')}>{ui("Awaiting receipt (")}{queue.length})</Button><Button role="tab" aria-selected={view==='history'} variant={view==='history'?'default':'outline'} onClick={()=>changeView('history')}>{ui("Received history")}</Button></div>
    <div className="flex flex-wrap items-end gap-3"><label className="min-w-56 flex-1 text-xs text-slate-600">{view==='history'?ui("Search loaded history"):ui("Search handovers")}<Input aria-label={ui("Search cash handovers")} className="mt-1" placeholder={ui("Commercial, handover or acknowledgement...")} value={search} onChange={e=>setSearch(e.target.value)}/></label>{view==='queue'?<label className="text-xs text-slate-600">{ui("Status")}<select aria-label={ui("Handover queue status")} className="mt-1 block h-10 rounded-md border bg-white px-3 text-sm" value={status} onChange={e=>setStatus(e.target.value)}>{[['all',ui("All pending")],['submitted',ui("Awaiting receipt")],['partially_received',ui("Partly received")],['disputed','Disputed']].map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>:<>{[[ui("From handover date"),from,setFrom],[ui("To handover date"),to,setTo]].map(([label,value,set])=><label className="text-xs text-slate-600" key={label}>{label}<Input className="mt-1" aria-label={label} type="date" max={businessDate()} disabled={preview} value={value} onChange={e=>set(e.target.value)}/></label>)}<Button variant="outline" disabled={loading || preview} onClick={onRefresh}>{ui("Refresh history")}</Button></>}</div>
    {view==='queue'?<>
      <DailyCommercialCash key={date} days={dailyCash} commercials={commercials} date={date} handovers={handovers} commercial={commercial} search={search} canAct={canAct} onReceive={onReceive} onRefresh={onRefresh}/>
      <WorkspacePanel title={ui("Receive end-of-day Commercial cash")} subtitle={ui("Count the money physically received. Confirming clears cash in transit into the selected account; sales are not recorded again.")}><Table headings={['Commercial / handover','Expected','Offered','Received','Still due','Status','Action']} rows={visibleQueue} empty="No handovers awaiting receipt match this view." render={h=>[<div><strong>{h.commercial_name}</strong><p className="text-xs text-slate-500">{h.handover_number} · {formatDate(h.handover_date)}</p>{h.agent_deposit_reported_at&&<p className="mt-1 text-xs font-semibold text-blue-700">{ui("Agent reported cash deposited: ")}{formatXAF(h.agent_deposit_reported_amount)}{ui(" with ")}{h.agent_deposit_cashier_name}{ui(". Awaiting your receipt confirmation.")}</p>}{h.variance_reason&&<p className="mt-1 text-xs text-slate-700">{h.variance_reason}</p>}</div>,formatXAF(h.expected_amount),h.requested_by_cashier ? 'Requested by cashier' : formatXAF(h.offered_amount),formatXAF(h.received_amount),formatXAF(Math.max(0,Number(h.expected_amount || 0)-Number(h.received_amount || 0))),<StatusPill map={HANDOVER_STATUS} value={h.status}/>,<Button size="sm" disabled={!canAct} onClick={()=>h.status==='disputed'&&Number(h.expected_amount)<=Number(h.received_amount)?onResolve(h):onReceive(h)}>{h.status==='disputed'&&Number(h.expected_amount)<=Number(h.received_amount)?'Resolve variance':'Receive cash'}</Button>]}/></WorkspacePanel>
      <WorkspacePanel title={ui("Cash still with Commercials")} subtitle={ui("Includes earlier outstanding collections. Use Daily Commercial cash to request or receive a day's collections. Existing handovers remain in the queue above.")}><Table headings={['Commercial','Customer / supply','Collection date','Still to hand over','Status']} rows={cash.filter(c=>match(c,search))} empty="No outstanding Commercial collections match this view." render={c=>[c.commercial_name,<div>{c.customer_name}<p className="text-xs text-slate-500">{c.sale_number || c.collection_number}</p></div>,formatDate(c.collection_date),formatXAF(c.outstanding_amount),<span className="text-xs capitalize">{String(c.status || '').replaceAll('_',' ')}</span>]}/></WorkspacePanel>
    </>:<WorkspacePanel title={ui("Received handover history")} subtitle={ui("Completed handovers from all dates, loaded in pages of 50. Date filters use the handover date; receipt date, account and acknowledgement stay with each record.")}>
      {error&&<p role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{uiMessage(error)}<button disabled={loading} className="ml-2 underline" onClick={()=>load(null,++sequence.current)}>{ui("Retry")}</button></p>}
      {loading&&!history.length?<p role="status" className="py-6 text-sm text-slate-500">{ui("Loading received handovers...")}</p>:<Table headings={['Commercial / handover','Received','Receipt date','Account / Cashier','Acknowledgement','Status']} rows={visibleHistory} empty="No completed handovers match this view." render={h=>[<div><strong>{h.commercial_name}</strong><p className="text-xs text-slate-500">{h.handover_number} · {formatDate(h.handover_date)}</p></div>,formatXAF(h.received_amount),formatDate(h.received_date || h.confirmed_at),<div>{h.treasury_account_name}<p className="text-xs text-slate-500">{h.cashier_name}</p></div>,<div className="font-medium">{h.acknowledgement_reference || 'Not recorded'}<p className="text-xs font-normal text-slate-500">{h.journal_number}</p></div>,<StatusPill map={HANDOVER_STATUS} value={h.status}/>]}/>}
      {cursor&&<Button className="mt-4" variant="outline" disabled={loading} onClick={()=>load(cursor,++sequence.current)}>{loading?ui("Loading..."):ui("Load more handovers")}</Button>}
    </WorkspacePanel>}
  </div>;
}
