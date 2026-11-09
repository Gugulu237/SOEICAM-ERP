import test from 'node:test';
import assert from 'node:assert/strict';
import {commissionMonth,customerCommissionModel,verifiedCommissionSales,customerCommissionAction} from '../src/server/domain/customer-commission-report.js';
import {guardEmployeeAttribution,authenticatedRecordChanges} from '../src/server/domain/employee-action-access.js';
import {registrationData} from '../src/server/domain/commercial-rules.js';
import {fixture,user,date as currentDate} from './helpers/cashier.mjs';
import {FEATURE_AUTHORITY} from '../src/server/domain/roles.js';

const period=commissionMonth('2026-11','2026-11-09');
const staff=[{id:'owner-a',full_name:'Acquisition owner',commission_rate_percent:5,new_customer_bonus:200},{id:'owner-b',full_name:'Another owner'}];
const acquired=(id,extra={})=>({id,business_name:'Customer '+id,acquired_by_id:'owner-a',acquisition_date:'2026-11-02',acquisition_verified:'verified_unique',...extra});
const sale=(id,customerId,net,total=net,extra={})=>({id,customer_id:customerId,date:'2026-11-03',net,total,salesperson_id:'different-seller',salesperson_name:'Different salesperson',is_reversal:false,...extra});
function sourceFixture(){return {accounts:[{id:'revenue',account_type:'revenue'},{id:'cash',account_type:'asset'},{id:'tax',account_type:'liability'}],invoices:[],fieldSales:[],journals:[],journalLines:[]};}
function document(f,id,{type='Invoice',net=100,total=120,tax=20,day='2026-11-03',...extra}={}){
 const row={id,customer_id:'customer-a',customer_name:'Customer A',subtotal:net,tax_total:tax,total,journal_id:'j-'+id,...(type==='Invoice'?{invoice_date:day,status:'posted',invoice_number:'INV-'+id,salesperson_id:'seller-b'}:{transaction_date:day,status:'approved_posted',sale_number:'FS-'+id,commercial_id:'seller-b'}),...extra};
 f[type==='Invoice'?'invoices':'fieldSales'].push(row);
 f.journals.push({id:row.journal_id,status:'posted',entry_date:day,source_module:type==='Invoice'?'sales':'field_sales',source_document_type:type,source_document_id:id,total_debit:total,total_credit:total});
 const specs=[['cash',total,0],['revenue',0,net],...(tax?[['tax',0,tax]]:[])];
 for(const [account_id,debit,credit] of specs)f.journalLines.push({id:id+'-'+account_id,journal_id:row.journal_id,status:'posted',account_id,debit,credit});
 return row;
}

test('monthly customer commissions follow the acquisition owner across sellers and use net sales after discount excluding tax',()=>{
 const customers=[acquired('a'),acquired('old',{acquisition_date:'2026-09-01'}),acquired('other',{acquired_by_id:'owner-b'}),acquired('unknown',{acquired_by_id:'',registered_by_id:'legacy-user'}),acquired('branch',{acquired_by_id:'',parent_id:'a'})];
 const model=customerCommissionModel({employees:staff,customers,sales:[sale('1','a',900,1080),sale('2','old',100,120),sale('3','other',500,600),sale('4','unknown',800),sale('5','branch',100)],...period}),a=model.agents.find(row=>row.id==='owner-a');
 assert.equal(a.total_customers,2);assert.equal(a.registered_customers,1);assert.equal(a.verified_new_customers,1);assert.equal(a.net_sales,1000);assert.equal(a.total_sales,1200);assert.equal(a.eligible_net_sales,1000);assert.equal(a.commission_estimate,50);assert.equal(a.customer_bonus_estimate,200);assert.equal(a.estimated_total,250);
 assert.equal(model.unassigned_customers,2);assert.equal(model.sales[0].salesperson_id,'different-seller');assert.equal(model.sales[0].agent_id,'owner-a');assert.equal(model.is_estimate,true);assert.equal(model.basis,'net_sales');
});

