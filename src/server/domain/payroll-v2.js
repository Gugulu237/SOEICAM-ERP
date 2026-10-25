import {canUseTreasury,assertTreasuryAccess,visibleTreasuryDocuments} from '../../lib/treasury-access.js';
import {payrollEmployeeData,employeePayrollChanged,payrollHierarchy} from './payroll-employees.js';
import { createHash } from 'node:crypto';
import { requireActiveContext, forbidden } from '../access.js';
import { assertModule } from './role-catalogue.js';
import { readRecords } from './commercial-workspace.js';
import { round2, postJournal, today } from './field-ops.js';
import { PAYSLIP_MONEY_FIELDS, payslipAmounts, payrollMoney } from '../../lib/payroll-values.js';

const hash=value=>createHash('sha256').update(JSON.stringify(value,(_,v)=>v && typeof v==='object' && !Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v)).digest('hex');
const label=context=>context.employee?.full_name || context.user.full_name || context.user.email || context.user.id;
const openStatuses=['draft','calculated','under_review'];
function access(context,write=false) {
  const role=requireActiveContext(context);
  if(!['admin','cashier'].includes(role) || write && role!=='admin')throw forbidden(write?'Payroll adjustment and approval require the General Manager.':'Payroll is restricted to the General Manager and Cashier.');
  assertModule({...context,role},'payroll');return role;
}
const text=(v,name,max=1000)=>{if(typeof v!=='string' || v.trim().length<3 || v.trim().length>max)throw Error('Enter '+name+'.');return v.trim();};
const active=a=>a && a.is_active!==false && a.is_posting!==false;
const conflict=message=>Object.assign(Error(message),{status:409});
function revision(run,body) {if(!Number.isInteger(body.revision) || body.revision!==Number(run.payroll_revision || 0))throw conflict('Payroll changed in another window. Reload the payslips before continuing.');}
async function period(stores,date) {
  const periods=await readRecords(stores.AccountingPeriod,{start_date:{$lte:date},end_date:{$gte:date}});
  if(!periods.length || periods.some(p=>p.status!=='open'))throw Error('An open accounting period is required for this payroll date.');
}
const total=lines=>({employee_count:lines.length,total_gross:round2(lines.reduce((n,l)=>n+Number(l.gross_pay || 0),0)),total_deductions:round2(lines.reduce((n,l)=>n+Number(l.statutory_deductions || 0)+Number(l.other_deductions || 0)+Number(l.loan_repayment || 0)+Number(l.salary_advance || 0),0)),total_net:round2(lines.reduce((n,l)=>n+Number(l.net_pay || 0),0))});
async function paymentsFor(stores,runId) {return readRecords(stores.Payment,{payment_type:'salary_payment',payroll_run_id:runId,status:'posted'});}
function settlement(lines,payments) {
  const result=lines.map(line=>{
    const paid=round2(payments.filter(p=>p.payroll_line_id===line.id).reduce((n,p)=>n+payrollMoney(p.amount),0)),net=payrollMoney(line.net_pay ?? 0);
    if(paid>net)throw Error('An employee payroll balance needs payment reconciliation.');
    return {...line,amount_paid:paid,outstanding_amount:round2(net-paid),payment_status:paid===net?'paid':paid>0?'partially_paid':'unpaid'};
  });
  return {lines:result,total_paid:round2(result.reduce((n,l)=>n+l.amount_paid,0)),total_outstanding:round2(result.reduce((n,l)=>n+l.outstanding_amount,0))};
}
export async function payrollWorkspace(stores,context,runId='') {
  const role=access(context),query=role==='admin'?{}:{status:'posted'};
  const runs=(await stores.PayrollRun.filter(query,'-created_date',100)).filter(r=>role==='admin' || r.payroll_workflow_version===2);
  const run=runId?await stores.PayrollRun.get(runId):runs[0];
  if(runId && (!run || role!=='admin' && (run.status!=='posted' || run.payroll_workflow_version!==2)))throw forbidden('Choose an approved payroll run.');
  const [lines,payments,treasury,accounts,history,staff]=await Promise.all([
    run?readRecords(stores.PayrollLine,{payroll_id:run.id}):[],run?paymentsFor(stores,run.id):[],
    readRecords(stores.TreasuryAccount),readRecords(stores.Account),
    run?stores.AuditLog.filter({module:'payroll',entity_id:run.id},'-created_date',40):[],payrollEmployeeData(stores),
  ]);
  const paid=settlement(lines,payments),treasuryIds=new Set(treasury.map(t=>t.gl_account_id));
  paid.lines=paid.lines.map(line=>{const current=staff.byId.get(line.employee_id)?.snapshot;return {...line,employee_role:current?.employee_role||line.employee_role,employee_role_label:current?.employee_role_label||line.employee_role_label,employee_role_rank:current?.employee_role_rank??line.employee_role_rank,employee_current_name:current?.employee_name||line.employee_name,employee_current_base_salary:current?.employee_source_base_salary??line.employee_source_base_salary,employee_current_fingerprint:current?.employee_source_fingerprint,employee_data_changed:employeePayrollChanged(line,current)};}).sort(payrollHierarchy);

  return {role,runs,employee_count:staff.rows.length,run:run?{...run,total_paid:paid.total_paid,total_outstanding:paid.total_outstanding}:null,lines:paid.lines,payments:visibleTreasuryDocuments(role,payments,treasury).map(p=>role==='admin'?p:({...p,receipt_posting_snapshot:undefined})),
    treasury_accounts:treasury.filter(t=>canUseTreasury(role,t) && t.is_active===true && ['cash','petty_cash','bank','mobile_money'].includes(t.account_type)).map(t=>({id:t.id,name:t.name,account_type:t.account_type,balance:t.balance})),
    accounts:accounts.filter(a=>active(a) && !treasuryIds.has(a.id) && !a.is_treasury && a.account_number!=='1050' && ['asset','liability'].includes(a.account_type)).map(a=>({id:a.id,name:a.name,account_number:a.account_number,account_type:a.account_type})),
    history:history.filter(e=>e.audit_source!=='client_reported').map(e=>({id:e.id,action:e.action,description:e.description,reason:e.reason,user_id:e.user_id,user_name:e.user_name,created_date:e.created_date}))};
}
async function log(stores,context,run,action,description,extra={}) {
  await stores.AuditLog.create({action,module:'payroll',entity_type:'PayrollRun',entity_id:run.id,user_id:context.user.id,user_name:label(context),actor_employee_id:context.employee?.id || '',description,...extra});
}
async function bookPayroll(stores,context,run,body) {
  if(run.status==='posted') {
    const journal=run.journal_id && await stores.JournalEntry.get(run.journal_id);
    if(!journal || journal.status!=='posted' || journal.source_document_id!==run.id)throw Error('This payroll posting needs reconciliation.');
    return run;
  }
  revision(run,body);
  if(![...openStatuses,'approved'].includes(run.status))throw Error('Only reviewed, unposted payroll can be approved.');
  const lines=await readRecords(stores.PayrollLine,{payroll_id:run.id});
  if(!lines.length || lines.length!==Number(run.employee_count) || lines.some(l=>!l.payroll_reviewed_by || !l.payroll_reviewed_at || l.payroll_review_revision!==l.payroll_line_revision))throw Error('Open, review and save every employee payslip before approval.');
  for(const l of lines){const calculated=payslipAmounts(l);if(calculated.gross_pay!==Number(l.gross_pay) || calculated.net_pay!==Number(l.net_pay) || Number(l.loan_repayment || 0) || Number(l.salary_advance || 0))throw Error('The reviewed payslip amounts do not reconcile.');}
  const currentStaff=await payrollEmployeeData(stores);
  if(lines.some(line=>employeePayrollChanged(line,currentStaff.byId.get(line.employee_id)?.snapshot)))throw conflict('Employee information changed. Update this payroll from employees and review the affected payslips before approval.');
  const totals=total(lines);
  if(['employee_count','total_gross','total_deductions','total_net'].some(k=>Number(run[k])!==totals[k]) || totals.total_gross<=0)throw Error('Payroll totals changed. Review the employee payslips again.');
  const date=today();await period(stores,date);
  const [accounts,treasury]=await Promise.all([readRecords(stores.Account),readRecords(stores.TreasuryAccount)]);
  const expense=accounts.find(a=>a.account_number==='6100'),payable=accounts.find(a=>a.account_number==='4200'),treasuryIds=new Set(treasury.map(t=>t.gl_account_id));
  if(!active(expense) || !active(payable) || expense.account_type!=='expense' || payable.account_type!=='liability' || expense.normal_balance!=='debit' || payable.normal_balance!=='credit' || treasuryIds.has(expense.id) || treasuryIds.has(payable.id))throw Error('Configure active posting accounts 6100 (salary expense) and 4200 (employee salaries payable).');
  const postings=[];
  const entry=(a,debit,credit,l,description)=>({account_id:a.id,account_number:a.account_number,account_name:a.name,debit,credit,party_type:'employee',party_id:l.employee_id,description:l.employee_name+' — '+description});
  for(const l of lines) {
    postings.push(entry(expense,l.gross_pay,0,l,'Earned salary '+run.period_name),entry(payable,0,l.net_pay,l,'Net salary payable '+run.period_name));
    for(const [field,idField,allowedTypes] of [['statutory_deductions','statutory_payable_account_id',['liability']],['other_deductions','other_deduction_account_id',['asset','liability']]])if(Number(l[field])>0) {
      const a=accounts.find(a=>a.id===l[idField]);
      if(!active(a) || a.id===payable.id || treasuryIds.has(a.id) || a.is_treasury || a.account_number==='1050' || !allowedTypes.includes(a.account_type) || a.normal_balance!==(a.account_type==='asset'?'debit':'credit'))throw Error('Choose active non-cash deduction accounts separate from salaries payable for every withholding.');
      postings.push(entry(a,0,l[field],l,field==='statutory_deductions'?'Statutory withholding':'Authorized deduction / recovery'));
    }
  }
  const existing=await stores.JournalEntry.filter({source_document_id:run.id,status:'posted'},'id',1);
  if(existing.length)throw Error('This payroll already has a journal. Reconcile the earlier posting before approval.');
  const {journal}=await postJournal({entities:stores},{entryDate:date,description:`Payroll ${run.period_name}`,sourceModule:'payroll',sourceDocumentType:'PayrollRun',sourceDocumentId:run.id,userId:context.user.id,lines:postings});
  const now=new Date().toISOString();
  for(const l of lines)await stores.PayrollLine.update(l.id,{status:'approved',payroll_approved_by:context.user.id,payroll_approved_name:label(context),payroll_approved_at:now,payroll_payable_account_id:payable.id,amount_paid:0,outstanding_amount:l.net_pay});
  const saved=await stores.PayrollRun.update(run.id,{status:'posted',payroll_workflow_version:2,approved_by:context.user.id,approved_by_name:label(context),approved_at:now,payroll_posted_date:date,payroll_payable_account_id:payable.id,journal_id:journal.id,total_paid:0,total_outstanding:totals.total_net,payment_status:totals.total_net?'unpaid':'paid',payroll_revision:Number(run.payroll_revision || 0)+1});
  await log(stores,context,saved,'approve_payroll',`Approved reviewed payslips and recorded ${totals.total_net} XAF employee payable for ${run.period_name}`,{payroll_approved_line_ids:lines.map(l=>l.id),journal_id:journal.id});
  return saved;
}
async function paySalary(stores,context,body) {
  const role=access(context);
  if(role!=='cashier')throw forbidden('Only the Cashier can record salary payments after GM approval.');
  assertModule(context,'cashier');
  if(!/^[\w-]{16,80}$/.test(body.requestKey || ''))throw Error('Reopen the salary payment form for a valid save reference.');
  const key=context.user.id+':'+body.requestKey,payload=hash(body),previous=(await stores.Payment.filter({payroll_payment_key:key},'id',1))[0];
  if(previous){assertTreasuryAccess(role,await stores.TreasuryAccount.get(previous.treasury_account_id));if(previous.payroll_payment_payload!==payload)throw conflict('This salary payment reference belongs to different details.');return {payment:previous,reused:true};}
  const line=await stores.PayrollLine.get(String(body.lineId || '')),run=line && await stores.PayrollRun.get(line.payroll_id);
  if(!run || run.status!=='posted' || run.payroll_workflow_version!==2 || !run.approved_by || !line.payroll_approved_by || !run.journal_id)throw Error('Choose a GM-approved payslip with a recorded employee payable. Legacy postings require accounting reconciliation.');
  const source=await stores.JournalEntry.get(run.journal_id);
  if(source?.status!=='posted' || source.source_document_id!==run.id)throw Error('The approved payroll journal needs reconciliation.');
  const amount=payrollMoney(body.amount),date=String(body.date || today()),reference=text(body.reference,'the payment receipt or transfer reference',200);
  if(amount<=0 || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date || date>today() || date<run.payroll_posted_date)throw Error('Choose a positive payment and a valid date on or after payroll approval, no later than today.');
  await period(stores,date);
  const paid=settlement([line],await paymentsFor(stores,run.id)).lines[0];
  if(amount>paid.outstanding_amount)throw conflict('This payment exceeds the employee outstanding salary. Reload the payslip.');
  const account=await stores.TreasuryAccount.get(String(body.accountId || '')),cash=account && await stores.Account.get(account.gl_account_id),payable=await stores.Account.get(run.payroll_payable_account_id);
  assertTreasuryAccess(role,account);
  if(!account || account.is_active!==true || !['cash','petty_cash','bank','mobile_money'].includes(account.account_type) || !active(cash) || cash.account_type!=='asset' || cash.normal_balance!=='debit' || !active(payable) || payable.account_type!=='liability' || payable.normal_balance!=='credit' || line.payroll_payable_account_id!==payable.id || cash.id===payable.id)throw Error('Choose an active treasury account with its own cash/bank asset account and a valid salary payable account.');
  if(amount>payrollMoney(account.balance) || amount>payrollMoney(cash.balance))throw Error('Insufficient available funds in the selected treasury account. You can record a smaller partial payment.');
  const referenceKey=hash([line.id,account.id,reference.toUpperCase()]);
  if((await stores.Payment.filter({payroll_reference_key:referenceKey,status:'posted'},'id',1)).length)throw conflict('This receipt or transfer reference was already used for this employee payslip.');
  const now=new Date().toISOString(),number='SAL-'+crypto.randomUUID().slice(0,12).toUpperCase();
  const payment=await stores.Payment.create({payment_number:number,payment_type:'salary_payment',party_type:'employee',party_id:line.employee_id,party_name:line.employee_name,payment_date:date,amount,status:'posted',payment_method:account.account_type==='bank'?'bank_transfer':account.account_type==='mobile_money'?'mobile_money':'cash',treasury_account_id:account.id,treasury_account_name:account.name,account_id:cash.id,reference,payroll_run_id:run.id,payroll_line_id:line.id,payroll_payment_key:key,payroll_payment_payload:payload,payroll_reference_key:referenceKey,prepared_by:context.user.id,prepared_at:now,posted_by:context.user.id,posted_at:now,payroll_cashier_employee_id:context.employee.id,payroll_cashier_name:label(context)});
  const posted=await postJournal({entities:stores},{entryDate:date,description:`Salary payment ${run.period_name} — ${line.employee_name} / ${reference}`,sourceModule:'payroll',sourceDocumentType:'PayrollPayment',sourceDocumentId:payment.id,userId:context.user.id,lines:[{account_id:payable.id,account_number:payable.account_number,account_name:payable.name,debit:amount,credit:0,party_type:'employee',party_id:line.employee_id},{account_id:cash.id,account_number:cash.account_number,account_name:cash.name,debit:0,credit:amount}]});
  if(posted.reused)throw Error('The salary payment journal already exists. Reconcile this payment.');
  const tx=await stores.TreasuryTransaction.create({transaction_number:'TRX-'+crypto.randomUUID().slice(0,12).toUpperCase(),treasury_account_id:account.id,treasury_account_name:account.name,transaction_type:'expense',amount,transaction_date:date,description:`Salary ${run.period_name} — ${line.employee_name}`,reference,source:'payroll',source_document_id:payment.id,source_document_number:number,journal_id:posted.journal.id,payee:line.employee_name,payroll_run_id:run.id,payroll_line_id:line.id,created_by:context.user.id});
  await stores.TreasuryAccount.update(account.id,{balance:round2(Number(account.balance)-amount)});
  const saved=await stores.Payment.update(payment.id,{journal_id:posted.journal.id,treasury_transaction_id:tx.id});
  const state=settlement(await readRecords(stores.PayrollLine,{payroll_id:run.id}),await paymentsFor(stores,run.id));
  const current=state.lines.find(l=>l.id===line.id);
  await stores.PayrollLine.update(line.id,{amount_paid:current.amount_paid,outstanding_amount:current.outstanding_amount,status:current.outstanding_amount?'approved':'paid'});
  await stores.PayrollRun.update(run.id,{total_paid:state.total_paid,total_outstanding:state.total_outstanding,payment_status:state.total_outstanding===0?'paid':state.total_paid>0?'partially_paid':'unpaid'});
  await log(stores,context,run,'pay_salary',`${label(context)} paid ${amount} XAF to ${line.employee_name}; ${current.outstanding_amount} XAF remains`,{payroll_line_id:line.id,payroll_payment_id:saved.id,reference});
  return {payment:saved,amount_paid:current.amount_paid,outstanding_amount:current.outstanding_amount};
}
export async function payrollAction(stores,context,body) {
  if(!body || typeof body!=='object' || Array.isArray(body))throw Error('Enter a valid payroll request.');
  if(body.action==='pay')return paySalary(stores,context,body);
  access(context,true);
  if(['create','recalculate'].includes(body.action)) {
    const existing=body.action==='recalculate'?await stores.PayrollRun.get(String(body.runId || '')):null;
    if(body.action==='recalculate' && (!existing || !openStatuses.includes(existing.status)))throw Error('Only an unapproved payroll run can be recalculated.');
    if(existing){revision(existing,body);const previous=await readRecords(stores.PayrollLine,{payroll_id:existing.id});if(previous.some(l=>l.payroll_reviewed_by))throw Error('Reviewed payslips retain their adjustments. Edit the payslip instead of recalculating the run.');}
    if(!existing && !/^[\w-]{16,80}$/.test(body.requestKey || ''))throw Error('A valid payroll save reference is required.');
    const month=Number(existing?.month ?? body.month),year=Number(existing?.year ?? body.year);
    if(!Number.isInteger(month) || month<1 || month>12 || !Number.isInteger(year) || year<2000 || year>2200)throw Error('Choose a valid payroll month and year.');
    const period_name=`${year}-${String(month).padStart(2,'0')}`;
    const reused=!existing && (await stores.PayrollRun.filter({payroll_request_key:body.requestKey},'id',1))[0];
    if(reused){if(reused.period_name!==period_name)throw conflict('This save reference belongs to another payroll period.');return reused;}
    if(!existing && (await stores.PayrollRun.filter({period_name},'id',1)).length)throw conflict('A payroll run already exists for this period. Open that run instead.');
    const staff=await payrollEmployeeData(stores),employees=staff.rows.filter(row=>row.employee.status==='active').map(row=>row.employee);
    if(!employees.length)throw Error('Add active employees before calculating payroll.');
    const lines=employees.map(e=>{const base=payrollMoney(e.base_salary ?? 0),values=payslipAmounts({base_salary:base});return {...values,...staff.byId.get(e.id).snapshot,employee_id:e.id,employee_name:e.full_name,requested_base_salary:base,requested_gross_pay:base,requested_net_pay:base,payroll_line_revision:0,status:'calculated'};});
    const changes={period_name,month,year,status:'calculated',...total(lines),payroll_workflow_version:2,payroll_revision:Number(existing?.payroll_revision || 0)+1,approved_by:'',approved_at:'',...(existing?{}:{payroll_request_key:body.requestKey,created_by:context.user.email})};
    const run=existing?await stores.PayrollRun.update(existing.id,changes):await stores.PayrollRun.create(changes);
    if(existing)await stores.PayrollLine.deleteMany({payroll_id:existing.id});
    await stores.PayrollLine.bulkCreate(lines.map(l=>({...l,payroll_id:run.id})));
    await log(stores,context,run,'calculate_payroll',`Prepared salary requests ${period_name}; statutory amounts require individual review`);return run;
  }
  const run=await stores.PayrollRun.get(String(body.runId || ''));if(!run)throw Error('Choose an existing payroll run.');
  if(body.action==='syncEmployees'){
    if(!openStatuses.includes(run.status))throw Error('Approved payroll and salary payments keep their recorded employee information.');
    revision(run,body);
    const staff=await payrollEmployeeData(stores),lines=await readRecords(stores.PayrollLine,{payroll_id:run.id});
    let added=0,updated=0;
    for(const row of staff.rows){
      const {employee,snapshot}=row,line=lines.find(line=>line.employee_id===employee.id),base=payrollMoney(employee.base_salary??0);
      if(!line){if(employee.status!=='active')continue;const values=payslipAmounts({base_salary:base});await stores.PayrollLine.create({...values,...snapshot,employee_id:employee.id,payroll_id:run.id,requested_base_salary:base,requested_gross_pay:base,requested_net_pay:base,payroll_line_revision:0,status:'calculated'});added++;continue;}
      if(line.employee_source_fingerprint===snapshot.employee_source_fingerprint)continue;
      const adjusted=!!(line.payroll_reviewed_by||line.adjustment_reason),values=adjusted?{}:payslipAmounts({base_salary:base});
      await stores.PayrollLine.update(line.id,{...values,...snapshot,requested_base_salary:base,requested_gross_pay:base,requested_net_pay:base,payroll_reviewed_by:'',payroll_reviewed_at:'',payroll_review_revision:null,payroll_line_revision:Number(line.payroll_line_revision||0)+1,status:'calculated'});updated++;
    }
    if(!added&&!updated)return {run,reused:true,added,updated};
    const all=await readRecords(stores.PayrollLine,{payroll_id:run.id}),saved=await stores.PayrollRun.update(run.id,{...total(all),status:'calculated',payroll_workflow_version:2,payroll_revision:Number(run.payroll_revision||0)+1});
    await log(stores,context,saved,'sync_payroll_employees',`Updated payroll from current employee records: ${added} added, ${updated} refreshed. Existing reviewed amounts retained for renewed review.`,{added,updated,retained_employee_ids:lines.filter(line=>!staff.byId.has(line.employee_id)||staff.byId.get(line.employee_id).employee.status!=='active').map(line=>line.employee_id)});
    return {run:saved,added,updated};
  }
  if(body.action==='reviewLine') {
    if(!openStatuses.includes(run.status))throw Error('Approved payslip amounts are locked. Retain their accounting and payment history.');
    revision(run,body);
    const line=await stores.PayrollLine.get(String(body.lineId || ''));
    const staff=await payrollEmployeeData(stores),source=staff.byId.get(line?.employee_id)?.snapshot;
    if(body.expectedEmployeeFingerprint&&body.expectedEmployeeFingerprint!==source?.employee_source_fingerprint)throw conflict('This employee record changed while the payslip was open. Refresh payroll before reviewing it.');
    if(!line || line.payroll_id!==run.id)throw Error('Choose a payslip belonging to this payroll run.');
    const input=body.changes,fields=[...PAYSLIP_MONEY_FIELDS,'statutory_payable_account_id','other_deduction_account_id','deduction_basis','adjustment_reason','adjustment_reference','attendance_notes','performance_notes','unpaid_days','late_minutes','unpaid_time_eligible','statutory_reviewed'];
    if(!input || typeof input!=='object' || Array.isArray(input) || PAYSLIP_MONEY_FIELDS.some(k=>!Object.hasOwn(input,k)) || Object.keys(input).some(k=>!fields.includes(k)))throw Error('Change only editable payslip details.');
    const values=payslipAmounts(input),reason=text(input.adjustment_reason,'a payslip review or adjustment explanation'),reference=text(input.adjustment_reference,'a contract, attendance or payroll evidence reference',200);
    if(input.statutory_reviewed!==true)throw Error('Confirm the statutory deduction amount against the applicable payroll calculation, including zero when appropriate.');
    if(values.unpaid_time_amount>0 && (input.unpaid_time_eligible!==true || !String(input.attendance_notes || '').trim()))throw Error('Validate unpaid working time and its evidence. Approved or protected leave is not an absence deduction.');
    if(values.other_deductions>0 && (!['advance_recovery','loan_repayment','court_order','other_statutory'].includes(input.deduction_basis) || !input.other_deduction_account_id))throw Error('Choose the documented legal recovery/withholding basis and its ledger account. Disciplinary fines are not payroll deductions.');
    if(values.statutory_deductions>0 && !input.statutory_payable_account_id)throw Error('Choose the statutory deductions payable account.');
    const unpaidDays=payrollMoney(input.unpaid_days ?? 0),lateMinutes=payrollMoney(input.late_minutes ?? 0);
    const calendarDays=new Date(Date.UTC(Number(run.year),Number(run.month),0)).getUTCDate();
    if(unpaidDays>calendarDays || lateMinutes>calendarDays*24*60 || !Number.isInteger(lateMinutes))throw Error('Enter valid attendance days and whole late minutes for this month.');
    for(const key of ['attendance_notes','performance_notes'])if(typeof (input[key] ?? '')!=='string' || String(input[key] || '').length>2000)throw Error('Keep attendance and performance notes under 2,000 characters.');
    const next=Number(line.payroll_line_revision || 0)+1,now=new Date().toISOString();
    const changes={...values,...(source||{}),loan_repayment:0,salary_advance:0,statutory_payable_account_id:input.statutory_payable_account_id || '',other_deduction_account_id:input.other_deduction_account_id || '',deduction_basis:input.deduction_basis || '',adjustment_reason:reason,adjustment_reference:reference,attendance_notes:input.attendance_notes || '',performance_notes:input.performance_notes || '',unpaid_days:unpaidDays,late_minutes:lateMinutes,unpaid_time_eligible:input.unpaid_time_eligible===true,statutory_reviewed:true,payroll_line_revision:next,payroll_review_revision:next,payroll_reviewed_by:context.user.id,payroll_reviewed_name:label(context),payroll_reviewed_at:now,status:'calculated',requested_base_salary:line.requested_base_salary ?? line.base_salary,requested_gross_pay:line.requested_gross_pay ?? line.gross_pay,requested_net_pay:line.requested_net_pay ?? line.net_pay};
    const saved=await stores.PayrollLine.update(line.id,changes),all=await readRecords(stores.PayrollLine,{payroll_id:run.id});
    const updated=await stores.PayrollRun.update(run.id,{...total(all),status:'calculated',payroll_revision:Number(run.payroll_revision || 0)+1,payroll_workflow_version:2});
    await log(stores,context,run,'review_payslip',`Reviewed ${line.employee_name}: ${saved.net_pay} XAF net`,{reason,payroll_line_id:line.id,reference,payroll_before_values:line,payroll_after_values:saved});return {line:saved,run:updated};
  }
  if(body.action==='reject') {
    if(![...openStatuses,'approved'].includes(run.status))throw Error('Only unposted payroll can be returned for correction.');revision(run,body);
    if(run.journal_id || (await stores.JournalEntry.filter({source_document_id:run.id,status:'posted'},'id',1)).length || (await paymentsFor(stores,run.id)).length)throw Error('This payroll has accounting or payment history and cannot be reopened.');
    const reason=text(body.reason,'a payroll rejection reason');
    for(const line of await readRecords(stores.PayrollLine,{payroll_id:run.id}))await stores.PayrollLine.update(line.id,{payroll_reviewed_by:'',payroll_reviewed_at:'',payroll_review_revision:null});
    const saved=await stores.PayrollRun.update(run.id,{status:'draft',approved_by:'',approved_at:'',notes:reason,payroll_revision:Number(run.payroll_revision || 0)+1});
    await log(stores,context,run,'reject_payroll',`Returned ${run.period_name} for correction`,{reason});return saved;
  }
  if(['approve','post'].includes(body.action))return bookPayroll(stores,context,run,body);
  throw Error('Unsupported payroll action.');
}
