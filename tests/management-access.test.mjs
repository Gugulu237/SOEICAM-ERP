import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogueFromStored, decorateEmployee, validateRoleProfile } from '../src/server/domain/role-catalogue.js';
import { assertEntityAccess, recordScope, guardMutation } from '../src/server/access.js';
import { canOpenFieldPath } from '../src/lib/permissions.js';
import { ACCOUNTING_REPORT_PATHS } from '../src/lib/management-access.js';
import { modulesForRole } from '../src/lib/appModules.js';
import { accountPosition } from '../src/server/domain/account-position.js';
import { cashFlowReport } from '../src/server/domain/cash-flow.js';
import { saveManualJournal } from '../src/server/domain/manual-journals.js';
import { companySalesAction } from '../src/server/domain/company-sales.js';
import { fixture, user, date } from './helpers/cashier.mjs';

test('management defaults include Sales, Accounting and Expenses; a later explicit module removal remains effective',()=>{
  const catalogue=catalogueFromStored();
  for(const key of ['admin','production_manager','supply_chain_manager'])for(const module of ['sales','accounting','expenses'])assert.ok(catalogue.roles[key].modules.includes(module),key+':'+module);
  const legacy=catalogueFromStored({roles:{production_manager:{...catalogue.roles.production_manager,modules:['manufacturing'],module_permissions_version:2}}});
  assert.ok(legacy.roles.production_manager.modules.includes('accounting'));
  const profile=validateRoleProfile({...catalogue.roles.production_manager,key:'production_manager',category:'Management',modules:['manufacturing']});
  assert.deepEqual(catalogueFromStored({roles:{production_manager:profile}}).roles.production_manager.modules,['manufacturing']);
  assert.ok(!catalogue.roles.warehouse_manager.modules.includes('accounting'));
});

test('management navigation exposes reporting and expense requests without journal entry or sales-entry routes',()=>{
  const catalogue=catalogueFromStored();
  for(const [role,key] of [['production_manager','production_manager'],['warehouse_manager','supply_chain_manager']]){
    const modules=modulesForRole(role,catalogue.roles[key].modules);
    for(const path of ['/sales','/accounting','/expenses'])assert.ok(modules.some(m=>m.path===path));
    for(const path of ACCOUNTING_REPORT_PATHS)assert.equal(canOpenFieldPath(role,path),true);
    for(const path of ['/accounting/journals/new','/accounting/payments/new','/accounting/assets','/sales/new'])assert.equal(canOpenFieldPath(role,path),false);
  }
});

test('management reads only posted journal data; reports do not grant accounting writes or payroll access',async()=>{
  const {entities:s}=await fixture(),catalogue=catalogueFromStored();
  const posted=await s.JournalEntry.create({status:'posted',entry_date:date}),draft=await s.JournalEntry.create({status:'draft',entry_date:date});
  for(const key of ['production_manager','supply_chain_manager']){
    const employee=decorateEmployee(user,{id:'manager',role:key,status:'active'},catalogue),role=employee.access_template,context={user,employee,role};
    for(const entity of ['Account','JournalEntry','JournalLine'])assert.equal(assertEntityAccess(context,entity,'filter'),role);
    assert.deepEqual(await recordScope(context,'JournalEntry','filter',s),{status:'posted'});
    const scope=await recordScope(context,'JournalLine','filter',s);assert.ok(scope.journal_id.$in.includes(posted.id));assert.ok(!scope.journal_id.$in.includes(draft.id));
    for(const entity of ['Account','JournalEntry','JournalLine','TreasuryAccount','PayrollRun'])assert.throws(()=>assertEntityAccess(context,entity,'create'));
    await assert.rejects(saveManualJournal(s,context,{status:'posted'}),/accounting|Accountant|accountant|restricted|permitted/i);
  }
});

test('authorized management runs account position, cash-flow and company sales reads; revoked modules and ordinary warehouse roles remain blocked',async()=>{
  const f=await fixture(),s=f.entities;
  for(const account of await s.Account.list())if(account.account_number==='1050')await s.Account.update(account.id,{account_type:'asset',normal_balance:'debit'});
  for(const [role,assigned_role] of [['production_manager','production_manager'],['warehouse_manager','supply_chain_manager']]){
    await s.Employee.update('cashier',{role,assigned_role,allowed_modules:['sales','accounting','expenses']});
    assert.ok((await accountPosition(f.client,user)).accounts.length>0);
    const cash=await cashFlowReport(f.client,user,{from:date,to:date});assert.ok(Array.isArray(cash.history));
    const sales=await companySalesAction(f.client,user,{from:date,to:date});assert.equal(sales.totals.count,0);
    await s.Employee.update('cashier',{allowed_modules:['expenses']});await assert.rejects(accountPosition(f.client,user),/restricted/);
  }
  await s.Employee.update('cashier',{role:'warehouse_manager',assigned_role:'warehouse_manager',allowed_modules:['inventory','expenses']});await assert.rejects(accountPosition(f.client,user),/restricted/);
});

test('management expense requests cannot be self-approved, reassigned to bypass approval, or marked as paid',()=>{
  const context={user,role:'production_manager',employee:{id:'manager',role:'production_manager',status:'active',allowed_modules:['expenses']}},own={id:'expense',requester_id:'manager',status:'pending_approval',amount:5000};
  assert.doesNotThrow(()=>guardMutation(context,'ExpenseRequest','create',{title:'Delivery fuel',amount:5000,status:'pending_approval'}));
  assert.throws(()=>guardMutation(context,'ExpenseRequest','create',{amount:5000,status:'approved'}),/draft or submitted/);
  assert.throws(()=>guardMutation(context,'ExpenseRequest','create',{amount:-1,status:'draft'}),/positive/);
  assert.throws(()=>guardMutation(context,'ExpenseRequest','update',{status:'approved'},own),/own expense request/);
  assert.throws(()=>guardMutation(context,'ExpenseRequest','update',{requester_id:'someone-else'},own),/cannot be reassigned/);
  assert.throws(()=>guardMutation(context,'ExpenseRequest','update',{status:'paid'},own),/Cashier workflow/);
  assert.doesNotThrow(()=>guardMutation(context,'ExpenseRequest','update',{status:'approved',approved_by:'Operations'}, {...own,requester_id:'other-staff'}));
});
