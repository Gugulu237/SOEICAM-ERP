import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {fixture,functionRoute,request,user,date} from './helpers/cashier.mjs';
import {distributionControlAction} from '../src/server/domain/distribution-control.js';
import {dispatchAction} from '../src/server/domain/dispatch-operations.js';
import {unsoldStockReturnAction} from '../src/server/domain/unsold-stock-returns.js';
import {distributionPath} from '../src/lib/distribution-navigation.js';

async function setup(db){
  const f=await fixture(db),s=f.entities;await s.Employee.update('cashier',{role:'warehouse_manager'});
  const agent=await s.Employee.create({full_name:'Agent A',role:'commercial',status:'active'}),driver=await s.Employee.create({full_name:'Driver A',role:'driver',status:'active'});
  await s.Dispatch.deleteMany({});await s.DispatchLine.deleteMany({});
  for(const b of await s.StockBalance.list())await s.StockBalance.update(b.id,{quantity:0,total_value:0});
  await s.Warehouse.update('factory',{name:'Factory',warehouse_type:'finished_goods',is_active:true});
  const stock=await s.StockBalance.create({product_id:'product-a',product_name:'YOLA',warehouse_id:'factory',quantity:20,unit_cost:100,total_value:2000,lot_number:'B-FACTORY',expiry_date:'2099-01-01',qc_status:'approved'});
  const body={action:'issueDistributionStock',commercialId:agent.id,driverId:driver.id,vehicleId:'vehicle-a',warehouseId:'factory',date,requestKey:crypto.randomUUID(),lines:[{product_id:'product-a',quantity:5}],notes:'Morning load'};
  const run=body=>distributionControlAction(f.client,user,body);
  return {...f,s,agent,driver,stock,body,run};
}
async function supply(f,dispatch){
  const {s}=f,journal=await s.JournalEntry.create({status:'posted',entry_date:date});
  const sale=await s.FieldSale.create({dispatch_id:dispatch.id,commercial_id:f.agent.id,customer_id:'customer-a',sale_number:'FS-1',transaction_date:date,status:'approved_posted',journal_id:journal.id,total:1000,amount_collected:400,amount_due:600,stock_moved_at:new Date().toISOString()});
  await s.FieldSaleLine.create({field_sale_id:sale.id,product_id:'product-a',product_name:'YOLA',quantity:2,unit:'ea',line_total:1000});
  await s.StockMovement.create({document_type:'FieldSale',document_id:sale.id,movement_type:'field_delivery',source_warehouse_id:'van-stock',product_id:'product-a',quantity:2,status:'approved'});
  await s.StockMovement.create({document_type:'FieldSale',document_id:sale.id,movement_type:'field_delivery',destination_warehouse_id:'other',product_id:'product-a',quantity:2,status:'approved'});
  const vehicle=(await s.StockBalance.list()).find(b=>b.warehouse_id==='van-stock'&&b.quantity>0);await s.StockBalance.update(vehicle.id,{quantity:3,total_value:300});
  await s.Customer.update('customer-a',{acquired_by_id:f.agent.id,acquisition_date:date,acquisition_verified:'pending'});
  return sale;
}

test('one retry-safe Distribution issue uses the paired vehicle, preserves lot/expiry and does not post revenue',async()=>{
  const f=await setup(),result=await f.run(f.body),retry=await f.run(f.body);
  assert.equal(result.dispatch.id,retry.dispatch.id);assert.equal(retry.reused,true);assert.equal((await f.s.DispatchRequest.list()).length,1);assert.equal((await f.s.Dispatch.list()).length,1);
  const stock=(await f.s.StockBalance.list()).find(b=>b.warehouse_id==='van-stock'&&b.quantity>0);assert.equal(stock.quantity,5);assert.equal(stock.lot_number,'B-FACTORY');assert.equal(stock.expiry_date,'2099-01-01');assert.equal((await f.s.StockBalance.get(f.stock.id)).quantity,15);
  assert.equal((await f.s.JournalEntry.list()).length,0);assert.equal((await f.s.StockMovement.list()).length,2);
  assert.ok((await f.s.StockMovement.list()).every(m=>m.movement_type==='vehicle_load'));
  await assert.rejects(f.run({...f.body,notes:'Changed load'}),/already issued/);
  const raw=await f.s.Product.create({name:'Raw milk',inventory_type:'raw_material',is_active:true});await assert.rejects(f.run({...f.body,requestKey:crypto.randomUUID(),lines:[{product_id:raw.id,quantity:1}]}),/finished products/);
});

