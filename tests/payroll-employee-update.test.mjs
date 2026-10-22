import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,date} from './helpers/cashier.mjs';
import {payrollAction,payrollWorkspace} from '../src/server/domain/payroll-workspace.js';
import {canOpenFieldPath} from '../src/lib/permissions.js';
import {moduleForPath} from '../src/server/domain/role-catalogue.js';
import {modulesForRole,APP_MODULES} from '../src/lib/appModules.js';
const gm={user:{id:'gm',role:'admin',email:'gm@example.test'},role:'admin'};
async function setup(){
 const f=await fixture(),s=f.entities;await s.Employee.update('cashier',{full_name:'Idelle',role:'warehouse_manager',base_salary:125000});
 const call=body=>payrollAction(s,gm,body),run=await call({action:'create',requestKey:crypto.randomUUID(),month:Number(date.slice(5,7)),year:Number(date.slice(0,4))}),line=(await s.PayrollLine.filter({payroll_id:run.id}))[0];
 const revision=async()=>(await s.PayrollRun.get(run.id)).payroll_revision;
 const review=async()=>call({action:'reviewLine',runId:run.id,lineId:line.id,revision:await revision(),changes:{base_salary:120000,allowances:0,variable_pay:0,unpaid_time_amount:0,statutory_deductions:0,other_deductions:0,adjustment_reason:'Reviewed current contract and attendance',adjustment_reference:'STAFF-PAYROLL-SHEET',statutory_reviewed:true}});
 return {...f,s,call,run,line,revision,review};
}
test('payroll uses current employee roles and salaries, includes each employee once and defaults to hierarchy order',async()=>{
 const f=await fixture(),s=f.entities;await s.Employee.update('cashier',{full_name:'Idelle',role:'cashier',base_salary:125000,staff_role_assignments:[{role_key:'warehouse_manager',from_date:'2026-01-01',notes:'Rotating'}]});
 for(const [id,name,role,salary] of [['host','Hostesse','hotesse',50000],['pm','Operations','production_manager',200000],['boss','Manager','admin',300000]])await s.Employee.create({id,full_name:name,role,base_salary:salary,status:'active'});
 const run=await payrollAction(s,gm,{action:'create',requestKey:crypto.randomUUID(),month:Number(date.slice(5,7)),year:Number(date.slice(0,4))}),data=await payrollWorkspace(s,gm,run.id);
 assert.deepEqual(data.lines.map(line=>line.employee_role),['admin','production_manager','cashier','hotesse']);
 assert.equal(data.lines.filter(line=>line.employee_id==='cashier').length,1);assert.equal(data.lines.find(line=>line.employee_id==='cashier').requested_base_salary,125000);
});
test('employee changes flag an unapproved payslip; syncing preserves GM adjustments and requires renewed review',async()=>{
 const f=await setup();await f.review();await f.s.Employee.update('cashier',{role:'cashier',base_salary:130000});
 let data=await payrollWorkspace(f.s,gm,f.run.id);assert.equal(data.lines[0].employee_data_changed,true);assert.equal(data.lines[0].employee_role,'cashier');assert.equal(data.lines[0].net_pay,120000);
 await assert.rejects(f.call({action:'approve',runId:f.run.id,revision:await f.revision()}),/Employee information changed/);
 await f.s.Employee.create({id:'new-person',full_name:'New Production Assistant',role:'employee',base_salary:60000,status:'active'});
 const result=await f.call({action:'syncEmployees',runId:f.run.id,revision:await f.revision()});assert.equal(result.added,1);assert.equal(result.updated,1);
 data=await payrollWorkspace(f.s,gm,f.run.id);const line=data.lines.find(line=>line.employee_id==='cashier');
 assert.equal(line.requested_base_salary,130000);assert.equal(line.base_salary,120000);assert.equal(line.net_pay,120000);assert.equal(line.payroll_reviewed_by,'');assert.equal(line.employee_data_changed,false);assert.equal(data.lines.length,2);
 const retry=await f.call({action:'syncEmployees',runId:f.run.id,revision:await f.revision()});assert.equal(retry.reused,true);assert.equal((await f.s.PayrollLine.filter({payroll_id:f.run.id})).length,2);
});
test('unreviewed salary requests refresh from employees while posted payroll and payments remain unchanged',async()=>{
 const f=await setup();await f.s.Employee.update('cashier',{base_salary:140000});await f.call({action:'syncEmployees',runId:f.run.id,revision:await f.revision()});
 let line=await f.s.PayrollLine.get(f.line.id);assert.equal(line.base_salary,140000);assert.equal(line.requested_base_salary,140000);
 await f.s.PayrollRun.update(f.run.id,{status:'posted'});const original=await f.s.PayrollLine.get(f.line.id),payments=await f.s.Payment.filter({});
 await f.s.Employee.update('cashier',{base_salary:150000,role:'cashier'});await payrollWorkspace(f.s,gm,f.run.id);
 assert.deepEqual(await f.s.PayrollLine.get(f.line.id),original);assert.deepEqual(await f.s.Payment.filter({}),payments);
 await assert.rejects(f.call({action:'syncEmployees',runId:f.run.id,revision:await f.revision()}),/Approved payroll/);
});
test('employee changes made while a payslip is open cannot be acknowledged using an older employee fingerprint',async()=>{
 const f=await setup(),data=await payrollWorkspace(f.s,gm,f.run.id);await f.s.Employee.update('cashier',{base_salary:130000});
 await assert.rejects(f.call({action:'reviewLine',runId:f.run.id,lineId:f.line.id,revision:await f.revision(),expectedEmployeeFingerprint:data.lines[0].employee_current_fingerprint,changes:{}}),{status:409});
});
test('Payroll lives in Employee Dashboard and Cashier access remains limited to that section',()=>{
 const path='/team-workspaces?section=payroll';assert.equal(moduleForPath(path),'payroll');assert.equal(canOpenFieldPath('cashier',path),true);assert.equal(canOpenFieldPath('cashier','/team-workspaces?section=people'),false);assert.equal(canOpenFieldPath('cashier','/team-workspaces?section=roles'),false);assert.equal(canOpenFieldPath('commercial',path),false);
 assert.equal(APP_MODULES.some(module=>module.key==='payroll'),false);assert.ok(modulesForRole('cashier',['cashier','payroll']).some(module=>module.key==='team_workspaces'&&module.path===path));assert.ok(modulesForRole('admin',null).some(module=>module.key==='team_workspaces'));
});
