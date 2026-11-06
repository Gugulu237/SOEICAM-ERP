import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {fixture,functionRoute,request,date} from './helpers/cashier.mjs';
import {distributionControlAction} from '../src/server/domain/distribution-control.js';
import {unsoldStockReturnAction} from '../src/server/domain/unsold-stock-returns.js';
import {dispatchAction} from '../src/server/domain/dispatch-operations.js';
import {supplyRun} from '../src/server/domain/commercial-runs.js';
import {employeeStockAction} from '../src/server/domain/employee-stock.js';
import {guardMutation} from '../src/server/access.js';
import {stockReceive} from '../src/server/domain/field-ops.js';
import {canOpenFieldPath} from '../src/lib/permissions.js';

const manager={id:'gm',role:'admin'},holder={id:'cashier-login',role:'user'};
async function setup(db,{vehicle=false,issueQuantity=12}={}){
  const f=await fixture(db),s=f.entities;
  for(const name of ['Warehouse','AuditLog']){const create=s[name].create;s[name].create=async value=>{if(!value.id)return create(value);const row=structuredClone(value);if(db)await db.query('INSERT INTO fixture_entity VALUES($1,$2,$3)',[name,row.id,JSON.stringify(row)]);else{assert.ok(!f.rows[name].some(r=>r.id===row.id));f.rows[name].push(row);}return structuredClone(row);};}
  await s.Employee.update('cashier',{role:'employee',full_name:'Goods holder'});await s.Dispatch.deleteMany({});await s.DispatchLine.deleteMany({});await s.Warehouse.update('factory',{warehouse_type:'finished_goods'});
  for(const row of await s.StockBalance.list())await s.StockBalance.update(row.id,{quantity:0,total_value:0});
  await s.StockBalance.create({warehouse_id:'factory',product_id:'product-a',quantity:10,unit_cost:200,total_value:2000,lot_number:'LOT-ONE',expiry_date:'2099-01-31',qc_status:'approved',production_order_id:'production-source',batch_number:'BATCH-ONE'});
  await s.StockBalance.create({warehouse_id:'factory',product_id:'product-a',quantity:10,unit_cost:300,total_value:3000,lot_number:'LOT-TWO',expiry_date:'2099-02-28',qc_status:'approved'});
  const issueBody={action:'issueDistributionStock',commercialId:'cashier',driverId:'',vehicleId:vehicle?'vehicle-a':'',warehouseId:'factory',requestKey:crypto.randomUUID(),lines:[{product_id:'product-a',quantity:issueQuantity}],date};
  const {dispatch}=await distributionControlAction(f.client,manager,issueBody);
  const own=body=>unsoldStockReturnAction(f.client,holder,body),review=body=>unsoldStockReturnAction(f.client,manager,body);
  const input=async()=>{const ws=await own({action:'unsoldReturnWorkspace'}),run=ws.runs.find(r=>r.id===dispatch.id);assert.equal(run.error,'');return {action:'requestUnsoldReturn',dispatchId:dispatch.id,token:run.token,countedLines:run.rows.map(row=>({product_id:row.product_id,quantity:row.quantity})),confirmed:true,notes:'All remaining goods counted',requestKey:crypto.randomUUID()};};
  const submit=async()=>{const body=await input();return {body,...await own(body)};};
  const receiveBody=record=>({action:'receiveUnsoldReturn',requestId:record.id,token:record.token,countedLines:record.rows.map(row=>({product_id:row.product_id,quantity:row.quantity})),confirmed:true});
  return {...f,s,dispatch,own,review,input,submit,receiveBody,issueBody};
}

