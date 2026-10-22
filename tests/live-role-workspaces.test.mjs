import test from 'node:test';
import assert from 'node:assert/strict';
import { employeeWorkspaceAction } from '../src/server/domain/employee-workspace.js';
import { catalogueFromStored } from '../src/server/domain/role-catalogue.js';

function fixture(employee, records = {}, catalogue = catalogueFromStored(null)) {
  const reads = [];
  const client = { entities:{Employee:{filter:async () => employee ? [employee] : []}}, auth:{ staff:async () => employee,roleCatalogue:async () => catalogue },asServiceRole:{entities:new Proxy({}, {get:(_,name) => ({
    filter:async filter => { reads.push({name,filter}); return records[name] || []; },
    get:async id => (records[name] || []).find(row => row.id === id),
  })})} };
  return {client,reads};
}

test('GM opens the live Operations department without a sample employee', async () => {
  const {client,reads} = fixture(null,{ProductionOrder:[{id:'batch',order_number:'PR-1',status:'in_production'}]});
  const result = await employeeWorkspaceAction(client,{id:'gm',role:'admin'},{action:'employeeDashboard',mode:'production_manager'});
  assert.equal(result.orders[0].id,'batch');
  assert.equal(result.isExample,undefined);
  assert.equal(result.employee,null);
  assert.equal(result.template,'production_manager');
  assert.ok(reads.some(r => r.name === 'ProductionOrder'));
  assert.ok(!reads.some(r => ['PayrollRun','TreasuryAccount'].includes(r.name)));
});

test('Operations module restrictions prevent private table reads even with a forged mode', async () => {
  const employee = {id:'pm',role:'production_manager',status:'active',allowed_modules:['manufacturing']};
  const {client,reads} = fixture(employee,{ProductionOrder:[{id:'batch',product_id:'product'}],Product:[{id:'product',name:'Finished product'}]});
  const result = await employeeWorkspaceAction(client,{id:'login',role:'user'},{action:'employeeDashboard',mode:'admin'});
  assert.equal(result.mode,'production_manager');
  assert.deepEqual(reads.map(r => r.name),['ProductionOrder','Product']);
  assert.deepEqual(result.cheques,[]);
  assert.deepEqual(result.riskLots,[]);
});

test('custom roles get a live workspace derived from the saved template and modules', async () => {
  const catalogue = catalogueFromStored({roles:{production_assistant:{label:'Production Assistant',template_role:'warehouse_manager',modules:['manufacturing']}}});
  const employee = {id:'assistant',role:'production_assistant',assigned_role:'production_assistant',access_template:'warehouse_manager',allowed_modules:['manufacturing'],status:'active'};
  const {client,reads} = fixture(employee,{ProductionOrder:[{id:'batch',status:'materials_issued'}]},catalogue);
  const result = await employeeWorkspaceAction(client,{id:'login',role:'user'},{action:'employeeDashboard',mode:'admin'});
  assert.equal(result.mode,'production_assistant');
  assert.equal(result.roleLabel,'Production Assistant');
  assert.equal(result.orders.length,1);
  assert.deepEqual(reads.map(r => r.name),['ProductionOrder']);
  reads.length = 0;
  await assert.rejects(employeeWorkspaceAction(client,{id:'login',role:'user'},{action:'employeeDashboard',employeeId:'another'}),/own workspace/);
  assert.equal(reads.length,0);
});

test('warehouse purchases preserve approval and own-department scope; expenses stay personal', async () => {
  const employee = {id:'warehouse',role:'warehouse_manager',status:'active',department_id:'store',allowed_modules:['purchases','expenses']};
  const {client,reads} = fixture(employee,{PurchaseOrder:[
    {id:'approved',status:'approved'}, {id:'own',status:'draft',requested_by_id:'warehouse'},
    {id:'department',status:'draft',requested_department_id:'store'}, {id:'private',status:'draft',requested_by_id:'another'},
  ]});
  const result = await employeeWorkspaceAction(client,{id:'login',role:'user'},{action:'employeeDashboard'});
  assert.deepEqual(result.purchaseOrders.map(r => r.id),['approved','own','department']);
  assert.equal(reads.find(r => r.name === 'ExpenseRequest').filter.requester_id,employee.id);
});

test('Procurement and general staff have distinct scopes; disabled field roles fail before reads', async () => {
  for (const role of ['procurement','employee']) {
    const employee = {id:'staff',role,status:'active',allowed_modules:['purchases']};
    const {client} = fixture(employee,{PurchaseOrder:[{id:'other',status:'draft',requested_by_id:'other'},{id:'own',status:'draft',requested_by_id:'staff'}]});
    const result = await employeeWorkspaceAction(client,{id:'login',role:'user'},{action:'employeeDashboard'});
    assert.equal(result.template,role);
    assert.equal(result.purchaseOrders.length,role === 'procurement' ? 2 : 1);
  }
  const {client,reads} = fixture({id:'driver',role:'driver',status:'active',allowed_modules:[]});
  await assert.rejects(employeeWorkspaceAction(client,{id:'login',role:'user'},{action:'employeeDashboard'}),/disabled/);
  assert.equal(reads.length,0);
});

test('GM driver review requires a matching employee, without falling back to sample data', async () => {
  const {client,reads} = fixture(null,{Employee:[{id:'not-driver',role:'commercial'}]});
  const result = await employeeWorkspaceAction(client,{id:'gm',role:'admin'},{action:'employeeDashboard',mode:'driver'});
  assert.equal(result.employee,null);
  assert.equal(result.isExample,undefined);
  assert.deepEqual(reads.map(r => r.name),['Employee']);
  await assert.rejects(employeeWorkspaceAction(client,{id:'gm',role:'admin'},{action:'employeeDashboard',mode:'driver',employeeId:'not-driver'}),/matching role/);
});
