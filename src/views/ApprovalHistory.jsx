import React,{useEffect,useState} from 'react';
import {ui,uiMessage} from '@/lib/i18n';
import {useLocaleRender} from '@/lib/localization';
import {invokeFieldOps} from '@/lib/field-ops';
import {businessDate} from '@/lib/business-date';
import {formatDateTime,formatXAF} from '@/lib/formatters';
import PageHeader from '@/components/shared/PageHeader';
import DataTable from '@/components/shared/DataTable';
import StatusBadge from '@/components/shared/StatusBadge';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
function download(rows){const keys=['reference','type','party','decision','approved_at','approved_by','approver_id','amount','current_status','description','evidence','entity_id','journal_id'];const cell=v=>'"'+String(v??'').replace(/^\s*[=+@-]/,"'$&").replaceAll('"','""')+'"';const csv=[keys,...rows.map(row=>keys.map(k=>row[k]))].map(row=>row.map(cell).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='approval-history.csv';a.click();URL.revokeObjectURL(url);}
export default function ApprovalHistory({embedded=false}){
 useLocaleRender();const today=businessDate();
 const [from,setFrom]=useState(today.slice(0,8)+'01'),[to,setTo]=useState(today),[data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[type,setType]=useState('all'),[search,setSearch]=useState(''),[selected,setSelected]=useState(null);
 async function load(){setBusy(true);setError('');setData(null);setSelected(null);try{const {data}=await invokeFieldOps({action:'approvalHistory',from,to});if(data.error)throw Error(data.error);setData(data);}catch(e){setError(e.message);}finally{setBusy(false);}}
 useEffect(()=>{load();},[]);
 const rows=(data?.rows||[]).filter(r=>(type==='all'||r.type===type)&&[r.reference,r.party,r.approved_by,r.description].some(v=>String(v||'').toLowerCase().includes(search.toLowerCase())));
 const columns=[{key:'reference',label:ui('Reference')},{key:'type',label:ui('Type')},{key:'party',label:ui('Customer / payee')},{key:'decision',label:ui('Decision'),render:v=>ui(v)},{key:'approved_at',label:ui('Decision time'),render:formatDateTime},{key:'approved_by',label:ui('Approved / received by'),render:v=>v||ui('Not recorded')},{key:'amount',label:ui('Record amount'),render:v=>v==null?'—':formatXAF(v)},{key:'current_status',label:ui('Current status'),render:v=><StatusBadge status={v}/>}];
 return <section className="space-y-4">{!embedded&&<PageHeader title={ui('Approval history')} subtitle={ui('Review completed decisions and payment receipts')}/>}
 <form onSubmit={e=>{e.preventDefault();load();}} className="flex flex-wrap items-end gap-3"><label className="text-xs">{ui('From')}<Input type="date" required value={from} max={to} onChange={e=>setFrom(e.target.value)}/></label><label className="text-xs">{ui('To')}<Input type="date" required value={to} min={from} max={today} onChange={e=>setTo(e.target.value)}/></label><Button disabled={busy}>{ui(busy?'Loading...':'Load history')}</Button><Button type="button" variant="outline" disabled={busy||!rows.length} onClick={()=>download(rows)}>{ui('Export CSV')}</Button></form>
 {error&&<p role="alert" className="text-sm text-red-700">{uiMessage(error)}</p>}{data&&<><p className="text-xs text-slate-500">{ui(data.scope)} · {data.from} — {data.to}</p><div className="flex flex-wrap gap-3"><Input aria-label={ui('Search history')} placeholder={ui('Reference, person or details')} value={search} onChange={e=>setSearch(e.target.value)} className="max-w-md"/><select aria-label={ui('Type')} className="h-10 rounded-lg border px-3 text-sm" value={type} onChange={e=>setType(e.target.value)}><option value="all">{ui('All types')}</option>{[...new Set(data.rows.map(r=>r.type))].map(t=><option key={t}>{t}</option>)}</select></div><DataTable columns={columns} data={rows} onRowClick={setSelected} emptyMessage={ui('No approval history in this period')}/></>}
 {selected&&<article className="rounded-xl border bg-white p-4 text-sm space-y-2"><h3 className="font-semibold">{selected.reference} — {ui(selected.decision)}</h3><p>{selected.description||ui('Historical approval metadata')}</p>{selected.approver_id&&<p>{ui('Approver ID')}: {selected.approver_id}</p>}<p>{ui('Evidence')}: {ui(selected.evidence)} · {ui('Record ID')}: {selected.entity_id}</p>{selected.journal_id&&<p>{ui('Journal')}: {selected.journal_number||selected.journal_id}</p>}<p className="text-xs text-slate-500">{ui('Amounts and status describe the current record. Each decision keeps its original audit details.')}</p><Button variant="outline" onClick={()=>setSelected(null)}>{ui('Close')}</Button></article>}
 </section>;
}
