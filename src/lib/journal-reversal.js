// Old imported manual journals may have no source fields. Never treat a linked
// business document or an opening import as a manual journal.
export function isManualJournal(journal){
 if(!journal||journal.opening_request_key||journal.opening_batch_id||journal.opening_detail_account_ids?.length)return false;
 const type=journal.source_document_type||'',module=journal.source_module||'';
 return ['','manual_journal'].includes(type)&&(module==='manual'||!module&&!journal.source_document_id&&!type);
}
export const canReverseManualJournal=journal=>isManualJournal(journal)&&journal.status==='posted'&&!journal.reversal_of&&!journal.reversed_by_journal;
