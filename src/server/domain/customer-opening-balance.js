import {createHash} from 'node:crypto';
import {requireActiveContext,forbidden} from '../access.js';
import {assertModule} from './role-catalogue.js';
import {readRecords} from './commercial-workspace.js';
import {openingBalancesWorkspace} from './opening-balances.js';
import {postJournal} from './field-ops.js';
import {openingPartyLines,isOpeningRecord} from '../../lib/opening-records.js';
import {businessDate} from '../../lib/business-date.js';

const fail=(message,status=400)=>Object.assign(Error(message),{status});
const hash=value=>createHash('sha256').update(value).digest('hex');
const marker=id=>'COB-'+hash(id);
const cents=value=>{
  if(!['number','string'].includes(typeof value)||String(value).trim()==='')throw fail('Enter a valid opening amount.');
  const n=Number(value),c=Math.round(n*100);
  if(!Number.isFinite(n)||n<0||n>1e12||!Number.isSafeInteger(c)||Math.abs(c-n*100)>0.0001)throw fail('Use non-negative amounts with at most two decimal places.');
  return c;
};
const active=a=>a&&a.is_active!==false&&a.is_posting!==false&&(!a.currency||a.currency==='XAF');
function access(context){
  if(requireActiveContext(context)!=='admin')throw forbidden('Only administrators can enter opening balances.');
  assertModule({...context,role:'admin'},'accounting');
  assertModule({...context,role:'admin'},'customers');
}
function dateValue(value,future=false){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value+'T12:00:00Z').toISOString().slice(0,10)!==value||!future&&value>businessDate())throw fail(future?'Choose a valid payment due date.':'Choose a valid opening date no later than today.');
  return value;
}
async function state(stores,context,id){
  access(context);
  if(typeof id!=='string'||!id||id.length>100)throw fail('Choose an existing customer.');
  const customer=await stores.Customer.get(id);
  if(!customer)throw fail('Customer not found.',404);
  const [setup,invoices,journals,rules,event]=await Promise.all([
    openingBalancesWorkspace(stores,context),readRecords(stores.Invoice,{customer_id:id}),
    readRecords(stores.JournalEntry,{source_module:'opening_balances'}),
    readRecords(stores.PostingRule,{rule_key:'customer_receivable',is_active:true}),stores.AuditLog.get(marker(id)),
  ]);
  const lines=[];
  for(let i=0;i<journals.length;i+=100)lines.push(...await readRecords(stores.JournalLine,{journal_id:{$in:journals.slice(i,i+100).map(j=>j.id)}}));
  const debts=invoices.filter(isOpeningRecord),allocations=lines.flatMap(openingPartyLines).filter(l=>l.party_type==='customer'&&l.party_id===id);
  const recorded=!!event||!!customer.opening_balance_batch_id||debts.length>0||allocations.length>0;
  const account=rules.length===1?setup.accounts.find(a=>a.id===rules[0].account_id):null;
  let mode='post',reason='',available=null,target=null;
  if(customer.customer_removed_at||customer.is_active===false)reason='Choose an active customer for opening balance entry.';
  else if(!active(account)||account.account_type!=='asset'||account.normal_balance!=='debit'||account.treasury_names.length)reason='Configure an active customer receivable posting account in Accounting.';
  else if(account.opening_recorded&&!lines.some(l=>l.account_id===account.id))reason='The recorded receivable opening balance is fully allocated. Review corrections in Accounting.';
  else {
    const accountLines=lines.filter(l=>l.account_id===account.id),byJournal=new Map(journals.map(j=>[j.id,j]));
    if(accountLines.some(l=>byJournal.get(l.journal_id)?.status!=='posted'))reason='Reconcile the receivable opening journal in Accounting before continuing.';
    else if(accountLines.some(l=>!byJournal.get(l.journal_id)?.opening_customer_entry)){
      // A pre-existing GL opening is a ceiling, not a new debt to post again.
      const candidates=[];
      for(const line of accountLines){
        const total=cents(line.debit||0),credit=cents(line.credit||0);
        const assigned=line.party_id?total:(line.opening_party_allocations||[]).reduce((n,a)=>n+cents(a.debit||0)-cents(a.credit||0),0);
        if(credit||assigned<0||assigned>total){reason='Reconcile the receivable opening journal in Accounting before continuing.';break;}
        if(total>assigned)candidates.push({line,remaining:total-assigned});
      }
      if(!reason){
        if(candidates.length!==1)reason=candidates.length?'Reconcile the receivable opening journal in Accounting before continuing.':'The recorded receivable opening balance is fully allocated. Review corrections in Accounting.';
        else {mode='attach';target=candidates[0].line;available=candidates[0].remaining/100;}
      }
    }
  }
  const entries=debts.map(d=>({id:d.id,reference:d.opening_document_reference||d.invoice_number,date:d.opening_date,amount:d.total,balance:d.balance}));
  return {customer,setup,invoices,journals,lines,account,event,target,mode,available,reason,recorded,entries};
}
function publicState(s){
  return {customer_id:s.customer.id,recorded:s.recorded,entries:s.entries,
    amount:s.event?.opening_customer_amount??(s.entries.length?s.entries.reduce((n,d)=>n+Number(d.amount),0):s.customer.opening_balance_amount??null),
    date:s.event?.opening_customer_date||s.customer.opening_balance_date||s.setup.date,
    date_locked:s.setup.date_locked,max_date:s.setup.first_transaction_date||businessDate(),
    mode:s.mode,account_id:s.account?.id||'',available:s.available,
    can_enter:!s.recorded&&!s.reason,reason:s.reason,
    offsets:s.setup.accounts.filter(a=>active(a)&&a.account_type==='equity'&&a.normal_balance==='credit'&&!a.is_control_account&&!a.treasury_names.length).map(a=>({id:a.id,name:a.name,number:a.account_number})),
  };
}
export async function customerOpeningWorkspace(stores,context,id){return publicState(await state(stores,context,id));}