test('operational preview counts exact stock-backed posted sales once, separates cash and credit and excludes unresolved supplies',async()=>{
  const f=await setup(),{dispatch}=await f.run(f.body);await supply(f,dispatch);
  await f.s.FieldSale.create({dispatch_id:dispatch.id,commercial_id:f.agent.id,transaction_date:date,status:'approved_posted',total:500,journal_id:'missing'});
  const data=await distributionControlAction(f.client,{id:'gm',role:'admin'},{action:'distributionControl',date}),agent=data.agents.find(a=>a.id===f.agent.id),run=data.runs.find(r=>r.id===dispatch.id);
  assert.equal(agent.sales,1000);assert.equal(agent.cash_collected,400);assert.equal(agent.credit,600);assert.equal(agent.supplies,1);assert.equal(agent.new_customers,1);assert.equal(agent.verified_customers,0);assert.equal(data.unverified_supplies,1);
  assert.equal(run.reconciliation.rows[0].sold,2);assert.equal(run.reconciliation.rows[0].expected,3);assert.equal(run.reconciliation.rows[0].actual,3);assert.equal(run.reconciliation.hasVariance,false);
  assert.equal('salary' in data.staff[0],false);assert.equal('bonus_plan' in agent,false);
  await f.s.Employee.update('cashier',{role:'commercial'});await assert.rejects(f.run({action:'distributionControl',date}),/Not permitted/);await assert.rejects(f.run(f.body),/Not permitted/);
});

test('physical counts are checked against fresh vehicle stock and variance blocks closing the run',async()=>{
  const f=await setup(),{dispatch}=await f.run(f.body);await supply(f,dispatch);
  await assert.rejects(f.run({action:'closeDistributionRun',dispatchId:dispatch.id}),/Receive the vehicle/);
  const count=(qty)=>dispatchAction(f.client,user,{action:'returnDispatchStock',dispatchId:dispatch.id,countedLines:[{product_id:'product-a',quantity:qty}]});
  const before=(await f.s.StockMovement.list()).length;await assert.rejects(count(2),/Physical return counts differ/);assert.equal((await f.s.StockMovement.list()).length,before);
  await count(3);assert.equal((await f.s.Dispatch.get(dispatch.id)).status,'returned');assert.equal((await f.s.StockBalance.get(f.stock.id)).quantity,18);
  const line=(await f.s.DispatchLine.list())[0];await f.s.DispatchLine.update(line.id,{returned_quantity:2});await assert.rejects(f.run({action:'closeDistributionRun',dispatchId:dispatch.id}),/stock variance/);
  await f.s.DispatchLine.update(line.id,{returned_quantity:3});const collection=await f.s.SpoilageRecord.create({dispatch_id:dispatch.id,record_type:'field_expired_return'});await assert.rejects(f.run({action:'closeDistributionRun',dispatchId:dispatch.id}),/expired customer collections/);await f.s.SpoilageRecord.update(collection.id,{return_received_at:new Date().toISOString()});await f.run({action:'closeDistributionRun',dispatchId:dispatch.id});assert.equal((await f.s.Dispatch.get(dispatch.id)).status,'completed');assert.equal((await f.run({action:'closeDistributionRun',dispatchId:dispatch.id})).reused,true);
});

test('old custody can be recovered explicitly once, retaining expired quarantine stock without mixing it into a vehicle run',async()=>{
  const f=await setup(),warehouse=await f.s.Warehouse.create({name:'Old Agent A custody',warehouse_type:'commercial_custody',custodian_employee_id:f.agent.id});
  const old=await f.s.StockBalance.create({product_id:'product-a',product_name:'YOLA',warehouse_id:warehouse.id,quantity:3,unit_cost:100,total_value:300,lot_number:'OLD-LOT',expiry_date:'2020-01-01',qc_status:'quarantine'});
  const body={action:'recoverLegacyCustody',warehouseId:warehouse.id,toWarehouseId:'factory',requestKey:crypto.randomUUID(),lines:[{product_id:'product-a',quantity:3}],reason:'Counted legacy goods'};
  const before=await distributionControlAction(f.client,{id:'gm',role:'admin'},{action:'distributionControl',date});assert.equal(before.legacy.length,1);
  await f.run(body);assert.equal((await f.run(body)).reused,true);assert.equal((await f.s.StockBalance.get(old.id)).quantity,0);
  const returned=(await f.s.StockBalance.list()).find(b=>b.warehouse_id==='factory'&&b.lot_number==='OLD-LOT');assert.equal(returned.quantity,3);assert.equal(returned.qc_status,'quarantine');assert.equal(returned.expiry_date,'2020-01-01');assert.equal((await f.s.Dispatch.list()).length,0);
  await assert.rejects(f.run({...body,reason:'Changed recovery'}),/already recorded/);
});

