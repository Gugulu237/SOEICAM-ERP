import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,user,date} from './helpers/cashier.mjs';
import {employeeWorkspaceAction} from '../src/server/domain/employee-workspace.js';
import {distributionControlAction} from '../src/server/domain/distribution-control.js';
import {assertEntityAccess} from '../src/server/access.js';
import {FEATURE_AUTHORITY} from '../src/server/domain/roles.js';
import {distributionSections} from '../src/lib/distribution-navigation.js';

test('team reports and register enumeration require a top admin even with full Distribution module authority',async()=>{
  for(const role of ['driver','commercial','employee','warehouse_manager','production_manager']){
    const f=await fixture();await f.entities.Employee.update('cashier',{role});
    const staff=await f.entities.Employee.get('cashier'),grant={module:'distribution',role:'admin'},actor={...user,[FEATURE_AUTHORITY]:grant};
    const context={user:actor,employee:staff,role:'admin'};
    for(const entity of ['Dispatch','DispatchLine','DispatchRequest','Vehicle','Route'])for(const operation of ['filter','list','count','aggregate'])assert.throws(()=>assertEntityAccess(context,entity,operation),/Only top administrators/);
    await assert.rejects(distributionControlAction(f.client,actor,{action:'distributionControl',date}),/Only top administrators/);
    await assert.rejects(employeeWorkspaceAction(f.client,actor,{action:'dispatchActivity',dispatchId:'run-a'}),/Only top administrators/);
    assert.deepEqual(distributionSections(role).map(s=>s.key),role==='driver'?['deliveries']:[]);
  }
  for(const entity of ['Dispatch','Vehicle','Route'])assert.doesNotThrow(()=>assertEntityAccess({user:{id:'gm',role:'admin'}},entity,'filter'));
  assert.ok(distributionSections('admin').some(s=>s.key==='fleet'));
});

test('driver workspace uses the session identity and never returns another driver run, stock, activity or customer',async()=>{
  const f=await fixture(),s=f.entities;await s.Employee.update('cashier',{role:'driver',full_name:'Assigned Driver'});await s.Dispatch.update('run-a',{driver_id:'cashier'});
  const foreign=await s.Dispatch.create({driver_id:'another-driver',status:'loaded',dispatch_date:date,vehicle_warehouse_id:'foreign-stock',vehicle_name:'Private vehicle'});
  await s.DispatchLine.create({dispatch_id:foreign.id,product_id:'product-a',loaded_quantity:999});
  await s.StockBalance.create({warehouse_id:'foreign-stock',product_id:'product-a',quantity:999,qc_status:'approved'});
  await s.SalesOrder.create({dispatch_id:foreign.id,driver_id:'another-driver',status:'ready',customer_id:'foreign-customer',customer_name:'Private customer'});
  await s.DriverActivity.create({dispatch_id:foreign.id,driver_id:'another-driver',type:'incident',notes:'Private incident'});
  await s.DriverActivity.create({dispatch_id:'run-a',driver_id:'another-driver',type:'incident',notes:'Previous driver incident'});
  const own=await s.DriverActivity.create({dispatch_id:'run-a',driver_id:'cashier',type:'stock_received'});
  const data=await employeeWorkspaceAction(f.client,user,{action:'employeeDashboard',mode:'admin',driverId:'another-driver'});
  assert.equal(data.mode,'driver');assert.equal(data.employee.id,'cashier');assert.deepEqual(data.dispatches.map(r=>r.id),['run-a']);assert.deepEqual(data.activities.map(a=>a.id),[own.id]);
  assert.ok(data.vehicleBalances.every(b=>b.warehouse_id!=='foreign-stock'));assert.doesNotMatch(JSON.stringify(data),/Private vehicle|Private customer|Private incident|Previous driver incident/);
  await assert.rejects(employeeWorkspaceAction(f.client,user,{action:'employeeDashboard',employeeId:'another-driver'}),/own workspace/);
});
