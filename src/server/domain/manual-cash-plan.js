import {readRecords} from './commercial-workspace.js';
import {journalCents,ledgerStatuses} from './journal-validation.js';
import {assertTreasuryAccess} from '../../lib/treasury-access.js';
export async function manualCashPlan(stores,context,lines,accounts,{reversingManual=false}={}){
 const rules=await readRecords(stores.PostingRule,{is_active:true});
 const controls=new Set(rules.filter(r=>/receivable|payable|inventory|work_in_progress/.test(r.rule_key||'')).map(r=>r.account_id));
 for(const id of accounts.keys())if(!reversingManual&&(accounts.get(id).is_control_account||controls.has(id)))throw Error('Use the source customer, supplier, inventory or opening-balance workflow for control accounts.');
 const treasury=await readRecords(stores.TreasuryAccount),linked=treasury.filter(t=>accounts.has(t.gl_account_id));
 if(!linked.length)return [];
 const journals=await readRecords(stores.JournalEntry,{status:{$in:ledgerStatuses}}),ids=new Set(journals.map(j=>j.id)),plans=[];
 for(const t of linked){
  assertTreasuryAccess(context.role,t);
  if(treasury.filter(a=>a.gl_account_id===t.gl_account_id).length!==1||t.is_active===false||t.currency&&t.currency!=='XAF')throw Error('Reconcile the treasury account mapping before posting a manual cash entry.');
  const account=accounts.get(t.gl_account_id);if(account.account_type!=='asset'||account.normal_balance!=='debit')throw Error('Treasury requires a debit-normal asset account.');
  const rows=await readRecords(stores.JournalLine,{account_id:t.gl_account_id});let cents=0;
  for(const l of rows.filter(l=>ids.has(l.journal_id)))cents+=journalCents(l.debit||0)-journalCents(l.credit||0);
  if(!Number.isSafeInteger(cents)||Math.abs(Number(t.balance||0)*100-cents)>0.001)throw Error('Reconcile treasury with its posted GL or enter its checked opening balance before a manual cash entry.');
  const delta=lines.filter(l=>l.account_id===t.gl_account_id).reduce((n,l)=>n+journalCents(l.debit)-journalCents(l.credit),0),after=cents+delta;
  if(!Number.isSafeInteger(after)||t.account_type!=='bank'&&after<0)throw Error('A manual journal cannot create a negative cash balance.');
  plans.push({id:t.id,balance:after/100});
 }
 return plans;
}