test('a late issue failure rolls request, approval and inventory back at the real API transaction boundary',async()=>{
  const db=new PGlite();try{const f=await setup(db),route=await functionRoute(),original=f.s.AuditLog.create;
    f.s.AuditLog.create=async value=>{if(value.action==='approve_dispatch_request')throw Error('Simulated final issue failure');return original(value);};
    globalThis.__cashierClient=f.client;globalThis.__cashierTransaction=async fn=>{await db.exec('BEGIN');try{const result=await fn();await db.exec('COMMIT');return result;}catch(e){await db.exec('ROLLBACK');throw e;}};
    const response=await route(request(f.body),{params:Promise.resolve({name:'fieldOps'})});assert.equal(response.status,400);assert.equal((await f.s.DispatchRequest.list()).length,0);assert.equal((await f.s.Dispatch.list()).length,0);assert.equal((await f.s.StockMovement.list()).length,0);assert.equal((await f.s.StockBalance.get(f.stock.id)).quantity,20);
    f.s.AuditLog.create=original;const success=await route(request(f.body),{params:Promise.resolve({name:'fieldOps'})});assert.equal(success.status,200);assert.equal((await f.s.Dispatch.list()).length,1);
  }finally{delete globalThis.__cashierClient;delete globalThis.__cashierTransaction;await db.close();}
});

test('legacy Custody bookmarks retain the selected agent in Distribution stock control',()=>{
  const url=new URL(distributionPath('stock',{commercial:'agent / 1',mode:'return'}),'http://localhost');assert.equal(url.pathname,'/distribution');assert.equal(url.searchParams.get('tab'),'stock');assert.equal(url.searchParams.get('commercial'),'agent / 1');assert.equal(url.searchParams.get('mode'),'return');
});

test('inventory issue lookup reads only load setup and stock, with no performance scans or writes',async()=>{
  const f=await setup();
  const before=structuredClone(f.rows);
  for(const name of ['Dispatch','DispatchLine','FieldSale','FieldSaleLine','Customer','JournalEntry','SpoilageRecord']){
    f.s[name].filter=()=>{throw Error('Unnecessary performance scan: '+name);};
  }
  const data=await f.run({action:'distributionIssueWorkspace'});
  assert.ok(data.staff.some(e=>e.id===f.agent.id));assert.ok(data.staff.some(e=>e.id===f.driver.id));
  assert.ok(data.warehouses.some(w=>w.id==='factory'));
  assert.ok(data.warehouse_stock.some(b=>b.warehouse_id==='factory'&&b.product_id==='product-a'&&b.quantity===20));
  assert.ok(data.products.some(p=>p.id==='product-a'&&p.unit));
  assert.equal('salary' in data.staff[0],false);assert.equal('runs' in data,false);
  assert.deepEqual(f.rows,before);
  await f.s.Employee.update('cashier',{role:'commercial'});
  await assert.rejects(f.run({action:'distributionIssueWorkspace'}),/Not permitted/);
});

test('delivery stock issuance belongs to warehouse management; production retains reporting but cannot issue through any endpoint',async()=>{
  const f=await setup(),before=structuredClone(f.rows);
  await f.s.Employee.update('cashier',{role:'production_manager'});
  const deniedState=structuredClone(f.rows);
  await assert.rejects(f.run({action:'distributionControl',date}),/Only top administrators/);
  await assert.rejects(f.run({action:'distributionIssueWorkspace'}),/Only warehouse management/);
  await assert.rejects(f.run(f.body),/Only warehouse management/);
  for(const action of ['approveDispatchRequest','approveDispatch','loadDispatch'])await assert.rejects(dispatchAction(f.client,user,{action,dispatchId:'legacy',requestId:'legacy'}),/Only warehouse management/);
  assert.deepEqual(f.rows,deniedState,'denied issue calls must not create drafts, approval metadata or stock movements');
  await f.s.Employee.update('cashier',{role:'warehouse_manager'});
  const {dispatch}=await f.run(f.body);assert.equal(dispatch.status,'loaded');assert.equal((await f.s.StockBalance.get(f.stock.id)).quantity,15);
  await f.s.Employee.update('cashier',{role:'production_manager'});
  await assert.rejects(f.run(f.body),/Only warehouse management/);
  assert.equal((await f.s.Dispatch.list()).length,1);assert.equal((await f.s.StockBalance.get(f.stock.id)).quantity,15);
  assert.equal(before.StockMovement.length,0);
});

