import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { build } from 'esbuild';
import { fixture,functionRoute,request } from './helpers/cashier.mjs';
import { fixture as fieldFixture,user as agentUser } from './helpers/commercial-supply.mjs';
import { customerDeliveryAction,prepareDeliveryDefinition } from '../src/server/domain/customer-delivery.js';
import { commercialAction } from '../src/server/domain/commercial-workspace.js';
import { deliveryPoints,deliveryCoverage,deliveryGpsStatus,validateDeliveryGps,filterDeliveryPoints } from '../src/lib/customer-delivery.js';
import { guardMutation } from '../src/server/access.js';

const admin={id:'gm',role:'admin'},zoneId='ca1984a3-99fa-418a-a6aa-e843e9bab6fd';
const zone={id:zoneId,name:'Central district',code:'CENTRAL',town:'City',neighbourhoods:'Centre, Market',notes:'Morning deliveries',colour:'amber',is_active:true};
const fix=()=>({gps_lat:4.05,gps_lng:9.7,gps_accuracy_m:8,gps_captured_at:new Date().toISOString()});
const saveZone=(changes={})=>({action:'saveDeliveryZone',revision:0,requestKey:zoneId,zone:{...zone},...changes});
async function setup(db){const f=await fixture(db);f.client.auth.me=async()=>admin;await f.entities.CompanySettings.update('settings',{delivery_zones:[zone],delivery_zones_revision:1});return f;}

test('delivery coverage treats every outlet separately and never copies headquarters coordinates or zone into branches',()=>{
  const customers=[{id:'hq',business_name:'Chain',is_active:true,...fix(),gps_capture_source:'device',delivery_zone_id:zoneId},{id:'shop',business_name:'Shop',is_active:true},{id:'inactive',business_name:'Closed',is_active:false}];
  const locations=[{id:'a',customer_id:'hq',name:'Branch A',is_active:true},{id:'b',customer_id:'hq',name:'Branch B',is_active:true,...fix(),gps_capture_source:'device',delivery_zone_id:zoneId},{id:'old',customer_id:'hq',name:'Closed outlet',is_active:false}];
  const points=deliveryPoints(customers,locations,[zone]);assert.equal(points.length,3);const a=points.find(p=>p.record_id==='a');assert.equal(a.gps_status,'missing');assert.equal(a.zone_id,'');assert.equal(a.gps_lat,undefined);assert.equal(points.find(p=>p.record_id==='b').gps_status,'ready');
  const coverage=deliveryCoverage(points,[zone]);assert.equal(coverage.total,3);assert.equal(coverage.ready,1);assert.equal(coverage.unassigned,2);assert.equal(filterDeliveryPoints(points,{zone:'unassigned',gps:'attention'}).length,2);assert.equal(filterDeliveryPoints(points,{search:'branch b',zone:zoneId}).length,1);
});

test('GPS completion requires accurate fresh numeric fixes and distinguishes manual, missing and approximate locations',()=>{
  const precise={...fix(),gps_capture_source:'device'};assert.equal(deliveryGpsStatus(precise),'ready');assert.equal(deliveryGpsStatus({gps_lat:4,gps_lng:9}),'unverified');assert.equal(deliveryGpsStatus({...precise,gps_accuracy_m:100}),'approximate');assert.equal(deliveryGpsStatus({gps_lat:91,gps_lng:9}),'missing');
  assert.equal(validateDeliveryGps(fix()).gps_capture_source,'device');
  for(const change of [{gps_lat:null},{gps_lng:''},{gps_lat:'4.05'},{gps_accuracy_m:31},{gps_accuracy_m:-1},{gps_captured_at:new Date(Date.now()-121000).toISOString()},{gps_captured_at:new Date(Date.now()+31000).toISOString()}])assert.throws(()=>validateDeliveryGps({...fix(),...change}));
  assert.equal(validateDeliveryGps({...fix(),gps_lat:0,gps_lng:0}).gps_lat,0);
});

test('zone saves are retry safe, version checked, unique, General Manager managed and cannot archive assigned records',async()=>{
  const f=await fixture();const first=await customerDeliveryAction(f.client,admin,saveZone());assert.equal(first.zone.id,zoneId);const repeat=await customerDeliveryAction(f.client,admin,saveZone());assert.equal(repeat.reused,true);assert.equal((await f.entities.CompanySettings.get('settings')).delivery_zones.length,1);
  await assert.rejects(customerDeliveryAction(f.client,admin,saveZone({zoneId,zone:{...zone,name:'Changed'}})),/another window/);
  await assert.rejects(customerDeliveryAction(f.client,admin,saveZone({requestKey:crypto.randomUUID(),revision:1})),/already has/);
  await f.entities.Customer.update('customer-a',{delivery_zone_id:zoneId});await assert.rejects(customerDeliveryAction(f.client,admin,saveZone({zoneId,revision:1,zone:{...zone,is_active:false}})),/Reassign/);
  await customerDeliveryAction(f.client,admin,{action:'assignDeliveryZone',zoneId:'',points:[{kind:'customer',recordId:'customer-a',revision:0}]});
  const archived=await customerDeliveryAction(f.client,admin,saveZone({zoneId,revision:1,zone:{...zone,is_active:false}}));assert.equal(archived.zone.is_active,false);
  await assert.rejects(prepareDeliveryDefinition(f.entities,{delivery_zone_id:zoneId}),/active delivery zone/);
});

