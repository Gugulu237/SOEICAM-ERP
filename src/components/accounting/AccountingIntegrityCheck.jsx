import React,{useState,useRef} from 'react';
import {Button} from '@/components/ui/button';
import {ui,uiMessage} from '@/lib/i18n';
import {formatAccountingXAF as formatXAF} from '@/lib/formatters';
import {accountingControlRequest} from '@/lib/accounting-controls-client';
import SetupStockCorrection from './SetupStockCorrection';
import AccountConsolidation from './AccountConsolidation';
import {Link} from '@/lib/router';
const labels={
 duplicate_source_journal:'Several posted journals use the same source document',
 supplier_payment_account_mismatch:'Supplier payment used a different payable account',supplier_payment_evidence_unverified:'Supplier payment evidence could not be verified',
 invalid_posting_rule:"Posting rule maps to an unsuitable account",orphan_line:'Journal line without its journal',posted_header_draft_line:'Draft line attached to a posted journal',missing_account:'Missing ledger account',invalid_line_amount:'Invalid journal amount',invalid_journal_date:'Invalid journal date',unbalanced_journal:'Unbalanced or incomplete posted journal',header_line_mismatch:'Journal totals differ from its lines',invalid_header_total:'Invalid recorded journal totals',duplicate_journal_number:'Duplicate journal number',account_cache_mismatch:'Stored account balance differs from the GL',treasury_missing_account:'Cash account without a GL account',duplicate_treasury_mapping:'Shared cash GL mapping',treasury_gl_mismatch:'Cash balance differs from the GL',overlapping_periods:'Overlapping accounting periods',invalid_allocation:'Invalid payment allocation',unverified_allocation:'Allocation without a matching posted payment',duplicate_allocation:'Duplicate payment allocation',payment_without_posted_journal:'Payment without a posted journal',overallocated_payment:'Allocated payment exceeds its amount',invalid_payment_amount:'Invalid posted payment amount'
};
function DuplicateSourceReview({groups=[]}) {
 if(!groups.length)return null;
 return <details className="rounded-lg border border-amber-200 bg-amber-50/40 p-3">
  <summary className="cursor-pointer text-sm font-semibold">{ui('Review repeated source postings')}</summary>
  <p className="mt-2 text-xs text-slate-600">{ui('Compare the original documents and any reversal entries before deciding which journal requires correction. All posted amounts remain included in the financial statements.')}</p>
  <div className="mt-3 space-y-3">{groups.map(group=><article className="min-w-0 rounded-lg border bg-white p-3 text-xs" key={JSON.stringify([group.source_module,group.source_document_type,group.source_document_id])}>
   <p className="break-words font-semibold">{group.source_module} / {group.source_document_type} / {group.source_document_id}</p>
   <p className="mt-1">{ui('Posted journals for this source: {0}',group.journal_count)}</p>
   <ul className="mt-2 space-y-1">{group.journals.map(journal=><li key={journal.id}><Link className="break-words underline" to={'/accounting/journals/'+encodeURIComponent(journal.id)}>{journal.journal_number||journal.id}</Link> · {journal.date} · {ui(journal.status)}</li>)}</ul>
   {group.truncated&&<p className="mt-2 text-amber-900">{ui('More matching journals exist. Review the full journal register.')}</p>}
  </article>)}</div>
 </details>;
}
function SupplierPayableReview({review}) {
  if(!review || !(review.mismatches?.length || review.blocked?.length))return null;
  return <details className="rounded-lg border border-amber-200 bg-amber-50/40 p-3">
    <summary className="cursor-pointer text-sm font-semibold">{ui('Supplier payable account review')}</summary>
    <p className="mt-2 text-xs text-slate-600">{ui('No correcting entry has been posted. Check the source documents and any earlier manual corrections before using these proposed lines.')}</p>
    <div className="mt-3 space-y-3">{(review.mismatches||[]).map((row,index)=>{
      const accounts=new Map([row.original_payable,row.payment_payable].filter(Boolean).map(account=>[account.id,account]));
      return <article key={row.payment_id+':'+row.bill_id+':'+index} className="min-w-0 space-y-2 rounded-lg border bg-white p-3 text-xs">
        <h4 className="break-words text-sm font-semibold">{row.payment_number} · {row.bill_number}</h4>
        <p>{ui('The goods receipt and payment used different supplier payable accounts.')}</p>
        <dl className="space-y-1">
          <div className="flex flex-wrap justify-between gap-2"><dt>{ui('Amount')}</dt><dd className="font-semibold">{formatXAF(row.amount)}</dd></div>
          <div className="flex flex-wrap justify-between gap-2"><dt>{ui('Original supplier payable')}</dt><dd className="break-words">{row.original_payable?.account_number} {row.original_payable?.name}</dd></div>
          <div className="flex flex-wrap justify-between gap-2"><dt>{ui('Payable used for payment')}</dt><dd className="break-words">{row.payment_payable?.account_number} {row.payment_payable?.name}</dd></div>
          <div className="flex flex-wrap justify-between gap-2"><dt>{ui('Goods receipt journal')}</dt><dd><Link className="break-words underline" to={'/accounting/journals/'+encodeURIComponent(row.receipt_journal_id)}>{row.receipt_journal_number}</Link></dd></div>
          <div className="flex flex-wrap justify-between gap-2"><dt>{ui('Payment journal')}</dt><dd><Link className="break-words underline" to={'/accounting/journals/'+encodeURIComponent(row.payment_journal_id)}>{row.payment_journal_number}</Link></dd></div>
        </dl>
        <div className="overflow-x-auto rounded-lg border"><table className="w-full text-xs">
          <caption className="p-2 text-left font-semibold">{ui('Proposed correcting entry - review only')}</caption>
          <thead className="bg-slate-50"><tr><th className="p-2 text-left">{ui('Account')}</th><th className="p-2 text-right">{ui('Debit')}</th><th className="p-2 text-right">{ui('Credit')}</th></tr></thead>
          <tbody>{(row.proposed_lines||[]).map((line,lineIndex)=>{const account=accounts.get(line.account_id);return <tr className="border-t" key={line.account_id+':'+lineIndex}><td className="min-w-32 break-words p-2">{account?.account_number||line.account_id} {account?.name}</td><td className="whitespace-nowrap p-2 text-right">{formatXAF(line.debit)}</td><td className="whitespace-nowrap p-2 text-right">{formatXAF(line.credit)}</td></tr>;})}</tbody>
        </table></div>
      </article>;
    })}</div>
    {!!review.blocked?.length&&<div className="mt-3 space-y-2"><h4 className="text-sm font-semibold">{ui('Payment evidence needs review')}</h4><p className="text-xs text-slate-600">{ui('Unverified payment evidence cannot produce a correcting entry.')}</p>{review.blocked.map((row,index)=><div className="rounded-lg border bg-white p-3 text-xs" key={row.payment_id+':'+row.bill_id+':'+index}><strong>{row.payment_number||row.payment_id}{row.bill_id?' · '+row.bill_id:''}</strong><p className="mt-1 break-words text-amber-900">{uiMessage(row.reason)}</p></div>)}</div>}
    {review.excluded_advances>0&&<p className="mt-3 text-xs text-slate-500">{ui('Supplier advances excluded from this comparison: {0}',review.excluded_advances)}</p>}
  </details>;
}

