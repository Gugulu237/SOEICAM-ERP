'use client';
import React,{useEffect,useRef,useState} from 'react';
import {erp} from '@/api/erpClient';
import {readAll} from '@/lib/field-pos';
import {accountingControlRequest} from '@/lib/accounting-controls-client';
import {businessDate} from '@/lib/business-date';
import {formatAccountingXAF as money,formatNumber} from '@/lib/formatters';
import {ui,uiMessage} from '@/lib/i18n';
import {useLocaleRender} from '@/lib/localization';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Link} from '@/lib/router';
import {eligibleDegustationExpenseAccount} from '@/lib/degustation-accounts';

export default function DegustationAppropriation({dispatch,onPosted}){
 useLocaleRender();
 const [accounts,setAccounts]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[refreshError,setRefreshError]=useState(''),[busy,setBusy]=useState('');
 const [form,setForm]=useState({expenseAccountId:'',date:businessDate(),reference:''}),[preview,setPreview]=useState(null),[reviewed,setReviewed]=useState(false),[saved,setSaved]=useState(null);
 const flight=useRef(false),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;let active=true;readAll(erp.entities.Account).then(rows=>{if(!active)return;setAccounts(rows);setForm(f=>({...f,expenseAccountId:rows.find(a=>/^d[eé]gustations?$/i.test(String(a.name||'').trim())&&eligibleDegustationExpenseAccount(a,rows))?.id||''}));}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;mounted.current=false;};},[]);
 const eligible=accounts.filter(a=>eligibleDegustationExpenseAccount(a,accounts));
 const edit=change=>{if(flight.current)return;setForm(f=>({...f,...change}));setPreview(null);setReviewed(false);setError('');setSaved(null);};
 const ready=!loading&&eligible.some(a=>a.id===form.expenseAccountId)&&form.date&&form.reference.trim().length>=3;
 async function prepare(){
  if(flight.current||!ready)return;flight.current=true;setBusy('preview');setError('');setPreview(null);setReviewed(false);
  const payload={dispatchId:dispatch.id,...form,reference:form.reference.trim()};
  try{const result=await accountingControlRequest('degustation-appropriation',{action:'preview',...payload});if(mounted.current)setPreview({payload,result,requestKey:crypto.randomUUID()});}catch(e){if(mounted.current)setError(e.message);}finally{flight.current=false;if(mounted.current)setBusy('');}
 }
 async function post(){
  if(flight.current||!preview||!reviewed)return;flight.current=true;setBusy('post');setError('');
  let result;
  try{result=await accountingControlRequest('degustation-appropriation',{action:'post',...preview.payload,token:preview.result.token,requestKey:preview.requestKey,confirmed:true});if(mounted.current){setSaved(result);setPreview(null);setReviewed(false);}}catch(e){if(mounted.current)setError(e.message);}finally{flight.current=false;if(mounted.current)setBusy('');}
  if(result)try{await onPosted?.(result);}catch{if(mounted.current)setRefreshError('Expense recorded. Refresh the reconciliation to see the updated balances.');}
 }
 return <div className="min-w-0 space-y-3 pt-3">
  <p className="text-sm text-slate-600">{ui('Expense the verified cost of reserved promotional goods that are still held by this employee. Physical quantities stay in custody; no customer giveaway or sale is created.')}</p>
  {loading&&<p role="status" className="text-sm">{ui('Loading accounts...')}</p>}
  {!saved&&<fieldset disabled={loading||!!busy} className="grid min-w-0 gap-3 sm:grid-cols-2">
   <label className="space-y-1 text-sm"><span>{ui('Degustation expense account')}</span><select aria-label={ui('Degustation expense account')} className="h-11 w-full min-w-0 rounded-md border bg-white px-2" value={form.expenseAccountId} onChange={e=>edit({expenseAccountId:e.target.value})}><option value="">{ui('Choose an account')}</option>{eligible.map(a=><option key={a.id} value={a.id}>{accounts.find(p=>p.id===a.parent_id)?.name} / {a.account_number} / {a.name}</option>)}</select></label>
   <label className="space-y-1 text-sm">{ui('Expense date')}<Input aria-label={ui('Expense date')} type="date" readOnly value={form.date}/></label>
   <label className="space-y-1 text-sm sm:col-span-2">{ui('Review reference')}<Input aria-label={ui('Review reference')} maxLength={500} value={form.reference} onChange={e=>edit({reference:e.target.value})}/></label>
  </fieldset>}
  {!loading&&!eligible.length&&<p className="text-sm text-amber-900">{ui('Create an active Degustation expense sub-account under Marketing before continuing.')} <Link className="underline" to="/accounting">{ui('Accounting')}</Link></p>}
  {!saved&&<Button type="button" variant="outline" disabled={!ready||!!busy} onClick={prepare}>{ui(busy==='preview'?'Preparing expense preview...':'Preview reserved Dégustation expense')}</Button>}
  {preview&&<section className="min-w-0 space-y-3 rounded-lg border border-green-200 bg-green-50/40 p-3 text-sm">
   <p className="font-semibold">{preview.result.dispatch.employee_name} / {preview.result.dispatch.dispatch_number}</p>
   <p>{ui('Physical units retained')}: <strong>{formatNumber(preview.result.total_quantity,3)}</strong> / {ui('Marketing expense')}: <strong>{money(preview.result.total_value)}</strong></p>
   <p>{ui('Degustation expense account')}: {preview.result.expense_account.parent_name||accounts.find(a=>a.id===accounts.find(x=>x.id===form.expenseAccountId)?.parent_id)?.name} / {preview.result.expense_account.account_number||preview.result.expense_account.number} / {preview.result.expense_account.name}</p>
   <p className="text-xs text-slate-600">{ui('Inventory value decreases by this cost. Cash, sales, customer balances and physical quantities remain unchanged. Later customer giveaways are not expensed again; returns restore only the remaining original cost.')}</p>
   <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr><th className="p-2 text-left">{ui('Product')}</th><th className="p-2 text-left">{ui('Lot')}</th><th className="p-2 text-right">{ui('Quantity')}</th><th className="p-2 text-right">{ui('Recorded cost')}</th></tr></thead><tbody>{preview.result.lots.map(l=><tr className="border-t" key={l.id}><td className="p-2">{l.product_name}</td><td className="p-2">{l.lot_number||'-'}</td><td className="p-2 text-right">{formatNumber(l.quantity,3)}</td><td className="p-2 text-right">{money(l.value)}</td></tr>)}</tbody></table></div>
   <div className="overflow-x-auto"><table aria-label={ui('Proposed journal')} className="w-full text-xs"><thead><tr><th className="p-2 text-left">{ui('Account')}</th><th className="p-2 text-right">{ui('Debit')}</th><th className="p-2 text-right">{ui('Credit')}</th></tr></thead><tbody>{(preview.result.journal_lines||[]).map((line,i)=>{const account=accounts.find(a=>a.id===line.account_id);return <tr className="border-t" key={i}><td className="p-2">{account?.account_number} / {account?.name||line.account_id}</td><td className="p-2 text-right">{money(line.debit)}</td><td className="p-2 text-right">{money(line.credit)}</td></tr>;})}</tbody></table></div>
   {!(preview.result.journal_lines||[]).length&&<p className="text-xs text-amber-900">{ui('Zero carrying value; no journal will be posted.')}</p>}
   <label className="flex items-start gap-2"><input className="mt-1" type="checkbox" aria-label={ui('Confirm reserved Dégustation review')} checked={reviewed} disabled={!!busy} onChange={e=>{if(!flight.current)setReviewed(e.target.checked);}}/><span>{ui('I reviewed the reserved quantities, original costs, expense account and employee custody.')}</span></label>
   <Button type="button" disabled={!reviewed||!!busy} onClick={post}>{ui(busy==='post'?'Posting promotional expense...':'Confirm reserved Dégustation expense')}</Button>
  </section>}
  {error&&<p role="alert" className="text-sm text-red-700">{uiMessage(error)}</p>}
  {refreshError&&<p role="status" className="text-sm text-amber-900">{ui(refreshError)}</p>}
  {saved&&<p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-900">{ui('Reserved Dégustation expensed. The promotional units remain in employee custody.')}{saved.journal_id&&<Link className="ml-2 underline" to={'/accounting/journals/'+encodeURIComponent(saved.journal_id)}>{saved.journal_number}</Link>}</p>}
 </div>;
}
