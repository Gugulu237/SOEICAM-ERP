import {readRecords} from './commercial-workspace.js';
import {journalCents} from './journal-validation.js';
import {PURCHASE_VAT_TREATMENTS} from '../../lib/purchase-vat.js';
import {splitIncludedVat,STANDARD_VAT_RATE} from '../../lib/sale-vat.js';

export async function supplierReceiptVat(stores,input,supplierId,total,quotedTax,maximumTax){
  const treatment=input?.treatment;
  if(!input||typeof input!=='object'||Array.isArray(input)||!PURCHASE_VAT_TREATMENTS.includes(treatment))throw Error('Choose the supplier invoice VAT treatment.');
  const cents=journalCents(total);
  const fields={purchase_vat_treatment:treatment,quoted_vat_total:quotedTax,supplier_vat_maximum:maximumTax};
  if(treatment==='unverified')return fields;
  const reference=typeof input.reference==='string'?input.reference.trim():'';
  if(reference.length>120||treatment==='documented'&&(!reference||input.confirmed!==true))throw Error('Enter the supplier invoice number and confirm its VAT evidence.');
  const taxCents=treatment==='none'?0:journalCents(input.taxAmount);
  const maximum=Math.max(journalCents(maximumTax),journalCents(splitIncludedVat(total,STANDARD_VAT_RATE).tax));
  if(treatment==='documented'&&(taxCents<=0||taxCents>maximum+1||taxCents>=cents))throw Error('Enter the VAT amount shown for these goods, within the standard VAT on the receipt total.');
  const key=reference.normalize('NFKC').replace(/\s+/g,'').toLowerCase();
  if(key&&(await readRecords(stores.GoodsReceipt,{supplier_id:supplierId,supplier_invoice_vat_key:key})).length)throw Error('This supplier invoice already has VAT recorded on another receipt.');
  return {...fields,...(key?{supplier_invoice_reference:reference,supplier_invoice_vat_key:key}:{}),subtotal:(cents-taxCents)/100,tax_total:taxCents/100};
}

export function supplierBillVat(receipt){
  if(!receipt.purchase_vat_treatment)return {};
  const {purchase_vat_treatment,quoted_vat_total,subtotal,tax_total,supplier_invoice_reference}=receipt;
  return {purchase_vat_treatment,quoted_vat_total,...(subtotal!=null?{subtotal,tax_total}:{}),...(supplier_invoice_reference?{supplier_invoice_reference}:{})};
}