test('holder requests full unsold load; warehouse receipt conserves batches and costs and retries without another stock move',async()=>{
  const f=await setup(),before=(await f.s.StockMovement.list()).length,{body,request:record}=await f.submit();
  assert.equal(record.status,'pending');assert.equal((await f.s.StockMovement.list()).length,before);assert.equal((await f.s.Dispatch.get(f.dispatch.id)).unsold_return_request_id,record.id);
  assert.equal((await f.own(body)).reused,true);assert.equal((await f.own({action:'unsoldReturnWorkspace'})).runs.length,0);
  const queue=await f.review({action:'unsoldReturnWorkspace',mode:'receive'});assert.equal(queue.requests.length,1);assert.equal(queue.requests[0].error,'');assert.equal(queue.requests[0].can_receive,true);
  await assert.rejects(dispatchAction(f.client,manager,{action:'returnDispatchStock',dispatchId:f.dispatch.id,unsoldReturnRequestId:record.id}),/warehouse return queue/);
  const receive=f.receiveBody(record),result=await f.review(receive);assert.equal(result.request.status,'received');const count=(await f.s.StockMovement.list()).length;
  assert.equal((await f.review(receive)).reused,true);assert.equal((await f.s.StockMovement.list()).length,count);
  const warehouse=(await f.s.StockBalance.filter({warehouse_id:'factory'})).filter(row=>row.quantity>0),held=(await f.s.StockBalance.filter({warehouse_id:f.dispatch.vehicle_warehouse_id})).reduce((sum,row)=>sum+row.quantity,0);
  assert.equal(held,0);assert.equal(warehouse.reduce((sum,row)=>sum+row.quantity,0),20);assert.equal(warehouse.reduce((sum,row)=>sum+row.total_value,0),5000);
  assert.equal(warehouse.filter(row=>row.lot_number==='LOT-ONE').reduce((sum,row)=>sum+row.quantity,0),10);assert.ok(warehouse.some(row=>row.lot_number==='LOT-ONE'&&row.expiry_date==='2099-01-31'&&row.qc_status==='approved'&&row.production_order_id==='production-source'&&row.batch_number==='BATCH-ONE'));
  assert.equal((await f.s.Dispatch.get(f.dispatch.id)).status,'returned');assert.equal((await f.s.Dispatch.get(f.dispatch.id)).unsold_return_request_id,'');assert.equal((await f.s.DispatchLine.filter({dispatch_id:f.dispatch.id}))[0].returned_quantity,12);
  for(const name of ['JournalEntry','Invoice','Payment','TreasuryTransaction'])assert.equal((await f.s[name].list()).length,0,name);
  assert.equal((await f.review({action:'unsoldReturnWorkspace',mode:'receive'})).requests.length,0);
});

test('pending returns reserve sales, exchanges, degustation and extra issues; cancel and reject release only the recorded request',async()=>{
  const f=await setup(),first=await f.submit();
  for(const verifying of [false,true])await assert.rejects(supplyRun(f.client.asServiceRole,'cashier',f.dispatch.id,date,true,verifying),/reserved for warehouse return/);
  await assert.rejects(employeeStockAction(f.client,holder,{action:'recordDegustation',dispatchId:f.dispatch.id,customerId:'customer-a',requestKey:crypto.randomUUID(),lines:[{product_id:'product-a',quantity:1}]}),/reserved for warehouse return/);
  await assert.rejects(distributionControlAction(f.client,manager,{...f.issueBody,requestKey:crypto.randomUUID()}),/open delivery run/);
  await assert.rejects(f.own({...first.body,requestKey:crypto.randomUUID()}),/already has a return/);
  const cancel={action:'cancelUnsoldReturn',requestId:first.request.id,note:'Continue deliveries'};assert.equal((await f.own(cancel)).request.status,'cancelled');assert.equal((await f.own(cancel)).reused,true);
  assert.equal((await supplyRun(f.client.asServiceRole,'cashier',f.dispatch.id,date,true)).dispatch_id,f.dispatch.id);
  const second=await f.submit();await assert.rejects(f.review({action:'rejectUnsoldReturn',requestId:second.request.id,note:''}),/why/);
  assert.equal((await f.review({action:'rejectUnsoldReturn',requestId:second.request.id,note:'Bring the physical goods first'})).request.status,'rejected');
  assert.equal((await f.s.Dispatch.get(f.dispatch.id)).unsold_return_request_id,'');assert.equal((await f.s.StockBalance.filter({warehouse_id:f.dispatch.vehicle_warehouse_id})).reduce((sum,row)=>sum+row.quantity,0),12);
  await assert.rejects(f.review(f.receiveBody(first.request)),/already been resolved/);
});

