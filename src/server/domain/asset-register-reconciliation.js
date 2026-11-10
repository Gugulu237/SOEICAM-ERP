import {readRecords} from './commercial-workspace.js';
import {assetAccountLedgerEvidence,assetCostSources} from './asset-account-link.js';
import {journalCents} from './journal-validation.js';
import {businessDate} from '../../lib/business-date.js';
import {assetSetupIncomplete} from '../../lib/asset-register-review.js';

const retired=a=>['disposed','written_off'].includes(a.status);
const sum=(items,field)=>{let total=0;for(const row of items){total+=journalCents(row[field]??0);if(!Number.isSafeInteger(total))throw Error('Registered asset values exceed the supported precision.');}return total/100;};
async function evidence(stores,ids){
 const targetLines=[],journals=[],lines=[];
 for(let i=0;i<ids.length;i+=100)targetLines.push(...await readRecords(stores.JournalLine,{account_id:{$in:ids.slice(i,i+100)}}));
 const journalIds=[...new Set(targetLines.map(row=>row.journal_id))];
 for(let i=0;i<journalIds.length;i+=100){const selected=journalIds.slice(i,i+100);journals.push(...await readRecords(stores.JournalEntry,{id:{$in:selected}}));lines.push(...await readRecords(stores.JournalLine,{journal_id:{$in:selected}}));}
 return {targetLines,journals,lines};
}

// A class-2 GL account is a balance to review, never a fabricated asset item.
// Gross cost and credit-normal accumulated depreciation stay separate.
export async function assetRegisterReconciliation(stores,{assets,accounts,treasuryAccounts,date=businessDate()}){
 const [rules,products]=await Promise.all([readRecords(stores.PostingRule,{is_active:true}),readRecords(stores.Product)]);
 const current=assets.filter(a=>!retired(a)),costIds=new Set(assets.map(a=>a.asset_account_id).filter(Boolean)),contraIds=new Set(assets.map(a=>a.accum_dep_account_id).filter(Boolean));
 const candidates=accounts.filter(a=>a.account_type==='asset'&&(String(a.account_number||'').startsWith('2')||costIds.has(a.id)||contraIds.has(a.id))&&a.is_posting!==false);
 const blocked=a=>a.is_control_account===true||a.is_treasury===true||treasuryAccounts.some(t=>t.gl_account_id===a.id)||rules.some(r=>r.account_id===a.id&&/receivable|payable|inventory|work_in_progress|wip|prepayment|cash|bank/.test(r.rule_key||''))||products.some(p=>p.inventory_account_id===a.id);
 const selected=candidates.filter(a=>!blocked(a)),prepared=await evidence(stores,selected.map(a=>a.id)),rows=[];
 for(const account of selected){
  const contra=account.normal_balance==='credit',linked=current.filter(a=>(contra?a.accum_dep_account_id:a.asset_account_id)===account.id),issues=[];let ledger=null,registered=null,sources=[];
  try{const result=await assetAccountLedgerEvidence(stores,account,accounts,prepared);ledger=result.balance;sources=assetCostSources(result,account.id);registered=sum(linked,contra?'accumulated_depreciation':'acquisition_cost');}
  catch(error){issues.push(error.message);}
  if(!['debit','credit'].includes(account.normal_balance))issues.push('Review this asset account normal balance before registration.');
  if(account.is_active!==true)issues.push('This account is inactive. Review it before registering existing cost.');
  if(account.currency&&account.currency!=='XAF'){issues.push('Choose an asset account denominated in XAF.');ledger=null;registered=null;sources=[];}
  if(ledger!==null&&registered!==null&&registered>ledger)issues.push('Registered asset values exceed the posted account balance. Review the account and register.');
  if(ledger!==null&&ledger===0&&(!linked.length||registered===0)&&!issues.length)continue;
  rows.push({account:{id:account.id,account_number:account.account_number,name:account.name,account_type:account.account_type,normal_balance:account.normal_balance,is_active:account.is_active},kind:contra?'accumulated_depreciation':'gross_cost',ledger_balance:ledger,stored_balance:(!account.currency||account.currency==='XAF')&&Number.isFinite(Number(account.balance))?Number(account.balance):null,registered_value:registered,unassigned_value:ledger!==null&&registered!==null?Math.round((ledger-registered)*100)/100:null,asset_count:linked.length,issues,can_review_registration:!contra&&issues.length===0&&ledger>registered,cost_sources:sources});
 }
 const totals=kind=>{const matched=rows.filter(row=>row.kind===kind);if(matched.some(row=>row.ledger_balance===null))return null;return Math.round(matched.reduce((n,row)=>n+row.ledger_balance,0)*100)/100;};
 const gross=totals('gross_cost'),contra=totals('accumulated_depreciation');
 return {date,rows,gross_ledger_cost:gross,accumulated_ledger_depreciation:contra,ledger_net_book_value:gross===null||contra===null?null:Math.round((gross-contra)*100)/100,awaiting_registration_cost:rows.some(r=>r.kind==='gross_cost'&&r.unassigned_value===null)?null:Math.round(rows.filter(r=>r.kind==='gross_cost'&&r.unassigned_value>0).reduce((n,r)=>n+r.unassigned_value,0)*100)/100,incomplete_assets:assets.filter(assetSetupIncomplete).map(a=>a.id)};
}
