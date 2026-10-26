import {openingPartyLines} from '../../lib/opening-records.js';
import {readRecords} from './commercial-workspace.js';
import {postJournal,audit} from './field-ops.js';
export async function verifiedOpeningDocument(stores,document,kind){
 if(!document?.opening_batch_id||!document.opening_account_id)return false;
 const [event,journal]=await Promise.all([stores.AuditLog.get(document.opening_batch_id),stores.JournalEntry.get(document.journal_id)]);
 return !!event&&['import_opening_position','attach_opening_details'].includes(event.action)&&event.opening_position_result?.[kind==='Invoice'?'receivables':'payables']?.includes(document.id)&&journal?.status==='posted'&&journal.source_module==='opening_balances'&&journal.opening_detail_account_ids?.includes(document.opening_account_id);
}
export async function requestOpeningBillPayment(svc,user,bill,body,account,date,key,actor){
 const s=svc.entities;
 if(!await verifiedOpeningDocument(s,bill,'Bill'))throw Error('Reconcile the imported supplier payable before requesting payment.');
 if(date<bill.opening_date)throw Error('An opening payable cannot be paid before its opening date.');
 const amount=Number(body.amount);
 if(!Number.isFinite(amount)||amount<=0||Math.abs(Math.round(amount*100)-amount*100)>0.0001||amount>Number(bill.balance))throw Error('Enter a valid amount within the unpaid bill balance.');
 const pending=await readRecords(s.Payment,{bill_id:bill.id,status:{$in:['draft','pending_approval','approved','confirmed']}});
 if(pending.length)throw Error('This bill already has a payment awaiting processing.');
 const payment=await s.Payment.create({payment_number:'PAY-'+crypto.randomUUID().slice(0,10).toUpperCase(),payment_type:'supplier_payment',party_type:'supplier',party_id:bill.supplier_id,party_name:bill.supplier_name,bill_id:bill.id,bill_number:bill.bill_number,payment_date:date,amount,status:'pending_approval',payment_method:account.account_type==='bank'?'bank_transfer':account.account_type==='mobile_money'?'mobile_money':'cash',account_id:account.gl_account_id,treasury_account_id:account.id,treasury_account_name:account.name,reference:String(body.reference||'').trim(),prepared_by:user.id,prepared_at:new Date().toISOString(),cashier_request_key:key,opening_bill_payment:true});
 await audit(svc,{action:'request_cash_disbursement',module:'cashier',entityType:'Payment',entityId:payment.id,userId:user.id,description:actor+' requested approval to pay opening bill '+bill.bill_number});
 return {payment};
}
export async function releaseOpeningBillPayment(svc,user,payment,body,account,date,key){
 const s=svc.entities,bill=await s.Bill.get(payment.bill_id);
 if(payment.status!=='approved'||!payment.approved_by||!payment.approved_at||payment.payment_type!=='supplier_payment'||payment.treasury_account_id!==account.id||!await verifiedOpeningDocument(s,bill,'Bill')||bill.supplier_id!==payment.party_id)throw Error('Select a verified opening bill payment approved by the General Manager.');
 const amount=Number(payment.amount);
 if(!Number.isFinite(amount)||date<bill.opening_date||Math.round((Number(bill.total)-Number(bill.amount_paid||0))*100)!==Math.round(Number(bill.balance)*100)||!['open','partially_paid','overdue'].includes(bill.status)||amount<=0||amount>Number(bill.balance)||Number(account.balance)<amount)throw Error('The opening bill balance, payment date or available cash has changed.');
 if(payment.journal_id||(await readRecords(s.JournalEntry,{source_document_id:payment.id,status:'posted'})).length)throw Error('This payment already has a ledger entry. Reconcile it before release.');
 const debit=await s.Account.get(bill.opening_account_id);
 if(!debit||debit.is_active===false||debit.is_posting===false||debit.account_type!=='liability'||debit.normal_balance!=='credit')throw Error('The original supplier payable account is not active.');
 const tx=await s.TreasuryTransaction.create({transaction_number:'TRX-'+crypto.randomUUID().slice(0,10).toUpperCase(),treasury_account_id:account.id,treasury_account_name:account.name,transaction_type:'expense',amount,transaction_date:date,description:'Payment of opening bill '+bill.bill_number,reference:payment.reference,source:'supplier_payment',source_document_id:payment.id,cashier_request_key:key,created_by:user.id});
 const {journal}=await postJournal(svc,{entryDate:date,description:tx.description,sourceModule:'cashier',sourceDocumentType:'TreasuryTransaction',sourceDocumentId:tx.id,userId:user.id,lines:[{account_id:debit.id,account_number:debit.account_number,account_name:debit.name,debit:amount,credit:0,party_type:'supplier',party_id:bill.supplier_id},{account_id:account.ledger.id,account_number:account.ledger.account_number,account_name:account.ledger.name,debit:0,credit:amount}]});
 await s.TreasuryTransaction.update(tx.id,{journal_id:journal.id});await s.TreasuryAccount.update(account.id,{balance:Math.round((Number(account.balance)-amount)*100)/100});
 await s.Payment.update(payment.id,{status:'posted',journal_id:journal.id,disbursed_by:user.id,disbursed_at:new Date().toISOString()});
 const balance=Math.round((Number(bill.balance)-amount)*100)/100;
 await s.Bill.update(bill.id,{amount_paid:Math.round((Number(bill.amount_paid||0)+amount)*100)/100,balance,status:balance===0?'paid':'partially_paid'});
 await s.PaymentAllocation.create({payment_id:payment.id,payment_number:payment.payment_number,document_type:'bill',document_id:bill.id,document_number:bill.bill_number,party_type:'supplier',party_id:bill.supplier_id,party_name:bill.supplier_name,amount,allocation_date:date});
 const [journals,lines]=await Promise.all([readRecords(s.JournalEntry,{status:{$in:['posted','reversed']}}),readRecords(s.JournalLine,{account_id:debit.id})]),ids=new Set(journals.map(j=>j.id));
 const supplierBalance=lines.filter(l=>ids.has(l.journal_id)).flatMap(openingPartyLines).filter(l=>l.party_type==='supplier'&&l.party_id===bill.supplier_id).reduce((n,l)=>n+Number(l.credit||0)-Number(l.debit||0),0);
 await s.Supplier.update(bill.supplier_id,{balance:Math.round(supplierBalance*100)/100});
 await audit(svc,{action:'release_opening_bill_payment',module:'cashier',entityType:'Payment',entityId:payment.id,userId:user.id,description:'Paid '+amount+' XAF against opening bill '+bill.bill_number});
 return {payment:{...payment,status:'posted',journal_id:journal.id},transaction:tx};
}
