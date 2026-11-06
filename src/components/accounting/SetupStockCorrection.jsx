'use client';
import React, {useEffect, useRef, useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Link} from '@/lib/router';
import {ui, uiMessage} from '@/lib/i18n';
import {useLocaleRender} from '@/lib/localization';
import {formatAccountingXAF as money} from '@/lib/formatters';
import {accountingControlRequest} from '@/lib/accounting-controls-client';

const EMPTY = {journalIds:[], offsetAccountId:'', accountingStartDate:'', reference:'', confirmSetup:false};
const selectClass = 'h-11 w-full min-w-0 rounded-md border bg-white px-2 text-sm';

function JournalLines({lines}) {
  return <div className="overflow-x-auto rounded-lg border bg-white"><table className="w-full text-xs">
    <thead className="bg-slate-50"><tr><th className="p-2 text-left">{ui('Account')}</th><th className="p-2 text-right">{ui('Debit')}</th><th className="p-2 text-right">{ui('Credit')}</th></tr></thead>
    <tbody>{lines.map((line,index)=><tr className="border-t" key={line.account_id+':'+index}><td className="min-w-32 break-words p-2">{line.account_number} {line.account_name}</td><td className="whitespace-nowrap p-2 text-right">{money(line.debit)}</td><td className="whitespace-nowrap p-2 text-right">{money(line.credit)}</td></tr>)}</tbody>
  </table></div>;
}

