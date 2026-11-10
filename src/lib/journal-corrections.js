import {isManualJournal} from './journal-reversal.js';
export const canEditManualDraft=journal=>isManualJournal(journal)&&journal.status==='draft'&&!journal.is_immutable&&!journal.posted_at&&!journal.reversal_of&&!journal.reversed_by_journal;
// Browser/server shared optimistic snapshot. Include all line identity, amounts
// and lifecycle flags so a second editor cannot silently replace a changed draft.
export async function journalFingerprint(journal,lines){
 const header=Object.fromEntries(['id','entry_date','description','status','source_module','source_document_type','source_document_id','total_debit','total_credit','is_immutable','posted_at','reversal_of','reversed_by_journal','corrected_by_journal','updated_date'].map(key=>[key,journal?.[key]??null]));
 const rows=[...lines].sort((a,b)=>String(a.id).localeCompare(String(b.id))).map(line=>Object.fromEntries(['id','journal_id','status','account_id','account_number','account_name','description','debit','credit','party_id','opening_party_allocations'].map(key=>[key,line[key]??null])));
 const digest=await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([header,rows])));
 return [...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('');
}
export function journalSourcePath(journal){
 const id=journal?.source_document_id;if(!id)return '';
 const paths={Invoice:'/sales/invoices/',FieldSale:'/field-review/',SalesOrder:'/sales/',PurchaseOrder:'/purchases/',ProductionOrder:'/manufacturing/'};
 return paths[journal.source_document_type]?paths[journal.source_document_type]+encodeURIComponent(id):'';
}