test('immutable registrar employee snapshots link new customers without borrowing mutable assignments or branch ownership',()=>{
 const customers=[acquired('snapshot',{acquired_by_id:'',registered_employee_id:'owner-a'}),acquired('explicit',{acquired_by_id:'owner-b',registered_employee_id:'owner-a'}),acquired('unproven',{acquired_by_id:'',registered_by_id:'owner-a',salesperson_id:'owner-a'})];
 const model=customerCommissionModel({employees:staff,customers,sales:customers.map(c=>sale(c.id,c.id,100)),...period});
 assert.equal(model.agents.find(a=>a.id==='owner-a').net_sales,100);assert.equal(model.agents.find(a=>a.id==='owner-b').net_sales,100);assert.equal(model.unassigned_customers,1);
});

test('frozen per-sale acquisition snapshots preserve the original beneficiary including an explicit unassigned snapshot',()=>{
 const customer=acquired('a',{acquired_by_id:'owner-b'}),model=customerCommissionModel({employees:staff,customers:[customer],sales:[sale('frozen','a',100,100,{acquisition_agent_id:'owner-a'}),sale('blank','a',500,500,{acquisition_agent_id:''}),sale('legacy','a',200)],...period});
 const a=model.agents.find(r=>r.id==='owner-a'),b=model.agents.find(r=>r.id==='owner-b');assert.equal(a.net_sales,100);assert.equal(a.registered_customers,0);assert.equal(a.total_customers,0);assert.equal(b.net_sales,200);assert.equal(b.registered_customers,1);
 const historical=model.customers.find(c=>c.agent_id==='owner-a');assert.equal(historical.historical_only,true);assert.equal(historical.registered_this_month,false);assert.notEqual(historical.report_key,model.customers.find(c=>c.agent_id==='owner-b').report_key);
});

test('duplicate and rejected acquisition remains visible but cannot earn a customer bonus or sales commission',()=>{
 const customers=[acquired('duplicate',{acquisition_verified:'duplicate'}),acquired('rejected',{acquisition_verified:'rejected'}),acquired('pending',{acquisition_verified:'pending'})],model=customerCommissionModel({employees:staff,customers,sales:customers.map(c=>sale(c.id,c.id,100)),...period}),a=model.agents.find(r=>r.id==='owner-a');
 assert.equal(a.registered_customers,3);assert.equal(a.net_sales,300);assert.equal(a.eligible_net_sales,100);assert.equal(a.verified_new_customers,0);assert.equal(a.estimated_total,5);
});

test('configured zero, missing and invalid rates remain distinct and commission rounding is exact for signed cent totals',()=>{
 const employees=[{id:'a',commission_rate_percent:50},{id:'b',commission_rate_percent:0,new_customer_bonus:0},{id:'c'},{id:'d',commission_rate_percent:101}],customers=employees.map(e=>acquired(e.id,{acquired_by_id:e.id}));
 const report=customerCommissionModel({employees,customers,sales:[sale('tiny','a',0.01),sale('zero','b',100),sale('unknown','c',100)],...period});
 assert.equal(report.agents.find(a=>a.id==='a').commission_estimate,0.01);assert.equal(report.agents.find(a=>a.id==='b').estimated_total,0);assert.equal(report.agents.find(a=>a.id==='b').configured,true);assert.equal(report.agents.find(a=>a.id==='c').estimated_total,null);assert.equal(report.agents.find(a=>a.id==='d').configured,false);assert.match(report.agents.find(a=>a.id==='d').configuration_error,/Review/);
 const reverse=customerCommissionModel({employees:[employees[0]],customers:[customers[0]],sales:[sale('reverse','a',-0.01,-0.01,{is_reversal:true})],...period});assert.equal(reverse.agents[0].commission_estimate,-0.01);
});