test('quantity, ownership and role checks prevent beyond-custody returns and unauthorized warehouse receipts',async()=>{
  const f=await setup(),body=await f.input(),before=(await f.s.StockMovement.list()).length;
  for(const change of [{confirmed:false},{countedLines:[]},{countedLines:[{product_id:'product-a',quantity:13}]},{countedLines:[{product_id:'product-a',quantity:-1}]},{countedLines:[{product_id:'product-a',quantity:11}]},{countedLines:[{product_id:'product-a',quantity:true}]},{countedLines:[{product_id:'product-a',quantity:12.0001}]},{employeeId:'someone-else'},{dispatchId:'other-run'}])await assert.rejects(f.own({...body,...change}));
  assert.equal((await f.s.StockMovement.list()).length,before);assert.ok(!(await f.s.Dispatch.get(f.dispatch.id)).unsold_return_request_id);
  const {request:record}=await f.own(body);
  await assert.rejects(f.own(f.receiveBody(record)),/Not permitted/);await assert.rejects(f.own({action:'unsoldReturnWorkspace',mode:'receive'}),/Not permitted/);
  await assert.rejects(f.review({...f.receiveBody(record),countedLines:[{product_id:'product-a',quantity:13}]}),/physical return count/);
  await f.s.Employee.update('cashier',{role:'hotesse'});await assert.rejects(f.own({action:'unsoldReturnWorkspace'}),/Not permitted/);
  await f.s.Employee.update('cashier',{role:'employee',status:'inactive'});await assert.rejects(f.own({action:'unsoldReturnWorkspace'}),/active/);
  for(const [entity,payload,existing] of [['Dispatch',{unsold_return_request_id:'fake'}],['Dispatch',{status:'returned'},{unsold_return_request_id:'request'}],['AuditLog',{unsold_return_request:{dispatch_id:'fake'}}]])assert.throws(()=>guardMutation({user:manager,employee:null,role:'admin'},entity,'update',payload,existing),/checked return workflow/);
});

test('either assigned driver or holder can request and cancel the same vehicle load without accessing another team',async()=>{
  const f=await setup(undefined,{vehicle:true}),driver=await f.s.Employee.create({id:'ignored-driver-id',role:'driver',status:'active',full_name:'Paired driver',user_id:'driver-login'});
  await f.s.Dispatch.update(f.dispatch.id,{driver_id:driver.id,driver_name:driver.full_name});
  const other=await f.s.Employee.create({role:'employee',status:'active',full_name:'Unassigned employee',user_id:'other-login'});
  f.client.auth.staff=async()=>driver;
  const driverAction=body=>unsoldStockReturnAction(f.client,{id:'driver-login',role:'user'},body),ws=await driverAction({action:'unsoldReturnWorkspace'});assert.equal(ws.runs.length,1);
  const body={action:'requestUnsoldReturn',dispatchId:f.dispatch.id,token:ws.runs[0].token,countedLines:[{product_id:'product-a',quantity:12}],confirmed:true,requestKey:crypto.randomUUID()},result=await driverAction(body);
  f.client.auth.staff=async()=>other;assert.equal((await unsoldStockReturnAction(f.client,{id:'other-login',role:'user'},{action:'unsoldReturnWorkspace'})).requests.length,0);
  await assert.rejects(unsoldStockReturnAction(f.client,{id:'other-login',role:'user'},{action:'cancelUnsoldReturn',requestId:result.request.id}),/own assigned/);
  f.client.auth.staff=async()=>await f.s.Employee.get('cashier');assert.equal((await f.own({action:'cancelUnsoldReturn',requestId:result.request.id})).request.status,'cancelled');
});