test('checked delivery saves update only operational fields, preserve acquisition and finance, and prevent stale overwrites',async()=>{
  const f=await setup();await f.entities.Customer.update('customer-a',{balance:1234,acquired_by_id:'original'});
  const body={action:'saveDeliveryPoint',kind:'customer',recordId:'customer-a',revision:0,details:{delivery_zone_id:zoneId,delivery_days:'Thu, Mon, Mon',delivery_instructions:'Call at loading entrance',...fix(),balance:0,acquired_by_id:'forged'}};
  await customerDeliveryAction(f.client,admin,body);const saved=await f.entities.Customer.get('customer-a');assert.equal(saved.balance,1234);assert.equal(saved.acquired_by_id,'original');assert.equal(saved.delivery_days,'Mon, Thu');assert.equal(saved.delivery_zone_id,zoneId);assert.equal(saved.gps_capture_source,'device');assert.equal(saved.delivery_revision,1);
  await assert.rejects(customerDeliveryAction(f.client,admin,body),/another window/);assert.equal((await f.entities.StockMovement.list()).length,0);assert.equal((await f.entities.JournalEntry.list()).length,0);
  const workspace=await customerDeliveryAction(f.client,admin,{action:'customerDeliveryWorkspace'});assert.equal(workspace.coverage.ready,1);assert.equal(workspace.points[0].balance,undefined);assert.equal(workspace.points[0].acquired_by_id,undefined);
});

test('generic manual edits clear old GPS evidence while unrelated profile changes retain it',async()=>{
  const f=await setup(),original={id:'c',...fix(),gps_capture_source:'device',delivery_revision:4};
  const unchanged=await prepareDeliveryDefinition(f.entities,{...fix(),gps_captured_at:original.gps_captured_at},original,{user:admin});assert.equal(unchanged.gps_capture_source,undefined);assert.equal(unchanged.delivery_revision,undefined);
  const manual=await prepareDeliveryDefinition(f.entities,{gps_lat:4.06,gps_lng:9.71},original,{user:admin});assert.equal(manual.gps_capture_source,'manual');assert.equal(manual.gps_accuracy_m,null);assert.equal(manual.gps_captured_at,'');assert.equal(manual.delivery_revision,5);assert.equal(deliveryGpsStatus({...original,...manual}),'unverified');
  for(const key of ['gps_capture_source','delivery_revision','gps_updated_by'])await assert.rejects(prepareDeliveryDefinition(f.entities,{[key]:'forged'},original),/managed/);
  await assert.rejects(prepareDeliveryDefinition(f.entities,{delivery_zone_id:'missing'},original),/active delivery zone/);
  assert.deepEqual(await prepareDeliveryDefinition(f.entities,{phone:'699123456'},original),{phone:'699123456'});
});

test('Commercial agents receive zone metadata and can update only their own customers, without accessing the complete directory',async()=>{
  const f=await setup();await f.entities.Employee.update('cashier',{role:'commercial'});const user={id:'cashier-login',role:'user'};
  await assert.rejects(customerDeliveryAction(f.client,user,{action:'customerDeliveryWorkspace'}),/restricted/);await assert.rejects(customerDeliveryAction(f.client,user,saveZone()),/restricted/);
  const options=await customerDeliveryAction(f.client,user,{action:'deliveryZoneOptions'});assert.equal(options.zones.length,1);assert.equal(options.points,undefined);assert.equal(options.customers,undefined);
  const body={action:'saveDeliveryPoint',kind:'customer',recordId:'customer-a',revision:0,details:{delivery_zone_id:zoneId}};await assert.rejects(customerDeliveryAction(f.client,user,body),/assigned or registered/);
  await f.entities.Customer.update('customer-a',{salesperson_id:'cashier'});await customerDeliveryAction(f.client,user,body);assert.equal((await f.entities.Customer.get('customer-a')).delivery_zone_id,zoneId);
  await f.entities.Employee.update('cashier',{role:'employee'});await assert.rejects(customerDeliveryAction(f.client,user,saveZone()),/restricted/);assert.ok(await customerDeliveryAction(f.client,user,{action:'customerDeliveryWorkspace'}));
  for(const role of ['cashier','driver','hotesse','warehouse_manager','production_manager']){await f.entities.Employee.update('cashier',{role});await assert.rejects(customerDeliveryAction(f.client,user,{action:'customerDeliveryWorkspace'}),/restricted/);}
});

