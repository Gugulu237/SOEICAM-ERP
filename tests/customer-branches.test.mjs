import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareCustomerParent} from '../src/server/domain/customer-hierarchy.js';
import {prepareDeliveryDefinition} from '../src/server/domain/customer-delivery.js';
import {fixture,fieldHandler,request,staff} from './helpers/commercial-supply.mjs';
const admin={user:{id:'gm',role:'admin'},role:'admin'};
test('customer hierarchy validates roots, preserves canonical names and blocks nested or circular branch relationships',async()=>{
 const f=fixture(),s=f.client.asServiceRole.entities,main=f.tables.Customer[0];
 const branch={id:'branch',business_name:'Outlet',parent_id:main.id};f.tables.Customer.push(branch,{id:'other',business_name:'Other main',is_active:true});
 assert.deepEqual(await prepareDeliveryDefinition(s,{parent_id:main.id,parent_name:'forged'},null,admin),{parent_id:main.id,parent_name:main.business_name});
 await assert.rejects(prepareCustomerParent(s,{parent_id:main.id},main,admin),/own parent/);
 await assert.rejects(prepareCustomerParent(s,{parent_id:branch.id},null,admin),/active main customer/);
 await assert.rejects(prepareCustomerParent(s,{parent_id:'other'},main,admin),/with branches/);
 await assert.rejects(prepareCustomerParent(s,{parent_id:'missing'},null,admin),/active main customer/);
 main.is_active=false;await assert.rejects(prepareCustomerParent(s,{parent_id:main.id},null,admin),/active main customer/);
 // An unrelated edit of an existing branch may keep its inactive parent.
 assert.equal((await prepareCustomerParent(s,{parent_id:main.id},branch,admin)).parent_name,main.business_name);
 main.customer_removed_at='2026-10-01';await assert.rejects(prepareCustomerParent(s,{parent_id:main.id},null,admin),/active main customer/);
 assert.deepEqual(await prepareCustomerParent(s,{parent_id:'',parent_name:'forged'},branch,admin),{parent_id:'',parent_name:''});
});
test('Commercial agents may add a branch only under a main customer they registered or manage',async()=>{
 const f=fixture(),s=f.client.asServiceRole.entities,main=f.tables.Customer[0],context={user:{id:staff.user_id,role:'user'},role:'commercial',employee:staff};
 await assert.rejects(prepareCustomerParent(s,{parent_id:main.id},null,context),{status:403});
 main.salesperson_id=staff.id;assert.equal((await prepareCustomerParent(s,{parent_id:main.id},null,context)).parent_id,main.id);
 delete main.salesperson_id;main.acquired_by_id=staff.id;assert.equal((await prepareCustomerParent(s,{parent_id:main.id},null,context)).parent_id,main.id);
});
test('real management registration persists parent branch with acquisition history and field customer responses include hierarchy',async()=>{
 const f=fixture(),handler=await fieldHandler(),main=f.tables.Customer[0];main.acquired_by_id=staff.id;
 f.client.auth.me=async()=>({id:'gm',role:'admin',full_name:'GM'});f.client.entities.Employee.filter=async()=>[];
 globalThis.__dailySupplyClient=f.client;try{
  const body={action:'registerManagedCustomer',requestKey:crypto.randomUUID(),acquiredById:staff.id,customer:{business_name:'New branch',phone:'699123456',parent_id:main.id}};
  const response=await handler(request(body));assert.equal(response.status,200);const {customer}=await response.json();
  assert.equal(customer.parent_id,main.id);assert.equal(customer.parent_name,main.business_name);assert.equal(customer.acquired_by_id,staff.id);assert.match(customer.acquisition_notes,/Branch of an existing/);
  const field=await handler(request({action:'fieldCustomers',commercialId:staff.id}));const result=await field.json();
  assert.equal(result.customers.find(c=>c.id===customer.id).parent_id,main.id);
  assert.equal(f.tables.CustomerLocation.length,0);assert.equal(f.tables.JournalEntry.length,0);
 }finally{delete globalThis.__dailySupplyClient;}
});

test('Commercial field registration records a branch under its own main customer and refuses another agent’s parent',async()=>{
 const f=fixture(),handler=await fieldHandler(),main=f.tables.Customer[0];main.acquired_by_id=staff.id;
 f.tables.Customer.push({id:'other-parent',business_name:'Other territory',is_active:true,acquired_by_id:'another-agent'});
 globalThis.__dailySupplyClient=f.client;
 try{
  const body={action:'registerCustomer',requestKey:crypto.randomUUID(),customer:{business_name:'Field branch',phone:'699123456',parent_id:main.id,gps_lat:3.86,gps_lng:11.51,gps_accuracy_m:10,gps_captured_at:new Date().toISOString()}};
  const response=await handler(request(body));assert.equal(response.status,200);const result=await response.json();
  assert.equal(result.customer.parent_id,main.id);assert.equal(result.customer.parent_name,main.business_name);assert.equal(result.customer.acquired_by_id,staff.id);
  const before=structuredClone(f.tables.Customer);
  const denied=await handler(request({...body,requestKey:crypto.randomUUID(),customer:{...body.customer,business_name:'Other branch',phone:'688123456',parent_id:'other-parent'}}));
  assert.ok(denied.status>=400);assert.deepEqual(f.tables.Customer,before);assert.equal(f.tables.CustomerLocation.length,0);
 }finally{delete globalThis.__dailySupplyClient;}
});
