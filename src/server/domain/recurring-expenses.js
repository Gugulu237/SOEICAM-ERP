import {createHash} from 'node:crypto';
import {requireActiveContext,forbidden} from '../access.js';
import {assertModule} from './role-catalogue.js';
import {readRecords} from './commercial-workspace.js';
import {postJournal,audit} from './field-ops.js';
import {journalCents,journalDate} from './journal-validation.js';
import {businessDate} from '../../lib/business-date.js';
import {monthIndex,shiftMonth} from '../../lib/asset-schedule.js';
import {recurringExpenseAccount,recurringVersion,recurringMonths,recurringDueDate} from '../../lib/recurring-expense-schedule.js';
import {recurringBillId,verifiedRecurringBill} from './recurring-bill-evidence.js';
import {requestOpeningBillPayment,releaseOpeningBillPayment} from './opening-payments.js';
import {canUseTreasury} from '../../lib/treasury-access.js';
import {canReadManagementAccounting} from '../../lib/management-access.js';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const cents=(value,label)=>{
  if(!['number','string'].includes(typeof value)||String(value).trim()==='')throw Error('Enter '+label+'.');
  const n=Number(value),c=Math.round(n*100);
  if(!Number.isFinite(n)||n<=0||n>1e12||!Number.isSafeInteger(c)||Math.abs(n*100-c)>0.0001)throw Error('Enter a positive '+label+' with at most two decimal places.');
  return c;
};
const active=a=>a&&a.is_active!==false&&a.is_posting!==false&&(!a.currency||a.currency==='XAF');
function pendingTotal(rows){let total=0;for(const row of rows.filter(r=>r.status==='pending')){total+=journalCents(row.amount);if(!Number.isSafeInteger(total))throw Error('Use a narrower recurring expense reporting period.');}return total/100;}
function access(context,write=false,reportOnly=false){
  const role=requireActiveContext(context);assertModule({...context,role},'accounting');
  if((!['admin','cashier'].includes(role)&&!(reportOnly&&canReadManagementAccounting(role,context.employee)))||write&&role!=='admin')throw forbidden('Only administrators can authorize recurring expenses.');
  return role;
}
async function payableAccount(stores,id){
  const account=await stores.Account.get(id);
  if(!active(account)||account.account_type!=='liability'||account.normal_balance!=='credit'||account.is_treasury)throw Error('Choose an active supplier payable account.');
  return account;
}
export async function prepareRecurringExpense(stores,context,input,account,existing=null,today=businessDate()){
  access(context,true);
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['enabled','amount','supplier_id','effective_month','due_day'].includes(k))||typeof input.enabled!=='boolean')throw Error('Enter valid monthly recurring expense settings.');
  if(!recurringExpenseAccount(account))throw Error('Monthly recurrence requires a debit-normal posting expense account.');
  if(!existing&&!input.enabled)return null;
  const month=String(input.effective_month||'');monthIndex(month);
  const minimum=existing?shiftMonth(today.slice(0,7),1):today.slice(0,7);
  if(month<minimum||month>shiftMonth(today.slice(0,7),120))throw Error(existing?'Rate changes and pauses apply from next month or later.':'Start recurring expenses this month or later; older debts belong in opening balances.');
  if(existing?.versions?.length>=240)throw Error('Review the long-running recurring schedule before adding more changes.');
  const latest=existing?.versions?.at(-1);
  if(latest&&month<latest.effective_month)throw Error('Change the latest scheduled month or a later month.');
  const amount=input.enabled?cents(input.amount,'monthly amount')/100:latest.amount;
  const supplierId=input.enabled?String(input.supplier_id||''):latest.supplier_id;
  const supplier=await stores.Supplier.get(supplierId);
  if(input.enabled&&(!supplier||supplier.is_active===false||supplier.supplier_removed_at))throw Error('Choose an active supplier or landlord.');
  const dueDay=input.enabled?Number(input.due_day):latest.due_day;
  if(!Number.isInteger(dueDay)||dueDay<1||dueDay>31)throw Error('Choose a monthly due day from 1 to 31.');
  let payableId=latest?.payable_account_id;
  if(!payableId){const rules=await readRecords(stores.PostingRule,{rule_key:'supplier_payable',is_active:true});if(rules.length!==1)throw Error('Configure one supplier payable posting rule in Accounting.');payableId=rules[0].account_id;}
  await payableAccount(stores,payableId);
  const version={enabled:input.enabled,amount,supplier_id:supplierId,supplier_name:supplier?.name||latest.supplier_name,due_day:dueDay,effective_month:month,effective_date:month===today.slice(0,7)?today:month+'-01',payable_account_id:payableId,authorized_by:context.user.id,authorized_at:new Date().toISOString()};
  return {version:1,revision:Number(existing?.revision||0)+1,versions:[...(existing?.versions||[]).filter(v=>v.effective_month!==month),version]};
}
function occurrence(account,month){
  const version=recurringVersion(account.recurring_expense,month);
  if(!version?.enabled)return null;
  const billDate=version.effective_date>month+'-01'?version.effective_date:month+'-01';
  const row={id:recurringBillId(account.id,month),account_id:account.id,account_name:account.name,account_number:account.account_number,period:month,bill_date:billDate,due_date:recurringDueDate(month,version.due_day),amount:version.amount,supplier_id:version.supplier_id,supplier_name:version.supplier_name,payable_account_id:version.payable_account_id};
  return {...row,token:hash({...row,version})};
}
export async function recurringExpenseWorkspace(stores,context,{from,to,reportOnly=false,today=businessDate()}={}){
  const role=access(context,false,reportOnly),[accounts,bills,suppliers,treasury,payments]=await Promise.all([
    readRecords(stores.Account),readRecords(stores.Bill,{accounting_source:'recurring_expense'}),reportOnly?[]:readRecords(stores.Supplier),reportOnly?[]:readRecords(stores.TreasuryAccount),reportOnly?[]:readRecords(stores.Payment,{recurring_bill_payment:true,status:{$in:['pending_approval','approved','confirmed']}})
  ]);
  if(from)journalDate(from);if(to)journalDate(to);if(from&&to&&from>to)throw Error('Choose a valid reporting period.');
  const byBill=new Map(bills.map(b=>[b.id,b])),rows=[];
  for(const account of accounts.filter(a=>a.recurring_expense))for(const month of recurringMonths(account.recurring_expense,today.slice(0,7))){
    const row=occurrence(account,month);if(!row)continue;
    if(from&&row.bill_date<from||to&&row.bill_date>to)continue;
    const bill=byBill.get(row.id);
    rows.push({...row,status:bill?.status||'pending',balance:bill?Number(bill.balance):row.amount,bill_id:bill?.id||'',pending_payment:payments.some(p=>p.bill_id===bill?.id),blocked:!active(account)||!recurringExpenseAccount(account)});
    if(rows.length>10000)throw Error('Use a narrower recurring expense reporting period.');
  }
  rows.sort((a,b)=>a.period.localeCompare(b.period)||a.account_name.localeCompare(b.account_name));
  if(reportOnly)return {pending_total:pendingTotal(rows),pending_count:rows.filter(r=>r.status==='pending').length,can_review:['admin','cashier'].includes(role)};
  return {date:today,can_manage:role==='admin',rows,pending_total:pendingTotal(rows),suppliers:suppliers.filter(s=>s.is_active!==false&&!s.supplier_removed_at).map(s=>({id:s.id,name:s.name})),treasury:treasury.filter(t=>t.is_active&&canUseTreasury(role,t)).map(t=>({id:t.id,name:t.name,balance:t.balance})),accounts:accounts.filter(recurringExpenseAccount).map(a=>({id:a.id,name:a.name,account_number:a.account_number,recurring_expense:a.recurring_expense}))};
}
async function paymentTreasury(stores,id,amount){
  const t=await stores.TreasuryAccount.get(id),all=await readRecords(stores.TreasuryAccount);
  if(!t?.is_active||!['cash','petty_cash','mobile_money','bank'].includes(t.account_type)||t.currency&&t.currency!=='XAF'||all.filter(a=>a.gl_account_id===t.gl_account_id).length!==1)throw Error('Choose a uniquely linked active treasury account.');
  const gl=await stores.Account.get(t.gl_account_id);
  if(!active(gl)||gl.account_type!=='asset'||gl.normal_balance!=='debit')throw Error('The treasury account requires an active debit-normal asset account.');
  const journals=await readRecords(stores.JournalEntry,{status:{$in:['posted','reversed']}}),ids=new Set(journals.map(j=>j.id)),lines=await readRecords(stores.JournalLine,{account_id:gl.id});
  const balance=lines.filter(l=>ids.has(l.journal_id)).reduce((sum,l)=>sum+journalCents(l.debit||0)-journalCents(l.credit||0),0);
  if(!Number.isSafeInteger(balance)||balance!==journalCents(t.balance)||balance!==journalCents(gl.balance))throw Error('Reconcile treasury and its ledger before paying recurring expenses.');
  if(balance<journalCents(amount))throw Error('Insufficient funds. Accrue the expense to pay later.');
  return {...t,ledger:gl};
}
export async function recordRecurringExpense(stores,context,body,{today=businessDate()}={}){
  access(context,true);
  if(!['accrue','pay'].includes(body.action)||!/^[\w-]{16,80}$/.test(body.requestKey||''))throw Error('Reopen the recurring expense form for a valid action and save reference.');
  const eventId='REP-'+hash([context.user.id,body.requestKey]),payload=JSON.stringify(body),previous=await stores.AuditLog.get(eventId);
  if(previous){if(previous.recurring_request_payload!==payload)throw Error('This reference belongs to a different recurring expense action.');return {...previous.recurring_result,reused:true};}
  const account=await stores.Account.get(body.accountId),month=String(body.period||'');monthIndex(month);
  if(month>today.slice(0,7))throw Error('Future recurring expenses cannot be posted.');
  const row=account&&occurrence(account,month);
  if(!row||row.token!==body.token)throw Error('The recurring charge changed. Refresh before posting.');
  let bill=await stores.Bill.get(row.id);
  const svc={entities:stores},supplier=await stores.Supplier.get(row.supplier_id);
  if(!supplier||supplier.is_active===false||supplier.supplier_removed_at)throw Error('The recurring supplier is no longer active.');
  if(bill){if(!await verifiedRecurringBill(stores,bill))throw Error('Reconcile the existing recurring bill before continuing.');}
  else {
    if(!active(account)||!recurringExpenseAccount(account))throw Error('The recurring expense account is not active for posting.');
    const payable=await payableAccount(stores,row.payable_account_id);
    if((await readRecords(stores.JournalEntry,{source_module:'recurring_expenses',source_document_id:row.id})).length)throw Error('A journal already exists without its recurring bill. Reconcile before posting.');
    bill=await stores.Bill.create({id:row.id,bill_number:'REC-'+month+'-'+hash(account.id).slice(0,10).toUpperCase(),supplier_id:supplier.id,supplier_name:supplier.name,bill_date:row.bill_date,due_date:row.due_date,total:row.amount,subtotal:row.amount,tax_total:0,amount_paid:0,balance:row.amount,status:'open',accounting_source:'recurring_expense',recurring_account_id:account.id,recurring_period:month,recurring_token:row.token,payable_account_id:payable.id,notes:account.name+' / '+month,created_by:context.user.id});
    const {journal}=await postJournal(svc,{entryDate:row.bill_date,description:account.name+' / '+month,sourceModule:'recurring_expenses',sourceDocumentType:'Bill',sourceDocumentId:bill.id,userId:context.user.id,lines:[{account_id:account.id,account_number:account.account_number,account_name:account.name,debit:row.amount,credit:0},{account_id:payable.id,account_number:payable.account_number,account_name:payable.name,debit:0,credit:row.amount,party_type:'supplier',party_id:supplier.id}]});
    bill=await stores.Bill.update(bill.id,{journal_id:journal.id});
    const balance=Number(supplier.balance||0),balanceCents=Math.round(balance*100)+journalCents(row.amount);
    if(!Number.isFinite(balance)||!Number.isSafeInteger(balanceCents)||Math.abs(balance*100-Math.round(balance*100))>0.0001)throw Error('Reconcile the supplier balance before posting.');
    await stores.Supplier.update(supplier.id,{balance:balanceCents/100});
  }
  let payment=null;
  if(body.action==='pay'){
    const amount=cents(body.amount,'payment amount')/100,date=journalDate(body.date),reference=String(body.reference||'').trim();
    if(date>today||date<bill.bill_date||!reference||reference.length>200)throw Error('Enter a payment reference and a date between the bill date and today.');
    const treasury=await paymentTreasury(stores,body.treasuryAccountId,amount);
    ({payment}=await requestOpeningBillPayment(svc,context.user,bill,{amount,reference},treasury,date,eventId,context.user.full_name||context.user.email||context.user.id));
    payment=await stores.Payment.update(payment.id,{status:'approved',approved_by:context.user.id,approved_at:new Date().toISOString()});
    await audit(svc,{action:'approve_cash_disbursement',module:'accounting',entityType:'Payment',entityId:payment.id,userId:context.user.id,description:'General Manager approved recurring bill payment '+bill.bill_number});
    ({payment}=await releaseOpeningBillPayment(svc,context.user,payment,body,treasury,date,eventId));
    bill=await stores.Bill.get(bill.id);
  }
  const result={bill,payment};
  await stores.AuditLog.create({id:eventId,action:body.action==='pay'?'pay_recurring_expense':'accrue_recurring_expense',module:'accounting',entity_type:'Bill',entity_id:bill.id,user_id:context.user.id,description:account.name+' / '+month,recurring_request_payload:payload,recurring_result:result});
  return result;
}