test('changed batch or cost evidence blocks stale receipt and keeps the load reserved for investigation',async()=>{
  const f=await setup(),{request:record}=await f.submit(),lot=(await f.s.StockBalance.filter({warehouse_id:f.dispatch.vehicle_warehouse_id})).find(row=>row.quantity>0);
  await f.s.StockBalance.update(lot.id,{lot_number:'CHANGED-BATCH'});
  const queue=await f.review({action:'unsoldReturnWorkspace',mode:'receive'});assert.match(queue.requests[0].error,/load changed/i);assert.equal(queue.requests[0].can_receive,true);
  await assert.rejects(f.review(f.receiveBody(record)),/load changed/i);assert.equal((await f.s.Dispatch.get(f.dispatch.id)).unsold_return_request_id,record.id);
  assert.equal((await f.s.StockBalance.filter({warehouse_id:f.dispatch.vehicle_warehouse_id})).reduce((sum,row)=>sum+row.quantity,0),12);
  await f.review({action:'rejectUnsoldReturn',requestId:record.id,note:'Reconcile changed batch evidence'});assert.equal((await f.s.Dispatch.get(f.dispatch.id)).unsold_return_request_id,'');
});

test('the actual API transaction rolls back a failed receipt and its retry transfers stock once',async()=>{
  const db=new PGlite();try{
    const f=await setup(db),route=await functionRoute();globalThis.__cashierClient=f.client;globalThis.__cashierTransaction=async fn=>{await db.exec('BEGIN');try{const result=await fn();await db.exec('COMMIT');return result;}catch(error){await db.exec('ROLLBACK');throw error;}};
    f.client.auth.me=async()=>holder;const body=await f.input();let response=await route(request(body),{params:Promise.resolve({name:'fieldOps'})});assert.equal(response.status,200);const {request:record}=await response.json(),receipt=f.receiveBody(record);
    response=await route(request(receipt),{params:Promise.resolve({name:'fieldOps'})});assert.equal(response.status,400);assert.equal((await f.s.Dispatch.get(f.dispatch.id)).status,'loaded');
    f.client.auth.me=async()=>manager;const before=(await f.s.StockMovement.list()).length,create=f.s.AuditLog.create;
    f.s.AuditLog.create=async value=>{if(value.action==='receiveUnsoldReturn')throw Error('Simulated receipt audit failure');return create(value);};
    response=await route(request(receipt),{params:Promise.resolve({name:'fieldOps'})});assert.equal(response.status,400);assert.equal((await f.s.StockMovement.list()).length,before);assert.equal((await f.s.Dispatch.get(f.dispatch.id)).status,'loaded');assert.equal((await f.s.Dispatch.get(f.dispatch.id)).unsold_return_request_id,record.id);
    f.s.AuditLog.create=create;response=await route(request(receipt),{params:Promise.resolve({name:'fieldOps'})});assert.equal(response.status,200,JSON.stringify(await response.clone().json()));const count=(await f.s.StockMovement.list()).length;
    response=await route(request(receipt),{params:Promise.resolve({name:'fieldOps'})});assert.equal(response.status,200);assert.equal((await response.json()).reused,true);assert.equal((await f.s.StockMovement.list()).length,count);assert.equal((await f.s.JournalEntry.list()).length,0);
  }finally{delete globalThis.__cashierClient;delete globalThis.__cashierTransaction;await db.close();}
});

test('a whole return preserves exact carried value when the rounded unit cost cannot represent it',async()=>{
  const f=await setup(undefined,{issueQuantity:3}),lot=(await f.s.StockBalance.filter({warehouse_id:f.dispatch.vehicle_warehouse_id})).find(row=>row.quantity>0);
  await f.s.StockBalance.update(lot.id,{quantity:3,unit_cost:33.33,total_value:100});
  const before=(await f.s.StockBalance.filter({warehouse_id:'factory'})).reduce((sum,row)=>sum+row.total_value,0),{request:record}=await f.submit();
  await f.review(f.receiveBody(record));
  const after=(await f.s.StockBalance.filter({warehouse_id:'factory'})).reduce((sum,row)=>sum+row.total_value,0);assert.equal(after-before,100);assert.equal((await f.s.StockBalance.get(lot.id)).total_value,0);
  const returned=(await f.s.StockMovement.filter({document_id:f.dispatch.id,movement_type:'warehouse_transfer'})).filter(row=>row.source_warehouse_id===f.dispatch.vehicle_warehouse_id||row.destination_warehouse_id==='factory');
  assert.equal(returned.length,2);assert.deepEqual(returned.map(row=>row.total_value),[100,100]);assert.equal((await f.s.Dispatch.get(f.dispatch.id)).total_returned_value,100);assert.equal((await f.s.JournalEntry.list()).length,0);
});

