import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {fixture,user,date,functionRoute,request} from './helpers/cashier.mjs';
import {distributionControlAction} from '../src/server/domain/distribution-control.js';
import {topUpDispatchStock,dispatchAction,dispatchReconciliationData,DISPATCH_TOP_UP_POLICY} from '../src/server/domain/dispatch-operations.js';
import {stockIssue,postJournal} from '../src/server/domain/field-ops.js';
import {runManifest} from '../src/server/domain/commercial-runs.js';

async function setup({db,vehicle=false,quantity=5}={}){
 const f=await fixture(db),s=f.entities;
 await s.Employee.update('cashier',{role:'warehouse_manager'});await s.Dispatch.deleteMany({});await s.DispatchLine.deleteMany({});
 for(const row of await s.StockBalance.list())await s.StockBalance.update(row.id,{quantity:0,total_value:0});
 await s.Warehouse.update('factory',{warehouse_type:'cold_room',is_active:true});
 const recipient=await s.Employee.create({full_name:'Synthetic stock holder',role:'commercial',status:'active'}),driver=vehicle?await s.Employee.create({full_name:'Synthetic driver',role:'driver',status:'active'}):null;
 const stock=await s.StockBalance.create({product_id:'product-a',product_name:'YOLA',warehouse_id:'factory',quantity:20,unit_cost:100,total_value:2000,lot_number:'TOPUP-LOT',expiry_date:'2099-01-01',qc_status:'approved'});
 const create=s.AuditLog.create;s.AuditLog.create=async value=>{if(!value.id)return create(value);if(db){await db.query('INSERT INTO fixture_entity VALUES($1,$2,$3)',['AuditLog',value.id,JSON.stringify(value)]);return structuredClone(value);}const row=await create(value);return s.AuditLog.update(row.id,{id:value.id});};
 const base={action:'issueDistributionStock',commercialId:recipient.id,driverId:driver?.id||'',vehicleId:vehicle?'vehicle-a':'',warehouseId:'factory',date,requestKey:crypto.randomUUID(),lines:[{product_id:'product-a',quantity,degustation_quantity:0}]};
 const issued=await distributionControlAction(f.client,user,base),dispatch=issued.dispatch;
 const body={...base,requestKey:crypto.randomUUID(),existingDispatchId:dispatch.id,topUpPolicy:DISPATCH_TOP_UP_POLICY,lines:[{product_id:'product-a',quantity:3,degustation_quantity:0}],notes:'Second physical loading'};
 return {...f,s,recipient,driver,stock,dispatch,body,top:async(changes={})=>topUpDispatchStock(f.client.asServiceRole,user,await s.Dispatch.get(dispatch.id),{...body,...changes})};
}
const state=async f=>Object.fromEntries(await Promise.all(['Dispatch','DispatchLine','DispatchRequest','StockBalance','StockMovement','JournalEntry','JournalLine','AuditLog','Account','PostingRule'].map(async name=>[name,await f.s[name].list()])));

test('additional loading extends one open employee run with exact lot value and an immutable retry-safe delta',async()=>{
 const f=await setup(),initialRequests=(await f.s.DispatchRequest.list()).length,result=await f.top(),s=f.s;
 assert.equal(result.dispatch.id,f.dispatch.id);assert.equal(result.reused,false);assert.equal(result.totalValue,300);assert.equal(result.addition.policy,DISPATCH_TOP_UP_POLICY);
 assert.equal((await s.Dispatch.list()).length,1);assert.equal((await s.DispatchRequest.list()).length,initialRequests);assert.equal((await s.StockBalance.get(f.stock.id)).quantity,12);
 const line=(await s.DispatchLine.filter({dispatch_id:f.dispatch.id}))[0];assert.equal(line.loaded_quantity,8);assert.equal(line.loaded_value,800);assert.equal(line.requested_quantity,8);assert.equal((await s.Dispatch.get(f.dispatch.id)).total_loaded_value,800);
 const added=await s.StockMovement.filter({dispatch_load_addition_id:result.addition.id});assert.equal(added.length,2);assert.ok(added.every(row=>row.movement_date===date&&row.total_value===300&&row.document_id===f.dispatch.id));
 const recon=await dispatchReconciliationData(f.client.asServiceRole,result.dispatch);assert.equal(recon.hasVariance,false);assert.equal(recon.rows[0].actual,8);assert.equal((await s.JournalEntry.list()).length,0);
 const before=await state(f),retry=await f.top();assert.equal(retry.reused,true);assert.deepEqual(await state(f),before);
});

