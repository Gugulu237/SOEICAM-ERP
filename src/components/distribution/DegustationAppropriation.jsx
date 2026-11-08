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

function JournalPreview({lines,accounts,label}){
 return <div className="overflow-x-auto"><table aria-label={ui(label)} className="w-full text-xs"><thead><tr><th className="p-2 text-left">{ui('Account')}</th><th className="p-2 text-right">{ui('Debit')}</th><th className="p-2 text-right">{ui('Credit')}</th></tr></thead><tbody>{lines.map((line,i)=>{const account=accounts.find(a=>a.id===line.account_id);return <tr className="border-t" key={i}><td className="p-2">{account?.account_number} / {account?.name||line.account_id}</td><td className="p-2 text-right">{money(line.debit)}</td><td className="p-2 text-right">{money(line.credit)}</td></tr>;})}</tbody></table></div>;
}

function LegacyRoundingReview({rounding,accounts}){
 return <section className="min-w-0 space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
  <p className="font-semibold">{ui('Legacy unit-cost rounding correction')}</p>
  <p>{ui('Original sale journals remain unchanged. This separate correction reconciles their recorded stock costs before the reserved stock is expensed.')}</p>
  <dl className="grid grid-cols-2 gap-2"><dt>{ui('COGS adjustment')}</dt><dd className="text-right">{money(rounding.cogs_change)}</dd><dt>{ui('Inventory journal adjustment')}</dt><dd className="text-right">{money(rounding.inventory_value_change)}</dd><dt>{ui('Recorded inventory value correction')}</dt><dd className="text-right">{money(rounding.cache_value_change)}</dd></dl>
  <details className="min-w-0"><summary className="cursor-pointer font-medium">{ui('Lot rounding evidence')}</summary><div className="mt-2 space-y-2">{rounding.lots.map((lot,index)=><article className="min-w-0 space-y-2 rounded border border-amber-200 bg-white p-2" key={index}>
   <p className="break-words font-medium">{lot.product_name||lot.product_id} / {ui('Lot')}: {lot.lot_number||'-'}{lot.exhausted&&<span> / {ui('Fully issued lot')}</span>}</p>
   <div className="overflow-x-auto"><table aria-label={ui('Legacy unit-cost rounding correction')+' / '+String(lot.product_name||lot.product_id)} className="w-full text-xs"><thead><tr><th className="p-2 text-right">{ui('Recorded inventory value')}</th><th className="p-2 text-right">{ui('Legacy remaining cost')}</th><th className="p-2 text-right">{ui('Reconciled carrying value')}</th></tr></thead><tbody><tr className="border-t"><td className="p-2 text-right">{money(lot.current_value)}</td><td className="p-2 text-right">{money(lot.legacy_remaining_value)}</td><td className="p-2 text-right">{money(lot.reconciled_value)}</td></tr></tbody></table></div>
   <p className="text-xs">{ui('COGS adjustment')}: {money(lot.cogs_adjustment)}; {ui('Recorded inventory value correction')}: {money(lot.cache_value_change)}</p>
  </article>)}</div></details>
  {rounding.journal_lines?.length?<><p className="font-medium">{ui('Rounding correction journal')}</p><JournalPreview lines={rounding.journal_lines} accounts={accounts} label="Rounding correction journal"/></>:<p>{ui('No rounding journal is required; only the recorded lot value is reconciled.')}</p>}
 </section>;
}