test('commission sales require full posted source journals and revenue amounts rather than document status alone',()=>{
 const f=sourceFixture();document(f,'valid',{sales_supply_acquisition_agent_id:'owner-a'});const original=structuredClone(f);
 const valid=verifiedCommissionSales({...f,...period});assert.equal(valid.sales.length,1);assert.equal(valid.sales[0].net,100);assert.equal(valid.sales[0].acquisition_agent_id,'owner-a');
 for(const alter of [f=>{f.journals=[];},f=>{f.journalLines.pop();},f=>{f.journals[0].status='draft';},f=>{f.journalLines[0].status='draft';},f=>{f.invoices[0].subtotal=110;},f=>{f.journalLines.find(l=>l.account_id==='revenue').credit=90;f.journalLines.find(l=>l.account_id==='tax').credit=30;},f=>{f.journals.push({...f.journals[0],id:'duplicate-journal'});},f=>{f.invoices[0].sales_supply_acquisition_agent_id=42;}]){const changed=structuredClone(original);alter(changed);const result=verifiedCommissionSales({...changed,...period});assert.equal(result.sales.length,0);assert.equal(result.unverified_sales,1);}
 const opening=structuredClone(original);opening.invoices[0].accounting_source='opening_balances';assert.equal(verifiedCommissionSales({...opening,...period}).sales.length,0);
});

test('linked field invoices do not count a second sale and ambiguous shared journals never inflate commission',()=>{
 const f=sourceFixture(),field=document(f,'field',{type:'FieldSale'});f.invoices.push({id:'linked',field_sale_id:field.id,journal_id:field.journal_id,status:'posted',invoice_date:'2026-11-03',subtotal:100,tax_total:20,total:120});
 let report=verifiedCommissionSales({...f,...period});assert.equal(report.sales.length,1);assert.equal(report.unverified_sales,0);
 f.fieldSales.push({...field,id:'ambiguous'});report=verifiedCommissionSales({...f,...period});assert.equal(report.sales.length,0);assert.equal(report.unverified_sales,2);
});

test('reversals reduce commission in their own month while the original sale remains in its original month',()=>{
 const f=sourceFixture(),invoice=document(f,'old',{day:'2026-10-31'}),original=f.journals[0];invoice.status='credited';invoice.sale_reversal={journal_id:'reversal',date:'2026-11-03',total:120,customer_credit:20,unpaid_cancelled:100};invoice.sale_reversal_date='2026-11-03';original.reversed_by_journal='reversal';
 f.journals.push({id:'reversal',status:'posted',entry_date:'2026-11-03',source_module:'sales',source_document_type:'SaleReversal',source_document_id:original.id,reversal_of:original.id,total_debit:120,total_credit:120});
 for(const line of f.journalLines.filter(l=>l.journal_id===original.id))f.journalLines.push({...line,id:'reversal-'+line.id,journal_id:'reversal',debit:line.credit,credit:line.debit});
 let result=verifiedCommissionSales({...f,...period});assert.equal(result.sales.length,1);assert.equal(result.sales[0].net,-100);assert.equal(result.sales[0].is_reversal,true);
 result=verifiedCommissionSales({...f,...commissionMonth('2026-10','2026-11-09')});assert.equal(result.sales.length,1);assert.equal(result.sales[0].net,100);
 f.journals.at(-1).reversal_of='unrelated';assert.equal(verifiedCommissionSales({...f,...period}).sales.length,0);
});

async function backend(){const f=await fixture(),s=f.entities;await s.Employee.update('cashier',{role:'commercial',commission_rate_percent:5,new_customer_bonus:200});await s.Customer.update('customer-a',{acquired_by_id:'cashier',acquisition_date:currentDate,acquisition_verified:'verified_unique'});const staff=await s.Employee.get('cashier');return {...f,s,staff};}
test('own reports cannot be widened by module grants, caller agent IDs or a feature authority claiming administrator',async()=>{
 const f=await backend(),s=f.s;await s.Employee.create({id:'ignored',user_id:'another',role:'commercial',full_name:'Other',status:'active'});
 const before=structuredClone(f.rows),report=await customerCommissionAction(f.client,user,{action:'customerCommissions',month:currentDate.slice(0,7)});
 assert.equal(report.scope,'own');assert.equal(report.can_view_all,false);assert.equal(report.agents.length,1);assert.equal(report.agents[0].id,'cashier');assert.equal(report.agents[0].registered_customers,1);assert.deepEqual(f.rows,before);
 const elevated={...user,[FEATURE_AUTHORITY]:{role:'admin',module:'sales_reports'}};await assert.rejects(customerCommissionAction(f.client,elevated,{action:'customerCommissions',commercialId:'another'}),{status:403});
 await assert.rejects(customerCommissionAction(f.client,user,{action:'customerCommissions',commercialId:'another'}),{status:403});await s.Employee.update('cashier',{status:'suspended'});await assert.rejects(customerCommissionAction(f.client,user,{action:'customerCommissions'}),{status:403});
});

