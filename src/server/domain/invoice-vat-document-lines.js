import {splitIncludedVat,STANDARD_VAT_RATE} from '../../lib/sale-vat.js';
import {journalCents} from './journal-validation.js';

export function invoiceVatLineTaxes(invoice,invoiceLines,marker) {
  const reconcile=()=>Error('Reconcile the invoice VAT correction with its saved lines.');
  const taxes=new Map(marker.lines.map(line=>[line.id,Number(line.tax_amount)]));
  if(taxes.size!==invoiceLines.length||new Set(invoiceLines.map(line=>line.id)).size!==invoiceLines.length)throw reconcile();

  let gross=0,originalTax=0;
  for(const line of invoiceLines){
    const total=journalCents(line.total),tax=journalCents(line.tax_amount);
    if(!taxes.has(line.id)||tax>total||journalCents(taxes.get(line.id))!==journalCents(splitIncludedVat(total/100,STANDARD_VAT_RATE).tax))throw reconcile();
    gross+=total;
    originalTax+=tax;
  }
  if(gross!==journalCents(invoice.total)||originalTax!==journalCents(invoice.tax_total))throw reconcile();
  return taxes;
}