test('all actual quarantine bins are disclosed and snapshotted, including earlier-run recovered packaging',async()=>{
  const f=await setup(undefined,{vehicle:true}),bin=await f.s.Warehouse.create({name:'Earlier collected returns',warehouse_type:'quarantine',vehicle_id:'vehicle-a',field_return_bin:true,is_active:true}),packaging=await f.s.Product.create({name:'Recovered cups',inventory_type:'raw_material',unit_of_measure:'units'});
  const lot=await f.s.StockBalance.create({warehouse_id:bin.id,product_id:packaging.id,product_name:packaging.name,quantity:2,unit_cost:0,total_value:0,lot_number:'RECOVERED-OLD',qc_status:'quarantine',inventory_recovery_source:'sale_exchange',inventory_recovery_return_id:'older-return'});
  await f.s.SpoilageRecord.create({id:'ignored-old-return',record_type:'field_expired_return',collection_warehouse_id:bin.id,dispatch_id:'earlier-run',product_name:'Original yogurt',quantity:2,status:'replaced'});
  const ws=await f.own({action:'unsoldReturnWorkspace'});assert.equal(ws.runs[0].collections.length,1);assert.equal(ws.runs[0].collections[0].product_name,'Recovered cups');assert.equal(ws.runs[0].collections[0].quantity,2);
  const {request:record}=await f.submit();
  await f.s.StockBalance.update(lot.id,{quantity:3});await assert.rejects(f.review(f.receiveBody(record)),/load changed/i);
  assert.equal((await f.s.Dispatch.get(f.dispatch.id)).status,'loaded');assert.equal((await f.s.StockBalance.get(lot.id)).quantity,3);
});

test('unverified customer exchanges block return reservation so verification is still possible',async()=>{
  const f=await setup(undefined,{vehicle:true});await f.s.SpoilageRecord.create({record_type:'field_expired_request',vehicle_id:'vehicle-a',dispatch_id:'earlier-run',status:'pending_verification'});
  const workspace=await f.own({action:'unsoldReturnWorkspace'});assert.match(workspace.runs[0].error,/Verify or reject pending/);assert.ok(!(await f.s.Dispatch.get(f.dispatch.id)).unsold_return_request_id);
  assert.equal((await supplyRun(f.client.asServiceRole,'cashier',f.dispatch.id,date,true,true)).dispatch_id,f.dispatch.id);
});

test('exact-value receipts merge numeric existing quantities and reject invalid target values before receiving',async()=>{
  const f=await setup(),s=f.s,target=await s.StockBalance.create({warehouse_id:'factory',product_id:'product-a',quantity:'3',unit_cost:33.33,total_value:'100',lot_number:'WEIGHTED',qc_status:'approved'});
  const body={productId:'product-a',productName:'Product',warehouseId:'factory',quantity:3,unitCost:33.33,totalValue:100,lotNumber:'WEIGHTED',movementType:'warehouse_transfer',documentType:'Dispatch',documentId:f.dispatch.id};
  await stockReceive(f.client.asServiceRole,body);const merged=await s.StockBalance.get(target.id);assert.equal(merged.quantity,6);assert.equal(merged.total_value,200);assert.equal(merged.unit_cost,33.33);
  for(const patch of [{quantity:-1},{quantity:'invalid'},{total_value:-1},{total_value:'invalid'},{quantity:0,total_value:10}]){
    await s.StockBalance.update(target.id,{quantity:6,total_value:200,...patch});const before=(await s.StockMovement.list()).length;
    await assert.rejects(stockReceive(f.client.asServiceRole,body),/receiving lot/);assert.equal((await s.StockMovement.list()).length,before);
  }
});

test('the own-return route is available to issued-stock roles without granting the warehouse queue',()=>{
  for(const role of ['driver','commercial','employee','procurement','warehouse_manager','cashier','production_manager'])assert.equal(canOpenFieldPath(role,'/my-stock/returns'),true);
  assert.equal(canOpenFieldPath('hotesse','/my-stock/returns'),false);assert.equal(canOpenFieldPath('driver','/purchases?section=receiving'),false);
});