test('a compatible paired vehicle run accepts extra goods without creating another assignment or financial posting',async()=>{
 const f=await setup({vehicle:true}),result=await distributionControlAction(f.client,user,f.body);
 assert.equal(result.dispatch.id,f.dispatch.id);assert.equal(result.dispatch.vehicle_id,'vehicle-a');assert.equal(result.dispatch.driver_id,f.driver.id);assert.equal(result.vehicleWarehouseId,'van-stock');
 assert.equal((await f.s.Dispatch.list()).length,1);assert.equal((await f.s.JournalEntry.list()).length,0);assert.equal((await dispatchReconciliationData(f.client.asServiceRole,result.dispatch)).hasVariance,false);
});

test('an existing run can gain another finished product while retaining one cumulative manifest row per product',async()=>{
 const f=await setup(),s=f.s,other=await s.Product.create({name:'Other finished yogurt',inventory_type:'assembly',storage_unit:'ea',is_active:true,selling_price:250});
 await s.StockBalance.create({product_id:other.id,warehouse_id:'factory',quantity:5,unit_cost:80,total_value:400,lot_number:'OTHER',expiry_date:'2099-01-01',qc_status:'approved'});
 const result=await f.top({lines:[{product_id:'product-a',quantity:2},{product_id:other.id,quantity:3}]}),rows=await s.DispatchLine.filter({dispatch_id:f.dispatch.id});
 assert.equal(rows.length,2);assert.equal(rows.find(row=>row.product_id==='product-a').loaded_quantity,7);assert.equal(rows.find(row=>row.product_id===other.id).loaded_quantity,3);assert.equal(result.totalValue,440);assert.equal((await dispatchReconciliationData(f.client.asServiceRole,result.dispatch)).hasVariance,false);
});

test('a committed top-up retries without writes after subsequent supplies, a return and a later business date',async()=>{
 const f=await setup(),result=await f.top(),s=f.s;
 const sale=await s.FieldSale.create({dispatch_id:f.dispatch.id,status:'approved_posted',commercial_id:f.recipient.id,stock_moved_at:new Date().toISOString()});await s.FieldSaleLine.create({field_sale_id:sale.id,product_id:'product-a',quantity:2,line_total:500});
 await stockIssue(f.client.asServiceRole,{productId:'product-a',warehouseId:f.dispatch.vehicle_warehouse_id,quantity:2,movementType:'field_delivery',documentType:'FieldSale',documentId:sale.id,movementDate:date,saleableOnly:true,preserveRecordedValue:true});
 assert.equal((await f.top()).reused,true);
 await dispatchAction(f.client,user,{action:'returnDispatchStock',dispatchId:f.dispatch.id,countedLines:[{product_id:'product-a',quantity:6}]});
 const OriginalDate=globalThis.Date,before=await state(f);globalThis.Date=class extends OriginalDate{constructor(...args){super(...(args.length?args:[OriginalDate.now()+86400000]));}};
 try{const retry=await f.top();assert.equal(retry.reused,true);assert.equal(retry.addition.id,result.addition.id);assert.equal(retry.dispatch.status,'returned');assert.deepEqual(await state(f),before);}finally{globalThis.Date=OriginalDate;}
});

