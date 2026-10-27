import {createHash} from 'node:crypto';
import {readRecords} from './commercial-workspace.js';
import {journalCents,checkedJournalLines,ledgerStatuses} from './journal-validation.js';
import {assertTreasuryAccess} from '../../lib/treasury-access.js';
const amount=cents=>cents/100||0;
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const conflict=message=>Object.assign(Error(message),{status:409});
function signedCents(value){
 if(!['number','string'].includes(typeof value)||typeof value==='string'&&!value.trim())throw Error('A stored balance is invalid. Review the account before reversal.');
 const n=Number(value),c=Math.round(n*100);
 if(!Number.isFinite(n)||!Number.isSafeInteger(c)||Math.abs(n*100-c)>0.0001)throw Error('A stored balance is invalid. Review the account before reversal.');
 return c;
}
const sorted=rows=>rows.sort((a,b)=>String(a.id).localeCompare(String(b.id)));
export function normalizedReversalReview(input){
 if(input==null)return null;
 if(typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['snapshot','confirmed','verifiedBalances'].includes(k))||!/^[a-f0-9]{64}$/.test(input.snapshot||'')||input.confirmed!==true||!Array.isArray(input.verifiedBalances)||input.verifiedBalances.length>200)throw Error('Review and confirm the displayed treasury balances before reversal.');
 const seen=new Set(),verifiedBalances=input.verifiedBalances.map(row=>{
  if(!row||typeof row.treasuryId!=='string'||!row.treasuryId||seen.has(row.treasuryId)||Object.keys(row).some(k=>!['treasuryId','balance'].includes(k)))throw Error('Confirm each displayed treasury balance once.');
  seen.add(row.treasuryId);return {treasuryId:row.treasuryId,balance:amount(signedCents(row.balance))};
 }).sort((a,b)=>a.treasuryId.localeCompare(b.treasuryId));
 return {snapshot:input.snapshot,confirmed:true,verifiedBalances};
}
export const reversalReviewHash=review=>review?hash(review):'';

// Read-only, bounded to the accounts touched by this exact journal.
// No cash transaction, opening balance or reconciliation is created here.
export async function manualReversalPlan(stores,context,journal,original){
 const checked=checkedJournalLines(original),ids=[...new Set(checked.lines.map(l=>l.account_id))].sort(),accounts=[];
 for(const id of ids){
  const a=await stores.Account.get(id);
  if(!a||a.is_active===false||a.is_posting===false||!['debit','credit'].includes(a.normal_balance)||a.currency&&a.currency!=='XAF')throw Error('Review the active posting accounts and currency before reversal.');
  accounts.push(a);
 }
 if(journalCents(journal.total_debit)!==journalCents(checked.debit)||journalCents(journal.total_credit)!==journalCents(checked.credit))throw Error('Reconcile the original journal totals and lines before reversal.');
 const rows=[];
 for(let i=0;i<ids.length;i+=100)rows.push(...await readRecords(stores.JournalLine,{account_id:{$in:ids.slice(i,i+100)}}));
 const journalIds=[...new Set(rows.map(l=>l.journal_id))].filter(Boolean),headers=[];
 for(let i=0;i<journalIds.length;i+=100)headers.push(...await readRecords(stores.JournalEntry,{id:{$in:journalIds.slice(i,i+100)},status:{$in:ledgerStatuses}}));
 const posted=new Set(headers.map(h=>h.id)),totals=new Map(ids.map(id=>[id,0]));
 for(const line of rows){
  if(!posted.has(line.journal_id))continue;
  const d=journalCents(line.debit??0),c=journalCents(line.credit??0);
  if(d&&c||line.status&&!ledgerStatuses.includes(line.status))throw Error('Reconcile inconsistent posted ledger lines before reversal.');
  const next=totals.get(line.account_id)+d-c;if(!Number.isSafeInteger(next))throw Error('Ledger balances exceed the supported precision.');totals.set(line.account_id,next);
 }
 const accountRows=accounts.map(a=>{
  const ledger=totals.get(a.id),delta=checked.lines.filter(l=>l.account_id===a.id).reduce((n,l)=>n+journalCents(l.credit)-journalCents(l.debit),0),normal=a.normal_balance==='credit'?-1:1,after=ledger+delta,stored=signedCents(a.balance??0);
  if(!Number.isSafeInteger(after))throw Error('Ledger balances exceed the supported precision.');
  return {id:a.id,name:a.name||a.id,account_number:a.account_number||'',stored_balance:amount(stored),ledger_balance:amount(ledger*normal),balance_after:amount(after*normal),net_after:amount(after),reversal_delta:amount(delta),mismatch:stored!==ledger*normal};
 });
 const treasury=await readRecords(stores.TreasuryAccount,{gl_account_id:{$in:ids}}),treasuryRows=[],blocked=[];
 for(const t of sorted(treasury)){
  assertTreasuryAccess(context.role,t);
  const a=accounts.find(a=>a.id===t.gl_account_id),row=accountRows.find(r=>r.id===t.gl_account_id);
  if(treasury.filter(other=>other.gl_account_id===t.gl_account_id).length!==1||t.is_active===false||t.currency&&t.currency!=='XAF'||a.account_type!=='asset'||a.normal_balance!=='debit')throw Error('Reconcile the treasury account mapping before posting a manual cash entry.');
  const stored=signedCents(t.balance??0),ledger=signedCents(row.ledger_balance),after=signedCents(row.net_after);
  treasuryRows.push({id:t.id,name:t.name||t.id,account_id:a.id,account_number:a.account_number||'',account_type:t.account_type,stored_balance:amount(stored),ledger_balance:amount(ledger),balance_after:amount(after),mismatch:stored!==ledger,retains_treasury_balance:stored===after&&stored!==ledger});
  if(t.account_type!=='bank'&&after<0)blocked.push('A manual journal cannot create a negative cash balance.');
 }
 const requires_review=accountRows.some(a=>a.mismatch)||treasuryRows.some(t=>t.mismatch);
 const snapshot=hash({journal,original,accounts,treasury:sorted(treasury),ledger:sorted(rows),headers:sorted(headers)});
 return {snapshot,requires_review,accounts:accountRows,treasury:treasuryRows,blocked:[...new Set(blocked)]};
}
export function verifyReversalReview(plan,review){
 if(plan.blocked.length)throw Error(plan.blocked[0]);
 if(!review){if(plan.requires_review)throw conflict('Review the treasury and ledger differences before confirming this reversal.');return;}
 if(review.snapshot!==plan.snapshot)throw conflict('Balances changed after the preview. Refresh the review and verify them again.');
 const amounts=new Map(review.verifiedBalances.map(r=>[r.treasuryId,signedCents(r.balance)]));
 if(amounts.size!==plan.treasury.length||plan.treasury.some(t=>amounts.get(t.id)!==signedCents(t.balance_after)))throw Error('The verified cash or bank balance must match the displayed balance after reversal. Record any missing opening balance or transaction first.');
}
