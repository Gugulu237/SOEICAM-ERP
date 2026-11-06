import {readRecords} from './commercial-workspace.js';
import {checkedJournalLines,journalCents,journalDate,journalPayload} from './journal-validation.js';

const active=account=>account&&account.is_active!==false&&account.is_posting!==false&&(!account.currency||account.currency==='XAF')&&!account.is_treasury;
const payable=account=>active(account)&&account.account_type==='liability'&&account.normal_balance==='credit';
const fail=()=>Error('Reconcile the original supplier journal and account before making this payment.');

async function verifiedJournal(stores,id){
  const journal=id?await stores.JournalEntry.get(id):null;
  if(!journal||journal.status!=='posted'||journal.reversed_by_journal||journal.reversal_of)throw fail();
  journalDate(journal.entry_date);
  const lines=await readRecords(stores.JournalLine,{journal_id:id});
  if(lines.some(l=>l.status&&l.status!=='posted'))throw fail();
  const checked=checkedJournalLines(lines);
  if(journalCents(journal.total_debit)!==journalCents(checked.debit)||journalCents(journal.total_credit)!==journalCents(checked.credit))throw fail();
  if(journal.posting_payload&&journal.posting_payload!==journalPayload({entryDate:journal.entry_date,description:journal.description,sourceModule:journal.source_module,sourceDocumentType:journal.source_document_type,lines:checked.lines}))throw fail();
  return {journal,lines};
}

// A bill clears the account that recorded the liability, not today's mapping.
export async function receiptSupplierPayable(stores,receipt,supplierId,bill){
  if(!receipt||receipt.status!=='confirmed'||receipt.supplier_id!==supplierId||bill&&(bill.receipt_id!==receipt.id||bill.po_id!==receipt.po_id||bill.supplier_id!==supplierId))throw fail();
  const journals=await readRecords(stores.JournalEntry,{source_document_id:receipt.id,source_module:'procurement',source_document_type:'GoodsReceipt',status:{$in:['posted','reversed']}});
  if(journals.length!==1||receipt.journal_id&&receipt.journal_id!==journals[0].id||bill?.journal_id&&bill.journal_id!==journals[0].id)throw fail();
  const {journal,lines}=await verifiedJournal(stores,journals[0].id);
  if(journal.entry_date!==receipt.receipt_date)throw fail();
  const matching=lines.filter(l=>l.party_type==='supplier'&&l.party_id===supplierId);
  const ids=[...new Set(matching.map(l=>l.account_id))];
  if(ids.length!==1||matching.some(l=>journalCents(l.debit)>0))throw fail();
  const account=await stores.Account.get(ids[0]);
  const cents=matching.reduce((n,l)=>n+journalCents(l.credit),0);
  if(!payable(account)||!cents||!Number.isSafeInteger(cents)||cents!==journalCents(receipt.total)||cents!==journalCents(journal.total_credit)||bill&&(cents!==journalCents(bill.total)||bill.payable_account_id&&bill.payable_account_id!==account.id))throw fail();
  return {account,journal,value:cents/100};
}

export async function billSupplierPayable(stores,bill,date){
  if(!bill?.receipt_id||!bill.journal_id)throw fail();
  const result=await receiptSupplierPayable(stores,await stores.GoodsReceipt.get(bill.receipt_id),bill.supplier_id,bill);
  if(date<result.journal.entry_date)throw Error('A supplier bill cannot be paid before its posting date.');
  return result.account;
}

export async function supplierPrepaymentAccount(stores){
  const rules=await readRecords(stores.PostingRule,{rule_key:'supplier_prepayment',is_active:true});
  const account=rules.length===1?await stores.Account.get(rules[0].account_id):null;
  const treasury=account?await readRecords(stores.TreasuryAccount,{gl_account_id:account.id}):[];
  if(!active(account)||account.account_type!=='asset'||account.normal_balance!=='debit'||account.account_number==='1050'||treasury.length)throw Error('Configure Supplier prepayments in Accounting > Posting Rules with a separate debit asset account before paying an advance.');
  return account;
}

