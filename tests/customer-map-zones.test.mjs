import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {fixture,functionRoute,request} from './helpers/cashier.mjs';
import {customerDeliveryAction} from '../src/server/domain/customer-delivery.js';
import {validateZoneBoundary,pointInDeliveryBoundary,zoneGpsMatches,YAOUNDE_MUNICIPALITIES} from '../src/lib/customer-map-zones.js';
import {isReadOnlyFunction} from '../src/lib/function-actions.js';
const admin={id:'gm',role:'admin'},zoneId='ca1984a3-99fa-418a-a6aa-e843e9bab6fd';
const boundary=[{lat:3.8,lng:11.4},{lat:3.9,lng:11.4},{lat:3.9,lng:11.6},{lat:3.8,lng:11.6}];
const zone={id:zoneId,name:'Central delivery',code:'CENTRAL',town:'Yaoundé',neighbourhoods:'',notes:'',colour:'green',is_active:true,boundary,municipality:'yaounde_1',service_status:'planned'};
const gps=(changes={})=>({gps_lat:3.85,gps_lng:11.5,gps_accuracy_m:8,gps_captured_at:new Date().toISOString(),gps_capture_source:'device',...changes});
async function setup(db){const f=await fixture(db);f.client.auth.me=async()=>admin;await f.entities.CompanySettings.update('settings',{delivery_zones:[zone],delivery_zones_revision:1});await f.entities.Customer.update('customer-a',gps());return f;}
const assign=(points=[{kind:'customer',recordId:'customer-a',revision:0}],extra={})=>({action:'assignDeliveryZoneByBoundary',zoneId,zoneRevision:1,points,...extra});