test('current holders use physical stock across issue dates and keep quarantined or disputed goods visible',async()=>{
  const f=await setup(),{dispatch}=await f.run({...f.body,driverId:'',vehicleId:''}),s=f.s;
  const balance=(await s.StockBalance.list()).find(b=>b.warehouse_id===dispatch.vehicle_warehouse_id&&b.quantity>0);
  await s.Dispatch.update(dispatch.id,{dispatch_date:'2020-01-01',unsold_return_request_id:'pending-return'});
  await s.StockBalance.update(balance.id,{qc_status:'quarantine',expiry_date:'2020-01-01'});
  await s.Employee.update(f.agent.id,{status:'inactive'});
  const empty=await s.Employee.create({full_name:'Zero stock employee',role:'cashier',status:'active'});
  const emptyRun=await s.Dispatch.create({dispatch_date:'2020-01-01',status:'loaded',salesperson_id:empty.id,vehicle_warehouse_id:'empty-location'});
  await s.DispatchLine.create({dispatch_id:emptyRun.id,product_id:'product-a',loaded_quantity:100});
  await s.StockBalance.create({warehouse_id:'empty-location',product_id:'product-a',quantity:0});
  const cancelled=await s.Employee.create({full_name:'Voided issue employee',role:'employee',status:'active'});
  const voidRun=await s.Dispatch.create({dispatch_date:date,status:'cancelled',salesperson_id:cancelled.id,vehicle_warehouse_id:dispatch.vehicle_warehouse_id});
  const history=await s.Dispatch.create({dispatch_date:date,status:'returned',salesperson_id:cancelled.id,vehicle_warehouse_id:dispatch.vehicle_warehouse_id});
  const legacyOwner=await s.Employee.create({full_name:'Inactive legacy holder',role:'commercial',status:'inactive'});
  const legacy=await s.Warehouse.create({name:'Older custody',warehouse_type:'commercial_custody',custodian_employee_id:legacyOwner.id});
  const legacyBalance=await s.StockBalance.create({warehouse_id:legacy.id,product_id:'product-a',quantity:2,qc_status:'quarantine',expiry_date:'2020-01-01'});
  const read=reportDate=>distributionControlAction(f.client,{id:'gm',role:'admin'},{action:'distributionControl',date:reportDate});
  const current=await read(date);
  assert.equal(current.agents.find(a=>a.id===f.agent.id).has_current_stock,true,'inactive employees remain accountable for physical goods');
  assert.equal(current.agents.find(a=>a.id===legacyOwner.id).has_current_stock,true);
  assert.equal(current.agents.find(a=>a.id===empty.id).has_current_stock,false,'a loaded manifest is not on-hand stock');
  assert.equal(current.agents.find(a=>a.id===cancelled.id).has_current_stock,false,'old issues cannot claim a reused stock location');
  assert.equal(current.runs.find(r=>r.id===voidRun.id).has_current_stock,false);
  assert.equal(current.runs.find(r=>r.id===history.id).has_current_stock,false);
  assert.equal((await read('2021-01-01')).runs.find(r=>r.id===dispatch.id).has_current_stock,true,'the performance date never hides older current holdings');
  await s.Dispatch.create({dispatch_date:date,status:'loaded',salesperson_id:empty.id,vehicle_warehouse_id:dispatch.vehicle_warehouse_id});
  const disputed=await read(date),run=disputed.runs.find(r=>r.id===dispatch.id);
  assert.match(run.error,/Multiple open delivery runs/);assert.equal(run.has_current_stock,true);
  assert.equal(disputed.agents.find(a=>a.id===f.agent.id).has_current_stock,true,'reconciliation errors must not erase actual holdings');
  await s.StockBalance.update(balance.id,{quantity:0,total_value:0});await s.StockBalance.update(legacyBalance.id,{quantity:0});
  const cleared=await read(date);assert.equal(cleared.agents.find(a=>a.id===f.agent.id).has_current_stock,false);
  assert.ok(!cleared.agents.find(a=>a.id===legacyOwner.id)?.has_current_stock);
  const returnBin=await s.Warehouse.create({warehouse_type:'quarantine',customer_supply_return_bin:true,field_return_bin:true,source_warehouse_id:dispatch.vehicle_warehouse_id});
  const packaging=await s.StockBalance.create({warehouse_id:returnBin.id,product_id:'returned-container',quantity:2,total_value:0,unit_cost:0,qc_status:'quarantine'});
  const heldReturns=await read(date);assert.equal(heldReturns.agents.find(a=>a.id===f.agent.id).has_current_stock,true,'a return bin still holds goods after the fresh load is empty');
  assert.equal(heldReturns.runs.find(r=>r.id===dispatch.id).has_current_stock,true);
  await s.StockBalance.update(packaging.id,{quantity:0});assert.equal((await read(date)).agents.find(a=>a.id===f.agent.id).has_current_stock,false);
});

