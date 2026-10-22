import { createHash } from 'node:crypto';
import { requireActiveContext, forbidden } from '../access.js';
import { requireAccountant } from './account-definitions.js';
import { saveManualJournal } from './manual-journals.js';
import { audit, today } from './field-ops.js';

function manual(journal) {
  return journal?.source_module === 'manual' && ['', 'manual_journal'].includes(journal.source_document_type || '');
}

export async function journalLifecycle(stores, context, body) {
  requireAccountant(context);
  const journal = await stores.JournalEntry.get(String(body.journalId || ''));
  if (!journal) throw Error('Choose an existing journal.');
  if (!manual(journal)) throw Error('Use the original business workflow to correct this journal and its linked stock, cash or payroll records.');
  if (body.action === 'postDraft') {
    if (journal.status === 'posted') return journal;
    if (journal.status !== 'draft') throw Error('Only draft journals can be posted.');
    if (!journal.source_document_type) await stores.JournalEntry.update(journal.id, { source_document_type:'manual_journal' });
    return saveManualJournal(stores, context, { journalId:journal.id });
  }
  if (body.action !== 'reverse') throw Error('Unsupported journal action.');
  if (requireActiveContext(context) !== 'admin') throw forbidden('Only the General Manager may reverse a manual journal.');
  if (journal.reversed_by_journal) {
    const reversal = await stores.JournalEntry.get(journal.reversed_by_journal);
    if (!reversal || reversal.reversal_of !== journal.id) throw Error('This journal reversal needs reconciliation.');
    return reversal;
  }
  if (journal.status !== 'posted' || journal.reversal_of) throw Error('Only an original posted manual journal can be reversed.');
  const lines = await stores.JournalLine.filter({ journal_id:journal.id }, 'id', 201);
  if (lines.length > 200) throw Error('This journal requires accountant review before reversal.');
  const reversal = await saveManualJournal(stores, context, {
    requestKey:'reverse-'+createHash('sha256').update(journal.id).digest('hex'),
    entryDate:today(), description:`Reversal of ${journal.journal_number}: ${journal.description}`.slice(0,1000), status:'posted',
    lines:lines.map(line => ({ account_id:line.account_id, debit:line.credit, credit:line.debit, description:line.description })),
  });
  const saved = await stores.JournalEntry.update(reversal.id, { reversal_of:journal.id, source_document_type:'reversal', source_document_id:journal.id });
  // Both sides remain posted in the ledger. Removing the original from posted
  // reports would leave only the inverse amount and corrupt the reported total.
  await stores.JournalEntry.update(journal.id, { reversed_by_journal:reversal.id, is_immutable:true });
  await audit({ entities:stores }, { action:'reverse_journal', module:'accounting', entityType:'JournalEntry', entityId:journal.id, userId:context.user.id, description:`Reversed ${journal.journal_number} with ${reversal.journal_number}` });
  return saved;
}
