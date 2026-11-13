import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,date} from './helpers/cashier.mjs';
import {staff,driver,user} from './helpers/commercial-supply.mjs';
import {salesOrderAction} from '../src/server/domain/sales-orders.js';
import {commercialAction} from '../src/server/domain/commercial-workspace.js';
import {employeeWorkspaceAction} from '../src/server/domain/employee-workspace.js';
import {commercialSnapshot} from '../src/lib/employee-dashboard.js';
import {dailySupplySummary} from '../src/lib/commercial-daily.js';
import {reconcileDailyCash} from '../src/lib/cash-settlement.js';

const admin={id:'gm',role:'admin',full_name:'General Manager'};
async function setup(){
  const f=await fixture();
  f.rows.Employee.push({...staff,commission_rate_percent:10},structuredClone(driver));
  f.rows.CashCollection.splice(0);f.rows.CashHandover.splice(0);f.rows.CashHandoverAllocation.splice(0);
  Object.assign(f.rows.Customer[0],{acquired_by_id:staff.id,acquired_by_name:staff.full_name,acquisition_date:date,acquisition_verified:'verified_unique'});
  await f.entities.CompanySettings.update('settings',{next_invoice_number:1,company_name:'Fixture Company'});
  const create=f.entities.AuditLog.create;
  f.entities.AuditLog.create=async value=>{
    if(!value.id)return create(value);
    const row={...structuredClone(value),audit_source:'server_verified'};f.rows.AuditLog.push(row);return structuredClone(row);
  };
  const result=await salesOrderAction(f.client,admin,{action:'recordSuppliedOrder',requestKey:crypto.randomUUID(),receiptReference:'RCPT-ADMIN',sourceType:'issued',dispatchId:'run-a',sellerId:staff.id,customerId:'customer-a',date,paymentType:'cash',expectedTotal:1000,lines:[{product_id:'product-a',quantity:2,unit_price:500,discount_pct:0}]});
  f.client.entities.Employee.filter=async()=>[f.rows.Employee.find(employee=>employee.id===staff.id)];
  return {...f,result};
}

test('an administrator-recorded Commercial order feeds daily, performance and dashboard totals once without FieldSale cash handovers',async()=>{
  const f=await setup(),order=f.result.order;
  assert.equal(f.rows.FieldSale.length,0,'delegated entry creates no FieldSale record');
  assert.equal(f.rows.CashCollection.length,0,'invoice cash remains in the existing cashier-confirmation workflow');
  const field={id:order.id,sale_number:'FIELD-1',commercial_id:staff.id,commercial_name:staff.full_name,customer_id:'customer-a',customer_name:'Customer A',transaction_date:date,status:'approved_posted',subtotal:500,total:500,payment_type:'cash',amount_collected:500,amount_due:0};
  // IDs can coincide across source tables without merging or duplicating sales.
  f.rows.FieldSale.push(field);f.rows.FieldSaleLine.push({id:'field-line',field_sale_id:field.id,product_id:'product-a',product_name:'YOLA',quantity:1,unit:'ea'});
  const before=structuredClone(f.rows);
  const daily=await commercialAction(f.client,user,{action:'commercialDailySupplies',date});
  assert.equal(daily.sales.length,2);assert.deepEqual(new Set(daily.sales.map(sale=>sale.source_type)),new Set(['FieldSale','SalesOrder']));
  const projected=daily.sales.find(sale=>sale.source_type==='SalesOrder');
  assert.equal(projected.id,'SalesOrder:'+order.id);assert.equal(projected.source_id,order.id);assert.equal(projected.invoice_id,f.result.invoiceId);
  assert.equal(dailySupplySummary(daily.sales,date).approved,1500);assert.equal(daily.lines.find(line=>line.sale_id===projected.id).quantity,2);
  const performance=await commercialAction(f.client,user,{action:'commercialPerformance',from:date,to:date});
  assert.equal(performance.agents.find(agent=>agent.id===staff.id).total,1500);
  assert.equal(performance.agents.find(agent=>agent.id===staff.id).deliveries,2);
  assert.equal(performance.supplies[0].products[0].quantity,3);
  const dashboard=await employeeWorkspaceAction(f.client,user,{action:'employeeDashboard',mode:'commercial'});
  const snapshot=commercialSnapshot(dashboard);
  assert.equal(snapshot.today,1500);assert.equal(snapshot.month,1500);assert.equal(snapshot.commission.eligibleNet,1338.57);assert.equal(snapshot.commission.salesEstimate,133.86);
  assert.deepEqual(dashboard.cashDays,reconcileDailyCash([],[],[field]),'order projections never enter FieldSale reconciliation');
  assert.equal(snapshot.cash,0);assert.deepEqual(f.rows,before,'all report reads are side-effect free');
  assert.equal(JSON.stringify({daily,performance,dashboard}).includes('unit_cost'),false);
  await assert.rejects(commercialAction(f.client,user,{action:'commercialDailySupplies',commercialId:'another-agent',date}),/own commercial/);
});

test('all-agent performance preserves verified Commercial attribution after that employee changes role',async()=>{
  const f=await setup();
  const report=()=>commercialAction(f.client,admin,{action:'commercialPerformance',from:date,to:date});
  assert.equal((await report()).agents.find(agent=>agent.id===staff.id).total,1000);
  Object.assign(f.rows.Employee.find(employee=>employee.id===staff.id),{role:'employee',access_template:'employee'});
  const changed=await report();
  assert.equal(changed.agents.find(agent=>agent.id===staff.id).total,1000,'the recorded seller role survives later job changes');
  assert.equal(changed.agents.find(agent=>agent.id===staff.id).full_name,staff.full_name);
  assert.equal(changed.agents.find(agent=>agent.id===admin.id),undefined,'the recorder receives no Commercial performance credit');
});