function BlockedExpenseReview({diagnostics}){
 return <section aria-label={ui('Inventory carrying-value differences')} className="min-w-0 space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
  <p className="font-semibold">{ui('Inventory carrying-value differences')}</p>
  <p>{ui('Reconcile these lot differences before expensing the reserved stock. No expense has been posted.')}</p>
  {diagnostics.source_journals_verified===true&&<p>{ui('Source sale journals verified')}</p>}
  {diagnostics.mismatches.map((lot,index)=><article className="min-w-0 space-y-2 rounded border border-amber-200 bg-white p-2" key={index}>
   <p className="break-words font-medium">{lot.product_name||lot.product_id} / {ui('Lot')}: {lot.lot_number||'-'}</p>
   <div className="overflow-x-auto"><table aria-label={ui('Quantity / value')+' / '+String(lot.product_name||lot.product_id)} className="w-full text-xs"><thead><tr><th className="p-2 text-left">{ui('Quantity / value')}</th><th className="p-2 text-right">{ui('Expected remaining')}</th><th className="p-2 text-right">{ui('Currently recorded')}</th><th className="p-2 text-right">{ui('Difference')}</th></tr></thead><tbody>
    <tr className="border-t"><th className="p-2 text-left font-normal">{ui('Quantity')}</th><td className="p-2 text-right">{formatNumber(lot.expected_quantity,3)}</td><td className="p-2 text-right">{formatNumber(lot.current_quantity,3)}</td><td className="p-2 text-right">{formatNumber(lot.quantity_delta,3)}</td></tr>
    <tr className="border-t"><th className="p-2 text-left font-normal">{ui('Recorded cost')}</th><td className="p-2 text-right">{money(lot.expected_value)}</td><td className="p-2 text-right">{money(lot.current_value)}</td><td className="p-2 text-right">{money(lot.value_delta)}</td></tr>
   </tbody></table></div>
   <p className="text-xs">{ui('Loaded')}: {formatNumber(lot.loaded_quantity,3)} / {money(lot.loaded_value)}; {ui('Released')}: {formatNumber(lot.released_quantity,3)} / {money(lot.released_value)}</p>
   <details className="text-xs"><summary className="cursor-pointer">{ui('Lot evidence')}</summary><dl className="mt-2 grid min-w-0 grid-cols-2 gap-2 break-words">
    <dt>{ui('Expiry')}</dt><dd>{lot.expiry_date||'-'}</dd><dt>{ui('QC status')}</dt><dd>{lot.qc_status||'-'}</dd><dt>{ui('Production order')}</dt><dd>{lot.production_order_id||'-'}</dd><dt>{ui('Batch')}</dt><dd>{lot.batch_number||'-'}</dd><dt>{ui('Stock balance records')}</dt><dd>{lot.balance_ids?.join(', ')||'-'}</dd>
    <dt>{ui('Load movements')}</dt><dd>{lot.load_movement_ids?.join(', ')||'-'}</dd><dt>{ui('Issue movements')}</dt><dd>{lot.issue_movement_ids?.join(', ')||'-'}</dd><dt>{ui('Loaded unit costs')}</dt><dd>{lot.loaded_unit_costs?.map(value=>money(value)).join(', ')||'-'}</dd><dt>{ui('Released unit costs')}</dt><dd>{lot.released_unit_costs?.map(value=>money(value)).join(', ')||'-'}</dd><dt>{ui('Current unit costs')}</dt><dd>{lot.current_unit_costs?.map(value=>money(value)).join(', ')||'-'}</dd>
   </dl></details>
  </article>)}
  {diagnostics.source_journals_verified===true&&!!diagnostics.source_journals.length&&<div className="space-y-1"><p className="font-medium">{ui('Verified source journals')}</p><ul className="space-y-1">{diagnostics.source_journals.map(journal=><li className="break-words text-xs" key={journal.id}><Link className="underline" to={'/accounting/journals/'+encodeURIComponent(journal.id)}>{journal.journal_number||journal.id}</Link> / {journal.date} / {ui('Inventory cost')}: {money(journal.inventory_cost)}</li>)}</ul></div>}
 </section>;
}

