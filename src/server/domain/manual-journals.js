import {manualCashPlan} from './manual-cash-plan.js';
import { requireAccountant } from './account-definitions.js';
import { round2, nextSequence, audit } from './field-ops.js';

// reversingManual is server-only: journalLifecycle supplies an exact, verified mirror.
export async function saveManualJournal(stores, context, body, {reversingManual=false,reversalPlan=null}={}) {
  requireAccountant(context);
  let draft = null;
  if(body?.journalId){
    draft=await stores.JournalEntry.get(String(body.journalId));
    if(!draft||draft.source_module!=='manual'||draft.source_document_type!=='manual_journal')throw Error('Choose a manual draft journal.');
    if(draft.status==='posted')return draft;
    if(draft.status!=='draft')throw Error('Only draft journals can be posted.');
    body={requestKey:'draft-'+draft.id,status:'posted',entryDate:draft.entry_date,description:draft.description,lines:await stores.JournalLine.filter({journal_id:draft.id})};
  }
  if (!/^[\w-]{16,80}$/.test(body?.requestKey || '')) throw Error('A valid journal save reference is required.');
  const status = body.status;
  if (!['draft','posted'].includes(status)) throw Error('Choose draft or posted journal status.');
  const entryDate=String(body.entryDate||''),description=String(body.description||'').trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(entryDate)||!Number.isFinite(Date.parse(entryDate))||new Date(entryDate+'T12:00:00Z').toISOString().slice(0,10)!==entryDate)throw Error('Select a valid journal date.');
  if(!description||description.length>1000)throw Error('Enter a journal description (up to 1000 characters).');
  if(!Array.isArray(body.lines)||body.lines.length>200)throw Error('A journal may contain up to 200 lines.');
  const raw=body.lines.filter(l=>l.account_id||Number(l.debit)||Number(l.credit));
  const fingerprint=JSON.stringify({entryDate,description,status,lines:raw.map(l=>({account_id:l.account_id,debit:Number(l.debit||0),credit:Number(l.credit||0),description:String(l.description||'')}))});
  const previous=(await stores.JournalEntry.filter({manual_request_key:body.requestKey},'id',1))[0];
  if(previous){if(previous.manual_request_payload!==fingerprint)throw Object.assign(Error('This save reference belongs to different journal details. Reload before creating another journal.'),{status:409});return previous;}
  if(raw.length<1||(status==='posted'&&raw.length<2))throw Error('A posted journal requires at least two lines.');
  const periods=await stores.AccountingPeriod.filter({}),matches=periods.filter(p=>p.start_date<=entryDate&&entryDate<=p.end_date),period=matches.find(p=>['closed','locked'].includes(p.status))||matches.sort((a,b)=>String(b.start_date).localeCompare(String(a.start_date)))[0];
  if(['closed','locked'].includes(period?.status))throw Error('The accounting period is closed or locked.');
  let totalDebit=0,totalCredit=0,totalDebitCents=0,totalCreditCents=0;const lines=[],accounts=new Map();
  for(const l of raw){
    const d=Number(l.debit||0),c=Number(l.credit||0);
    if(!l.account_id||![d,c].every(n=>Number.isFinite(n)&&n>=0&&n<=1e12)||d>0&&c>0)throw Error('Choose an account and enter a valid debit or credit on each line.');
    if([d,c].some(n=>Math.abs(n*100-Math.round(n*100))>0.0001))throw Error("Journal amounts must have at most two decimal places.");
    const debit=round2(d),credit=round2(c);
    if(status==='posted'&&debit===0&&credit===0)throw Error('A posted journal cannot contain a zero-value line.');
    const account=accounts.get(l.account_id)||await stores.Account.get(String(l.account_id));
    if(!account||account.is_active===false||account.is_posting===false||account.allow_manual_journal===false&&!reversingManual)throw Error('Choose active posting accounts that allow manual journals.');
    accounts.set(account.id,account);
    if(String(l.description||'').length>1000)throw Error('A journal line description is too long.');
    lines.push({account_id:account.id,account_number:account.account_number,account_name:account.name,description:String(l.description||'')||description,debit,credit});
    totalDebitCents+=Math.round(debit*100);totalCreditCents+=Math.round(credit*100);
    if(!Number.isSafeInteger(totalDebitCents)||!Number.isSafeInteger(totalCreditCents))throw Error("Journal totals exceed the supported precision.");
    totalDebit=totalDebitCents/100;totalCredit=totalCreditCents/100;
  }
  if(status==='posted'&&totalDebit!==totalCredit)throw Error('Journal debits and credits must balance before posting.');
  const checkedPlan=reversingManual?reversalPlan:null;
  if(checkedPlan&&(status!=='posted'||checkedPlan.accounts.length!==accounts.size||checkedPlan.accounts.some(a=>!accounts.has(a.id))))throw Error('Invalid manual reversal plan.');
  const cashPlan=checkedPlan?checkedPlan.treasury.map(t=>({id:t.id,balance:t.balance_after})):status==='posted'?await manualCashPlan(stores,context,lines,accounts,{reversingManual}):[];
  const client={entities:stores},journal_number=draft?.journal_number||await nextSequence(client,'next_journal_number','JV',6);
  const journalData={journal_number,entry_date:entryDate,description,source_module:'manual',source_document_type:'manual_journal',source_document_id:'MAN-'+body.requestKey,period_id:period?.id||'',status,is_immutable:status==='posted',total_debit:totalDebit,total_credit:totalCredit,posted_by:status==='posted'?context.user.id:'',posted_at:status==='posted'?new Date().toISOString():'',manual_request_key:body.requestKey,manual_request_payload:fingerprint,created_by:context.user.email};
  const journal=draft?await stores.JournalEntry.update(draft.id,journalData):await stores.JournalEntry.create(journalData);
  if(draft){for(const l of await stores.JournalLine.filter({journal_id:draft.id}))await stores.JournalLine.update(l.id,{status:"posted"});}
  else await stores.JournalLine.bulkCreate(lines.map(l=>({...l,journal_id:journal.id,status})));
  if(status==='posted'){
    if(checkedPlan){for(const row of checkedPlan.accounts)accounts.get(row.id).balance=row.balance_after;}
    else for(const l of lines){const a=accounts.get(l.account_id);a.balance=round2(Number(a.balance||0)+(a.normal_balance==='debit'?l.debit-l.credit:l.credit-l.debit));}
    for(const a of accounts.values())await stores.Account.update(a.id,{balance:a.balance});
  }
  for(const change of cashPlan)await stores.TreasuryAccount.update(change.id,{balance:change.balance});
  await audit(client,{action:status==='posted'?'post_journal':'create_draft_journal',module:'accounting',entityType:'JournalEntry',entityId:journal.id,userId:context.user.id,description:`${status==='posted'?'Posted':'Saved draft'} ${journal_number}: ${description}`});
  return journal;
}