async function reconcileCaches(stores,customerId,accountIds){
  const [journals,lines,accounts,treasury]=await Promise.all([readRecords(stores.JournalEntry,{status:{$in:['posted','reversed']}}),readRecords(stores.JournalLine),readRecords(stores.Account),readRecords(stores.TreasuryAccount)]);
  const posted=new Set(journals.map(j=>j.id)),accountMap=new Map(accounts.map(a=>[a.id,a]));
  const valid=lines.filter(l=>posted.has(l.journal_id));
  const net=l=>{const d=cents(l.debit||0),c=cents(l.credit||0);if(d&&c||l.status&&!['posted','reversed'].includes(l.status))throw fail('Reconcile inconsistent posted ledger lines before importing opening balances.');return d-c;};
  const sum=rows=>{const total=rows.reduce((n,l)=>n+net(l),0);if(!Number.isSafeInteger(total))throw fail('Ledger balances exceed the supported precision.');return total/100;};
  for(const id of accountIds){const a=accountMap.get(id),balance=sum(valid.filter(l=>l.account_id===id));await stores.Account.update(id,{balance:a.normal_balance==='credit'?-balance:balance});}
  // Cash-sale clearing and cash/bank lines are not customer credit balances.
  const cash=new Set(treasury.map(t=>t.gl_account_id));
  const customerLines=valid.flatMap(openingPartyLines).filter(l=>{const a=accountMap.get(l.account_id);return l.party_type==='customer'&&l.party_id===customerId&&a?.account_type==='asset'&&a.normal_balance==='debit'&&a.account_number!=='1050'&&!cash.has(a.id);});
  await stores.Customer.update(customerId,{balance:sum(customerLines)});
}