test('unreviewed policies and changed employee, driver, vehicle, source or payload cannot add or repeat goods',async()=>{
 const f=await setup(),before=await state(f);
 for(const change of [{topUpPolicy:''},{commercialId:'other'},{driverId:'other'},{vehicleId:'vehicle-a'},{warehouseId:'other'},{existingDispatchId:'other'},{requestKey:'bad'},{lines:[{product_id:'product-a',quantity:true}]},{lines:[{product_id:'product-a',quantity:1.00001}]},{lines:[{product_id:'product-a',quantity:1,degustation_quantity:2}]}])await assert.rejects(f.top(change));
 assert.deepEqual(await state(f),before);
 await f.top();const after=await state(f);await assert.rejects(f.top({notes:'Changed submitted loading'}),/already used/);assert.deepEqual(await state(f),after);
});

test('pending returns, return-to-base reports, unresolved exchanges and stock-moved unposted supplies block top-ups before writes',async()=>{
 const changes=[async f=>f.s.Dispatch.update(f.dispatch.id,{unsold_return_request_id:'pending'}),async f=>f.s.Dispatch.update(f.dispatch.id,{return_date:'2026-01-01'}),async f=>f.s.DriverActivity.create({dispatch_id:f.dispatch.id,type:'trip_returned'}),async f=>f.s.SpoilageRecord.create({dispatch_id:f.dispatch.id,record_type:'field_expired_request',status:'pending_verification'}),async f=>f.s.FieldSale.create({dispatch_id:f.dispatch.id,status:'submitted',stock_moved_at:'2026-01-01'}),async f=>f.s.SalesOrder.create({dispatch_id:f.dispatch.id,status:'draft',stock_moved_at:'2026-01-01'})];
 for(const change of changes){const f=await setup();await change(f);const before=await state(f);await assert.rejects(f.top());assert.deepEqual(await state(f),before);}
});

test('duplicate assignments, stock variances and incomplete original transfer or manifest evidence cannot be covered by new goods',async()=>{
 const changes=[async f=>f.s.Dispatch.create({status:'loaded',salesperson_id:f.recipient.id,vehicle_warehouse_id:'another'}),async f=>{const balance=(await f.s.StockBalance.filter({warehouse_id:f.dispatch.vehicle_warehouse_id}))[0];await f.s.StockBalance.update(balance.id,{quantity:4,total_value:400});},async f=>{const movement=(await f.s.StockMovement.list())[0];await f.s.StockMovement.update(movement.id,{total_value:999});},async f=>{const line=(await f.s.DispatchLine.list())[0];await f.s.DispatchLine.create({...line,id:undefined});},async f=>f.s.Dispatch.update(f.dispatch.id,{total_loaded_value:999})];
 for(const change of changes){const f=await setup();await change(f);const before=await state(f);await assert.rejects(f.top());assert.deepEqual(await state(f),before);}
});

test('actual outbound issues awaiting accounting block additions even when their headers lack a stock-moved flag',async()=>{
 for(const field of [true,false]){const f=await setup(),s=f.s,entity=field?'FieldSale':'SalesOrder',document=await s[entity].create({dispatch_id:f.dispatch.id,status:field?'submitted':'confirmed'}),balance=(await s.StockBalance.filter({warehouse_id:f.dispatch.vehicle_warehouse_id}))[0];
  await stockIssue(f.client.asServiceRole,{productId:'product-a',warehouseId:balance.warehouse_id,quantity:1,movementType:field?'field_delivery':'customer_delivery',documentType:entity,documentId:document.id,movementDate:date,saleableOnly:true,preserveRecordedValue:true});
  assert.equal((await dispatchReconciliationData(f.client.asServiceRole,await s.Dispatch.get(f.dispatch.id))).hasVariance,false);
  const before=await state(f);await assert.rejects(f.top(),/Complete accounting/);assert.deepEqual(await state(f),before);
 }
});