export default function AccountingIntegrityCheck({onCorrected}) {
  const [data,setData]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),flight=useRef(false);
  const [correctionOpened,setCorrectionOpened]=useState(false);
  const [consolidationOpened,setConsolidationOpened]=useState(false);
  const run=async()=>{
    if(flight.current)return;
    flight.current=true;setBusy(true);setError('');
    try {setData(await accountingControlRequest('integrity'));}
    catch(e) {setError(e.message);}
    finally {flight.current=false;setBusy(false);}
  };
  return <section className="mb-4 min-w-0 space-y-3 rounded-xl border bg-white p-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">{ui('Accounting integrity')}</h3><Button variant="outline" type="button" disabled={busy} onClick={run}>{ui(busy?'Checking accounting...':'Check accounting')}</Button></div>
    {error&&<p role="alert" className="text-sm text-red-700">{uiMessage(error)}</p>}
    {data&&<>
      <p role="status" className={data.issue_count?'text-sm text-amber-900':'text-sm text-green-800'}>{data.issue_count?ui('{0} discrepancies require review. No records were changed.',data.issue_count):ui('This scan found no discrepancies. No records were changed.')}</p>
      {data.totals&&<p className="text-xs">{ui('Debit')} {formatXAF(data.totals.debit)} · {ui('Credit')} {formatXAF(data.totals.credit)} · {ui('Difference')} {formatXAF(data.totals.difference)}</p>}
      {data.issue_count>0&&<details><summary className="cursor-pointer text-sm">{ui('Review findings')}</summary><ul className="mt-2 space-y-2 text-xs">{Object.entries(data.counts).map(([code,count])=><li key={code}><strong>{ui(labels[code]||code)}: {count}</strong><p className="break-words text-slate-600">{data.issues.filter(issue=>issue.code===code).map(issue=>issue.reference).join(' · ')}</p></li>)}</ul></details>}
      <SupplierPayableReview review={data.supplier_payable_mismatches}/>
      <DuplicateSourceReview groups={data.duplicate_source_journals}/>
    </>}
    <details id="setup-stock-corrections" className="border-t pt-3" onToggle={event=>{if(event.currentTarget.open)setCorrectionOpened(true);}}>
      <summary className="cursor-pointer py-1 text-sm font-semibold">{ui('Correct setup inventory entries')}</summary>
      {correctionOpened&&<SetupStockCorrection onCorrected={result=>{setData(null);onCorrected?.(result);}}/>}
    </details>
    <details className="border-t pt-3" onToggle={event=>{if(event.currentTarget.open)setConsolidationOpened(true);}}>
      <summary className="cursor-pointer py-1 text-sm font-semibold">{ui('Consolidate duplicate COGS accounts')}</summary>
      {consolidationOpened&&<AccountConsolidation onConsolidated={result=>{setData(null);onCorrected?.(result);}}/>}
    </details>
  </section>;
}
