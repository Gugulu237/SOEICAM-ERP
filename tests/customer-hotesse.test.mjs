import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {fixture,functionRoute,request,date} from './helpers/cashier.mjs';
import {outletAction,hotesseData} from '../src/server/domain/outlet-workspace.js';
import {loadOutletStock} from '../src/server/domain/outlet-stock.js';
import {guardMutation} from '../src/server/access.js';
import {FEATURE_AUTHORITY} from '../src/server/domain/roles.js';

const admin={id:'gm',role:'admin'},login={id:'worker-login',role:'user'};
async function setup(db){
  const f=await fixture(db),s=f.entities;f.client.auth.me=async()=>admin;
  // These records have server-generated stable IDs. Preserve them in the fixture.
  for(const name of ['CustomerLocation','AuditLog']){
    s[name].create=async value=>{const row=structuredClone(value);if(db)await db.query('INSERT INTO fixture_entity VALUES($1,$2,$3)',[name,row.id,JSON.stringify(row)]);else {if(f.rows[name].some(r=>r.id===row.id))throw Error('Duplicate ID');f.rows[name].push(row);}return structuredClone(row);};
    s[name].upsert=async(values,{updateExisting})=>{const records=[];for(const value of values){const existing=await s[name].get(value.id);records.push(existing?(updateExisting===false?existing:await s[name].update(value.id,value)):await s[name].create(value));}return {records};};
  }
  const first=await s.Employee.create({role:'hotesse',status:'active',full_name:'Hotesse One'}),second=await s.Employee.create({role:'hotesse',status:'active',full_name:'Hotesse Two'});
  const body={action:'assignCustomerHotesse',customerId:'customer-a',employeeIds:[first.id],expectedEmployeeIds:[],requestKey:crypto.randomUUID()};
  return {...f,s,first,second,body,call:b=>outletAction(f.client,admin,b)};
}

test('direct customer assignment is attributed, idempotent and rejects stale or altered retries without touching financial stock',async()=>{
  const f=await setup(),before=structuredClone(f.rows.StockBalance),customer=await f.s.Customer.get('customer-a');
  const a=await f.call({...f.body,customer_name:'Forged',hotesse_assignment_by:'forged'});
  assert.equal(a.location.customer_id,customer.id);assert.equal(a.location.customer_reporting_point,true);
  assert.equal(a.location.customer_name,customer.business_name);assert.deepEqual(a.location.assigned_hotesse_ids,[f.first.id]);
  assert.equal((await f.s.CustomerLocation.get(a.location.id)).hotesse_assignment_by,admin.id);
  assert.equal((await f.call(f.body)).reused,true);assert.equal((await f.s.AuditLog.list()).length,1);
  await assert.rejects(f.call({action:'assignHotesse',locationId:a.location.id,employeeIds:[f.second.id]}),/customer assignments/);
  await assert.rejects(f.call({...f.body,employeeIds:[f.second.id]}),/different details/);
  await assert.rejects(f.call({...f.body,requestKey:crypto.randomUUID(),employeeIds:[f.second.id]}),/changed/);
  await f.call({...f.body,requestKey:crypto.randomUUID(),expectedEmployeeIds:[f.first.id],employeeIds:[f.second.id]});
  assert.deepEqual((await f.call(f.body)).location.assigned_hotesse_ids,[f.second.id],'retry never restores old access');
  assert.equal((await f.s.CustomerLocation.list()).length,1);assert.equal((await f.s.AuditLog.list()).length,2);
  assert.deepEqual(f.rows.StockBalance,before);assert.deepEqual(await f.s.Customer.get(customer.id),customer);
  assert.equal((await f.s.JournalEntry.list()).length,0);
});

test('assignment refuses inactive/removed/non-Hotesse staff, unregistered customers and self-assignment including feature grants',async()=>{
  const f=await setup();
  for(const patch of [{status:'inactive'},{employee_removed_at:'removed'},{role:'driver'}]){
    await f.s.Employee.update(f.first.id,{status:'active',employee_removed_at:null,role:'hotesse',...patch});
    await assert.rejects(f.call(f.body),/active Hotesse/);
  }
  await f.s.Employee.update(f.first.id,{status:'active',employee_removed_at:null,role:'hotesse'});
  for(const patch of [{is_active:false},{is_active:true,customer_removed_at:'removed'}]){await f.s.Customer.update('customer-a',patch);await assert.rejects(f.call(f.body),/active registered customer/);}
  await f.s.Customer.update('customer-a',{is_active:true,customer_removed_at:null});
  await assert.rejects(f.call({...f.body,customerId:'unregistered'}),/registered customer/);
  await assert.rejects(f.call({...f.body,employeeIds:[]}),/at least one/);
  await assert.rejects(f.call({...f.body,employeeIds:[f.first.id,f.first.id]}),/valid staff/);
  await assert.rejects(f.call({...f.body,expectedEmployeeIds:null}),/Reload/);
  await assert.rejects(f.call({...f.body,requestKey:'invalid'}),/reference/);
  f.client.entities.Employee.filter=async()=>[f.first];
  for(const user of [login,{...login,[FEATURE_AUTHORITY]:{role:'admin'}}])await assert.rejects(outletAction(f.client,user,f.body),/General Manager/);
  assert.equal((await f.s.CustomerLocation.list()).length,0);assert.equal((await f.s.AuditLog.list()).length,0);
});

