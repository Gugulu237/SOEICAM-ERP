import {checkedJournalLines,journalCents,journalDate,journalPayload,ledgerStatuses} from './journal-validation.js';

export const INVOICE_VAT_CORRECTION_TYPE='InvoiceVatCorrection';
const invalid=()=>Error('Reconcile the posted invoice VAT correction before continuing.');
const present=value=>typeof value==='string'&&Boolean(value.trim());
const money=value=>{
  if(value==null)throw invalid();
  return journalCents(value);
};

export function verifyInvoiceVatCorrection({invoice,originalJournal,originalLines,journal,lines,accounts}){
  const marker=invoice?.invoice_vat_correction;
  if(!Object.hasOwn(invoice||{},'invoice_vat_correction')&&!journal)return null;
  if(marker?.version!==1||!present(marker.journal_id)||!present(marker.journal_number)||!present(marker.tax_account_id)||
    !Array.isArray(marker.lines)||!marker.lines.length||!invoice.sales_order_id||invoice.field_sale_id)throw invalid();
  if(!originalJournal?.id||originalJournal.id!==invoice.journal_id||originalJournal.id!==marker.original_journal_id||
    originalJournal.source_document_id!==invoice.id||originalJournal.source_document_type!=='Invoice'||originalJournal.source_module!=='sales'||
    !ledgerStatuses.includes(originalJournal.status)||originalJournal.reversal_of)throw invalid();
  if(journal?.id!==marker.journal_id||journal.journal_number!==marker.journal_number||journal.entry_date!==marker.date||
    journal.entry_date!==originalJournal.entry_date||journal.status!=='posted'||journal.reversal_of||journal.reversed_by_journal||
    journal.source_module!=='sales'||journal.source_document_type!==INVOICE_VAT_CORRECTION_TYPE||
    journal.source_document_id!==invoice.id||journal.is_immutable!==true)throw invalid();
  journalDate(marker.date);

  const gross=money(invoice.total),oldNet=money(invoice.subtotal),oldTax=money(invoice.tax_total),net=money(marker.subtotal),tax=money(marker.tax_total),delta=tax-oldTax;
  if(!gross||oldNet+oldTax!==gross||net+tax!==gross||money(marker.original_subtotal)!==oldNet||money(marker.original_tax_total)!==oldTax||delta<=0||oldNet-net!==delta||
    marker.lines.some(line=>!present(line?.id))||new Set(marker.lines.map(line=>line.id)).size!==marker.lines.length||marker.lines.reduce((total,line)=>total+money(line.tax_amount),0)!==tax)throw invalid();

  const original=checkedVatJournal(originalJournal,originalLines,ledgerStatuses);
  const originalRevenue=new Map(),taxAccount=accounts.get(marker.tax_account_id);
  if(taxAccount?.account_type!=='liability'||taxAccount.normal_balance!=='credit')throw invalid();
  let originalTax=0,originalTaxLines=0;
  for(const line of original.lines){
    const account=accounts.get(line.account_id);
    if(!account)throw invalid();
    if(account.account_type==='revenue'){
      if(account.normal_balance!=='credit'||line.debit||originalRevenue.has(line.account_id))throw invalid();
      originalRevenue.set(line.account_id,money(line.credit));
    }
    if(line.account_id===marker.tax_account_id){
      originalTaxLines++;
      if(line.debit||originalTaxLines>1)throw invalid();
      originalTax=money(line.credit);
    }
  }
  if([...originalRevenue.values()].reduce((total,credit)=>total+credit,0)!==oldNet||originalTax!==oldTax)throw invalid();

  const checked=checkedVatJournal(journal,lines,['posted']);
  if(checked.lines.some(line=>line.status!=='posted'||line.party_type||line.party_id)||
    new Set(checked.lines.map(line=>line.account_id)).size!==checked.lines.length||money(checked.debit)!==delta)throw invalid();
  let vatCredit=0;
  for(const line of checked.lines){
    if(line.account_id===marker.tax_account_id){
      if(line.debit)throw invalid();
      vatCredit=money(line.credit);
    }else if(!line.debit||line.credit||money(line.debit)>(originalRevenue.get(line.account_id)||0))throw invalid();
  }
  if(vatCredit!==delta)throw invalid();
  return {marker,journal,lines:checked.lines};
}

function checkedVatJournal(journal,lines,statuses){
  const checked=checkedJournalLines(lines);
  if(checked.lines.length!==lines.length||lines.some(line=>!present(line.id)||line.journal_id!==journal.id||line.status&&!statuses.includes(line.status))||
    new Set(lines.map(line=>line.id)).size!==lines.length||money(journal.total_debit)!==money(checked.debit)||money(journal.total_credit)!==money(checked.credit))throw invalid();
  if(journal.posting_payload&&journal.posting_payload!==journalPayload({entryDate:journal.entry_date,description:journal.description,
    sourceModule:journal.source_module,sourceDocumentType:journal.source_document_type,lines:checked.lines}))throw invalid();
  return checked;
}

export function invoiceVatEffectiveLines(originalLines,correction){
  if(!correction)return originalLines;
  const remaining=new Map(correction.lines.map(line=>[line.account_id,line]));
  const result=originalLines.map(line=>{
    const adjustment=remaining.get(line.account_id);
    if(!adjustment)return line;
    remaining.delete(line.account_id);
    return {...line,credit:(money(line.credit)+money(adjustment.credit)-money(adjustment.debit))/100};
  });
  return [...result.filter(line=>line.debit||line.credit),...remaining.values()];
}
