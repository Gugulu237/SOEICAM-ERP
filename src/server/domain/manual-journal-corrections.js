import {createHash} from 'node:crypto';
import {requireActiveContext,forbidden} from '../access.js';
import {canEditManualDraft,journalFingerprint} from '../../lib/journal-corrections.js';
import {saveManualJournal} from './manual-journals.js';
import {manualReversalPlan,normalizedReversalReview,verifyReversalReview} from './manual-reversal-plan.js';
import {today} from './field-ops.js';
import {journalDate} from './journal-validation.js';

const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const hash=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const conflict=message=>Object.assign(Error(message),{status:409});
function reference(body){if(!/^[\w-]{16,80}$/.test(body.requestKey||''))throw Error('A valid correction save reference is required.');if(!/^[a-f0-9]{64}$/.test(body.expectedFingerprint||''))throw Error('Reload the journal before editing it.');}
async function originalLines(stores,journal){const lines=await stores.JournalLine.filter({journal_id:journal.id},'id',201);if(lines.length>200)throw Error('This journal requires accountant review.');return lines;}

export async function updateManualDraft(stores,context,body,journal){
 reference(body);
 const payload=hash({journalId:journal.id,expectedFingerprint:body.expectedFingerprint,entryDate:body.entryDate,description:body.description,lines:body.lines});
 const auditId='JDE-'+hash([context.user.id,body.requestKey]),previous=await stores.AuditLog.get(auditId);
 if(previous){if(previous.entity_id!==journal.id||previous.draft_edit_payload!==payload)throw conflict('This save reference belongs to different draft edits. Reload the journal.');return journal;}
 if(!canEditManualDraft(journal))throw Error('Only an unposted manual draft can be edited. Use correction for a posted journal.');
 const lines=await originalLines(stores,journal);
 if(lines.some(line=>line.status&&line.status!=='draft'||line.party_id||line.opening_party_allocations?.length))throw Error('Linked or posted journal lines cannot be edited as a manual draft.');
 if(await journalFingerprint(journal,lines)!==body.expectedFingerprint)throw conflict('This draft changed in another window. Reload the saved draft before editing again.');
 const periods=await stores.AccountingPeriod.filter({});if(periods.some(period=>period.start_date<=journal.entry_date&&journal.entry_date<=period.end_date&&['closed','locked'].includes(period.status)))throw Error('The accounting period is closed or locked.');
 const plan=await saveManualJournal(stores,context,{requestKey:body.requestKey,status:'draft',entryDate:body.entryDate,description:body.description,lines:body.lines},{validateOnly:true});
 const updated=await stores.JournalEntry.update(journal.id,{entry_date:plan.entryDate,description:plan.description,period_id:plan.period?.id||'',total_debit:plan.totalDebit,total_credit:plan.totalCredit,source_module:'manual',source_document_type:'manual_journal'});
 await stores.JournalLine.deleteMany({journal_id:journal.id});
 const savedLines=await stores.JournalLine.bulkCreate(plan.lines.map(line=>({...line,journal_id:journal.id,status:'draft'})));
 await stores.AuditLog.create({id:auditId,action:'edit_draft_journal',module:'accounting',entity_type:'JournalEntry',entity_id:journal.id,user_id:context.user.id,audit_source:'server_verified',description:'Edited draft '+journal.journal_number,draft_edit_payload:payload,before_journal:journal,before_lines:lines,after_journal:updated,after_lines:savedLines});
 return updated;
}

async function correctionPlan(stores,context,body,journal){
 if(requireActiveContext(context)!=='admin')throw forbidden('Only the General Manager may correct a posted manual journal.');
 reference(body);
 if(journal.status!=='posted'||journal.reversal_of||journal.reversed_by_journal)throw Error('Only an original posted manual journal can be corrected.');
 const entryDate=journalDate(body.reversalDate);
 if(entryDate>today()||entryDate<journalDate(journal.entry_date))throw Error('The correction date must be on or after the original entry and no later than today.');
 const original=await originalLines(stores,journal);
 if(original.some(line=>line.party_id||line.opening_party_allocations?.length||line.status&&!['posted','reversed'].includes(line.status)))throw Error('Review linked customer or supplier allocations before correcting this manual journal.');
 if(await journalFingerprint(journal,original)!==body.expectedFingerprint)throw conflict('This journal changed during correction review. Reload it before continuing.');
 const input=body.replacement;if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Review the replacement journal before confirming the correction.');
 const replacementBody={requestKey:'correct-'+hash([context.user.id,body.requestKey]).slice(0,48),status:'posted',entryDate,description:input.description,lines:input.lines};
 const replacement=await saveManualJournal(stores,context,replacementBody,{validateOnly:true});
 const plan=await manualReversalPlan(stores,context,journal,original,{replacementLines:replacement.lines,correctionDate:entryDate});
 return {entryDate,original,replacementBody,plan};
}
export async function previewManualCorrection(stores,context,body,journal){
 const {plan}=await correctionPlan(stores,context,body,journal);return {...plan,correction:true};
}

