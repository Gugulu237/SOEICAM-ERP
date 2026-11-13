import {checkedJournalLines,journalCents,journalDate,journalPayload} from './journal-validation.js';

export const INVOICE_PAYMENT_TYPE_CORRECTION_TYPE='InvoicePaymentTypeCorrection';
export const INVOICE_PAYMENT_TYPE_CORRECTION_MARKER='invoice_payment_type_correction';
const invalid=()=>Error('Reconcile the posted invoice payment type correction before continuing.');
const markerFields=['version','journal_id','journal_number','date','original_journal_id','original_payment_type','payment_type','amount','clearing_account_id','receivable_account_id','recorded_at'];
const hasMarker=row=>Object.hasOwn(row||{},INVOICE_PAYMENT_TYPE_CORRECTION_MARKER);
const isReceivableAsset=account=>account?.account_type==='asset'&&account.normal_balance==='debit'&&!account.is_treasury;
const matchesPayload=(journal,lines)=>!journal.posting_payload||journal.posting_payload===journalPayload({
  entryDate:journal.entry_date,description:journal.description,sourceModule:journal.source_module,sourceDocumentType:journal.source_document_type,lines,
});

export function verifyInvoicePaymentTypeCorrection({invoice,order,originalJournal,originalLines,journal,lines,clearing,receivable}){
  if(!hasMarker(invoice)&&!hasMarker(order)&&!journal)return null;
  const marker=invoice?.[INVOICE_PAYMENT_TYPE_CORRECTION_MARKER],orderMarker=order?.[INVOICE_PAYMENT_TYPE_CORRECTION_MARKER];
  if(!marker||!orderMarker||markerFields.some(key=>marker[key]!==orderMarker[key])||marker.version!==1||
    marker.original_payment_type!=='cash'||marker.payment_type!=='credit'||!invoice.sales_order_id||invoice.field_sale_id||
    invoice.payment_type!=='credit'||order.payment_type!=='credit'||order.id!==invoice.sales_order_id||order.invoice_id!==invoice.id||
    order.customer_id!==invoice.customer_id||invoice.cash_sale_settlement||order.cash_sale_settlement)throw invalid();

  const amount=journalCents(marker.amount);
  if(!amount||amount!==journalCents(invoice.total)||amount!==journalCents(order.total)||
    !isReceivableAsset(clearing)||!isReceivableAsset(receivable)||clearing.account_number!=='1050'||clearing.id===receivable.id||
    clearing.id!==marker.clearing_account_id||receivable.id!==marker.receivable_account_id)throw invalid();
  if(!originalJournal?.id||originalJournal.id!==invoice.journal_id||originalJournal.id!==marker.original_journal_id||
    originalJournal.source_module!=='sales'||originalJournal.source_document_type!=='Invoice'||originalJournal.source_document_id!==invoice.id||
    originalJournal.status!=='posted'||originalJournal.reversal_of||originalJournal.reversed_by_journal)throw invalid();

  journalDate(marker.date);
  if(marker.date!==originalJournal.entry_date||marker.date!==invoice.invoice_date||!journal?.id||
    journal.id!==marker.journal_id||!journal.journal_number||journal.journal_number!==marker.journal_number||
    journal.entry_date!==marker.date||journal.status!=='posted'||journal.reversal_of||journal.reversed_by_journal||
    journal.source_module!=='sales'||journal.source_document_type!==INVOICE_PAYMENT_TYPE_CORRECTION_TYPE||
    journal.source_document_id!==invoice.id||journal.is_immutable!==true||
    typeof marker.recorded_at!=='string'||!Number.isFinite(Date.parse(marker.recorded_at))||
    new Date(marker.recorded_at).toISOString()!==marker.recorded_at||journal.posted_at!==marker.recorded_at)throw invalid();

  const isParty=line=>line.party_type==='customer'&&line.party_id===invoice.customer_id;
  const originalClearing=originalLines.filter(line=>line.account_id===clearing.id);
  if(originalClearing.length!==1||originalLines.some(line=>line.account_id===receivable.id)||
    !isParty(originalClearing[0])||journalCents(originalClearing[0].debit)!==amount||journalCents(originalClearing[0].credit)||
    !matchesPayload(originalJournal,originalLines))throw invalid();
  const checked=checkedJournalLines(lines);
  const debit=checked.lines.find(line=>line.account_id===receivable.id);
  const credit=checked.lines.find(line=>line.account_id===clearing.id);
  if(lines.length!==2||checked.lines.length!==2||new Set(lines.map(line=>line.id)).size!==2||
    lines.some(line=>!line.id||line.journal_id!==journal.id||line.status!=='posted'||!isParty(line))||
    !debit||!credit||journalCents(debit.debit)!==amount||journalCents(debit.credit)||
    journalCents(credit.credit)!==amount||journalCents(credit.debit)||
    journalCents(journal.total_debit)!==amount||journalCents(journal.total_credit)!==amount||
    !matchesPayload(journal,checked.lines))throw invalid();

  return {marker,journal,lines:checked.lines,receivableLine:debit};
}

export function invoicePaymentTypeEffectiveLines(originalLines,correction){
  if(!correction)return originalLines;
  return originalLines.map(line=>line.account_id===correction.marker.clearing_account_id?correction.receivableLine:line);
}
