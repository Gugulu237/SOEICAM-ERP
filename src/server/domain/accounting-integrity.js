import {validPostingRuleAccount} from '../../lib/posting-rule-types.js';
import {requireActiveContext,forbidden} from '../access.js';
import {assertModule} from './role-catalogue.js';
import {readRecords} from './commercial-workspace.js';
import {journalCents,journalDate,ledgerStatuses} from './journal-validation.js';
export async function accountingIntegrity(stores,context){
 if(requireActiveContext(context)!=='admin')throw forbidden('Only administrators can run the accounting integrity check.');assertModule({...context,role:'admin'},'accounting');
 const [accounts,journals,lines,treasury,periods,payments,allocations,invoices,bills,rules]=await Promise.all(['Account','JournalEntry','JournalLine','TreasuryAccount','AccountingPeriod','Payment','PaymentAllocation','Invoice','Bill','PostingRule'].map(n=>readRecords(stores[n])));
 const issues=[],counts={},byAccount=new Map(accounts.map(a=>[a.id,a])),byJournal=new Map(journals.map(j=>[j.id,j])),nets=new Map(),headerLines=new Map();let totalDebit=0,totalCredit=0,invalid=false;
 const issue=(code,reference)=>{counts[code]=(counts[code]||0)+1;if(issues.length<100)issues.push({code,reference:String(reference||'')});};
 for(const line of lines){
  const header=byJournal.get(line.journal_id);if(!header){issue('orphan_line',line.id);continue;}
  if(!ledgerStatuses.includes(header.status))continue;
  if(line.status==='draft'){issue('posted_header_draft_line',header.journal_number||header.id);continue;}
  if(!byAccount.has(line.account_id))issue('missing_account',header.journal_number||header.id);
  let debit,credit;try{debit=journalCents(line.debit||0);credit=journalCents(line.credit||0);if(debit&&credit)throw Error();}catch{issue('invalid_line_amount',line.id);invalid=true;continue;}
  const sum=headerLines.get(header.id)||{debit:0,credit:0,count:0};sum.debit+=debit;sum.credit+=credit;sum.count++;headerLines.set(header.id,sum);
  totalDebit+=debit;totalCredit+=credit;nets.set(line.account_id,(nets.get(line.account_id)||0)+debit-credit);
 }
 for(const j of journals.filter(j=>ledgerStatuses.includes(j.status))){
  try{journalDate(j.entry_date);}catch{issue('invalid_journal_date',j.journal_number||j.id);}
  const sum=headerLines.get(j.id);if(!sum||sum.count<2||sum.debit!==sum.credit)issue('unbalanced_journal',j.journal_number||j.id);
  try{if(journalCents(j.total_debit)!==sum?.debit||journalCents(j.total_credit)!==sum?.credit)issue('header_line_mismatch',j.journal_number||j.id);}catch{issue('invalid_header_total',j.journal_number||j.id);}
 }
 for(const r of rules.filter(r=>r.is_active!==false))if(!validPostingRuleAccount(byAccount.get(r.account_id),r.rule_key))issue("invalid_posting_rule",r.label||r.rule_key);
 const numbers=new Set();for(const j of journals){if(j.journal_number&&numbers.has(j.journal_number))issue('duplicate_journal_number',j.journal_number);numbers.add(j.journal_number);}
 for(const a of accounts){const net=(nets.get(a.id)||0)*(a.normal_balance==='credit'?-1:1);if(!Number.isFinite(Number(a.balance||0))||Math.abs(Number(a.balance||0)*100-net)>0.001)issue('account_cache_mismatch',a.account_number||a.id);}
 const mapped=new Set();for(const t of treasury){
  if(!byAccount.has(t.gl_account_id))issue('treasury_missing_account',t.name||t.id);
  if(mapped.has(t.gl_account_id))issue('duplicate_treasury_mapping',t.name||t.id);mapped.add(t.gl_account_id);
  if(!Number.isFinite(Number(t.balance||0))||Math.abs(Number(t.balance||0)*100-(nets.get(t.gl_account_id)||0))>0.001)issue('treasury_gl_mismatch',t.name||t.id);
 }
 for(let i=0;i<periods.length;i++)for(let n=i+1;n<periods.length;n++)if(periods[i].start_date<=periods[n].end_date&&periods[n].start_date<=periods[i].end_date)issue('overlapping_periods',periods[i].name+' / '+periods[n].name);
 const paymentMap=new Map(payments.map(p=>[p.id,p])),documents=new Map([...invoices.map(d=>['invoice:'+d.id,d]),...bills.map(d=>['bill:'+d.id,d])]),allocated=new Map(),pairs=new Set();
 for(const a of allocations){
  const p=paymentMap.get(a.payment_id),key=a.document_type+':'+a.document_id,doc=documents.get(key),pair=a.payment_id+':'+key;let cents;
  try{cents=journalCents(a.amount);if(!cents)throw Error();}catch{issue('invalid_allocation',a.id);continue;}
  if(!p||p.status!=='posted'||!doc||doc[a.document_type==='bill'?'supplier_id':'customer_id']!==p.party_id){issue('unverified_allocation',a.id);continue;}
  if(pairs.has(pair))issue('duplicate_allocation',a.id);pairs.add(pair);allocated.set(p.id,(allocated.get(p.id)||0)+cents);
 }
 for(const p of payments.filter(p=>p.status==='posted')){
  if(!ledgerStatuses.includes(byJournal.get(p.journal_id)?.status))issue('payment_without_posted_journal',p.payment_number||p.id);
  try{if((allocated.get(p.id)||0)>journalCents(p.amount))issue('overallocated_payment',p.payment_number||p.id);}catch{issue('invalid_payment_amount',p.payment_number||p.id);}
 }
 const safe=!invalid&&Number.isSafeInteger(totalDebit)&&Number.isSafeInteger(totalCredit);
 return {checked_at:new Date().toISOString(),journal_count:journals.length,line_count:lines.length,issue_count:Object.values(counts).reduce((n,v)=>n+v,0),counts,issues,truncated:Object.values(counts).reduce((n,v)=>n+v,0)>issues.length,totals:safe?{debit:totalDebit/100,credit:totalCredit/100,difference:(totalDebit-totalCredit)/100}:null};
}