// Called only inside the existing accounting API transaction/advisory lock.
// The exact combined final plan is checked before permitting a temporary mirror
// cash deficit. It is never an allowance for a standalone reversal.
export async function correctManualJournal(stores,context,body,journal,reverse){
 if(requireActiveContext(context)!=='admin')throw forbidden('Only the General Manager may correct a posted manual journal.');
 reference(body);
 const entryDate=journalDate(body.reversalDate),reason=typeof body.reason==='string'?body.reason.trim():'';
 const input=body.replacement;if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Review the replacement journal before confirming the correction.');
 const review=normalizedReversalReview(body.treasuryReview);
 if(!review)throw Error('Review the final ledger and treasury balances before confirming this correction.');
 const payload=hash({journalId:journal.id,expectedFingerprint:body.expectedFingerprint,entryDate,reason,replacement:input,treasuryReview:review});
 const prior=journal.manual_correction;
 if(prior){
  if(prior.request_key!==body.requestKey||prior.payload!==payload)throw conflict('This journal already has a different correction. Open the recorded replacement.');
  const [reversal,replacement]=await Promise.all([stores.JournalEntry.get(prior.reversal_id),stores.JournalEntry.get(prior.replacement_id)]);
  if(!reversal||reversal.reversal_of!==journal.id||!replacement||replacement.correction_of!==journal.id||replacement.correction_reversal_id!==reversal.id)throw Error('The linked journal correction needs reconciliation.');
  return {original:journal,reversal,replacement,reused:true};
 }
 const prepared=await correctionPlan(stores,context,body,journal),plan=prepared.plan;
 verifyReversalReview(plan,review,{correction:true});
 // An explicitly reviewed cache mismatch is rebuilt to its CURRENT posted
 // ledger before the two checked writers run. The final verified balances,
 // original evidence and this reconciliation are retained in the audit.
 if(plan.requires_review){
  for(const account of plan.accounts.filter(row=>row.mismatch))await stores.Account.update(account.id,{balance:account.ledger_balance});
  for(const treasury of plan.treasury.filter(row=>row.mismatch))await stores.TreasuryAccount.update(treasury.id,{balance:treasury.ledger_balance});
 }
 const allowance={journalId:journal.id,snapshot:plan.snapshot,originalFingerprint:body.expectedFingerprint,reversal_lines:plan.reversal_lines,accounts:plan.accounts};
 const reversal=await reverse({...body,action:'reverse',reversalDate:entryDate,reason,treasuryReview:undefined},allowance);
 const saved=await saveManualJournal(stores,context,prepared.replacementBody);
 // Recheck the actual final posted ledger/caches against the reviewed result,
 // including replacement-only accounts. A drift aborts the whole transaction.
 const final=await manualReversalPlan(stores,context,journal,prepared.original,{replacementLines:prepared.replacementBody.lines,correctionDate:entryDate});
 if(plan.accounts.some(expected=>{const actual=final.accounts.find(row=>row.id===expected.id);return !actual||actual.ledger_balance!==expected.balance_after||actual.stored_balance!==expected.balance_after;})||plan.treasury.some(expected=>{const actual=final.treasury.find(row=>row.id===expected.id);return !actual||actual.ledger_balance!==expected.balance_after||actual.stored_balance!==expected.balance_after;}))throw conflict('Balances changed during correction. Reload and review the final balances again.');
 const replacement=await stores.JournalEntry.update(saved.id,{correction_of:journal.id,correction_reversal_id:reversal.id});
 await stores.JournalEntry.update(reversal.id,{correction_replacement_id:replacement.id});
 const original=await stores.JournalEntry.update(journal.id,{corrected_by_journal:replacement.id,manual_correction:{request_key:body.requestKey,payload,reversal_id:reversal.id,replacement_id:replacement.id}});
 await stores.AuditLog.create({action:'correct_manual_journal',module:'accounting',entity_type:'JournalEntry',entity_id:journal.id,user_id:context.user.id,audit_source:'server_verified',reason,description:'Corrected '+journal.journal_number+' through '+reversal.journal_number+' and '+replacement.journal_number,original_journal:journal,original_lines:prepared.original,reversal_id:reversal.id,replacement_id:replacement.id,replacement_journal:replacement,accounting_correction_review:{snapshot:plan.snapshot,accounts:plan.accounts,treasury:plan.treasury,verified_balances:review.verifiedBalances,reconciled:plan.requires_review}});
 return {original,reversal,replacement};
}