export default function SetupStockCorrection({onCorrected}) {
  useLocaleRender();
  const [workspace,setWorkspace] = useState(null), [form,setForm] = useState(EMPTY);
  const [loading,setLoading] = useState(true), [loadError,setLoadError] = useState(''), [reload,setReload] = useState(0);
  const [busy,setBusy] = useState(''), [error,setError] = useState(''), [preview,setPreview] = useState(null);
  const [reviewed,setReviewed] = useState(false), [saved,setSaved] = useState(null);
  const flight = useRef(false), mounted = useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{
    let active=true;
    setLoading(true);setLoadError('');
    accountingControlRequest('setup-stock-correction').then(data=>{
      if(!active)return;
      setWorkspace(data);
    }).catch(e=>{if(active)setLoadError(e.message);}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[reload]);

  const edit = change => {
    if(flight.current)return;
    setForm(current=>({...current,...change}));setPreview(null);setReviewed(false);setError('');setSaved(null);
  };
  const refresh = () => {
    if(flight.current)return;
    setPreview(null);setReviewed(false);setError('');setReload(value=>value+1);
  };
  const candidates = workspace?.candidates || [];
  const selected = candidates.filter(candidate=>form.journalIds.includes(candidate.journal_id));
  const ready = !loading && !loadError && selected.length>0 && selected.length===form.journalIds.length && selected.every(candidate=>candidate.eligible&&!candidate.corrected)
    && !!form.accountingStartDate && (workspace?.equity_accounts||[]).some(account=>account.id===form.offsetAccountId)
    && form.reference.trim().length>=3 && form.confirmSetup;
  const showPreview = async () => {
    if(flight.current)return;
    if(!ready){setError('Select eligible setup journals and complete all review fields.');return;}
    flight.current=true;setBusy('preview');setError('');setPreview(null);setReviewed(false);setSaved(null);
    const payload={...form,journalIds:[...form.journalIds].sort(),reference:form.reference.trim()};
    try {
      const result=await accountingControlRequest('setup-stock-correction',{action:'preview',...payload});
      if(mounted.current)setPreview({result,payload,requestKey:crypto.randomUUID()});
    } catch(e) {if(mounted.current)setError(e.message);}
    finally {flight.current=false;if(mounted.current)setBusy('');}
  };
  const post = async () => {
    if(flight.current||!preview||!reviewed)return;
    flight.current=true;setBusy('post');setError('');
    try {
      const result=await accountingControlRequest('setup-stock-correction',{action:'post',...preview.payload,token:preview.result.token,requestKey:preview.requestKey,confirmed:true});
      if(!mounted.current)return;
      setSaved(result);
      const corrected = new Set(preview.payload.journalIds);
      setWorkspace(current=>({...current,candidates:current.candidates.map(candidate=>corrected.has(candidate.journal_id)?{...candidate,corrected:true,eligible:false}:candidate)}));
      setForm(current=>({...current,journalIds:[],confirmSetup:false}));setPreview(null);setReviewed(false);
      onCorrected?.(result);
    } catch(e) {if(mounted.current)setError(e.message);}
    finally {flight.current=false;if(mounted.current)setBusy('');}
  };

  return <div className="min-w-0 space-y-4 pt-3">
    <p className="text-sm text-slate-600">{ui('Use this review only for inventory entries that established the company starting position. Normal operating gains and losses must remain in profit and loss.')}</p>
    <div className="flex flex-wrap items-center gap-2"><Button type="button" variant="outline" disabled={loading||!!busy} onClick={refresh}>{ui('Refresh setup entries')}</Button>{loading&&<p role="status" className="text-sm">{ui('Loading setup entries...')}</p>}</div>
    {loadError&&<p role="alert" className="break-words text-sm text-red-700">{uiMessage(loadError)}</p>}
    {workspace&&<>
      <fieldset disabled={loading||!!busy} className="min-w-0 space-y-3">
        <legend className="mb-2 text-sm font-semibold">{ui('Select the exact setup journals')}</legend>
        {!candidates.length&&<p className="text-sm text-slate-500">{ui('No inventory setup candidates were found.')}</p>}
        {candidates.map(candidate=><article key={candidate.journal_id} className="min-w-0 space-y-2 rounded-lg border p-3">
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" aria-label={ui('Select setup journal {0}',candidate.journal_number)} checked={form.journalIds.includes(candidate.journal_id)} disabled={loading||!!busy||!candidate.eligible||!!candidate.corrected} className="mt-1 h-4 w-4 shrink-0" onChange={event=>edit({journalIds:event.target.checked?[...form.journalIds,candidate.journal_id]:form.journalIds.filter(id=>id!==candidate.journal_id)})}/><span className="min-w-0 break-words"><strong>{candidate.journal_number}</strong> · {candidate.date}<span className="mt-1 block text-slate-600">{candidate.description}</span></span></label>
          {candidate.source_reference&&<p className="break-words text-xs">{ui('Source reference')}: {candidate.source_reference}</p>}
          <p className="text-xs">{ui('Original effect on profit')}: <strong>{money(candidate.profit_effect)}</strong></p>
          {candidate.corrected?<p className="text-xs font-medium text-green-800">{ui('Already corrected')}</p>:<>{!candidate.eligible&&<p className="text-xs font-medium text-amber-900">{ui('Cannot correct this entry')}</p>}{(candidate.blocked_reasons||[]).map((reason,index)=><p className="break-words text-xs text-amber-900" key={index}>{uiMessage(reason)}</p>)}</>}
          <details><summary className="cursor-pointer py-1 text-xs font-medium">{ui('Original journal lines')}</summary><JournalLines lines={candidate.lines||[]}/></details>
        </article>)}
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <label className="block space-y-1 text-sm"><span>{ui('Accounting start date')}</span><Input aria-label={ui('Accounting start date')} type="date" required max={workspace.date||undefined} value={form.accountingStartDate} onChange={event=>edit({accountingStartDate:event.target.value})}/></label>
          <label className="block space-y-1 text-sm"><span>{ui('Opening equity counterpart')}</span><select aria-label={ui('Opening equity counterpart')} className={selectClass} value={form.offsetAccountId} required onChange={event=>edit({offsetAccountId:event.target.value})}><option value="">{ui('Choose an equity account')}</option>{(workspace.equity_accounts||[]).map(account=><option key={account.id} value={account.id}>{account.account_number} · {account.name}</option>)}</select></label>
        </div>
        <p className="text-xs text-slate-500">{ui('Only selected entries on or before this start date can be reclassified. Correction entries keep their original dates.')}</p>
        <label className="block space-y-1 text-sm"><span>{ui('Setup evidence reference')}</span><Input aria-label={ui('Setup evidence reference')} required minLength={3} maxLength={200} value={form.reference} onChange={event=>edit({reference:event.target.value})}/></label>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" aria-label={ui('Confirm these are opening setup entries')} className="mt-1 h-4 w-4 shrink-0" checked={form.confirmSetup} onChange={event=>edit({confirmSetup:event.target.checked})}/><span>{ui('I confirm that these selected journals established opening inventory, rather than recording an operating stock gain or loss.')}</span></label>
      </fieldset>
      <Button type="button" variant="outline" disabled={!!busy||!ready} onClick={showPreview}>{ui(busy==='preview'?'Preparing correction preview...':'Preview correction')}</Button>
    </>}
    {preview&&<section className="min-w-0 space-y-3 rounded-xl border border-green-200 bg-green-50/40 p-3">
      <h4 className="text-sm font-semibold">{ui('Review the correction before posting')}</h4>
      <p className="break-words text-sm">{ui('Opening equity counterpart')}: {preview.result.offset_account.account_number} {preview.result.offset_account.name}</p>
      <div className="grid gap-2 text-sm sm:grid-cols-3">{[['Total change in profit',preview.result.total_profit_adjustment],['Change in inventory',preview.result.stock_change],['Change in cash',preview.result.cash_change]].map(([label,value])=><div key={label} className="rounded-lg border bg-white p-3"><p className="text-xs text-slate-500">{ui(label)}</p><strong>{money(value)}</strong></div>)}</div>
      <p className="text-xs text-slate-600">{ui('A negative profit change removes setup income. A positive change removes setup expense. Original journals remain in the audit history.')}</p>
      {preview.result.journals.map(journal=><div key={journal.source_journal_id} className="space-y-2"><p className="text-sm font-medium">{journal.journal_number} · {journal.date} · {ui('Change in profit')}: {money(journal.profit_adjustment)}</p><JournalLines lines={journal.lines}/></div>)}
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" aria-label={ui('Confirm reviewed correction')} className="mt-1 h-4 w-4 shrink-0" checked={reviewed} disabled={!!busy} onChange={event=>{if(!flight.current)setReviewed(event.target.checked);}}/><span>{ui('I reviewed the selected journals, equity account and amounts. Post these correcting entries.')}</span></label>
      <Button type="button" disabled={!!busy||!reviewed} onClick={post}>{ui(busy==='post'?'Posting correction...':'Confirm and post correction')}</Button>
    </section>}
    {error&&<p role="alert" className="break-words text-sm text-red-700">{uiMessage(error)}</p>}
    {saved&&<section role="status" className="space-y-2 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-900"><p className="font-semibold">{ui('Setup correction posted. Refresh the financial statements to review the revised balances.')}</p><p>{ui('Total change in profit')}: {money(saved.total_profit_adjustment)}</p><ul className="space-y-1">{saved.journals.map(journal=><li key={journal.journal_id}><Link className="break-words underline" to={'/accounting/journals/'+encodeURIComponent(journal.journal_id)}>{journal.journal_number}</Link> · {journal.date} · {money(journal.profit_adjustment)}</li>)}</ul></section>}
  </div>;
}
