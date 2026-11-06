import {openingPartyLines} from '../../lib/opening-records.js';
import {readRecords} from './commercial-workspace.js';
import {postJournal,audit} from './field-ops.js';
import {verifiedRecurringBill} from './recurring-bill-evidence.js';
export const verifiedPayableBill=(stores,bill)=>bill?.accounting_source==='recurring_expense'?verifiedRecurringBill(stores,bill):verifiedOpeningDocument(stores,bill,'Bill');
const postedDate=bill=>bill.accounting_source==='recurring_expense'?bill.bill_date:bill.opening_date;
export async function verifiedOpeningDocument(stores,document,kind){
 if(!document?.opening_batch_id||!document.opening_account_id)return false;
 const [event,journal]=await Promise.all([stores.AuditLog.get(document.opening_batch_id),stores.JournalEntry.get(document.journal_id)]);
 if(event?.action==='import_customer_opening_balance'&&kind==='Invoice'){
  if(event.audit_source==='client_reported'||event.opening_customer_id!==document.customer_id||event.opening_customer_amount!==Number(document.total)||!event.opening_position_result?.receivables?.includes(document.id)||event.opening_position_result?.journal?.id!==journal?.id||journal?.status!=='posted'||journal.source_module!=='opening_balances')return false;
  const lines=await readRecords(stores.JournalLine,{journal_id:journal.id,account_id:document.opening_account_id});
  return lines.flatMap(openingPartyLines).some(l=>l.party_type==='customer'&&l.party_id===document.customer_id&&Number(l.debit)===Number(document.total)&&Number(l.credit||0)===0);
 }
 return !!event&&['import_opening_position','attach_opening_details'].includes(event.action)&&event.opening_position_result?.[kind==='Invoice'?'receivables':'payables']?.includes(document.id)&&journal?.status==='posted'&&journal.source_module==='opening_balances'&&journal.opening_detail_account_ids?.includes(document.opening_account_id);
}
export async function requestOpeningBillPayment(svc,user,bill,body,account,date,key,actor){
 const s=svc.entities;
 if(!await verifiedPayableBill(s,bill))throw Error('Reconcile the recorded supplier payable before requesting payment.');
 if(date<postedDate(bill))throw Error('A payable cannot be paid before its posting date.');
 const amount=Number(body.amount);
 if(!Number.isFinite(amount)||amount<=0||Math.abs(Math.round(amount*100)-amount*100)>0.0001||amount>Number(bill.balance))throw Error('Enter a valid amount within the unpaid bill balance.');
 const pending=await readRecords(s.Payment,{bill_id:bill.id,status:{$in:['draft','pending_approval','approved','confirmed']}});
 if(pending.length)throw Error('This bill already has a payment awaiting processing.');
 const payment=await s.Payment.create({payment_number:'PAY-'+crypto.randomUUID().slice(0,10).toUpperCase(),payment_type:'supplier_payment',party_type:'supplier',party_id:bill.supplier_id,party_name:bill.supplier_name,bill_id:bill.id,bill_number:bill.bill_number,payment_date:date,amount,status:'pending_approval',payment_method:account.account_type==='bank'?'bank_transfer':account.account_type==='mobile_money'?'mobile_money':'cash',account_id:account.gl_account_id,treasury_account_id:account.id,treasury_account_name:account.name,reference:String(body.reference||'').trim(),prepared_by:user.id,prepared_at:new Date().toISOString(),cashier_request_key:key,opening_bill_payment:bill.accounting_source!=='recurring_expense',recurring_bill_payment:bill.accounting_source==='recurring_expense'});
 await audit(svc,{action:'request_cash_disbursement',module:'cashier',entityType:'Payment',entityId:payment.id,userId:user.id,description:actor+' requested approval to pay recorded bill '+bill.bill_number});
 return {payment};
}
export async function releaseOpeningBillPayment(svc,user,payment,body,account,date,key){
 const s=svc.entities,bill=await s.Bill.get(payment.bill_id);
 if(payment.status!=='approved'||!payment.approved_by||!payment.approved_at||payment.payment_type!=='supplier_payment'||payment.treasury_account_id!==account.id||!await verifiedPayableBill(s,bill)||bill.supplier_id!==payment.party_id)throw Error('Select a verified recorded bill payment approved by the General Manager.');
 const amount=Number(payment.amount);
 if(!Number.isFinite(amount)||date<postedDate(bill)||Math.round((Number(bill.total)-Number(bill.amount_paid||0))*100)!==Math.round(Number(bill.balance)*100)||!['open','partially_paid','overdue'].includes(bill.status)||amount<=0||amount>Number(bill.balance)||Number(account.balance)<amount)throw Error('The recorded bill balance, payment date or available cash has changed.');
 if(payment.journal_id||(await readRecords(s.JournalEntry,{source_document_id:payment.id,status:'posted'})).length)throw Error('This payment already has a ledger entry. Reconcile it before release.');
 const debit=await s.Account.get(bill.accounting_source==='recurring_expense'?bill.payable_account_id:bill.opening_account_id);
 if(!debit||debit.is_active===false||debit.is_posting===false||debit.account_type!=='liability'||debit.normal_balance!=='credit')throw Error('The original supplier payable account is not active.');
 const tx=await s.TreasuryTransaction.create({transaction_number:'TRX-'+crypto.randomUUID().slice(0,10).toUpperCase(),treasury_account_id:account.id,treasury_account_name:account.name,transaction_type:'expense',amount,transaction_date:date,description:'Payment of recorded bill '+bill.bill_number,reference:payment.reference,source:'supplier_payment',source_document_id:payment.id,cashier_request_key:key,created_by:user.id});
 const {journal}=await postJournal(svc,{entryDate:date,description:tx.description,sourceModule:'cashier',sourceDocumentType:'TreasuryTransaction',sourceDocumentId:tx.id,userId:user.id,lines:[{account_id:debit.id,account_number:debit.account_number,account_name:debit.name,debit:amount,credit:0,party_type:'supplier',party_id:bill.supplier_id},{account_id:account.ledger.id,account_number:account.ledger.account_number,account_name:account.ledger.name,debit:0,credit:amount}]});
 await s.TreasuryTransaction.update(tx.id,{journal_id:journal.id});await s.TreasuryAccount.update(account.id,{balance:Math.round((Number(account.balance)-amount)*100)/100});
 await s.Payment.update(payment.id,{status:'posted',journal_id:journal.id,disbursed_by:user.id,disbursed_at:new Date().toISOString()});
 const balance=Math.round((Number(bill.balance)-amount)*100)/100;
 await s.Bill.update(bill.id,{amount_paid:Math.round((Number(bill.amount_paid||0)+amount)*100)/100,balance,status:balance===0?'paid':'partially_paid'});
 await s.PaymentAllocation.create({payment_id:payment.id,payment_number:payment.payment_number,document_type:'bill',document_id:bill.id,document_number:bill.bill_number,party_type:'supplier',party_id:bill.supplier_id,party_name:bill.supplier_name,amount,allocation_date:date});
 const [journals,rules,bills,accounts,payments]=await Promise.all([readRecords(s.JournalEntry,{status:{$in:['posted','reversed']}}),readRecords(s.PostingRule,{rule_key:{$in:['supplier_payable','supplier_prepayment']},is_active:true}),readRecords(s.Bill),readRecords(s.Account),readRecords(s.Payment,{party_id:bill.supplier_id,status:'posted'})]),ids=new Set(journals.map(j=>j.id));
 const payableIds=[...new Set([debit.id,...rules.map(r=>r.account_id),...accounts.filter(a=>a.account_type==='liability'||a.account_number==='4010').map(a=>a.id),...bills.flatMap(b=>[b.opening_account_id,b.payable_account_id]),...payments.flatMap(p=>[p.supplier_prepayment_account_id,p.supplier_payable_account_id])].filter(Boolean))];
 const lines=await readRecords(s.JournalLine,{account_id:{$in:payableIds}});
 const supplierBalance=lines.filter(l=>ids.has(l.journal_id)&&(!l.status||['posted','reversed'].includes(l.status))).flatMap(openingPartyLines).filter(l=>l.party_type==='supplier'&&l.party_id===bill.supplier_id).reduce((n,l)=>n+Number(l.credit||0)-Number(l.debit||0),0);
 await s.Supplier.update(bill.supplier_id,{balance:Math.round(supplierBalance*100)/100});
 await audit(svc,{action:bill.accounting_source==='recurring_expense'?'release_recurring_bill_payment':'release_opening_bill_payment',module:'cashier',entityType:'Payment',entityId:payment.id,userId:user.id,description:'Paid '+amount+' XAF against recorded bill '+bill.bill_number});
 return {payment:{...payment,status:'posted',journal_id:journal.id},transaction:tx};
}