test('only the currently assigned Hotesse sees the customer stock and reassignment preserves its reporting identity',async()=>{
  const f=await setup(),a=await f.call(f.body),id=a.location.id;
  await f.s.SalesOrder.create({customer_id:'customer-a',status:'delivered',delivery_date:date}).then(o=>f.s.SalesOrderLine.create({order_id:o.id,product_id:'product-a',quantity:50,delivered_quantity:4,unit:'ea'}));
  const data=await hotesseData({entities:f.s},f.first.id,date);
  assert.equal(data.locations[0].id,id);assert.equal(data.outletProducts[id][0].cumulative_supplied,4);
  await f.call({...f.body,requestKey:crypto.randomUUID(),expectedEmployeeIds:[f.first.id],employeeIds:[f.second.id]});
  assert.equal((await hotesseData({entities:f.s},f.first.id,date)).locations.length,0);
  assert.equal((await hotesseData({entities:f.s},f.second.id,date)).locations[0].id,id);
  f.client.entities.Employee.filter=async()=>[f.first];
  await assert.rejects(outletAction(f.client,login,{action:'submitOutletVisit',locationId:id,requestKey:crypto.randomUUID(),lines:[]}),/not assigned/);
  await f.call({...f.body,requestKey:crypto.randomUUID(),expectedEmployeeIds:[f.second.id],employeeIds:[]});
  assert.equal((await hotesseData({entities:f.s},f.second.id,date)).locations.length,0);
});

test('customer reporting includes its direct and branch-addressed deliveries but never another outlet, draft or customer',async()=>{
  const f=await setup(),a=await f.call(f.body);
  await f.s.Customer.update('customer-a',{parent_id:'billing-parent'});
  const orders=[{customer_id:'customer-a',qty:2},{customer_id:'customer-a',location_id:a.location.id,qty:3},{customer_id:'billing-parent',location_id:'customer-a',qty:4},{customer_id:'customer-a',location_id:'other-shop',qty:500},{customer_id:'other-customer',qty:500},{customer_id:'billing-parent',location_id:'other-branch',qty:500},{customer_id:'customer-a',status:'draft',qty:500}];
  for(const {qty,...attrs} of orders){const o=await f.s.SalesOrder.create({status:'delivered',delivery_date:date,...attrs});await f.s.SalesOrderLine.create({order_id:o.id,product_id:'product-a',quantity:1000,delivered_quantity:qty,unit:'ea'});}
  const stock=await loadOutletStock({entities:f.s},a.location,date);
  assert.equal(stock.products[0].cumulative_supplied,9);assert.equal(stock.deliveries.length,3);
});

test('generic entity writes cannot bypass the checked customer reporting assignment workflow, even as administrator',()=>{
  const context={user:admin,role:'admin'},existing={id:'report',customer_id:'customer-a',customer_reporting_point:true};
  for(const value of [{assigned_hotesse_ids:['worker']},{customer_reporting_point:true},{hotesse_assignment_by:'forged'},{hotesse_assignment_at:'today'},{customer_id:'other'}])assert.throws(()=>guardMutation(context,'CustomerLocation','update',value,existing),/checked Hotesse/);
  assert.throws(()=>guardMutation(context,'CustomerLocation','delete',{},existing),/checked Hotesse/);
});

test('the real HTTP transaction rolls back customer assignment on audit failure, and an identical retry commits once',async()=>{
  const db=new PGlite();try{
    const f=await setup(db),route=await functionRoute(),create=f.s.AuditLog.create;
    globalThis.__cashierClient=f.client;globalThis.__cashierTransaction=async fn=>{await db.exec('BEGIN');try{const result=await fn();await db.exec('COMMIT');return result;}catch(error){await db.exec('ROLLBACK');throw error;}};
    f.s.AuditLog.create=async()=>{throw Error('Simulated audit failure');};
    const call=()=>route(request(f.body),{params:Promise.resolve({name:'fieldOps'})});
    const before=(await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows;
    const failed=await call();assert.equal(failed.status,400);assert.deepEqual((await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows,before);
    f.s.AuditLog.create=create;assert.equal((await call()).status,200);assert.equal((await (await call()).json()).reused,true);
    assert.equal((await f.s.CustomerLocation.list()).length,1);assert.equal((await f.s.AuditLog.list()).length,1);
  }finally{delete globalThis.__cashierClient;delete globalThis.__cashierTransaction;await db.close();}
});
