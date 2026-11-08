'use client';
import React,{useEffect,useRef,useState} from 'react';
import {erp} from '@/api/erpClient';
import {readAll} from '@/lib/field-pos';
import {businessDate} from '@/lib/business-date';
import {ui,uiMessage} from '@/lib/i18n';
import {useLocaleRender} from '@/lib/localization';
import {formatAccountingXAF as money} from '@/lib/formatters';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Link} from '@/lib/router';

export default function AccountConsolidation({onConsolidated}){
 useLocaleRender();
 const [accounts,setAccounts]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState('');
 const [form,setForm]=useState({sourceAccountId:'',targetAccountId:'',date:businessDate(),reference:''}),[preview,setPreview]=useState(null),[reviewed,setReviewed]=useState(false),[saved,setSaved]=useState(null);
 const flight=useRef(false),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;let active=true;readAll(erp.entities.Account).then(rows=>{if(!active)return;setAccounts(rows);setForm(f=>({...f,sourceAccountId:rows.find(a=>a.account_number==='7000'&&a.is_active!==false&&!a.consolidated_into_account_id)?.id||'',targetAccountId:rows.find(a=>a.account_number==='5100'&&a.is_active!==false&&!a.consolidated_into_account_id)?.id||''}));}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;mounted.current=false;};},[]);
 const eligible=accounts.filter(a=>a.account_type==='cogs'&&a.normal_balance==='debit'&&a.is_active!==false&&a.is_posting!==false&&!a.consolidated_into_account_id);
 const edit=change=>{if(flight.current)return;setForm(f=>({...f,...change}));setPreview(null);setReviewed(false);setSaved(null);setError('');};
 const ready=!loading&&form.sourceAccountId&&form.targetAccountId&&form.sourceAccountId!==form.targetAccountId&&form.date&&form.reference.trim().length>=3;
 const blockers=preview?.result.unsupported_references||[],blocked=blockers.length>0;
 async function prepare(){
  if(flight.current||!ready)return;flight.current=true;setBusy('preview');setError('');setPreview(null);setReviewed(false);
  const payload={...form,reference:form.reference.trim()};
  try{const result=await erp.accounting.saveAccount({action:'previewConsolidation',...payload});if(mounted.current)setPreview({result,payload,requestKey:crypto.randomUUID()});}catch(e){if(mounted.current)setError(e.message);}finally{flight.current=false;if(mounted.current)setBusy('');}
 }
 async function post(){
  if(flight.current||!preview||!reviewed||blocked)return;flight.current=true;setBusy('post');setError('');
  try{const result=await erp.accounting.saveAccount({action:'consolidate',...preview.payload,token:preview.result.token,requestKey:preview.requestKey,confirmed:true});if(mounted.current){setSaved(result);setPreview(null);setReviewed(false);onConsolidated?.(result);}}catch(e){if(mounted.current)setError(e.message);}finally{flight.current=false;if(mounted.current)setBusy('');}
 }
 return <div className="min-w-0 space-y-3 pt-3">
  <p className="text-sm text-slate-600">{ui('Consolidate duplicate cost-of-goods-sold accounts into one active account. Historical journals remain traceable; future product and posting-rule mappings use the retained account.')}</p>
  {loading&&<p role="status" className="text-sm">{ui('Loading accounts...')}</p>}
  {!saved&&<fieldset disabled={loading||!!busy} className="grid min-w-0 gap-3 sm:grid-cols-2">
   {[['sourceAccountId','Duplicate COGS account'],['targetAccountId','Retained COGS account']].map(([field,label])=><label key={field} className="space-y-1 text-sm"><span>{ui(label)}</span><select aria-label={ui(label)} className="h-11 w-full min-w-0 rounded-md border bg-white px-2" value={form[field]} onChange={e=>edit({[field]:e.target.value})}><option value="">{ui('Choose an account')}</option>{eligible.filter(a=>field!=='sourceAccountId'||!a.is_system).map(a=><option key={a.id} value={a.id}>{a.account_number} / {a.name}</option>)}</select></label>)}
   <label className="space-y-1 text-sm">{ui('Consolidation date')}<Input aria-label={ui('Consolidation date')} type="date" max={businessDate()} value={form.date} onChange={e=>edit({date:e.target.value})}/></label>
   <label className="space-y-1 text-sm">{ui('Review reference')}<Input aria-label={ui('Review reference')} maxLength={500} value={form.reference} onChange={e=>edit({reference:e.target.value})}/></label>
  </fieldset>}
  {!saved&&<Button type="button" variant="outline" disabled={!ready||!!busy} onClick={prepare}>{ui(busy==='preview'?'Preparing consolidation...':'Preview COGS consolidation')}</Button>}
  {preview&&<section className="min-w-0 space-y-3 rounded-lg border border-green-200 bg-green-50/40 p-3 text-sm">
   <p className="break-words font-semibold">{preview.result.source_account.account_number} {preview.result.source_account.name}{' '}{ui('to')}{' '}{preview.result.target_account.account_number} {preview.result.target_account.name}</p>
   <p>{ui('Combined balance')}: <strong>{money(preview.result.combined_balance)}</strong></p>
   <p className="text-xs text-slate-600">{ui('This transfers the duplicate account balance and combines both accounts in historical reports. Total profit, inventory and cash remain unchanged.')}</p>
   <p className="text-xs text-slate-600">{ui('The duplicate account will become read-only. Historical journal entries remain available for audit.')}</p>
   <p>{ui('Products to remap')}: <strong>{preview.result.products_count||0}</strong> / {ui('Posting rules to remap')}: <strong>{preview.result.rules_count||0}</strong></p>
   {blocked&&<div role="alert" className="space-y-1 rounded-md border border-red-200 bg-red-50 p-3 text-red-800"><p>{ui('These references must be resolved before consolidation.')}</p><ul className="list-inside list-disc">{blockers.map((reference,i)=><li key={reference.entity+':'+reference.id+':'+i}>{reference.entity} / {reference.name||reference.id}</li>)}</ul></div>}
   <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr><th className="p-2 text-left">{ui('Account')}</th><th className="p-2 text-right">{ui('Debit')}</th><th className="p-2 text-right">{ui('Credit')}</th></tr></thead><tbody>{preview.result.transfer_lines.map((line,i)=><tr key={i} className="border-t"><td className="p-2">{accounts.find(a=>a.id===line.account_id)?.account_number}</td><td className="p-2 text-right">{money(line.debit)}</td><td className="p-2 text-right">{money(line.credit)}</td></tr>)}</tbody></table></div>
   <label className="flex items-start gap-2"><input className="mt-1" type="checkbox" aria-label={ui('Confirm COGS consolidation')} checked={reviewed} disabled={!!busy||blocked} onChange={e=>{if(!flight.current&&!blocked)setReviewed(e.target.checked);}}/><span>{ui('I reviewed the retained account, transfer and mapping changes.')}</span></label>
   <Button type="button" disabled={!reviewed||!!busy||blocked} onClick={post}>{ui(busy==='post'?'Consolidating accounts...':'Confirm COGS consolidation')}</Button>
  </section>}
  {error&&<p role="alert" className="text-sm text-red-700">{uiMessage(error)}</p>}
  {saved&&<div role="status" className="space-y-1 rounded-lg bg-green-50 p-3 text-sm text-green-900"><p>{ui('COGS accounts consolidated. Refresh the statements to review the combined account.')}{saved.journal_id&&<Link className="ml-2 underline" to={'/accounting/journals/'+encodeURIComponent(saved.journal_id)}>{saved.journal_number}</Link>}</p><p>{ui('The duplicate account is now read-only. Historical journal entries remain available for audit.')}</p></div>}
 </div>;
}