// Called under the same serializable transaction and advisory lock as all
// opening imports. The customer-specific audit ID survives payment/removal.
export async function saveCustomerOpening(stores,context,id,body){
  access(context);
  if(!body||!/^[\w-]{16,80}$/.test(body.requestKey||''))throw fail('Reopen opening balances for a valid save reference.');
  if(body.confirmed!==true)throw fail('Confirm this customer opening balance before posting.');
  const amount=cents(body.amount);if(!amount)throw fail('Enter a positive outstanding customer balance.');
  const date=dateValue(body.date),reference=typeof body.reference==='string'?body.reference.trim():'';
  const due=dateValue(body.due_date||date,true);
  if(!reference||reference.length>100)throw fail('Enter the original customer balance reference.');
  const payload=JSON.stringify({id,date,due_date:due,reference,amount,mode:body.mode,account_id:body.account_id,offset_account_id:body.offset_account_id||''});
  const s=await state(stores,context,id),key=context.user.id+':'+body.requestKey;
  if(s.event){
    if(s.event.opening_request_key===key&&s.event.opening_import_hash===hash(payload))return {...s.event.opening_position_result,reused:true};
    throw fail('An opening balance is already recorded for this customer.',409);
  }
  if(s.recorded)throw fail('An opening balance is already recorded for this customer.',409);
  if(s.reason)throw fail(s.reason,409);
  if(body.mode!==s.mode||body.account_id!==s.account.id)throw fail('Opening balance setup changed. Reload before posting.',409);
  if(s.setup.date_locked&&date!==s.setup.date)throw fail('Use the same opening date as the existing migration balances.');
  if(s.setup.first_transaction_date&&date>s.setup.first_transaction_date)throw fail('Opening balances must be dated on or before the first recorded transaction.');
  if(s.invoices.some(d=>[d.invoice_number,d.opening_document_reference].some(v=>String(v||'').trim().toUpperCase()===reference.toUpperCase())))throw fail('This original customer balance reference is already recorded.');
  const batchId=marker(id),allocation={party_type:'customer',party_id:id,debit:amount/100,credit:0};
  let journal,offset;
  if(s.mode==='attach'){
    if(body.offset_account_id)throw fail('Link this balance without a new opening counterpart.');
    if(amount>cents(s.available))throw fail('The customer balance exceeds the unallocated ledger opening amount.',409);
    journal=s.journals.find(j=>j.id===s.target.journal_id);
    const allocations=[...(s.target.opening_party_allocations||[]),allocation];
    await stores.JournalLine.update(s.target.id,{opening_party_allocations:allocations});
    if(amount===cents(s.available))await stores.JournalEntry.update(journal.id,{opening_detail_account_ids:[...new Set([...(journal.opening_detail_account_ids||[]),s.account.id])]});
  }else{
    offset=s.setup.accounts.find(a=>a.id===body.offset_account_id);
    if(!active(offset)||offset.account_type!=='equity'||offset.normal_balance!=='credit'||offset.is_control_account||offset.treasury_names.length)throw fail('Choose a posting equity account for the opening counterpart.');
    ({journal}=await postJournal({entities:stores},{entryDate:date,description:'Customer opening balance: '+reference,sourceModule:'opening_balances',sourceDocumentType:'OpeningBalances',sourceDocumentId:batchId,userId:context.user.id,lines:[{account_id:s.account.id,...allocation},{account_id:offset.id,debit:0,credit:amount/100}]}));
    await stores.JournalEntry.update(journal.id,{opening_customer_entry:true,opening_reference:reference,opening_detail_account_ids:[s.account.id],opening_import_hash:hash(payload)});
  }
  const invoice=await stores.Invoice.create({invoice_number:reference,customer_id:id,customer_name:s.customer.business_name||s.customer.name,invoice_date:date,due_date:due,payment_type:'credit',status:'posted',subtotal:amount/100,total:amount/100,tax_total:0,amount_paid:0,balance:amount/100,
    opening_batch_id:batchId,accounting_source:'opening_balances',opening_date:date,opening_imported_by:context.user.id,opening_account_id:s.account.id,opening_document_reference:reference,journal_id:journal.id,notes:'Customer balance brought forward from the previous system.'});
  await reconcileCaches(stores,id,[s.account.id,...(offset?[offset.id]:[])]);
  await stores.Customer.update(id,{opening_balance_batch_id:batchId,opening_balance_amount:amount/100,opening_balance_date:date,opening_balance_recorded_at:new Date().toISOString(),opening_balance_recorded_by:context.user.id});
  const answer={receivables:[invoice.id],journal:{id:journal.id,journal_number:journal.journal_number},linked_only:s.mode==='attach',amount:amount/100,date};
  await stores.AuditLog.create({id:batchId,action:'import_customer_opening_balance',module:'accounting',entity_type:'Customer',entity_id:id,user_id:context.user.id,description:'Recorded customer opening balance '+reference,
    opening_request_key:key,opening_import_hash:hash(payload),opening_customer_id:id,opening_customer_amount:amount/100,opening_customer_date:date,opening_position_result:answer});
  return {...answer,reused:false};
}
