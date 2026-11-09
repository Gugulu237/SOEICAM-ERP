import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {fixture,functionRoute,request,user} from './helpers/cashier.mjs';
import {customerRegistrationAction} from '../src/server/domain/customer-registration.js';
import {customerCommissionAction} from '../src/server/domain/customer-commission-report.js';
import {FEATURE_AUTHORITY} from '../src/server/domain/roles.js';

const gm={id:'gm',role:'admin',full_name:'General Manager'};
async function setup(db){const f=await fixture(db),s=f.entities,create=s.AuditLog.create;
 // The production store preserves explicit immutable event IDs; this older
 // general-purpose fixture otherwise replaces every supplied ID.
 s.AuditLog.create=async value=>{const row=await create(value);if(!value.id)return row;const saved={...row,id:value.id};if(db)await db.query('UPDATE fixture_entity SET id=$1,data=$2 WHERE entity=$3 AND id=$4',[value.id,JSON.stringify(saved),'AuditLog',row.id]);else Object.assign(f.rows.AuditLog.find(a=>a.id===row.id),saved);return saved;};
 await s.Customer.update('customer-a',{registered_by_id:'original-registrar',registered_by_name:'Original registrar',registered_at:'2026-11-05T12:00:00Z'});const body={action:'assignCustomerAcquisition',customerId:'customer-a',employeeId:'cashier',reason:'Reviewed original customer registration evidence',requestKey:crypto.randomUUID()};return {...f,s,body,run:body=>customerRegistrationAction(f.client,gm,body)};}
async function state(f){return Object.fromEntries(await Promise.all(Object.entries(f.s).map(async([name,store])=>[name,await store.list()])));}

test('reviewed acquisition assignment links an unassigned customer once and preserves the original registrar and dates',async()=>{
 const f=await setup(),before=await f.s.Customer.get('customer-a'),result=await f.run(f.body),customer=await f.s.Customer.get('customer-a');
 assert.equal(result.reused,false);assert.equal(customer.acquired_by_id,'cashier');assert.equal(customer.registered_by_id,before.registered_by_id);assert.equal(customer.registered_by_name,before.registered_by_name);assert.equal(customer.registered_at,before.registered_at);assert.equal(customer.acquisition_date,'2026-11-05');assert.equal(customer.acquisition_verified,'pending');
 const audits=await f.s.AuditLog.list();assert.equal(audits.length,1);assert.equal(audits[0].user_id,gm.id);assert.equal(audits[0].audit_source,'server_verified');assert.equal(audits[0].action,'assign_customer_acquisition');assert.equal((await f.s.JournalEntry.list()).length,0);assert.equal((await f.s.StockMovement.list()).length,0);
 const saved=await state(f);assert.equal((await f.run(f.body)).reused,true);assert.deepEqual(await state(f),saved);
 await assert.rejects(f.run({...f.body,reason:'Different beneficiary evidence'}),/already used/);assert.deepEqual(await state(f),saved);
 await assert.rejects(f.run({...f.body,requestKey:crypto.randomUUID()}),/already linked/);assert.deepEqual(await state(f),saved);
});

test('only the real General Manager can assign acquisitions even when another role has broad feature permissions',async()=>{
 const f=await setup(),before=await state(f),elevated={...user,[FEATURE_AUTHORITY]:{role:'admin',module:'customers'}};
 await assert.rejects(customerRegistrationAction(f.client,elevated,f.body),{status:403});assert.deepEqual(await state(f),before);
 await assert.rejects(customerRegistrationAction(f.client,user,f.body),/Not permitted/);assert.deepEqual(await state(f),before);
});

test('stale ownership, inactive records, invalid employees and malformed requests reject before any assignment',async()=>{
 for(const change of [async f=>f.s.Customer.update('customer-a',{acquired_by_id:'known-owner'}),async f=>f.s.Customer.update('customer-a',{registered_employee_id:'known-registrar'}),async f=>f.s.Customer.update('customer-a',{is_active:false}),async f=>f.s.Employee.update('cashier',{status:'suspended'}),async f=>{f.body.employeeId='missing';},async f=>{f.body.reason='';},async f=>{f.body.requestKey='invalid';},async f=>{f.body.registered_by_id='forged';}]){const f=await setup();await change(f);const before=await state(f);await assert.rejects(f.run(f.body));assert.deepEqual(await state(f),before);}
});

test('an unknown original registration date stays unknown and cannot create an invented new-customer bonus month',async()=>{
 const f=await setup();await f.s.Customer.update('customer-a',{registered_at:'',registered_by_id:'',created_date:'2010-01-01T00:00:00Z'});await f.run(f.body);const customer=await f.s.Customer.get('customer-a');assert.equal(customer.acquisition_date,'');assert.equal(customer.registered_at,'');assert.equal(customer.acquisition_verified,'pending');
});

test('unlinked customer and employee assignment options are visible only to the actual General Manager',async()=>{
 const f=await setup(),all=await customerCommissionAction(f.client,gm,{action:'customerCommissions'});assert.equal(all.can_assign_customers,true);assert.equal(all.unassigned_customers,1);assert.equal(all.unassigned_customer_details[0].id,'customer-a');assert.equal(all.unassigned_customer_details[0].registered_by_id,'original-registrar');assert.ok(all.assignment_agents.some(e=>e.id==='cashier'));
 await f.s.Employee.update('cashier',{role:'production_manager'});const report=await customerCommissionAction(f.client,user,{action:'customerCommissions'});assert.equal(report.can_view_all,true);assert.equal(report.can_assign_customers,false);assert.deepEqual(report.unassigned_customer_details,[]);assert.deepEqual(report.assignment_agents,[]);
});

test('the real API rolls a late assignment failure back and a persisted JSONB retry remains read-only',async()=>{
 const db=new PGlite();try{const f=await setup(db),route=await functionRoute(),create=f.s.AuditLog.create;f.client.auth.me=async()=>gm;
  f.s.AuditLog.create=async row=>{if(row.action==='assign_customer_acquisition')throw Error('Simulated late acquisition audit failure');return create(row);};
  globalThis.__cashierClient=f.client;globalThis.__cashierTransaction=async fn=>{await db.exec('BEGIN');try{const result=await fn();await db.exec('COMMIT');return result;}catch(e){await db.exec('ROLLBACK');throw e;}};
  const before=await state(f),failed=await route(request(f.body),{params:Promise.resolve({name:'fieldOps'})});assert.equal(failed.status,400);assert.deepEqual(await state(f),before);
  f.s.AuditLog.create=create;const success=await route(request(f.body),{params:Promise.resolve({name:'fieldOps'})});assert.equal(success.status,200,await success.text());const saved=await state(f),retry=await route(request(f.body),{params:Promise.resolve({name:'fieldOps'})});assert.equal(retry.status,200,await retry.text());assert.deepEqual(await state(f),saved);
 }finally{delete globalThis.__cashierClient;delete globalThis.__cashierTransaction;await db.close();}
});
