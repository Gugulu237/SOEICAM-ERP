import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {build} from 'esbuild';
import path from 'node:path';
import {fixture,date,user as cashier} from './helpers/cashier.mjs';
import {prepareRecurringExpense,recurringExpenseWorkspace,recordRecurringExpense,configureRecurringExpense,previewDueAccrual,accrueDueExpenses} from '../src/server/domain/recurring-expenses.js';
import {verifiedRecurringBill} from '../src/server/domain/recurring-bill-evidence.js';
import {recurringDueDate} from '../src/lib/recurring-expense-schedule.js';
import {shiftMonth} from '../src/lib/asset-schedule.js';
import {postJournal} from '../src/server/domain/field-ops.js';
import {cashierAction} from '../src/server/domain/cashier-workspace.js';
import {purchasePaymentDecision} from '../src/server/domain/purchase-workspace.js';
import {saveAccountDefinition} from '../src/server/domain/account-definitions.js';
import {guardMutation} from '../src/server/access.js';
import {supplierAction} from '../src/server/domain/supplier-workspace.js';
const statementsBundle=await build({entryPoints:['src/lib/statements.js'],bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'statement-posting',setup(b){b.onResolve({filter:/^@\/lib\/posting$/},()=>({path:path.resolve('src/server/domain/field-ops.js')}));}}]});
const {sectionRows,computeActivity}=await import('data:text/javascript;base64,'+Buffer.from(statementsBundle.outputFiles[0].text).toString('base64'));