test('zone geometry accepts either winding, closes repeated endpoints and includes boundary pins',()=>{
  assert.equal(YAOUNDE_MUNICIPALITIES.length,7);
  assert.deepEqual(validateZoneBoundary([...boundary,boundary[0]]),boundary);
  for(const ring of [boundary,[...boundary].reverse()]){
    assert.equal(pointInDeliveryBoundary(gps(),ring),true);
    assert.equal(pointInDeliveryBoundary(gps({gps_lat:3.8}),ring),true);
    assert.equal(pointInDeliveryBoundary(gps({gps_lat:3.95}),ring),false);
    assert.equal(pointInDeliveryBoundary({gps_lat:null,gps_lng:11.5},ring),false);
  }
  assert.deepEqual(validateZoneBoundary(null),[]);
  for(const ring of [[boundary[0],boundary[1]],[boundary[0],boundary[1],boundary[0]],boundary.map(p=>({...p,lat:NaN})),[boundary[0],boundary[2],boundary[1],boundary[3]],[{lat:1,lng:1},{lat:2,lng:2},{lat:3,lng:3}],Array.from({length:62},(_,i)=>({lat:i,lng:i}))])assert.throws(()=>validateZoneBoundary(ring));
});
test('GPS matching proposes only unassigned verified points inside the boundary',()=>{
  const points=[{id:'ready',...gps(),gps_status:'ready'},{id:'old',...gps(),gps_status:'unverified'},{id:'elsewhere',...gps(),gps_status:'ready',zone_id:'other'},{id:'same',...gps(),gps_status:'ready',zone_id:zoneId},{id:'outside',...gps({gps_lat:4}),gps_status:'ready'},{id:'none',gps_status:'missing'}];
  const result=zoneGpsMatches(points,zone);assert.deepEqual(result.eligible.map(p=>p.id),['ready']);assert.deepEqual(result.otherZones.map(p=>p.id),['elsewhere']);assert.deepEqual(result.assigned.map(p=>p.id),['same']);assert.deepEqual(result.unverified.map(p=>p.id),['old']);
});
test('map workspace is read only; geometry assignments use the write transaction boundary',()=>{
  assert.equal(isReadOnlyFunction('fieldOps','customerMapWorkspace'),true);assert.equal(isReadOnlyFunction('fieldOps','assignDeliveryZoneByBoundary'),false);
});
test('zone geometry, municipality and served status are checked, retry safe and preserved by legacy forms',async()=>{
  const f=await fixture(),body={action:'saveDeliveryZone',requestKey:zoneId,revision:0,zone};
  const saved=await customerDeliveryAction(f.client,admin,body);assert.deepEqual(saved.zone.boundary,boundary);assert.equal(saved.zone.service_status,'planned');
  assert.equal((await customerDeliveryAction(f.client,admin,body)).reused,true);
  const legacy={...zone};delete legacy.boundary;delete legacy.municipality;delete legacy.service_status;
  const edited=await customerDeliveryAction(f.client,admin,{...body,zoneId,revision:1,zone:{...legacy,name:'Updated'}});assert.deepEqual(edited.zone.boundary,boundary);assert.equal(edited.zone.municipality,'yaounde_1');
  for(const change of [{municipality:'yaounde_8'},{service_status:'all_served'},{boundary:[boundary[0],boundary[2],boundary[1],boundary[3]]}])await assert.rejects(customerDeliveryAction(f.client,admin,{...body,zoneId,revision:2,zone:{...edited.zone,...change}}));
  assert.equal((await f.entities.CompanySettings.get('settings')).delivery_zones_revision,2);
});
test('commercial map returns owned customers and assigned outlets, without siblings or foreign headquarters',async()=>{
  const f=await setup(),user={id:'cashier-login',role:'user'};await f.entities.Employee.update('cashier',{role:'commercial'});
  await f.entities.Customer.update('customer-a',{balance:999,acquired_by_id:'cashier'});
  const foreign=await f.entities.Customer.create({business_name:'Foreign chain',is_active:true,...gps()}),hidden=await f.entities.Customer.create({business_name:'Invisible',is_active:true,...gps()});
  const permitted=await f.entities.CustomerLocation.create({customer_id:foreign.id,name:'Assigned branch',is_active:true,assigned_commercial_id:'cashier',...gps()});
  const sibling=await f.entities.CustomerLocation.create({customer_id:foreign.id,name:'Hidden branch',is_active:true,...gps()});
  const result=await customerDeliveryAction(f.client,user,{action:'customerMapWorkspace'});
  assert.equal(result.customer_count,2);assert.ok(result.points.some(p=>p.record_id==='customer-a'));assert.ok(result.points.some(p=>p.record_id===permitted.id));
  assert.ok(result.points.every(p=>p.record_id!==sibling.id&&p.record_id!==hidden.id&&p.record_id!==foreign.id));assert.ok(result.points.every(p=>p.balance===undefined&&p.acquired_by_id===undefined));
  await assert.rejects(customerDeliveryAction(f.client,user,assign()),/restricted/);
  for(const role of ['driver','warehouse_manager','production_manager','cashier']){await f.entities.Employee.update('cashier',{role});await assert.rejects(customerDeliveryAction(f.client,user,{action:'customerMapWorkspace'}),/restricted/);}
  await f.entities.Employee.update('cashier',{role:'commercial',status:'inactive'});await assert.rejects(customerDeliveryAction(f.client,user,{action:'customerMapWorkspace'}),/active staff/);
});
test('boundary assignment changes zone only, preserves finance and stock, and rejects stale settings',async()=>{
  const f=await setup();await f.entities.Customer.update('customer-a',{balance:123,acquired_by_id:'origin'});
  await assert.rejects(customerDeliveryAction(f.client,admin,assign(undefined,{zoneRevision:0})),/Zone settings changed/);
  const saved=await customerDeliveryAction(f.client,admin,assign());assert.equal(saved.updated,1);
  const customer=await f.entities.Customer.get('customer-a');assert.equal(customer.delivery_zone_id,zoneId);assert.equal(customer.balance,123);assert.equal(customer.acquired_by_id,'origin');
  assert.equal((await f.entities.StockMovement.list()).length,0);assert.equal((await f.entities.JournalEntry.list()).length,0);
  await assert.rejects(customerDeliveryAction(f.client,admin,assign()),/changed/);
});
test('bulk geometry assignment preflights every pin and never moves customers from another zone',async()=>{
  for(const change of [{gps_lat:4},{gps_accuracy_m:100},{gps_capture_source:'manual'},{delivery_zone_id:'other'},{delivery_revision:2}]){
    const f=await setup();const other=await f.entities.Customer.create({business_name:'Other',is_active:true,...gps(),...change});
    await assert.rejects(customerDeliveryAction(f.client,admin,assign([{kind:'customer',recordId:'customer-a',revision:0},{kind:'customer',recordId:other.id,revision:0}])));
    assert.equal((await f.entities.Customer.get('customer-a')).delivery_zone_id,undefined);
  }
  const f=await setup();await f.entities.CompanySettings.update('settings',{delivery_zones:[{...zone,service_status:'paused'}]});await assert.rejects(customerDeliveryAction(f.client,admin,assign()),/active delivery zone/);
});
test('boundary assignment through the function route rolls back when audit recording fails',async()=>{
  const db=new PGlite();try{const f=await setup(db),route=await functionRoute();globalThis.__cashierClient=f.client;globalThis.__cashierTransaction=async fn=>{await db.exec('BEGIN');try{const result=await fn();await db.exec('COMMIT');return result;}catch(e){await db.exec('ROLLBACK');throw e;}};
    const create=f.entities.AuditLog.create;f.entities.AuditLog.create=async()=>{throw Error('Fixture audit failure');};
    const failed=await route(request(assign()),{params:Promise.resolve({name:'fieldOps'})});assert.equal(failed.status,400);assert.equal((await f.entities.Customer.get('customer-a')).delivery_zone_id,undefined);
    f.entities.AuditLog.create=create;const ok=await route(request(assign()),{params:Promise.resolve({name:'fieldOps'})});assert.equal(ok.status,200);assert.equal((await f.entities.Customer.get('customer-a')).delivery_zone_id,zoneId);
  }finally{delete globalThis.__cashierClient;delete globalThis.__cashierTransaction;await db.close();}
});