test('field registration accepts a valid zone and current GPS, refuses coarse capture and preserves the acquisition owner on retry',async()=>{
  const f=fieldFixture();f.tables.CompanySettings[0].delivery_zones=[zone];
  const body={action:'registerCustomer',requestKey:crypto.randomUUID(),customer:{business_name:'New outlet',phone:'699123456',delivery_zone_id:zoneId,...fix(),acquired_by_id:'forged'}};
  const result=await commercialAction(f.client,agentUser,body);assert.equal(result.customer.delivery_zone_id,zoneId);assert.equal(result.customer.gps_capture_source,'device');assert.equal(result.customer.acquired_by_id,'agent-a');
  await assert.rejects(commercialAction(f.client,agentUser,{...body,customer:{...body.customer,gps_captured_at:'2020-01-01T00:00:00Z'}}),/different customer details/);
  const retry=await commercialAction(f.client,agentUser,body);assert.equal(retry.reused,true);assert.equal(retry.customer.id,result.customer.id);
  await assert.rejects(commercialAction(f.client,agentUser,{...body,requestKey:crypto.randomUUID(),customer:{...body.customer,business_name:'Other outlet',phone:'688123456',gps_accuracy_m:120}}),/GPS accuracy/);
});

test('bulk assignment rolls back every selected point if a later revision has changed',async()=>{
  const db=new PGlite();try{const f=await setup(db),other=await f.entities.Customer.create({business_name:'Other outlet',is_active:true,delivery_revision:2}),route=await functionRoute();globalThis.__cashierClient=f.client;globalThis.__cashierTransaction=async fn=>{await db.exec('BEGIN');try{const out=await fn();await db.exec('COMMIT');return out;}catch(e){await db.exec('ROLLBACK');throw e;}};
    const body={action:'assignDeliveryZone',zoneId,points:[{kind:'customer',recordId:'customer-a',revision:0},{kind:'customer',recordId:other.id,revision:1}]};const response=await route(request(body),{params:Promise.resolve({name:'fieldOps'})});assert.equal(response.status,400);assert.match((await response.json()).error,/changed/);assert.equal((await f.entities.Customer.get('customer-a')).delivery_zone_id,undefined);assert.equal((await f.entities.Customer.get('customer-a')).delivery_revision,undefined);
    body.points[1].revision=2;const success=await route(request(body),{params:Promise.resolve({name:'fieldOps'})});assert.equal(success.status,200);assert.equal((await f.entities.Customer.get('customer-a')).delivery_zone_id,zoneId);assert.equal((await f.entities.Customer.get(other.id)).delivery_zone_id,zoneId);assert.equal((await f.entities.JournalEntry.list()).length,0);
  }finally{delete globalThis.__cashierClient;delete globalThis.__cashierTransaction;await db.close();}
});

test('public entity API invokes delivery validation on both customer and outlet creates / updates',async()=>{
  const f=await setup();const output=await build({entryPoints:['src/server/entity-api.js'],bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'delivery-entity',setup(b){b.onResolve({filter:/^server-only$/},()=>({path:'empty',namespace:'mock'}));b.onResolve({filter:/^\.\/entities\.js$/},()=>({path:'entities',namespace:'mock'}));b.onResolve({filter:/^\.\/db\.js$/},()=>({path:'db',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},({path})=>({contents:path==='empty'?'':path==='db'?'export const database=()=>{throw Error("Unexpected catalogue read in unrelated test");};export const transaction=fn=>fn();':'export const serviceEntities=globalThis.__deliveryEntities;export const entityStore=name=>globalThis.__deliveryEntities[name];'}));}}]});globalThis.__deliveryEntities=f.entities;
  try{const {entityOperation}=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));const ctx={user:admin,role:'admin'};
    for(const entity of ['Customer','CustomerLocation']){await assert.rejects(entityOperation(ctx,entity,'create',[{name:'Outlet',business_name:'Outlet',delivery_zone_id:'invalid'}]),/active delivery zone/);const saved=await entityOperation(ctx,entity,'create',[{name:'Outlet',business_name:'Outlet',delivery_zone_id:zoneId,...fix()}]);assert.equal(saved.gps_capture_source,'device');const changed=await entityOperation(ctx,entity,'update',[saved.id,{gps_lat:4.06}]);assert.equal(changed.gps_capture_source,'manual');assert.equal(changed.gps_accuracy_m,null);}
    assert.throws(()=>guardMutation(ctx,'CompanySettings','update',{delivery_zones:[]}),/checked customer delivery/);
  }finally{delete globalThis.__deliveryEntities;}
});