const gm={id:'gm',role:'admin',full_name:'General Manager'},context={user:gm,role:'admin',employee:null},month=date.slice(0,7);
const monthly=(extra={})=>({enabled:true,amount:20000,supplier_id:'supplier',due_day:31,effective_month:month,...extra});
async function setup(db){
  const f=await fixture(db),s=f.entities;
  for(const name of ['Bill','AuditLog']){
    const create=s[name].create;
    s[name].create=async value=>{
      if(!value.id)return create(value);
      if(await s[name].get(value.id))throw Error('Duplicate ID');
      if(db)await db.query('INSERT INTO fixture_entity VALUES($1,$2,$3)',[name,value.id,JSON.stringify(value)]);else f.rows[name].push(structuredClone(value));
      return structuredClone(value);
    };
  }
  await s.AccountingPeriod.update('period',{start_date:'2000-01-01',end_date:'2099-12-31'});
  await s.Account.update('payable',{account_type:'liability',currency:'XAF'});
  await s.PostingRule.create({rule_key:'supplier_payable',account_id:'payable',is_active:true});
  await s.Account.update('till-gl',{balance:0});await s.TreasuryAccount.update('till',{balance:0});
  const equity=await s.Account.create({name:'Opening equity',account_number:'OP-EQUITY',account_type:'equity',normal_balance:'credit',balance:0,is_active:true,is_posting:true});
  await postJournal({entities:s},{entryDate:date,description:'Opening till',sourceModule:'opening_balances',sourceDocumentType:'Fixture',sourceDocumentId:'fixture-cash',userId:gm.id,lines:[{account_id:'till-gl',debit:100000,credit:0},{account_id:equity.id,debit:0,credit:100000}]});
  await s.TreasuryAccount.update('till',{balance:100000});
  const schedule=await prepareRecurringExpense(s,context,monthly(),await s.Account.get('expense'));
  await s.Account.update('expense',{name:'Monthly rent',recurring_expense:schedule});
  const row=async options=>(await recurringExpenseWorkspace(s,context,options)).rows[0];
  const body=async(action='accrue',extra={})=>{const r=await row();return {action,requestKey:crypto.randomUUID(),accountId:r.account_id,period:r.period,token:r.token,...(action==='pay'?{amount:20000,date,treasuryAccountId:'till',reference:'Receipt-001'}:{}),...extra};};
  return {...f,row,body};
}
async function expenseTotal(s){
  const journals=await s.JournalEntry.list(),activity=computeActivity({journalsById:Object.fromEntries(journals.filter(j=>['posted','reversed'].includes(j.status)).map(j=>[j.id,j])),lines:await s.JournalLine.list(),fromDate:'2000-01-01',toDate:'2099-12-31'});
  return sectionRows(await s.Account.list(),activity,['expense','other_expense'],1).reduce((n,r)=>n+r.amount,0);
}
test('monthly charges appear on reads, catch up after missed months and do not silently post financial records',async()=>{
  const f=await setup(),before=structuredClone(f.rows);
  const first=await recurringExpenseWorkspace(f.entities,context),later=await recurringExpenseWorkspace(f.entities,context,{today:shiftMonth(month,3)+'-10'});
  assert.equal(first.rows.length,1);assert.equal(first.pending_total,20000);assert.equal(later.rows.length,4);
  assert.equal(new Set(later.rows.map(r=>r.id)).size,4);assert.deepEqual(f.rows,before);assert.equal(await expenseTotal(f.entities),0);
  assert.equal(first.rows[0].bill_date,date,'first charge cannot predate setup');
  assert.equal(recurringDueDate('2028-02',31),'2028-02-29');assert.equal(recurringDueDate('2027-02',31),'2027-02-28');
});
test('accrual enters P&L and supplier payables exactly once without moving cash or posting sales',async()=>{
  const f=await setup(),s=f.entities,body=await f.body(),before=(await s.JournalEntry.list()).length;
  const result=await recordRecurringExpense(s,context,body);
  assert.equal(result.bill.balance,20000);assert.equal(await verifiedRecurringBill(s,result.bill),true);
  assert.equal(await expenseTotal(s),20000);assert.equal((await s.Supplier.get('supplier')).balance,20000);assert.equal((await s.Account.get('payable')).balance,20000);
  assert.equal((await s.TreasuryAccount.get('till')).balance,100000);assert.equal((await s.TreasuryTransaction.list()).length,0);
  assert.equal((await recurringExpenseWorkspace(s,context)).pending_total,0);
  assert.equal((await recordRecurringExpense(s,context,body)).reused,true);
  await recordRecurringExpense(s,context,{...body,requestKey:crypto.randomUUID()});
  assert.equal((await s.Bill.list()).length,1);assert.equal((await s.JournalEntry.list()).length,before+1);assert.equal(await expenseTotal(s),20000);
  await assert.rejects(recordRecurringExpense(s,context,{...body,action:'pay'}),/different recurring/);
});
test('Pay now posts the expense and clears its payable once, with real cash and payment allocation evidence',async()=>{
  const f=await setup(),s=f.entities,body=await f.body('pay');
  const result=await recordRecurringExpense(s,context,body),after=structuredClone(f.rows);
  assert.equal(result.bill.status,'paid');assert.equal(result.bill.balance,0);assert.equal(result.payment.status,'posted');assert.equal(result.payment.approved_by,gm.id);
  assert.equal((await s.Account.get('payable')).balance,0);assert.equal((await s.Supplier.get('supplier')).balance,0);assert.equal((await s.TreasuryAccount.get('till')).balance,80000);assert.equal((await s.Account.get('till-gl')).balance,80000);
  assert.equal(await expenseTotal(s),20000);assert.equal((await s.PaymentAllocation.list())[0].document_id,result.bill.id);
  assert.equal((await recordRecurringExpense(s,context,body)).reused,true);assert.deepEqual(f.rows,after);
});
test('partial and later settlements reduce the same bill without charging P&L twice',async()=>{
  const f=await setup(),s=f.entities;
  await recordRecurringExpense(s,context,await f.body());
  const partial=await recordRecurringExpense(s,context,await f.body('pay',{amount:7000}));
  assert.equal(partial.bill.status,'partially_paid');assert.equal(partial.bill.balance,13000);assert.equal((await s.Supplier.get('supplier')).balance,13000);
  const final=await recordRecurringExpense(s,context,await f.body('pay',{amount:13000,reference:'Receipt-002'}));
  assert.equal(final.bill.status,'paid');assert.equal(await expenseTotal(s),20000);assert.equal((await s.TreasuryAccount.get('till')).balance,80000);assert.equal((await s.PaymentAllocation.list()).length,2);
});
test('cashier requests for accrued recurring bills retain GM approval and retry-safe release',async()=>{
  const f=await setup(),s=f.entities,{bill}=await recordRecurringExpense(s,context,await f.body());
  const {payment}=await cashierAction(f.client,cashier,{action:'cashierRequestPayment',requestKey:crypto.randomUUID(),billId:bill.id,accountId:'till',amount:9000,date,reference:'RENT-01'});
  assert.equal(payment.recurring_bill_payment,true);assert.equal(payment.opening_bill_payment,false);
  const release={action:'cashierReleasePayment',requestKey:crypto.randomUUID(),paymentId:payment.id,accountId:'till',date};
  await assert.rejects(cashierAction(f.client,cashier,release),/approved/);
  await assert.rejects(purchasePaymentDecision(f.client,cashier,{action:'approvePurchasePayment',paymentId:payment.id}),/restricted/);
  await purchasePaymentDecision(f.client,gm,{action:'approvePurchasePayment',paymentId:payment.id});
  await cashierAction(f.client,cashier,release);const after=structuredClone(f.rows);
  await cashierAction(f.client,cashier,{...release,requestKey:crypto.randomUUID()});assert.deepEqual(f.rows,after);
  assert.equal((await s.Bill.get(bill.id)).balance,11000);assert.equal(await expenseTotal(s),20000);
});
test('rate changes and pauses are prospective; old unposted amounts and posted debt cannot be rewritten',async()=>{
  const f=await setup(),s=f.entities,old=await s.Account.get('expense');
  await assert.rejects(prepareRecurringExpense(s,context,monthly({amount:40000}),old,old.recurring_expense),/next month/);
  const next=shiftMonth(month,1),updated=await prepareRecurringExpense(s,context,monthly({amount:30000,effective_month:next}),old,old.recurring_expense);
  await s.Account.update('expense',{recurring_expense:updated});
  let rows=(await recurringExpenseWorkspace(s,context,{today:next+'-10'})).rows;assert.deepEqual(rows.map(r=>r.amount),[20000,30000]);
  await recordRecurringExpense(s,context,await f.body());
  const pause=await prepareRecurringExpense(s,context,{enabled:false,effective_month:shiftMonth(month,2)},old,updated);
  await s.Account.update('expense',{recurring_expense:pause});
  rows=(await recurringExpenseWorkspace(s,context,{today:shiftMonth(month,3)+'-10'})).rows;
  assert.equal(rows.length,2);assert.equal(rows[0].status,'open');assert.equal(rows[0].balance,20000);
});
test('account creation and editing accept approved recurrence settings while other roles and forged metadata are refused',async()=>{
  const f=await setup(),s=f.entities,definition={account_number:'RENT-2',name:'Internet subscription',account_type:'expense',normal_balance:'debit',is_posting:true};
  const saved=await saveAccountDefinition(s,context,{requestKey:crypto.randomUUID(),account:definition,recurring:monthly({amount:10000})});
  assert.equal(saved.recurring_expense.versions[0].amount,10000);
  const staff={user:cashier,role:'cashier',employee:{role:'cashier',status:'active',allowed_modules:['accounting']}};
  await assert.rejects(prepareRecurringExpense(s,staff,monthly(),definition),{status:403});
  await assert.rejects(recordRecurringExpense(s,staff,await f.body()),{status:403});
  for(const account_type of ['asset','liability','equity','revenue','cogs'])await assert.rejects(prepareRecurringExpense(s,context,monthly(),{...definition,account_type}),/posting expense/);
  for(const [entity,payload,existing]of [['Account',{recurring_expense:{}},{}],['Bill',{accounting_source:'recurring_expense'},{}],['Bill',{balance:0},{recurring_account_id:'expense'}],['Payment',{recurring_bill_payment:true},{}],['AuditLog',{id:'REP-forged'},{}]])assert.throws(()=>guardMutation(context,entity,'update',payload,existing),{status:403});
});
test('invalid rates, suppliers, dates and stale previews cannot create a charge',async()=>{
  const f=await setup(),s=f.entities,account=await s.Account.get('expense');
  for(const changes of [{amount:0},{amount:-1},{amount:0.001},{due_day:32},{supplier_id:'absent'},{effective_month:shiftMonth(month,-1)}])await assert.rejects(prepareRecurringExpense(s,context,monthly(changes),account));
  for(const changes of [{token:'stale'},{period:shiftMonth(month,1)}]){const before=structuredClone(f.rows);await assert.rejects(recordRecurringExpense(s,context,await f.body('accrue',changes)));assert.deepEqual(f.rows,before);}
});
test('existing bill and source journal evidence must agree before a payment or retry',async()=>{
  const f=await setup(),s=f.entities,{bill}=await recordRecurringExpense(s,context,await f.body());
  await s.Bill.update(bill.id,{total:21000});assert.equal(await verifiedRecurringBill(s,await s.Bill.get(bill.id)),false);
  await assert.rejects(recordRecurringExpense(s,context,await f.body('pay')),/Reconcile the existing/);
});
test('changing the supplier posting rule does not redirect settlement of an already recorded recurring bill',async()=>{
  const f=await setup(),s=f.entities,{bill}=await recordRecurringExpense(s,context,await f.body());
  const rule=(await s.PostingRule.filter({rule_key:'supplier_payable'}))[0];await s.PostingRule.update(rule.id,{account_id:'missing'});
  await recordRecurringExpense(s,context,await f.body('pay'));
  assert.equal((await s.Account.get('payable')).balance,0);assert.equal((await s.Bill.get(bill.id)).status,'paid');
});