export default function DegustationAppropriation({dispatch,onPosted}){
 useLocaleRender();
 const [accounts,setAccounts]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[diagnostics,setDiagnostics]=useState(null),[refreshError,setRefreshError]=useState(''),[busy,setBusy]=useState('');
 const [form,setForm]=useState({expenseAccountId:'',date:businessDate(),reference:''}),[preview,setPreview]=useState(null),[reviewed,setReviewed]=useState(false),[saved,setSaved]=useState(null);
 const flight=useRef(false),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;let active=true;readAll(erp.entities.Account).then(rows=>{if(!active)return;setAccounts(rows);setForm(f=>({...f,expenseAccountId:rows.find(a=>/^d[eé]gustations?$/i.test(String(a.name||'').trim())&&eligibleDegustationExpenseAccount(a,rows))?.id||''}));}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;mounted.current=false;};},[]);
 const eligible=accounts.filter(a=>eligibleDegustationExpenseAccount(a,accounts));
 const diagnosticFor=error=>{const d=error?.diagnostics;return d&&d.dispatch_id===dispatch.id&&(!dispatch.vehicle_warehouse_id||d.stock_warehouse_id===dispatch.vehicle_warehouse_id)&&Array.isArray(d.mismatches)&&Array.isArray(d.source_journals)?d:null;};
 const edit=change=>{if(flight.current)return;setForm(f=>({...f,...change}));setPreview(null);setReviewed(false);setError('');setDiagnostics(null);setSaved(null);};
 const ready=!loading&&eligible.some(a=>a.id===form.expenseAccountId)&&form.date&&form.reference.trim().length>=3;
 async function prepare(){
  if(flight.current||!ready)return;flight.current=true;setBusy('preview');setError('');setDiagnostics(null);setPreview(null);setReviewed(false);
  const payload={dispatchId:dispatch.id,...form,reference:form.reference.trim()};
  try{const result=await accountingControlRequest('degustation-appropriation',{action:'preview',...payload});if(mounted.current)setPreview({payload,result,requestKey:crypto.randomUUID()});}catch(e){if(mounted.current){setError(e.message);setDiagnostics(diagnosticFor(e));}}finally{flight.current=false;if(mounted.current)setBusy('');}
 }
 async function post(){
  if(flight.current||!preview||!reviewed)return;flight.current=true;setBusy('post');setError('');
  let result;
  try{result=await accountingControlRequest('degustation-appropriation',{action:'post',...preview.payload,token:preview.result.token,requestKey:preview.requestKey,confirmed:true,...(preview.result.legacy_rounding?.required?{roundingReviewPolicy:preview.result.legacy_rounding.policy}:{})});if(mounted.current){setSaved(result);setPreview(null);setReviewed(false);}}catch(e){if(mounted.current){setError(e.message);const blocked=diagnosticFor(e);if(blocked)setDiagnostics(blocked);if(e.status===409||blocked){setPreview(null);setReviewed(false);}}}finally{flight.current=false;if(mounted.current)setBusy('');}
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
   {preview.result.legacy_rounding?.required?<><p>{ui('Combined inventory journal change')}: <strong>{money(preview.result.inventory_value_change)}</strong></p><p className="text-xs text-slate-600">{ui(preview.result.legacy_rounding.journal_lines?.length?'Marketing expense uses the reconciled remaining cost. The separate rounding journal changes COGS and is included in the combined inventory value change. Cash, sales, customer balances and physical quantities remain unchanged.':'Marketing expense uses the reconciled remaining cost. The recorded lot value is corrected without changing COGS or posting another journal. Cash, sales, customer balances and physical quantities remain unchanged.')}</p><LegacyRoundingReview rounding={preview.result.legacy_rounding} accounts={accounts}/></>:<p className="text-xs text-slate-600">{ui('Inventory value decreases by this cost. Cash, sales, customer balances and physical quantities remain unchanged. Later customer giveaways are not expensed again; returns restore only the remaining original cost.')}</p>}
   <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr><th className="p-2 text-left">{ui('Product')}</th><th className="p-2 text-left">{ui('Lot')}</th><th className="p-2 text-right">{ui('Quantity')}</th><th className="p-2 text-right">{ui('Recorded cost')}</th></tr></thead><tbody>{preview.result.lots.map(l=><tr className="border-t" key={l.id}><td className="p-2">{l.product_name}</td><td className="p-2">{l.lot_number||'-'}</td><td className="p-2 text-right">{formatNumber(l.quantity,3)}</td><td className="p-2 text-right">{money(l.value)}</td></tr>)}</tbody></table></div>
   <p className="font-medium">{ui('Proposed journal')}</p><JournalPreview lines={preview.result.journal_lines||[]} accounts={accounts} label="Proposed journal"/>
   {!(preview.result.journal_lines||[]).length&&<p className="text-xs text-amber-900">{ui(preview.result.legacy_rounding?.required?'Zero promotional carrying value; no appropriation journal will be posted.':'Zero carrying value; no journal will be posted.')}</p>}
   <label className="flex items-start gap-2"><input className="mt-1" type="checkbox" aria-label={ui('Confirm reserved Dégustation review')} checked={reviewed} disabled={!!busy} onChange={e=>{if(!flight.current)setReviewed(e.target.checked);}}/><span>{ui(preview.result.legacy_rounding?.required?(preview.result.legacy_rounding.journal_lines?.length?(preview.result.journal_lines?.length?'I reviewed the reserved quantities, reconciled costs, expense account, employee custody and both proposed journals.':'I reviewed the reserved quantities, reconciled costs, expense account, employee custody and the rounding correction journal.'):'I reviewed the reserved quantities, reconciled costs, expense account, employee custody and the recorded inventory value correction.'):'I reviewed the reserved quantities, original costs, expense account and employee custody.')}</span></label>
   <Button type="button" disabled={!reviewed||!!busy} onClick={post}>{ui(busy==='post'?'Posting promotional expense...':'Confirm reserved Dégustation expense')}</Button>
  </section>}
  {error&&<p role="alert" className="text-sm text-red-700">{uiMessage(error)}</p>}
  {diagnostics&&<BlockedExpenseReview diagnostics={diagnostics}/>}
  {refreshError&&<p role="status" className="text-sm text-amber-900">{ui(refreshError)}</p>}
  {saved&&<p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-900">{ui('Reserved Dégustation expensed. The promotional units remain in employee custody.')}{saved.journal_id&&<Link className="ml-2 underline" to={'/accounting/journals/'+encodeURIComponent(saved.journal_id)}>{saved.journal_number}</Link>}{saved.rounding_journal_id&&<Link className="ml-2 underline" to={'/accounting/journals/'+encodeURIComponent(saved.rounding_journal_id)}>{ui('Rounding correction')}: {saved.rounding_journal_number}</Link>}</p>}
 </div>;
}
