import { erp } from '@/api/erpClient';
import { readAll } from '@/lib/field-pos';
import { tableReport } from '@/lib/report-models';

export function buildPaymentQuery(filters) {
  const query={};
  if(filters.type!=='all') query.payment_type=filters.type;
  if(filters.status!=='all') query.status=filters.status==='pending'?{$in:['pending_approval','approved']}:filters.status;
  const term=filters.q.trim().replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  if(term) query.$or=['payment_number','party_name','invoice_numbers','reference'].map(key=>({[key]:{$regex:term,$options:'i'}}));
  return query;
}
export async function paymentRegisterDocument(filters) {
  const rows=await readAll(erp.entities.Payment,buildPaymentQuery(filters),'-created_date');
  return tableReport('Receipts and payments',[
    {key:'payment_number',label:'Receipt / payment'}, {key:'payment_date',label:'Date'}, {key:'payment_type',label:'Type'},
    {key:'party_name',label:'Party'},{key:'invoice_numbers',label:'Invoices',exportValue:r=>r.invoice_numbers|| (r.receipt_allocations||[]).map(a=>a.invoice_number||a.invoice_id).join(', ')},
    {key:'amount',label:'Amount',exportType:'money'},{key:'treasury_account_name',label:'Treasury account'},{key:'reference',label:'Reference'},
    {key:'cashier_confirmed_name',label:'Cashier confirmation'},{key:'cashier_confirmed_at',label:'Cashier confirmation date'},
    {key:'approved_by',label:'Approved by'},{key:'status',label:'Status'},{key:'journal_id',label:'Journal ID'},
  ],rows,[['Payment type',filters.type],['Status',filters.status],['Search',filters.q||'All records']],['Only posted payments affect the ledger. Pending and rejected records remain labelled with their actual status.']);
}