test('management P&L summaries show unrecognized monthly expenses without exposing bank or supplier details',async()=>{
  const f=await setup(),manager={user:{id:'manager',role:'user'},role:'production_manager',employee:{id:'manager',role:'production_manager',status:'active',allowed_modules:['accounting']}};
  const summary=await recurringExpenseWorkspace(f.entities,manager,{reportOnly:true,from:month+'-01',to:date});
  assert.deepEqual(summary,{pending_total:20000,pending_count:1,can_review:false});
  await assert.rejects(recurringExpenseWorkspace(f.entities,manager),{status:403});
  assert.equal((await recurringExpenseWorkspace(f.entities,context,{reportOnly:true,from:shiftMonth(month,1)+'-01',to:shiftMonth(month,1)+'-28'})).pending_total,0);
});

test('supplier statements retain recurring bills and original payable accounts after rule changes',async()=>{
  const f=await setup(),s=f.entities;
  // An account without the legacy 4010 number must still remain in the ledger review.
  await s.Account.update('payable',{account_number:'PAY-ORIGINAL'});
  await recordRecurringExpense(s,context,await f.body());
  const rule=(await s.PostingRule.filter({rule_key:'supplier_payable'}))[0];await s.PostingRule.update(rule.id,{account_id:'future-payable'});
  const result=await supplierAction(f.client,gm,{action:'supplierWorkspace',supplierId:'supplier'});
  assert.equal(result.supplier.ledger_balance,20000);assert.equal(result.supplier.unpaid_bills,20000);assert.equal(result.bills[0].accounting_source,'recurring_expense');
});