async function supplierPaymentSource(stores,payment){
  if(payment.status!=='posted'||payment.party_type!=='supplier'||payment.payment_type!=='supplier_payment'||!journalCents(payment.amount))throw fail();
  const {journal,lines}=await verifiedJournal(stores,payment.journal_id);
  const tx=journal.source_document_type==='TreasuryTransaction'?await stores.TreasuryTransaction.get(journal.source_document_id):null;
  if(journal.source_module!=='cashier'||!tx||tx.journal_id!==journal.id||tx.source!=='supplier_payment'||tx.source_document_id!==payment.id||tx.treasury_account_id!==payment.treasury_account_id||journalCents(tx.amount)!==journalCents(payment.amount)||journal.entry_date!==tx.transaction_date)throw fail();
  const linked=await readRecords(stores.JournalEntry,{source_module:'cashier',source_document_type:'TreasuryTransaction',source_document_id:tx.id,status:{$in:['posted','reversed']}});
  if(linked.length!==1||linked[0].id!==journal.id)throw fail();
  const treasury=await stores.TreasuryAccount.get(payment.treasury_account_id);
  const supplierLines=lines.filter(l=>l.party_type==='supplier'&&l.party_id===payment.party_id);
  if(supplierLines.length!==1||lines.length!==2||journalCents(supplierLines[0].debit)!==journalCents(payment.amount)||journalCents(supplierLines[0].credit)!==0)throw fail();
  const source=supplierLines[0],cash=lines.find(l=>l!==source);
  if(!treasury||cash.account_id!==treasury.gl_account_id||journalCents(cash.credit)!==journalCents(payment.amount)||journalCents(cash.debit)!==0)throw fail();
  const account=await stores.Account.get(source.account_id);
  return {account,journal};
}

export async function supplierAdvanceSource(stores,payment,bill){
  const {account,journal}=await supplierPaymentSource(stores,payment);
  if(payment.bill_id||payment.party_id!==bill.supplier_id||payment.po_id!==bill.po_id||journal.entry_date>bill.bill_date)throw fail();
  if(payment.supplier_prepayment_account_id){
    if(account?.id!==payment.supplier_prepayment_account_id||!active(account)||account.account_type!=='asset'||account.normal_balance!=='debit')throw fail();
    return {account,prepayment:true};
  }
  if(!payable(account))throw fail();
  return {account,prepayment:false};
}

// Read-only evidence for review. A proposal is not proof that a separate manual
// correction has not already been posted; callers must never auto-post it.
export async function supplierPayableMismatches(stores){
  const [payments,allocations]=await Promise.all([readRecords(stores.Payment,{status:'posted',payment_type:'supplier_payment'}),readRecords(stores.PaymentAllocation)]);
  const mismatches=[],blocked=[];let excluded_advances=0;
  const describe=account=>({id:account.id,account_number:account.account_number||'',name:account.name||''});
  for(const payment of payments){
    if(!payment.bill_id){excluded_advances++;continue;}
    if(payment.opening_bill_payment||payment.recurring_bill_payment)continue;
    try{
      const bill=await stores.Bill.get(payment.bill_id);
      if(!bill||bill.supplier_id!==payment.party_id||bill.po_id!==payment.po_id||bill.status==='cancelled'||payment.supplier_prepayment_account_id)throw fail();
      const {account:original,journal:receiptJournal}=await receiptSupplierPayable(stores,await stores.GoodsReceipt.get(bill.receipt_id),payment.party_id,bill);
      const {account:actual,journal:paymentJournal}=await supplierPaymentSource(stores,payment);
      if(!payable(actual)||paymentJournal.entry_date<receiptJournal.entry_date||payment.supplier_payable_account_id&&payment.supplier_payable_account_id!==actual.id)throw fail();
      const applied=allocations.filter(a=>a.payment_id===payment.id);
      if(applied.length!==1||applied[0].document_type!=='bill'||applied[0].document_id!==bill.id||applied[0].party_type!=='supplier'||applied[0].party_id!==payment.party_id||journalCents(applied[0].amount)!==journalCents(payment.amount)||journalCents(payment.amount)>journalCents(bill.total))throw fail();
      const billAllocated=allocations.filter(a=>a.document_type==='bill'&&a.document_id===bill.id).reduce((total,a)=>total+journalCents(a.amount),0);
      if(!Number.isSafeInteger(billAllocated)||billAllocated>journalCents(bill.total)||billAllocated!==journalCents(bill.amount_paid)||journalCents(bill.balance)+billAllocated!==journalCents(bill.total))throw fail();
      if(actual.id===original.id)continue;
      const amount=journalCents(payment.amount)/100;
      mismatches.push({payment_id:payment.id,payment_number:payment.payment_number||'',bill_id:bill.id,bill_number:bill.bill_number||'',supplier_id:payment.party_id,amount,payment_journal_id:paymentJournal.id,payment_journal_number:paymentJournal.journal_number||'',receipt_journal_id:receiptJournal.id,receipt_journal_number:receiptJournal.journal_number||'',original_payable:describe(original),payment_payable:describe(actual),proposed_lines:[{account_id:original.id,debit:amount,credit:0},{account_id:actual.id,debit:0,credit:amount}],review_required:true});
    }catch(error){blocked.push({payment_id:payment.id,payment_number:payment.payment_number||'',bill_id:payment.bill_id,reason:error.message});}
  }
  return {mismatches,blocked,excluded_advances};
}