test('warehouse stock must be enough, approved, unexpired and recorded with a valid carrying value',async()=>{
 for(const change of [{quantity:1,total_value:100},{qc_status:'quarantine'},{expiry_date:'2020-01-01'},{total_value:null}]){const f=await setup();await f.s.StockBalance.update(f.stock.id,change);const before=await state(f);await assert.rejects(f.top());assert.deepEqual(await state(f),before);}
});

test('invalid carrying value on another selected product blocks the whole addition before any first-product transfer',async()=>{
 const f=await setup(),s=f.s,other=await s.Product.create({name:'Invalid-cost finished product',inventory_type:'assembly',storage_unit:'ea',is_active:true});await s.StockBalance.create({product_id:other.id,warehouse_id:'factory',quantity:5,unit_cost:80,total_value:null,lot_number:'INVALID',expiry_date:'2099-01-01',qc_status:'approved'});
 const before=await state(f);await assert.rejects(f.top({lines:[{product_id:'product-a',quantity:2},{product_id:other.id,quantity:1}]}));assert.deepEqual(await state(f),before);
});

test('a retry rejects detached or edited transfer evidence and cannot create a second addition',async()=>{
 for(const change of [async(f,result)=>{const row=(await f.s.StockMovement.filter({dispatch_load_addition_id:result.addition.id}))[0];await f.s.StockMovement.update(row.id,{total_value:999});},async(f,result)=>{const row=(await f.s.StockMovement.filter({dispatch_load_addition_id:result.addition.id}))[0];await f.s.StockMovement.update(row.id,{dispatch_load_addition_id:''});},async(f,result)=>f.s.AuditLog.update(result.addition.id,{dispatch_load_addition_checksum:'changed'})]){const f=await setup(),result=await f.top();await change(f,result);const before=await state(f);await assert.rejects(f.top());assert.deepEqual(await state(f),before);}
});

test('top-ups preserve protected zero-value Dégustation custody, expense only fresh giveaways and return mixed stock correctly',async()=>{
 const f=await setup({quantity:13}),s=f.s,dispatch=f.dispatch,line=(await s.DispatchLine.list())[0],held=(await s.StockBalance.filter({warehouse_id:dispatch.vehicle_warehouse_id}))[0],inventoryRule=(await s.PostingRule.filter({rule_key:'finished_goods_inventory'}))[0];
 await s.Account.update(inventoryRule.account_id,{account_type:'asset',normal_balance:'debit'});await s.Account.update('expense',{normal_balance:'debit'});
 const originalExpense=await postJournal(f.client.asServiceRole,{entryDate:date,description:'Synthetic earlier Dégustation appropriation',sourceModule:'degustation',sourceDocumentType:'DegustationAppropriation',sourceDocumentId:'DGA-SYNTHETIC',userId:user.id,lines:[{account_id:'expense',debit:1300,credit:0},{account_id:inventoryRule.account_id,debit:0,credit:1300}]});
 const marker={degustation_appropriation_id:'DGA-SYNTHETIC',degustation_appropriation_dispatch_id:dispatch.id,degustation_appropriation_expense_account_id:'expense',degustation_appropriation_inventory_account_id:inventoryRule.account_id,degustation_appropriation_quantity:13,degustation_appropriation_value:1300};
 await s.StockBalance.update(held.id,{total_value:0,unit_cost:0,...marker});await s.DispatchLine.update(line.id,{degustation_quantity:13});await s.Dispatch.update(dispatch.id,{degustation_appropriation:{id:'DGA-SYNTHETIC',policy:'legacy-degustation-appropriation-v1',dispatch_id:dispatch.id,expense_account_id:'expense',total_quantity:13,total_value:1300,journal_id:originalExpense.journal.id}});
 const old=await s.StockBalance.get(held.id),first=await f.top({lines:[{product_id:'product-a',quantity:3,degustation_quantity:2}]}),remaining=(await runManifest(f.client.asServiceRole,dispatch.id,dispatch.vehicle_warehouse_id)).get('product-a');
 assert.deepEqual(await s.StockBalance.get(held.id),old);assert.equal(remaining,1);assert.equal((await s.StockBalance.filter({warehouse_id:dispatch.vehicle_warehouse_id})).reduce((sum,row)=>sum+row.quantity,0),14);
 const giveaway=await s.StockMovement.filter({document_type:'Degustation',document_id:'DEG-ISSUE-'+first.addition.id});assert.equal(giveaway.length,1);assert.equal(giveaway[0].quantity,2);assert.equal(giveaway[0].total_value,200);assert.equal(giveaway[0].degustation_already_expensed,undefined);
 assert.equal((await dispatchReconciliationData(f.client.asServiceRole,first.dispatch)).hasVariance,false);
 const second=await f.top({requestKey:crypto.randomUUID(),lines:[{product_id:'product-a',quantity:2,degustation_quantity:1}]});assert.notEqual(first.addition.id,second.addition.id);assert.equal((await s.JournalEntry.filter({source_document_type:'Degustation'})).length,2);assert.deepEqual(await s.StockBalance.get(held.id),old);
 assert.equal((await f.top({lines:[{product_id:'product-a',quantity:3,degustation_quantity:2}]})).reused,true);
 await dispatchAction(f.client,user,{action:'returnDispatchStock',dispatchId:dispatch.id,countedLines:[{product_id:'product-a',quantity:15}]});
 const source=(await s.StockBalance.filter({warehouse_id:'factory'})).reduce((sum,row)=>sum+row.quantity,0);assert.equal(source,17);assert.equal((await s.Dispatch.get(dispatch.id)).status,'returned');assert.equal((await s.JournalEntry.filter({source_document_type:'DegustationReturn'})).length,1);
});