test('inactive expense accounts remain visible for recognition review while already accrued debts can still be settled',async()=>{
  const f=await setup(),s=f.entities;
  await recordRecurringExpense(s,context,await f.body());await s.Account.update('expense',{is_active:false});
  assert.equal((await f.row()).status,'open');
  await recordRecurringExpense(s,context,await f.body('pay'));assert.equal(await expenseTotal(s),20000);
});

async function route(){
  const r=await build({entryPoints:['src/app/api/accounting/recurring-expenses/route.js'],bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'recurring-transaction',setup(b){const mocks={
    '@/server/auth':'export const authenticateRequest=async()=>globalThis.__recurringTest.context,checkOrigin=()=>{},apiError=e=>Response.json({error:e.message},{status:e.status||400});',
    '@/server/entities':'export const serviceEntities=new Proxy({},{get:(_,key)=>globalThis.__recurringTest.entities[key]});',
    '@/server/db':'export const database=()=>({unsafe:async()=>{}}),transaction=async run=>{const db=globalThis.__recurringTest.db;await db.exec("BEGIN");try{const result=await run();await db.exec("COMMIT");return result;}catch(e){await db.exec("ROLLBACK");throw e;}};'};
    b.onResolve({filter:/^@\/server\//},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
  return import('data:text/javascript;base64,'+Buffer.from(r.outputFiles[0].text).toString('base64'));
}
test('transaction rolls back the complete accrual and payment on insufficient funds, closed periods and late allocation or audit failures',async()=>{
  const api=await route();
  for(const mode of ['funds','period','allocation','audit']){
    const db=new PGlite();try{
      const f=await setup(db),s=f.entities;globalThis.__recurringTest={...f,context,db};
      if(mode==='period')await s.AccountingPeriod.update('period',{status:'closed'});
      const before=(await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows;
      const create=mode==='allocation'?s.PaymentAllocation.create:s.AuditLog.create;
      if(mode==='allocation')s.PaymentAllocation.create=async()=>{throw Error('Allocation unavailable');};
      if(mode==='audit')s.AuditLog.create=async value=>{if(value.action==='pay_recurring_expense')throw Error('Audit unavailable');return create(value);};
      const body=await f.body('pay',mode==='funds'?{amount:100001}:{});
      const response=await api.POST(new Request('http://localhost/api/accounting/recurring-expenses',{method:'POST',body:JSON.stringify(body)}));
      assert.equal(response.status,400,mode+': '+await response.text());
      assert.deepEqual((await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows,before,mode);
    }finally{delete globalThis.__recurringTest;await db.close();}
  }
});
test('checked endpoint commits once and a retry after a lost response creates no second bill, expense, payment or allocation',async()=>{
  const db=new PGlite();try{
    const f=await setup(db),api=await route();globalThis.__recurringTest={...f,context,db};const body=await f.body('pay');
    const request=()=>api.POST(new Request('http://localhost/api/accounting/recurring-expenses',{method:'POST',body:JSON.stringify(body)}));
    const response=await request();assert.equal(response.status,200,await response.text());
    const before=(await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows;
    const retry=await request();assert.equal(retry.status,200);assert.equal((await retry.json()).reused,true);
    assert.deepEqual((await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows,before);
    const read=await api.GET(new Request('http://localhost/api/accounting/recurring-expenses'));assert.equal(read.headers.get('cache-control'),'private, no-store');
  }finally{delete globalThis.__recurringTest;await db.close();}
});


const directSettings=(extra={})=>monthly({due_day:1,payable_account_id:'payable',...extra});
test('direct recurring setup creates a real expense account without a global rule and saves versions without posting liabilities',async()=>{
 const f=await setup(),s=f.entities;await s.PostingRule.deleteMany({rule_key:'supplier_payable'});const beforeJournals=(await s.JournalEntry.list()).length,beforeBills=(await s.Bill.list()).length;
 const body={action:'configure',requestKey:crypto.randomUUID(),newAccount:{name:'Fixture internet charge',account_number:'TEST-NET'},expectedRevision:0,settings:directSettings({amount:123.45})};
 const result=await configureRecurringExpense(s,context,body),account=await s.Account.get(result.account.id);
 assert.equal(account.account_type,'expense');assert.equal(account.normal_balance,'debit');assert.equal(account.recurring_expense.versions[0].amount,123.45);assert.equal(account.recurring_expense.versions[0].payable_account_id,'payable');assert.equal((await s.JournalEntry.list()).length,beforeJournals);assert.equal((await s.Bill.list()).length,beforeBills);assert.equal((await s.TreasuryTransaction.list()).length,0);
 const retry=await configureRecurringExpense(s,context,body);assert.equal(retry.reused,true);assert.equal(retry.account.id,account.id);assert.equal((await s.Account.list()).filter(row=>row.account_number==='TEST-NET').length,1);
 await assert.rejects(configureRecurringExpense(s,context,{...body,settings:{...body.settings,amount:99}}),{status:409});
 const next=shiftMonth(month,1),edited=await configureRecurringExpense(s,context,{action:'configure',requestKey:crypto.randomUUID(),accountId:account.id,expectedRevision:1,settings:directSettings({amount:200,effective_month:next})});
 assert.equal(edited.account.recurring_expense.revision,2);assert.deepEqual(edited.account.recurring_expense.versions.map(version=>version.amount),[123.45,200]);
 await assert.rejects(configureRecurringExpense(s,context,{action:'configure',requestKey:crypto.randomUUID(),accountId:account.id,expectedRevision:1,settings:directSettings({amount:250,effective_month:next})}),{status:409});
 const workspace=await recurringExpenseWorkspace(s,context);assert.equal(workspace.summaries.find(row=>row.account_id===account.id).pending_total,123.45);assert.equal(workspace.summaries.find(row=>row.account_id===account.id).accrued_unpaid_total,0);
});

test('direct schedule setup requires its own valid payee and payable and denies salary duplication by exact payroll account',async()=>{
 const f=await setup(),s=f.entities,body={action:'configure',requestKey:crypto.randomUUID(),newAccount:{name:'Fixture monthly service',account_number:'TEST-SERVICE'},expectedRevision:0,settings:directSettings()};
 for(const settings of [{...body.settings,supplier_id:''},{...body.settings,payable_account_id:''},{...body.settings,payable_account_id:'till-gl'},{...body.settings,payable_account_id:'expense'},{...body.settings,effective_month:shiftMonth(month,-1)}])await assert.rejects(configureRecurringExpense(s,context,{...body,requestKey:crypto.randomUUID(),settings}));
 await assert.rejects(configureRecurringExpense(s,{user:cashier,role:'cashier',employee:{id:'cashier',role:'cashier',status:'active'}},body),{status:403});
 await assert.rejects(configureRecurringExpense(s,context,{...body,newAccount:{name:'Fixture salaries',account_number:'6100'}}),/Payroll/);
 const expense=await s.Account.get('expense');await s.Account.update('expense',{account_number:'6100',recurring_expense:{...expense.recurring_expense,versions:expense.recurring_expense.versions.map(version=>({...version,due_day:1}))}});
 let workspace=await recurringExpenseWorkspace(s,context),row=workspace.rows.find(value=>value.account_id==='expense');assert.equal(row.payroll_managed,true);assert.equal(row.blocked,true);assert.ok(workspace.accounts.some(account=>account.id==='expense'&&account.payroll_managed));
 await assert.rejects(recordRecurringExpense(s,context,{action:'accrue',requestKey:crypto.randomUUID(),accountId:'expense',period:row.period,token:row.token}),/Payroll/);
 await assert.rejects(previewDueAccrual(s,context,{rows:[{accountId:'expense',period:row.period,token:row.token}]}),/Payroll/);
 assert.equal((await s.Bill.list()).length,0);
 await configureRecurringExpense(s,context,{action:'configure',requestKey:crypto.randomUUID(),accountId:'expense',expectedRevision:1,settings:{enabled:false,effective_month:shiftMonth(month,1)}});
 workspace=await recurringExpenseWorkspace(s,context,{today:shiftMonth(month,1)+'-10'});assert.equal(workspace.rows.length,1,'legacy salary charge stays visible while future duplicate schedule is paused');
});

test('due recognition is a read-only bounded reviewed selection and rejects stale, future or duplicate rows',async()=>{
 const f=await setup(),s=f.entities,result=await configureRecurringExpense(s,context,{action:'configure',requestKey:crypto.randomUUID(),newAccount:{name:'Fixture due service',account_number:'TEST-DUE'},expectedRevision:0,settings:directSettings({amount:100})}),row=(await recurringExpenseWorkspace(s,context)).rows.find(value=>value.account_id===result.account.id),input={accountId:row.account_id,period:row.period,token:row.token},before=structuredClone(f.rows);
 const preview=await previewDueAccrual(s,context,{rows:[input]});assert.equal(preview.total,100);assert.equal(preview.count,1);assert.deepEqual(f.rows,before);
 await assert.rejects(previewDueAccrual(s,context,{rows:[input,input]}),/only once/);await assert.rejects(previewDueAccrual(s,context,{rows:Array(61).fill(input)}),/1 and 60/);
 await assert.rejects(accrueDueExpenses(s,context,{action:'accrueDue',requestKey:crypto.randomUUID(),rows:[input],reviewToken:preview.token,confirmed:false}),/Review and confirm/);
 await s.Account.update(result.account.id,{name:'Changed during review'});await assert.rejects(accrueDueExpenses(s,context,{action:'accrueDue',requestKey:crypto.randomUUID(),rows:[input],reviewToken:preview.token,confirmed:true}),/changed/);assert.equal((await s.Bill.list()).length,0);
 const future=await configureRecurringExpense(s,context,{action:'configure',requestKey:crypto.randomUUID(),newAccount:{name:'Fixture future service',account_number:'TEST-FUTURE'},expectedRevision:0,settings:directSettings({effective_month:shiftMonth(month,1)})});assert.ok(!(await recurringExpenseWorkspace(s,context)).rows.some(value=>value.account_id===future.account.id));
});

test('reviewed due accrual commits rent and service payables together, rolls back late failures, retries once and pays a partial debt without duplicate expense',async()=>{
 const db=new PGlite();try{
  const f=await setup(db),s=f.entities,api=await route();globalThis.__recurringTest={...f,context,db};
  const accounts=[];for(const [name,number,amount] of [['Fixture rent','TEST-RENT',100],['Fixture service','TEST-SUB',200]])accounts.push((await configureRecurringExpense(s,context,{action:'configure',requestKey:crypto.randomUUID(),newAccount:{name,account_number:number},expectedRevision:0,settings:directSettings({amount})})).account);
  const workspace=await recurringExpenseWorkspace(s,context),selected=workspace.rows.filter(row=>accounts.some(account=>account.id===row.account_id)),rows=selected.map(row=>({accountId:row.account_id,period:row.period,token:row.token}));
  const request=body=>api.POST(new Request('http://localhost/api/accounting/recurring-expenses',{method:'POST',body:JSON.stringify(body)}));
  const previewResponse=await request({action:'previewDueAccrual',rows});assert.equal(previewResponse.status,200);const preview=await previewResponse.json();assert.equal(preview.total,300);assert.equal((await s.Bill.list()).length,0);
  const body={action:'accrueDue',requestKey:crypto.randomUUID(),rows,reviewToken:preview.token,confirmed:true},beforeJournals=(await s.JournalEntry.list()).length,create=s.AuditLog.create;
  s.AuditLog.create=async input=>{if(input.action==='accrue_due_recurring_expenses')throw Error('Late due-review audit failure');return create(input);};
  let response=await request(body);assert.equal(response.status,400);assert.equal((await s.Bill.list()).length,0);assert.equal((await s.JournalEntry.list()).length,beforeJournals);assert.equal((await s.Supplier.get('supplier')).balance,0);assert.equal((await s.Account.get('payable')).balance,0);
  s.AuditLog.create=create;response=await request(body);assert.equal(response.status,200);assert.equal((await response.json()).count,2);assert.equal((await s.Bill.list()).length,2);assert.equal((await s.JournalEntry.list()).length,beforeJournals+2);assert.equal((await s.Supplier.get('supplier')).balance,300);assert.equal((await s.TreasuryAccount.get('till')).balance,100000);assert.equal((await s.Payment.list()).length,0);
  const counts=await Promise.all(['Bill','JournalEntry','JournalLine','AuditLog'].map(name=>s[name].list().then(values=>values.length)));response=await request(body);assert.equal(response.status,200);assert.equal((await response.json()).reused,true);assert.deepEqual(await Promise.all(['Bill','JournalEntry','JournalLine','AuditLog'].map(name=>s[name].list().then(values=>values.length))),counts);
  const rent=selected.find(row=>row.account_name==='Fixture rent');await recordRecurringExpense(s,context,{action:'pay',requestKey:crypto.randomUUID(),accountId:rent.account_id,period:rent.period,token:rent.token,amount:40,date,treasuryAccountId:'till',reference:'TEST-PARTIAL'});
  assert.equal((await s.Account.get(rent.account_id)).balance,100);assert.equal((await s.Account.get('payable')).balance,260);assert.equal((await s.Supplier.get('supplier')).balance,260);assert.equal((await s.Payment.list()).length,1);assert.equal((await s.Bill.list()).length,2);
  const summary=(await recurringExpenseWorkspace(s,context)).summaries.find(value=>value.account_id===rent.account_id);assert.equal(summary.accrued_unpaid_total,60);assert.equal(summary.paid_total,40);assert.equal(summary.pending_total,0);
 }finally{delete globalThis.__recurringTest;await db.close();}
});