test('management can inspect all portfolios or a chosen existing employee without creating payables or stock changes',async()=>{
 const f=await backend(),before=structuredClone(f.rows),gm={id:'gm',role:'admin'},all=await customerCommissionAction(f.client,gm,{action:'customerCommissions',month:currentDate.slice(0,7)});
 assert.equal(all.can_view_all,true);assert.equal(all.scope,'all');assert.ok(all.agents.some(a=>a.id==='cashier'));const selected=await customerCommissionAction(f.client,gm,{action:'customerCommissions',commercialId:'cashier'});assert.equal(selected.agents.length,1);assert.equal(selected.selected_agent_id,'cashier');assert.deepEqual(f.rows,before);
 await assert.rejects(customerCommissionAction(f.client,gm,{action:'customerCommissions',commercialId:'missing'}),/existing employee/);
});

test('Supply Chain profiles using the Production Manager template retain Commercial report access without a separate sales-report grant',async()=>{
 const f=await backend(),modules=['commercial','customers','sales','reports'];await f.s.Employee.update('cashier',{role:'supply_chain_manager',access_template:'production_manager',assigned_role:'supply_chain_manager',allowed_modules:modules});
 const checked=[];f.client.auth.assertModule=module=>{checked.push(module);assert.ok(modules.includes(module));};
 const result=await customerCommissionAction(f.client,user,{action:'customerCommissions',commercialId:'cashier'});assert.equal(result.can_view_all,true);assert.equal(result.can_assign_customers,false);assert.deepEqual(checked,['commercial']);
});

test('sales-only employees and inventory warehouse staff can inspect their own commissions without gaining another portfolio',async()=>{
 for(const [role,modules] of [['employee',['sales']],['warehouse_manager',['inventory']],['cashier',['cashier']]]){const f=await backend();await f.s.Employee.update('cashier',{role,allowed_modules:modules});f.client.auth.assertModule=module=>{if(!modules.includes(module))throw Object.assign(Error('Disabled module'),{status:403});};
  const report=await customerCommissionAction(f.client,user,{action:'customerCommissions'});assert.equal(report.scope,'own');assert.equal(report.selected_agent_id,'cashier');assert.equal(report.agents[0].id,'cashier');assert.equal(report.can_view_all,false);await assert.rejects(customerCommissionAction(f.client,user,{action:'customerCommissions',commercialId:'another-person'}),{status:403});
 }
});

test('a manager with only operational inventory access can inspect self but cannot request a global or foreign commission report',async()=>{
 const f=await backend();await f.s.Employee.update('cashier',{role:'production_manager',allowed_modules:['inventory']});f.client.auth.assertModule=module=>{if(module!=='inventory')throw Object.assign(Error('Disabled module'),{status:403});};
 const report=await customerCommissionAction(f.client,user,{action:'customerCommissions',commercialId:'cashier'});assert.equal(report.scope,'own');assert.equal(report.can_view_all,false);assert.equal(report.selected_agent_id,'cashier');
 await assert.rejects(customerCommissionAction(f.client,user,{action:'customerCommissions'}),{status:403});await assert.rejects(customerCommissionAction(f.client,user,{action:'customerCommissions',commercialId:'another-person'}),{status:403});
});