test('a late top-up failure rolls its stock, manifest, giveaway expense and delta audit back before an identical retry',async()=>{
 const db=new PGlite();try{
  const f=await setup({db}),s=f.s,inventoryRule=(await s.PostingRule.filter({rule_key:'finished_goods_inventory'}))[0];await s.Account.update(inventoryRule.account_id,{account_type:'asset',normal_balance:'debit'});
  const body={...f.body,lines:[{product_id:'product-a',quantity:3,degustation_quantity:1}]},before=await state(f),create=s.AuditLog.create;
  s.AuditLog.create=async value=>{if(value.action==='add_dispatch_stock')throw Error('Synthetic late top-up failure');return create(value);};
  const route=await functionRoute();globalThis.__cashierClient=f.client;globalThis.__cashierTransaction=async fn=>{await db.exec('BEGIN');try{const result=await fn();await db.exec('COMMIT');return result;}catch(error){await db.exec('ROLLBACK');throw error;}};
  let response=await route(request(body),{params:Promise.resolve({name:'fieldOps'})});assert.equal(response.status,400,JSON.stringify(await response.clone().json()));assert.match((await response.json()).error,/Synthetic late/);assert.deepEqual(await state(f),before);
  s.AuditLog.create=create;response=await route(request(body),{params:Promise.resolve({name:'fieldOps'})});assert.equal(response.status,200,JSON.stringify(await response.clone().json()));const result=await response.json();assert.equal(result.dispatch.id,f.dispatch.id);assert.equal((await s.Dispatch.list()).length,1);assert.equal((await s.StockBalance.get(f.stock.id)).quantity,12);assert.equal((await s.JournalEntry.filter({source_document_type:'Degustation'})).length,1);
  const after=await state(f);response=await route(request(body),{params:Promise.resolve({name:'fieldOps'})});assert.equal(response.status,200,JSON.stringify(await response.clone().json()));assert.equal((await response.json()).reused,true);assert.deepEqual(await state(f),after);
 }finally{delete globalThis.__cashierClient;delete globalThis.__cashierTransaction;await db.close();}
});
