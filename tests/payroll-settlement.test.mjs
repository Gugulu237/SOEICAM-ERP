import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { PGlite } from '@electric-sql/pglite';
import { fixture,user,date } from './helpers/cashier.mjs';
import { payrollAction,payrollWorkspace } from '../src/server/domain/payroll-workspace.js';
import { canOpenFieldPath } from '../src/lib/permissions.js';
import { guardMutation } from '../src/server/access.js';
import { catalogueFromStored } from '../src/server/domain/role-catalogue.js';
const gm={user:{id:'gm',role:'admin',email:'gm@example.test'},role:'admin'};
async function setup(db,{month=Number(date.slice(5,7)),year=Number(date.slice(0,4))}={}) {
  const f=await fixture(db),s=f.entities;
  await s.Employee.update('cashier',{base_salary:100000});
  const wages=await s.Account.create({account_number:'6100',name:'Wages',account_type:'expense',normal_balance:'debit',balance:0,is_active:true,is_posting:true});
  const payable=await s.Account.create({account_number:'4200',name:'Employee salaries payable',account_type:'liability',normal_balance:'credit',balance:0,is_active:true,is_posting:true});
  const tax=await s.Account.create({account_number:'4300',name:'Statutory withholding payable',account_type:'liability',normal_balance:'credit',balance:0,is_active:true,is_posting:true});
  const loan=await s.Account.create({account_number:'2700',name:'Employee loan receivable',account_type:'asset',normal_balance:'debit',balance:10000,is_active:true,is_posting:true});
  const cashier={user,role:'cashier',employee:await s.Employee.get('cashier')};
  const call=(body,context=gm)=>payrollAction(s,context,body);
  const run=await call({action:'create',requestKey:crypto.randomUUID(),month,year});
  const line=(await s.PayrollLine.filter({payroll_id:run.id}))[0];
  const review=async(extra={})=>call({action:'reviewLine',runId:run.id,lineId:line.id,revision:(await s.PayrollRun.get(run.id)).payroll_revision,changes:{base_salary:100000,allowances:0,variable_pay:0,unpaid_time_amount:0,statutory_deductions:0,other_deductions:0,adjustment_reason:'Contract and attendance reviewed',adjustment_reference:'PAYROLL-SHEET-001',statutory_reviewed:true,...extra}});
  const approve=async(extra={})=>call({action:'approve',runId:run.id,revision:(await s.PayrollRun.get(run.id)).payroll_revision,...extra});
  const pay=(amount=30000,extra={})=>call({action:'pay',lineId:line.id,requestKey:crypto.randomUUID(),date,accountId:'till',reference:'SALARY-RECEIPT-'+crypto.randomUUID().slice(0,8),amount,...extra},cashier);
  return {...f,s,wages,payable,tax,loan,cashier,run,line,call,review,approve,pay};
}
test('GM reviews an individual payslip with requested and adjusted values; attendance/performance reasons are retained without changing the employee contract',async()=>{
  const f=await setup(),{s}=f;
  const result=await f.review({variable_pay:10000,unpaid_time_amount:5000,unpaid_days:1,late_minutes:20,unpaid_time_eligible:true,attendance_notes:'Unpaid time supported by attendance sheet; approved leave excluded',performance_notes:'Agreed variable component reviewed',statutory_deductions:4200,statutory_payable_account_id:f.tax.id,other_deductions:1000,deduction_basis:'loan_repayment',other_deduction_account_id:f.loan.id});
  assert.equal(result.line.requested_base_salary,100000);assert.equal(result.line.gross_pay,105000);assert.equal(result.line.net_pay,99800);assert.equal(result.line.payroll_reviewed_by,gm.user.id);
  assert.equal((await s.Employee.get('cashier')).base_salary,100000);
  const event=(await s.AuditLog.list()).find(a=>a.action==='review_payslip');assert.equal(event.payroll_before_values.base_salary,100000);assert.equal(event.payroll_after_values.net_pay,99800);
  const posted=await f.approve();assert.equal(posted.status,'posted');assert.equal((await s.Account.get(f.wages.id)).balance,105000);assert.equal((await s.Account.get(f.payable.id)).balance,99800);assert.equal((await s.Account.get(f.tax.id)).balance,4200);assert.equal((await s.Account.get(f.loan.id)).balance,9000);
  assert.equal((await s.JournalLine.list()).reduce((n,l)=>n+l.debit-l.credit,0),0);assert.ok((await s.JournalLine.list()).every(l=>l.party_id==='cashier' && l.party_type==='employee'));
});
test('new salary requests require explicit payslip review and do not apply the old unverified flat statutory rate',async()=>{
  const f=await setup();assert.equal(f.run.total_net,100000);assert.equal(f.run.total_deductions,0);
  await assert.rejects(f.approve(),/review and save every/);
  await assert.rejects(f.review({statutory_reviewed:false}),/Confirm the statutory/);
  await assert.rejects(f.review({unpaid_time_amount:100,unpaid_days:1}),/Validate unpaid/);
  await assert.rejects(f.review({other_deductions:100,other_deduction_account_id:f.loan.id,deduction_basis:'disciplinary_fine'}),/Disciplinary fines/);
  await assert.rejects(f.review({base_salary:10,unpaid_time_amount:20}),/cannot exceed/);
});
test('approved payslips are locked and a cashier can make partial payments that reduce employee payable and cash once',async()=>{
  const f=await setup(),s=f.s;await f.review();await f.approve();
  const body={action:'pay',lineId:f.line.id,amount:30000,date,accountId:'till',reference:'RECEIPT-001',requestKey:crypto.randomUUID()};
  const first=await f.call(body,f.cashier);assert.equal(first.outstanding_amount,70000);assert.equal((await s.Account.get(f.payable.id)).balance,70000);assert.equal((await s.TreasuryAccount.get('till')).balance,70000);assert.equal((await s.Account.get('till-gl')).balance,70000);
  assert.equal((await f.call(body,f.cashier)).reused,true);assert.equal((await s.Payment.filter({payment_type:'salary_payment'})).length,1);assert.equal((await s.TreasuryTransaction.list()).length,1);
  await assert.rejects(f.call({...body,amount:10000},f.cashier),/different details/);
  await assert.rejects(f.call({...body,requestKey:crypto.randomUUID()},f.cashier),/already used/);
  await assert.rejects(f.review(),/amounts are locked/);
  await f.pay(70000);assert.equal((await s.Account.get(f.payable.id)).balance,0);assert.equal((await s.TreasuryAccount.get('till')).balance,0);assert.equal((await s.Account.get(f.wages.id)).balance,100000);
  const state=await payrollWorkspace(s,f.cashier);assert.equal(state.lines[0].outstanding_amount,0);assert.equal(state.run.total_paid,100000);assert.equal(state.payments.length,2);
});
test('insufficient treasury or ledger funds, overpayment, future dates and closed accounting periods change nothing',async()=>{
  const f=await setup(),s=f.s;await f.review();await f.approve();
  await s.TreasuryAccount.update('till',{balance:20000});let before=structuredClone(f.rows);
  await assert.rejects(f.pay(30000),/Insufficient available funds/);assert.deepEqual(f.rows,before);
  await s.TreasuryAccount.update('till',{balance:100000});await s.Account.update('till-gl',{balance:1000});await assert.rejects(f.pay(30000),/Insufficient available funds/);
  await s.Account.update('till-gl',{balance:100000});await assert.rejects(f.pay(100001),/exceeds the employee/);
  await assert.rejects(f.pay(100,{date:'2200-01-01'}),/valid date/);
  await s.AccountingPeriod.update('period',{status:'closed'});before=structuredClone(f.rows);await assert.rejects(f.pay(100),/open accounting period/);assert.deepEqual(f.rows,before);
});
test('salary rights and payments remain separated by actual account and module permissions, including GM employee previews',async()=>{
  const f=await setup();
  await assert.rejects(f.call({action:'create',month:1,year:2026,requestKey:crypto.randomUUID()},f.cashier),{status:403});
  await assert.rejects(f.call({action:'reviewLine',runId:f.run.id},f.cashier),{status:403});
  await f.review();await f.approve();await assert.rejects(f.call({action:'pay'},gm),/Only the Cashier/);
  for(const role of ['employee','production_manager','warehouse_manager','commercial','driver'])await assert.rejects(payrollWorkspace(f.s,{user,employee:{id:'cashier',role,status:'active'},role}),{status:403});
  const disabled={...f.cashier,employee:{...f.cashier.employee,allowed_modules:['cashier']}};await assert.rejects(f.call({action:'pay'},disabled),{status:403});
  const inactive={...f.cashier,employee:{...f.cashier.employee,status:'inactive'}};await assert.rejects(f.payrollWorkspace?.(inactive) || payrollWorkspace(f.s,inactive),{status:403});
});
test('stale GM revisions, repeated approval and recalculation cannot overwrite reviewed or approved amounts',async()=>{
  const f=await setup(),before=f.run.payroll_revision;await f.review();
  await assert.rejects(f.call({action:'approve',runId:f.run.id,revision:before}),{status:409});
  await assert.rejects(f.call({action:'recalculate',runId:f.run.id,revision:(await f.s.PayrollRun.get(f.run.id)).payroll_revision}),/retain their adjustments/);
  const approved=await f.approve();assert.equal((await f.approve()).journal_id,approved.journal_id);assert.equal((await f.s.JournalEntry.list()).length,1);
});
test('unposted legacy approval can return for correction while retaining adjustments and requiring renewed payslip reviews',async()=>{
  const f=await setup();await f.review({variable_pay:1000});
  await f.s.PayrollRun.update(f.run.id,{status:'approved',payroll_workflow_version:1,approved_by:'legacy-gm'});
  await f.call({action:'reject',runId:f.run.id,revision:(await f.s.PayrollRun.get(f.run.id)).payroll_revision,reason:'Recheck the salary evidence'});
  const line=await f.s.PayrollLine.get(f.line.id);assert.equal(line.variable_pay,1000);assert.equal(line.payroll_reviewed_by,'');
  await assert.rejects(f.approve(),/review and save every/);assert.equal((await f.s.JournalEntry.list()).length,0);
});
test('cashiers cannot discover unapproved salary requests and never receive unrelated employee or account financial data',async()=>{
  const f=await setup();const initial=await payrollWorkspace(f.s,f.cashier);assert.deepEqual(initial.runs,[]);assert.deepEqual(initial.lines,[]);
  await assert.rejects(payrollWorkspace(f.s,f.cashier,f.run.id),{status:403});
  await f.review();await f.approve();const approved=await payrollWorkspace(f.s,f.cashier);assert.equal(approved.runs.length,1);assert.equal(approved.lines.length,1);assert.equal(approved.accounts.some(a=>'balance' in a),false);
});
test('individual employee subledgers stay separate when one employee is paid and another remains outstanding',async()=>{
  const f=await setup(),s=f.s;
  // Recalculate an unreviewed run after adding another active employee.
  const second=await s.Employee.create({id:'staff-b',full_name:'Second employee',base_salary:60000,status:'active'});
  await f.call({action:'recalculate',runId:f.run.id,revision:f.run.payroll_revision});
  for(const l of await s.PayrollLine.filter({payroll_id:f.run.id}))await f.call({action:'reviewLine',runId:f.run.id,lineId:l.id,revision:(await s.PayrollRun.get(f.run.id)).payroll_revision,changes:{base_salary:l.base_salary,allowances:0,variable_pay:0,unpaid_time_amount:0,statutory_deductions:0,other_deductions:0,adjustment_reason:'Monthly evidence checked',adjustment_reference:'CHECK-ALL',statutory_reviewed:true}});
  await f.approve();const line=(await s.PayrollLine.filter({payroll_id:f.run.id})).find(l=>l.employee_id===second.id);await f.pay(20000,{lineId:line.id});
  const state=await payrollWorkspace(s,gm,f.run.id);assert.equal(state.lines.find(l=>l.employee_id===second.id).outstanding_amount,40000);assert.equal(state.lines.find(l=>l.employee_id==='cashier').outstanding_amount,100000);assert.equal((await s.Account.get(f.payable.id)).balance,140000);
});
test('generic writes cannot forge or alter salary payments, payroll balances, treasury movements or their source journals',()=>{
  for(const [entity,input,existing] of [['Payment',{payment_type:'salary_payment'}],['Payment',{amount:1},{payment_type:'salary_payment'}],['TreasuryTransaction',{source:'payroll'}],['AuditLog',{payroll_line_id:'fake'}],['JournalEntry',{source_document_type:'PayrollPayment'}]])assert.throws(()=>guardMutation(gm,entity,'update',input,existing),/checked (?:Payroll|cash)/);
});
test('cashier payroll access is granted once with the existing cash-desk role and explicit later removal is retained',()=>{
  const old=catalogueFromStored({roles:{cashier:{template_role:'cashier',module_permissions_version:4,modules:['cashier','accounting']}}});assert.ok(old.roles.cashier.modules.includes('payroll'));assert.equal(canOpenFieldPath('cashier','/payroll'),true);
  const saved=catalogueFromStored({roles:{cashier:{template_role:'cashier',module_permissions_version:5,modules:['cashier','accounting']}}});assert.equal(saved.roles.cashier.modules.includes('payroll'),false);
});
test('approval rejects cash/asset tax accounts and salary-payable deduction offsets before any posting',async()=>{
  const f=await setup();await f.review({statutory_deductions:1000,statutory_payable_account_id:'till-gl'});const before=structuredClone(f.rows);await assert.rejects(f.approve(),/non-cash deduction/);assert.deepEqual(f.rows,before);
  await f.review({statutory_deductions:1000,statutory_payable_account_id:f.payable.id});await assert.rejects(f.approve(),/separate from salaries/);
});
test('late salary-payment failures roll back payment, payable, treasury balance, numbering, movements and audit at the HTTP boundary',async()=>{
  const db=new PGlite();try{
    const f=await setup(db);await f.review();await f.approve();
    const out=await build({entryPoints:['src/app/api/accounting/payroll/route.js'],bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'payroll-http',setup(b){const mocks={auth:'export const authenticateRequest=()=>globalThis.__payrollContext;export const checkOrigin=()=>{};export const apiError=e=>Response.json({error:e.message},{status:e.status||400});',entities:'export const serviceEntities=new Proxy({},{get:(_,key)=>globalThis.__payrollEntities[key]});',db:'export const database=()=>({unsafe:async()=>{}});export const transaction=fn=>globalThis.__payrollTransaction(fn);'};b.onResolve({filter:/^@\/server\/(auth|entities|db)$/},a=>({path:a.path.split('/').at(-1),namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
    const route=await import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));globalThis.__payrollEntities=f.s;globalThis.__payrollContext=f.cashier;globalThis.__payrollTransaction=async fn=>{await db.exec('BEGIN');try{const result=await fn();await db.exec('COMMIT');return result;}catch(e){await db.exec('ROLLBACK');throw e;}};
    const body={action:'pay',lineId:f.line.id,amount:30000,accountId:'till',date,reference:'RECEIPT-ROLLBACK',requestKey:crypto.randomUUID()},post=()=>route.POST(new Request('http://localhost/api/accounting/payroll',{method:'POST',body:JSON.stringify(body)}));
    const before=(await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows,create=f.s.AuditLog.create;
    f.s.AuditLog.create=async input=>{if(input.action==='pay_salary')throw Error('Audit unavailable');return create(input);};assert.equal((await post()).status,400);assert.deepEqual((await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows,before);
    f.s.AuditLog.create=create;assert.equal((await post()).status,200);assert.equal((await post()).status,200);assert.equal((await f.s.Payment.filter({payment_type:'salary_payment'})).length,1);
  }finally{delete globalThis.__payrollEntities;delete globalThis.__payrollContext;delete globalThis.__payrollTransaction;await db.close();}
});


const monthEnd=period=>new Date(Date.UTC(Number(period.slice(0,4)),Number(period.slice(5,7)),0)).toISOString().slice(0,10);
const nextPeriod=period=>new Date(Date.UTC(Number(period.slice(0,4)),Number(period.slice(5,7)),1)).toISOString().slice(0,7);
const atNoon=day=>new Date(day+'T12:00:00Z').getTime();
const allState=async stores=>Object.fromEntries(await Promise.all(['PayrollRun','PayrollLine','Payment','TreasuryAccount','TreasuryTransaction','Account','JournalEntry','JournalLine','AuditLog'].map(async name=>[name,await stores[name].list()])));
async function reviewAll(f){
 for(const line of await f.s.PayrollLine.filter({payroll_id:f.run.id}))await f.call({action:'reviewLine',runId:f.run.id,lineId:line.id,revision:(await f.s.PayrollRun.get(f.run.id)).payroll_revision,changes:{base_salary:line.base_salary,allowances:0,variable_pay:0,unpaid_time_amount:0,statutory_deductions:0,other_deductions:0,adjustment_reason:'Monthly contract and attendance evidence checked',adjustment_reference:'MONTHLY-REVIEW-SHEET',statutory_reviewed:true}});
}

test('approving earned payroll accrues expense and employee payable without any salary payment or treasury outflow',async()=>{
 const f=await setup(),s=f.s;await f.review();
 const before={treasury:await s.TreasuryAccount.list(),transactions:await s.TreasuryTransaction.list(),payments:await s.Payment.list(),cash:await s.Account.get('till-gl')};
 const approved=await f.approve();assert.equal(approved.status,'posted');assert.equal((await s.Account.get(f.wages.id)).balance,100000);assert.equal((await s.Account.get(f.payable.id)).balance,100000);
 assert.deepEqual(await s.TreasuryAccount.list(),before.treasury);assert.deepEqual(await s.TreasuryTransaction.list(),before.transactions);assert.deepEqual(await s.Payment.list(),before.payments);assert.deepEqual(await s.Account.get('till-gl'),before.cash);
 const snapshot=await allState(s),view=await payrollWorkspace(s,f.cashier,approved.id);assert.equal(view.run.total_paid,0);assert.equal(view.run.total_outstanding,100000);assert.equal(view.lines[0].amount_paid,0);assert.equal(view.lines[0].outstanding_amount,100000);assert.deepEqual(await allState(s),snapshot,'viewing unpaid payroll must not post a payment or another expense');
});

test('individual salary installments in a later month settle two employee liabilities without expensing payroll again',async t=>{
 const earned=date.slice(0,7),accrualDate=monthEnd(earned),paymentPeriod=nextPeriod(earned);t.mock.timers.enable({apis:['Date'],now:new Date(accrualDate+'T12:00:00Z')});
 const f=await setup(),s=f.s,second=await s.Employee.create({full_name:'Second employee',base_salary:60000,role:'employee',status:'active'});
 await f.call({action:'recalculate',runId:f.run.id,revision:f.run.payroll_revision});await reviewAll(f);
 await s.TreasuryAccount.update('till',{balance:200000});await s.Account.update('till-gl',{balance:200000});
 if(paymentPeriod.slice(0,4)!==earned.slice(0,4))await s.AccountingPeriod.create({start_date:paymentPeriod.slice(0,4)+'-01-01',end_date:paymentPeriod.slice(0,4)+'-12-31',status:'open'});
 const approved=await f.approve({accrualDate}),lines=await s.PayrollLine.filter({payroll_id:f.run.id}),firstLine=lines.find(line=>line.employee_id==='cashier'),secondLine=lines.find(line=>line.employee_id===second.id);
 assert.equal(approved.payroll_posted_date,accrualDate);assert.equal((await s.Account.get(f.wages.id)).balance,160000);assert.equal((await s.Account.get(f.payable.id)).balance,160000);assert.equal((await s.TreasuryAccount.get('till')).balance,200000);
 let clock=atNoon(accrualDate);
 for(const [day,lineId,amount] of [[paymentPeriod+'-01',firstLine.id,30000],[paymentPeriod+'-05',secondLine.id,20000],[paymentPeriod+'-15',firstLine.id,70000]]){
  const next=atNoon(day);t.mock.timers.tick(next-clock);clock=next;await f.pay(amount,{lineId,date:day});
  assert.equal((await s.Account.get(f.wages.id)).balance,160000,'an installment must never recognize salary expense again');
 }
 const view=await payrollWorkspace(s,gm,f.run.id),first=view.lines.find(line=>line.id===firstLine.id),other=view.lines.find(line=>line.id===secondLine.id);
 assert.equal(first.amount_paid,100000);assert.equal(first.outstanding_amount,0);assert.equal(other.amount_paid,20000);assert.equal(other.outstanding_amount,40000);assert.equal(view.run.total_paid,120000);assert.equal(view.run.total_outstanding,40000);assert.equal((await s.Account.get(f.payable.id)).balance,40000);assert.equal((await s.TreasuryAccount.get('till')).balance,80000);assert.equal((await s.Account.get('till-gl')).balance,80000);
 const journals=await s.JournalEntry.list(),accrual=journals.filter(journal=>journal.source_document_type==='PayrollRun'),settlements=journals.filter(journal=>journal.source_document_type==='PayrollPayment');assert.equal(accrual.length,1);assert.equal(accrual[0].entry_date,accrualDate);assert.deepEqual(settlements.map(journal=>journal.entry_date).sort(),[paymentPeriod+'-01',paymentPeriod+'-05',paymentPeriod+'-15']);
 const settlementIds=new Set(settlements.map(journal=>journal.id)),postingLines=(await s.JournalLine.list()).filter(line=>settlementIds.has(line.journal_id));assert.equal(postingLines.length,6);assert.ok(postingLines.every(line=>[f.payable.id,'till-gl'].includes(line.account_id)));assert.equal(postingLines.filter(line=>line.account_id===f.payable.id).reduce((sum,line)=>sum+line.debit,0),120000);
 await f.approve({accrualDate});assert.equal((await s.JournalEntry.list()).filter(journal=>journal.source_document_type==='PayrollRun').length,1);assert.equal((await s.Account.get(f.wages.id)).balance,160000);
});

test('prior-month expense recognition uses an explicit earned-month accrual date while payments wait for actual approval',async t=>{
 const earned=date.slice(0,7),accrualDate=monthEnd(earned),approvalDate=nextPeriod(earned)+'-05';t.mock.timers.enable({apis:['Date'],now:new Date(approvalDate+'T12:00:00Z')});
 const f=await setup();await f.review();
 if(approvalDate.slice(0,4)!==earned.slice(0,4))await f.s.AccountingPeriod.create({start_date:approvalDate.slice(0,4)+'-01-01',end_date:approvalDate.slice(0,4)+'-12-31',status:'open'});
 const before=await allState(f.s);await assert.rejects(f.approve(),/accrual|earned|payroll month/i);assert.deepEqual(await allState(f.s),before);await assert.rejects(f.approve({accrualDate:approvalDate}),/accrual|earned|payroll month/i);assert.deepEqual(await allState(f.s),before);
 const approved=await f.approve({accrualDate});assert.equal(approved.payroll_posted_date,accrualDate);assert.equal(approved.payroll_approval_date,approvalDate);assert.equal(approved.approved_at.slice(0,10),approvalDate);assert.equal((await f.s.JournalEntry.get(approved.journal_id)).entry_date,accrualDate);
 const afterApproval=await allState(f.s);await assert.rejects(f.pay(1000,{date:accrualDate}),/valid date|approval/i);assert.deepEqual(await allState(f.s),afterApproval);await assert.rejects(f.pay(1000,{date:approvalDate.slice(0,7)+'-04'}),/valid date|approval/i);assert.deepEqual(await allState(f.s),afterApproval);
 await f.pay(1000,{date:approvalDate});assert.equal((await f.s.Account.get(f.wages.id)).balance,100000);assert.equal((await f.s.Account.get(f.payable.id)).balance,99000);
});

test('invalid, future, wrong-month and closed-period accrual choices cannot post payroll',async t=>{
 const earned=date.slice(0,7),approvalDate=earned+'-10';t.mock.timers.enable({apis:['Date'],now:new Date(approvalDate+'T12:00:00Z')});
 const f=await setup();await f.review();let before=await allState(f.s);
 for(const accrualDate of [earned+'-32',earned+'-11',nextPeriod(earned)+'-01','not-a-date']){await assert.rejects(f.approve({accrualDate}),/accrual|date|earned|payroll month/i);assert.deepEqual(await allState(f.s),before);}
 await f.s.AccountingPeriod.update('period',{status:'closed'});before=await allState(f.s);await assert.rejects(f.approve({accrualDate:approvalDate}),/open accounting period/);assert.deepEqual(await allState(f.s),before);
 const futurePeriod=nextPeriod(earned),future=await setup(undefined,{month:Number(futurePeriod.slice(5,7)),year:Number(futurePeriod.slice(0,4))});await future.review();before=await allState(future.s);await assert.rejects(future.approve(),/accrual|future|earned|payroll month/i);await assert.rejects(future.approve({accrualDate:futurePeriod+'-01'}),/accrual|future|date/i);assert.deepEqual(await allState(future.s),before);
});

test('competing HTTP salary installments serialize under the payroll lock and cannot overpay the remaining employee liability',async()=>{
 const db=new PGlite();try{
  const f=await setup(db);await f.review();await f.approve();
  const out=await build({entryPoints:['src/app/api/accounting/payroll/route.js'],bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'payroll-competing-http',setup(b){const mocks={auth:'export const authenticateRequest=()=>globalThis.__payrollCompetition.context;export const checkOrigin=()=>{};export const apiError=e=>Response.json({error:e.message},{status:e.status||400});',entities:'export const serviceEntities=new Proxy({},{get:(_,key)=>globalThis.__payrollCompetition.stores[key]});',db:'export const database=()=>({unsafe:async(sql,args)=>{globalThis.__payrollCompetition.locks.push({sql,args});}});export const transaction=fn=>globalThis.__payrollCompetition.transaction(fn);'};b.onResolve({filter:/^@\/server\/(auth|entities|db)$/},a=>({path:a.path.split('/').at(-1),namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
  const route=await import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));let tail=Promise.resolve();
  globalThis.__payrollCompetition={context:f.cashier,stores:f.s,locks:[],transaction:fn=>{const result=tail.then(async()=>{await db.exec('BEGIN');try{const value=await fn();await db.exec('COMMIT');return value;}catch(error){await db.exec('ROLLBACK');throw error;}});tail=result.catch(()=>{});return result;}};
  const bodies=['A','B'].map(reference=>({action:'pay',lineId:f.line.id,amount:70000,date,accountId:'till',reference:'COMPETING-INSTALLMENT-'+reference,requestKey:crypto.randomUUID()})),post=body=>route.POST(new Request('http://localhost/api/accounting/payroll',{method:'POST',body:JSON.stringify(body)}));
  const responses=await Promise.all(bodies.map(post)),results=await Promise.all(responses.map(response=>response.json()));assert.deepEqual(responses.map(response=>response.status).sort(),[200,409]);assert.equal((await f.s.Payment.filter({payment_type:'salary_payment'})).length,1);assert.equal((await f.s.Account.get(f.payable.id)).balance,30000);assert.equal((await f.s.TreasuryAccount.get('till')).balance,30000);assert.equal((await f.s.Account.get(f.wages.id)).balance,100000);
  assert.equal(globalThis.__payrollCompetition.locks.length,2);assert.ok(globalThis.__payrollCompetition.locks.every(lock=>/pg_advisory_xact_lock/.test(lock.sql)&&lock.args[0]==='payroll-workspace'));
  const accepted=responses.findIndex(response=>response.status===200);assert.equal(results[accepted].outstanding_amount,30000);const retry=await post(bodies[accepted]);assert.equal(retry.status,200);assert.equal((await retry.json()).reused,true);assert.equal((await f.s.Payment.filter({payment_type:'salary_payment'})).length,1);
 }finally{delete globalThis.__payrollCompetition;await db.close();}
});