test('native Commercial reports still require their Commercial module and operational fallback propagates unexpected errors',async()=>{
 const f=await backend();f.client.auth.assertModule=module=>{if(module!=='sales')throw Object.assign(Error('Disabled module'),{status:403});};await assert.rejects(customerCommissionAction(f.client,user,{action:'customerCommissions'}),{status:403});
 await f.s.Employee.update('cashier',{role:'employee'});f.client.auth.assertModule=()=>{throw Object.assign(Error('Unexpected authorization failure'),{status:500});};await assert.rejects(customerCommissionAction(f.client,user,{action:'customerCommissions'}),/Unexpected authorization failure/);
 f.client.auth.assertModule=()=>{throw Object.assign(Error('Disabled module'),{status:403});};await assert.rejects(customerCommissionAction(f.client,user,{action:'customerCommissions'}),{status:403});
});

test('the scoped backend finds frozen acquisition sales after a customer changes owner and never substitutes the seller',async()=>{
 const f=await backend(),s=f.s,other=await s.Employee.create({full_name:'Current owner',role:'commercial',status:'active',commission_rate_percent:10});
 await s.Customer.update('customer-a',{acquired_by_id:other.id});
 const invoice=await s.Invoice.create({invoice_number:'INV-COMMISSION',customer_id:'customer-a',customer_name:'Customer A',salesperson_id:other.id,salesperson_name:'Different seller',invoice_date:currentDate,status:'posted',subtotal:100,tax_total:20,total:120,sales_supply_acquisition_agent_id:'cashier',sales_supply_registration_user_id:'original-registrar'});
 const journal=await s.JournalEntry.create({status:'posted',entry_date:currentDate,source_module:'sales',source_document_type:'Invoice',source_document_id:invoice.id,total_debit:120,total_credit:120});await s.Invoice.update(invoice.id,{journal_id:journal.id});
 for(const [account_id,debit,credit] of [['receivable',120,0],['revenue',0,100],['tax',0,20]])await s.JournalLine.create({journal_id:journal.id,status:'posted',account_id,debit,credit});
 const before=structuredClone(f.rows),report=await customerCommissionAction(f.client,user,{action:'customerCommissions',month:currentDate.slice(0,7)}),a=report.agents[0];
 assert.equal(a.id,'cashier');assert.equal(a.total_customers,0);assert.equal(a.net_sales,100);assert.equal(a.commission_estimate,5);assert.equal(a.customer_bonus_estimate,0);assert.equal(report.sales[0].salesperson_id,other.id);assert.equal(report.sales[0].agent_id,'cashier');assert.equal(report.customers[0].historical_only,true);assert.deepEqual(f.rows,before);
 const all=await customerCommissionAction(f.client,{id:'gm',role:'admin'},{action:'customerCommissions',month:currentDate.slice(0,7)});assert.equal(all.agents.find(a=>a.id===other.id).net_sales,0);assert.equal(all.agents.find(a=>a.id==='cashier').net_sales,100);
});

test('server registration links the actual employee and rejects forged or changed registration snapshots',()=>{
 const context={user:{id:'login',role:'user'},employee:{id:'employee',full_name:'Employee'},role:'commercial'},now=new Date().toISOString(),data=registrationData({business_name:'Registered customer',phone:'699123456',gps_lat:3.8,gps_lng:11.5,gps_accuracy_m:5,gps_captured_at:now,registered_employee_id:'forged'},context.employee,context.user.id,now);
 assert.equal(data.registered_by_id,'login');assert.equal(data.registered_employee_id,'employee');assert.equal(data.acquired_by_id,'employee');
 assert.throws(()=>guardEmployeeAttribution(context,'Customer','create',{registered_employee_id:'another'},null),{status:403});assert.throws(()=>guardEmployeeAttribution(context,'Customer','update',{registered_employee_id:'another'},data),{status:403});
 const generic=authenticatedRecordChanges(context,'Customer',{business_name:'Generic'},null);assert.equal(generic.registered_employee_id,'employee');assert.equal(generic.registered_by_id,'login');
});

test('month selection validates real dates, year transitions, current-month cutoff and future periods',()=>{
 assert.equal(commissionMonth('2024-02','2026-11-09').to,'2024-02-29');assert.equal(commissionMonth('2025-12','2026-11-09').to,'2025-12-31');assert.equal(period.to,'2026-11-09');
 for(const month of ['2026-13','2026-00','2026-1','2026-12'])assert.throws(()=>commissionMonth(month,'2026-11-09'));
});
