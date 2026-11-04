import {createHash} from 'node:crypto';
import {readRecords} from './commercial-workspace.js';
import {journalCents} from './journal-validation.js';

export const recurringBillId=(accountId,month)=>'RE-'+createHash('sha256').update(accountId+':'+month).digest('hex').slice(0,40);
export async function verifiedRecurringBill(stores,bill){
  if(!bill||bill.accounting_source!=='recurring_expense'||bill.id!==recurringBillId(bill.recurring_account_id,bill.recurring_period)||!bill.journal_id)return false;
  const [journal,lines]=await Promise.all([stores.JournalEntry.get(bill.journal_id),readRecords(stores.JournalLine,{journal_id:bill.journal_id})]);
  if(journal?.status!=='posted'||journal.source_module!=='recurring_expenses'||journal.source_document_type!=='Bill'||journal.source_document_id!==bill.id||lines.length!==2)return false;
  const amount=journalCents(bill.total),expense=lines.find(l=>l.account_id===bill.recurring_account_id),payable=lines.find(l=>l.account_id===bill.payable_account_id);
  return amount>0&&journal.entry_date===bill.bill_date&&journalCents(journal.total_debit)===amount&&journalCents(journal.total_credit)===amount&&!!expense&&!!payable&&journalCents(expense.debit)===amount&&journalCents(expense.credit||0)===0&&journalCents(payable.credit)===amount&&journalCents(payable.debit||0)===0&&payable.party_type==='supplier'&&payable.party_id===bill.supplier_id;
}