test('warehouse receipt removes a packaging-only holder while retaining the returned run for explicit review',async()=>{
  const f=await setup(),{dispatch}=await f.run(f.body);
  const sale=await supply(f,dispatch),saleLine=(await f.s.FieldSaleLine.list()).find(row=>row.field_sale_id===sale.id);
  await f.s.FieldSaleLine.update(saleLine.id,{quantity:5});
  for(const movement of await f.s.StockMovement.filter({document_id:sale.id}))await f.s.StockMovement.update(movement.id,{quantity:5});
  const fresh=(await f.s.StockBalance.list()).find(row=>row.warehouse_id===dispatch.vehicle_warehouse_id&&row.quantity>0);
  await f.s.StockBalance.update(fresh.id,{quantity:0,total_value:0});
  const container=await f.s.Product.create({name:'Returned cups',inventory_type:'packaging',storage_unit:'ea'});
  const bin=await f.s.Warehouse.create({name:'Vehicle returns',warehouse_type:'quarantine',vehicle_id:dispatch.vehicle_id,field_return_bin:true,is_active:true});
  const packaging=await f.s.StockBalance.create({product_id:container.id,product_name:container.name,warehouse_id:bin.id,lot_number:'RECOVERED-CUPS',qc_status:'quarantine',quantity:2,total_value:0,unit_cost:0,inventory_recovery_id:'EPR-existing',inventory_recovery_source:'sale_exchange',inventory_recovery_receipt_required:true});
  const create=f.s.AuditLog.create;
  f.s.AuditLog.create=async value=>{const row=await create(value);return value.id?f.s.AuditLog.update(row.id,{id:value.id}):row;};
  const ownClient={...f.client,auth:{...f.client.auth,staff:()=>f.s.Employee.get(f.agent.id)}},actor={id:'holder-login',role:'user'};
  const workspace=await unsoldStockReturnAction(ownClient,actor,{action:'unsoldReturnWorkspace'}),load=workspace.runs.find(r=>r.id===dispatch.id);
  assert.equal(load.rows[0].quantity,0);assert.equal(load.collections[0].product_name,'Returned cups');
  const countedLines=load.rows.map(row=>({product_id:row.product_id,quantity:row.quantity}));
  const submitted=await unsoldStockReturnAction(ownClient,actor,{action:'requestUnsoldReturn',dispatchId:dispatch.id,requestKey:crypto.randomUUID(),token:load.token,countedLines,confirmed:true});
  const read=()=>distributionControlAction(f.client,{id:'gm',role:'admin'},{action:'distributionControl',date});
  assert.equal((await read()).agents.find(a=>a.id===f.agent.id).has_current_stock,true);
  await assert.rejects(dispatchAction(f.client,user,{action:'returnDispatchStock',dispatchId:dispatch.id,countedLines,returnRequestId:submitted.request.id}),/warehouse return queue/);
  await unsoldStockReturnAction(f.client,user,{action:'receiveUnsoldReturn',requestId:submitted.request.id,token:load.token,countedLines,confirmed:true});
  const received=await read();assert.equal(received.agents.find(a=>a.id===f.agent.id).has_current_stock,false);
  const historical=received.runs.find(r=>r.id===dispatch.id);assert.equal(historical.status,'returned');assert.equal(historical.has_current_stock,false);
  assert.equal(historical.reconciliation.rows[0].returned,0);
  assert.equal((await f.s.StockBalance.get(packaging.id)).quantity,0);
  const receivedPackaging=(await f.s.StockBalance.list()).find(row=>row.product_id===container.id&&row.warehouse_id!==bin.id&&row.quantity>0);
  assert.equal(receivedPackaging.quantity,2);assert.equal(receivedPackaging.qc_status,'quarantine');assert.ok(receivedPackaging.inventory_recovery_received_at);
});
