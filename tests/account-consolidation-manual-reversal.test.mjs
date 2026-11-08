import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,date} from './helpers/cashier.mjs';
import {saveManualJournal} from '../src/server/domain/manual-journals.js';
import {journalLifecycle} from '../src/server/domain/journal-lifecycle.js';
import {previewAccountConsolidation,postAccountConsolidation} from '../src/server/domain/account-consolidation.js';

const context={user:{id:'gm',role:'admin',email:'gm@example.test'},role:'admin'};
async function consolidatedManualJournal(){
 const f=await fixture(),s=f.entities;s.FixedAsset={filter:async()=>[]};
 const create=s.AuditLog.create;s.AuditLog.create=async value=>{
  if(!value.id)return create({...value,audit_source:'server_verified'});
  const row=structuredClone({...value,audit_source:'server_verified'});f.rows.AuditLog.push(row);return structuredClone(row);
 };
 const base={account_type:'cogs',normal_balance:'debit',currency:'XAF',balance:0,is_active:true,is_posting:true};
 const source=await s.Account.create({...base,account_number:'7000',name:'Direct Material COGS'});
 const target=await s.Account.create({...base,account_number:'5100',name:'Direct Material Cost of Goods Sold',is_system:true});
 const offset=await s.Account.create({account_number:'offset',name:'Test offset',account_type:'asset',normal_balance:'debit',balance:0,is_active:true,is_posting:true});
 const original=await saveManualJournal(s,context,{requestKey:crypto.randomUUID(),entryDate:date,status:'posted',description:'Original signed material cost',lines:[{account_id:source.id,debit:30,credit:0},{account_id:target.id,debit:20,credit:0},{account_id:offset.id,debit:0,credit:50}]});
 await saveManualJournal(s,context,{requestKey:crypto.randomUUID(),entryDate:date,status:'posted',description:'Other current material costs',lines:[{account_id:target.id,debit:100,credit:0},{account_id:offset.id,debit:0,credit:100}]});
 const body={sourceAccountId:source.id,targetAccountId:target.id,date,reference:'Consolidate duplicate COGS'};
 const preview=await previewAccountConsolidation(s,context,body);
 await postAccountConsolidation(s,context,{...body,token:preview.token,requestKey:crypto.randomUUID(),confirmed:true});
 return {...f,s,source,target,offset,original};
}
const reverse=(f,preview)=>({action:'reverse',journalId:f.original.id,reason:'Correct original material cost',reversalDate:date,treasuryReview:{snapshot:preview.snapshot,confirmed:true,verifiedBalances:[]}});

test('a historical manual journal reverses into canonical COGS after consolidation without reopening the retired ledger',async()=>{
 const f=await consolidatedManualJournal(),original=await f.s.JournalEntry.get(f.original.id),originalLines=await f.s.JournalLine.filter({journal_id:f.original.id});
 const preview=await journalLifecycle(f.s,context,{action:'previewReversal',journalId:f.original.id});
 assert.equal(preview.requires_review,false);assert.equal(preview.accounts.some(row=>row.id===f.source.id),false);
 const cost=preview.accounts.find(row=>row.id===f.target.id);assert.equal(cost.ledger_balance,150);assert.equal(cost.reversal_delta,-50);assert.equal(cost.balance_after,100);
 const body=reverse(f,preview),mirror=await journalLifecycle(f.s,context,body),mirrorLines=await f.s.JournalLine.filter({journal_id:mirror.id});
 assert.equal(mirrorLines.some(row=>row.account_id===f.source.id),false);assert.equal(mirrorLines.filter(row=>row.account_id===f.target.id).reduce((sum,row)=>sum+row.credit-row.debit,0),50);
 assert.equal((await f.s.Account.get(f.source.id)).balance,0);assert.equal((await f.s.Account.get(f.source.id)).is_active,false);assert.equal((await f.s.Account.get(f.target.id)).balance,100);
 assert.deepEqual(await f.s.JournalLine.filter({journal_id:f.original.id}),originalLines);
 const after=await f.s.JournalEntry.get(f.original.id);assert.equal(after.manual_request_payload,original.manual_request_payload);assert.equal(after.status,'posted');assert.equal(after.reversed_by_journal,mirror.id);
 const count=(await f.s.JournalEntry.list()).length;assert.equal((await journalLifecycle(f.s,context,body)).id,mirror.id);assert.equal((await f.s.JournalEntry.list()).length,count);
});

test('manual reversal reviews bind the original alias and canonical account metadata',async()=>{
 for(const account of ['source','target']){
  const f=await consolidatedManualJournal(),preview=await journalLifecycle(f.s,context,{action:'previewReversal',journalId:f.original.id});
  await f.s.Account.update(f[account].id,{name:'Changed account metadata'});const before=structuredClone(f.rows);
  await assert.rejects(journalLifecycle(f.s,context,reverse(f,preview)),/Balances changed after the preview/);assert.deepEqual(f.rows,before);
 }
});

test('manual reversal planning rejects invalid COGS aliases instead of hiding their accounting effect',async()=>{
 for(const change of [{consolidated_into_account_id:'missing'},{consolidated_into_account_id:'self'},{account_type:'expense'}]){
  const f=await consolidatedManualJournal();
  if(change.account_type)await f.s.Account.update(f.target.id,change);else await f.s.Account.update(f.source.id,{...change,...(change.consolidated_into_account_id==='self'?{consolidated_into_account_id:f.source.id}:{})});
  const before=structuredClone(f.rows);await assert.rejects(journalLifecycle(f.s,context,{action:'previewReversal',journalId:f.original.id}),/Consolidat|consolidat/);assert.deepEqual(f.rows,before);
 }
});
