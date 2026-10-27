import {createHash} from 'node:crypto';
import {requireActiveContext,forbidden} from '../access.js';
import {requireAccountant} from './account-definitions.js';
import {saveManualJournal} from './manual-journals.js';
import {audit,today} from './field-ops.js';
import {journalDate,journalCents,checkedJournalLines} from './journal-validation.js';
import {isManualJournal} from '../../lib/journal-reversal.js';

export async function journalLifecycle(stores,context,body){
 requireAccountant(context);
 const journal=await stores.JournalEntry.get(String(body.journalId||''));
 if(!journal)throw Error('Choose an existing journal.');
 if(!isManualJournal(journal))throw Error('Use the original business workflow to correct this journal and its linked stock, cash or payroll records.');
 if(body.action==='postDraft'){
  if(journal.status==='posted')return journal;
  if(journal.status!=='draft')throw Error('Only draft journals can be posted.');
  if(!journal.source_document_type||!journal.source_module)await stores.JournalEntry.update(journal.id,{source_module:'manual',source_document_type:'manual_journal'});
  return saveManualJournal(stores,context,{journalId:journal.id});
 }
 if(body.action!=='reverse')throw Error('Unsupported journal action.');
 if(requireActiveContext(context)!=='admin')throw forbidden('Only the General Manager may reverse a manual journal.');
 const entryDate=journalDate(body.reversalDate||today()),reason=typeof body.reason==='string'?body.reason.trim():'';
 if(reason.length<3||reason.length>1000)throw Error('Enter a reversal reason of 3 to 1000 characters.');
 if(entryDate>today()||entryDate<journalDate(journal.entry_date))throw Error('The reversal date must be on or after the original entry and no later than today.');
 const payload=JSON.stringify({journalId:journal.id,entryDate,reason});
 if(journal.reversed_by_journal){
  const reversal=await stores.JournalEntry.get(journal.reversed_by_journal);
  if(!reversal||reversal.reversal_of!==journal.id)throw Error('This journal reversal needs reconciliation.');
  if(reversal.reversal_request_payload&&reversal.reversal_request_payload!==payload)throw Object.assign(Error('This journal was already reversed with different details. Open its recorded reversal.'),{status:409});
  return reversal;
 }
 if(journal.status!=='posted'||journal.reversal_of)throw Error('Only an original posted manual journal can be reversed.');
 const original=await stores.JournalLine.filter({journal_id:journal.id},'id',201);
 if(original.length>200)throw Error('This journal requires accountant review before reversal.');
 if(original.some(l=>l.party_id||l.opening_party_allocations?.length||l.status&&!['posted','reversed'].includes(l.status)))throw Error('Review the customer or supplier allocations and posted lines before reversing this journal.');
 const checked=checkedJournalLines(original);
 if(journalCents(journal.total_debit)!==journalCents(checked.debit)||journalCents(journal.total_credit)!==journalCents(checked.credit))throw Error('Reconcile the original journal totals and lines before reversal.');
 const reversal=await saveManualJournal(stores,context,{
  requestKey:'reverse-'+createHash('sha256').update(journal.id).digest('hex'),
  entryDate,description:('Reversal of '+journal.journal_number+': '+reason).slice(0,1000),status:'posted',
  lines:checked.lines.map(l=>({account_id:l.account_id,debit:l.credit,credit:l.debit,description:l.description})),
 },{reversingManual:true});
 const saved=await stores.JournalEntry.update(reversal.id,{reversal_of:journal.id,source_document_type:'reversal',source_document_id:journal.id,reversal_reason:reason,reversal_request_payload:payload});
 // Keep the original and mirror posted; the pair must net to zero.
 await stores.JournalEntry.update(journal.id,{reversed_by_journal:reversal.id,reversed_at:new Date().toISOString(),reversed_by:context.user.id,is_immutable:true});
 await audit({entities:stores},{action:'reverse_journal',module:'accounting',entityType:'JournalEntry',entityId:journal.id,userId:context.user.id,description:'Reversed '+journal.journal_number+' with '+reversal.journal_number+' at '+entryDate+': '+reason});
 return saved;
}
