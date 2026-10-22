import test from 'node:test';
import assert from 'node:assert/strict';
import { employeeWorkspaceAction } from '../src/server/domain/employee-workspace.js';

function fixture(role = 'driver') {
  const user = { id:role+'-login', role:role === 'admin' ? 'admin' : 'user' };
  const employee = { id:role === 'driver' ? 'assigned-driver' : role+'-staff', user_id:user.id, full_name:role, role, status:'active' };
  const run = { id:'run', dispatch_number:'RUN-1', driver_id:'assigned-driver', status:'loaded' };
  const activities = [], writes = [];
  const entities = {
    Employee:{ filter:async () => [employee] },
    Dispatch:{
      get:async id => id === run.id ? run : null,
      updateMany:async (query, changes) => {
        assert.equal(query.id,run.id); assert.equal(query.driver_id,employee.id);
        assert.equal(query.status,'loaded');
        writes.push({entity:'Dispatch',changes}); Object.assign(run,changes.$set);
      },
    },
    DriverActivity:{
      filter:async query => { assert.equal(query.dispatch_id,run.id); return activities; },
      upsert:async rows => {
        writes.push({entity:'DriverActivity',rows});
        const activity={id:'departure',...rows[0]}; activities.push(activity);
        return {records:[activity],created:1};
      },
    },
  };
  const client = { entities,asServiceRole:{entities} };
  const body = { action:'driverActivity', dispatchId:run.id, type:'trip_started', requestKey:'12345678-1234-1234-1234-123456789abc' };
  return {user,employee,run,activities,writes,client,body};
}

test('only assigned driver departure records the actual authenticated reporter and timestamp, once', async () => {
  const f=fixture();
  const result=await employeeWorkspaceAction(f.client,f.user,f.body);
  assert.equal(f.run.status,'in_transit');
  assert.match(f.run.departure_date,/^\d{4}-\d\d-\d\dT/);
  assert.equal(result.activity.driver_id,f.employee.id);
  assert.equal(result.activity.recorded_by,f.user.id);
  assert.equal(result.activity.recorded_at,f.run.departure_date);
  assert.equal(f.writes.length,2);
  const retry=await employeeWorkspaceAction(f.client,f.user,f.body);
  assert.equal(retry.reused,true); assert.equal(f.writes.length,2); assert.equal(f.activities.length,1);
});

test('GM or management cannot create the driver departure by providing the assigned employee ID', async () => {
  for(const role of ['admin','warehouse_manager','production_manager','cashier','procurement','employee']) {
    const f=fixture(role);
    await assert.rejects(employeeWorkspaceAction(f.client,f.user,{...f.body,employeeId:'assigned-driver',driverId:'assigned-driver',mode:'driver'}),/Only the assigned active driver/);
    assert.equal(f.run.status,'loaded'); assert.equal(f.writes.length,0);
  }
  const custom=fixture('warehouse_manager');
  custom.employee.role='supply_chain_manager';custom.employee.access_template='warehouse_manager';
  await assert.rejects(employeeWorkspaceAction(custom.client,custom.user,{...custom.body,employeeId:'assigned-driver',mode:'driver'}),/Only the assigned active driver/);
  assert.equal(custom.writes.length,0);
  const f=fixture(); f.run.driver_id='another-driver';
  await assert.rejects(employeeWorkspaceAction(f.client,f.user,f.body),/not assigned to you/);
  assert.equal(f.writes.length,0);
});
