import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,date,user} from './helpers/cashier.mjs';
import {centralCutoverQuantities} from '../src/server/domain/central-cutover-reconciliation.js';
import {dispatchReconciliationData,dispatchAction,topUpDispatchStock} from '../src/server/domain/dispatch-operations.js';
import {CENTRAL_INVENTORY_POLICY} from '../src/server/domain/centralized-inventory-policy.js';
import {centralPromotionalHandoff,PROMOTIONAL_HANDOFF_POLICY} from '../src/server/domain/central-promotional-handoff.js';
import {guardMutation} from '../src/server/access.js';

async function setup({zero=false}={}){
 const f=await fixture(),s=f.entities;
 for(const name of ['Warehouse','AuditLog','StockMovement','StockBalance']){const create=s[name].create;s[name].create=async value=>{if(!value.id)return create(value);const row=structuredClone(value);assert.ok(!f.rows[name].some(old=>old.id===row.id));f.rows[name].push(row);return row;};}
 const config={policy:CENTRAL_INVENTORY_POLICY,enabled:true,effective_date:date,activation_id:'CIA-'+'2'.repeat(64),central_warehouse_id:'central-pool'};
 await s.Warehouse.create({id:config.central_warehouse_id,warehouse_type:'general',is_active:true,central_inventory_pool:true});
 const marker={central_inventory_cutover_id:config.activation_id,central_inventory_cutover_policy:CENTRAL_INVENTORY_POLICY};
 const line={product_id:'product-a',quantity:10,total_value:2000,source_balance_id:'stock',source_movement_id:'cutover-source',destination_movement_id:'cutover-destination',destination_balance_id:'central-stock',lot_number:'LOT',expiry_date:'',qc_status:'approved',production_order_id:'',batch_number:''};
 const runProof={dispatch_id:'run-a',source_warehouse_id:'van-stock',quantity:zero?0:10,total_value:zero?0:2000,completed:!zero,lines:zero?[]:[line]};
 if(!zero){
  await s.StockBalance.update('stock',{quantity:0,total_value:0,unit_cost:0,...marker});
  await s.StockBalance.create({id:line.destination_balance_id,product_id:line.product_id,warehouse_id:config.central_warehouse_id,quantity:line.quantity,total_value:line.total_value,unit_cost:200,lot_number:line.lot_number,expiry_date:'',qc_status:'approved',...marker,central_inventory_cutover_source_balance_id:line.source_balance_id,central_inventory_cutover_dispatch_id:'run-a'});
  const movement={product_id:line.product_id,quantity:line.quantity,total_value:line.total_value,unit_cost:200,document_type:'CentralInventoryCutover',document_id:config.activation_id,dispatch_id:'run-a',movement_type:'warehouse_transfer',movement_date:date,status:'approved',lot_number:line.lot_number,expiry_date:'',qc_status:'approved',...marker,central_inventory_cutover_source_balance_id:line.source_balance_id,central_inventory_cutover_destination_balance_id:line.destination_balance_id,no_physical_return:true};
  await s.StockMovement.create({id:line.source_movement_id,...movement,source_warehouse_id:'van-stock'});await s.StockMovement.create({id:line.destination_movement_id,...movement,destination_warehouse_id:config.central_warehouse_id});
 }
 const dispatch=await s.Dispatch.update('run-a',{status:zero?'loaded':'completed',...marker,central_inventory_cutover_date:date,central_inventory_cutover_quantity:runProof.quantity,central_inventory_cutover_no_physical_return:true});
 const proof={policy:CENTRAL_INVENTORY_POLICY,id:config.activation_id,central_warehouse_id:config.central_warehouse_id,runs:[runProof]};
 await s.AuditLog.create({id:config.activation_id,action:'activate_central_inventory',module:'inventory',entity_type:'CompanySettings',entity_id:'settings',user_id:'gm',audit_source:'server_verified',centralized_inventory_policy:CENTRAL_INVENTORY_POLICY,centralized_inventory_activation:config,central_inventory_cutover:proof});
 await s.CompanySettings.update('settings',{centralized_inventory:config});
 return {...f,s,config,dispatch,proof,line,marker};
}

test('company-stock cutover is disclosed separately and never rewrites loaded, sold or physically returned quantities',async()=>{
 const f=await setup(),before=structuredClone(f.rows),quantities=await centralCutoverQuantities(f.s,f.dispatch),reconciliation=await dispatchReconciliationData(f.client.asServiceRole,f.dispatch),row=reconciliation.rows[0];
 assert.deepEqual([...quantities],[['product-a',10]]);assert.equal(row.loaded,10);assert.equal(row.centralized_quantity,10);assert.equal(row.returned,0);assert.equal(row.sold,0);assert.equal(row.expected,0);assert.equal(row.actual,0);assert.equal(row.variance,0);assert.equal(reconciliation.hasVariance,false);assert.deepEqual(f.rows,before);assert.equal(f.rows.JournalEntry.length,0);
});

test('manual promotional handoff removes employee custody without inventing a sale, return, giveaway or second expense',async()=>{
 const f=await setup({zero:true}),id='CPH-test',appropriation={id:'DGA-test',policy:'legacy-degustation-appropriation-v1',expense_account_id:'marketing',total_quantity:10,total_value:2000},original={...await f.s.StockBalance.get('stock'),unit_cost:0,total_value:0,degustation_appropriation_id:'DGA-test',degustation_appropriation_dispatch_id:'run-a',degustation_appropriation_quantity:10,degustation_appropriation_value:2000,degustation_appropriation_expense_account_id:'marketing',degustation_appropriation_inventory_account_id:'inventory'};
 const manifest=(await f.s.DispatchLine.filter({dispatch_id:'run-a'}))[0];await f.s.DispatchLine.update(manifest.id,{degustation_quantity:10});
 await f.s.StockBalance.update('stock',{quantity:0,unit_cost:0,total_value:0,central_promotional_handoff_id:id});
 const proof={policy:PROMOTIONAL_HANDOFF_POLICY,date,activation_id:f.config.activation_id,dispatch_id:'run-a',source_warehouse_id:'van-stock',appropriation_id:'DGA-test',total_quantity:10,original_cost:2000,balances:[original]};
 await f.s.AuditLog.create({id,action:'handoff_expensed_degustation',module:'inventory',entity_type:'Dispatch',entity_id:'run-a',audit_source:'server_verified',user_id:'gm',central_promotional_handoff:proof});
 const movement=await f.s.StockMovement.create({id:'handoff-movement',product_id:'product-a',quantity:10,unit_cost:0,total_value:0,lot_number:'LOT',document_type:'CentralPromotionalHandoff',document_id:id,movement_type:'promotional_issue',movement_date:date,status:'approved',source_warehouse_id:'van-stock',dispatch_id:'run-a',central_promotional_source_balance_id:'stock',central_promotional_handoff_id:id,central_promotional_original_cost:2000});
 const dispatch=await f.s.Dispatch.update('run-a',{status:'completed',central_promotional_handoff_id:id,degustation_appropriation:appropriation});
 const before=structuredClone(f.rows),result=await dispatchReconciliationData(f.client.asServiceRole,dispatch),row=result.rows[0];
 assert.equal(result.hasVariance,false);assert.equal(row.expected,0);assert.equal(row.actual,0);assert.equal(row.sold,0);assert.equal(row.returned,0);assert.equal(row.degustation_given,0);assert.equal(row.degustation_remaining,0);assert.equal(row.manual_tracking_quantity,10);assert.equal(result.degustationCost,2000);assert.equal(result.manualTrackingQuantity,10);assert.equal(result.degustationAppropriation.remaining_quantity,0);assert.equal(result.degustationAppropriation.manual_tracking_quantity,10);assert.deepEqual(f.rows,before);assert.equal(f.rows.JournalEntry.length,0);
 for(const update of [{total_value:1},{central_promotional_original_cost:1999},{quantity:9}]){await f.s.StockMovement.update(movement.id,update);await assert.rejects(centralPromotionalHandoff(f.s,dispatch),/Reconcile/);await f.s.StockMovement.update(movement.id,movement);}
 assert.throws(()=>guardMutation({user:{role:'admin'},role:'admin'},'StockMovement','delete',{},movement),/immutable/);
});

test('historical cutover proof remains valid after company stock is sold or replenished',async()=>{
 const f=await setup();await f.s.StockBalance.update(f.line.destination_balance_id,{quantity:3,total_value:525,unit_cost:175,qc_status:'quarantine'});
 const before=structuredClone(f.rows),proof=await centralCutoverQuantities(f.s,f.dispatch);assert.equal(proof.get('product-a'),10);assert.equal((await dispatchReconciliationData(f.client.asServiceRole,f.dispatch)).hasVariance,false);assert.deepEqual(f.rows,before);
});

test('a zero-quantity cutover keeps the original expensed Dégustation custody and remaining load intact',async()=>{
 const f=await setup({zero:true}),id='DGA-reserved';
 await f.s.DispatchLine.update('load-a',{loaded_quantity:13,loaded_value:2600,degustation_quantity:13});
 const dispatch=await f.s.Dispatch.update(f.dispatch.id,{degustation_appropriation:{id,policy:'legacy-degustation-appropriation-v1',expense_account_id:'expense',total_quantity:13,total_value:2600}});
 await f.s.StockBalance.update('stock',{quantity:13,total_value:0,unit_cost:0,degustation_appropriation_id:id,degustation_appropriation_dispatch_id:dispatch.id,degustation_appropriation_expense_account_id:'expense',degustation_appropriation_inventory_account_id:'inventory',degustation_appropriation_quantity:13,degustation_appropriation_value:2600});
 const before=structuredClone(f.rows),reconciliation=await dispatchReconciliationData(f.client.asServiceRole,dispatch),row=reconciliation.rows[0];assert.equal(row.centralized_quantity,0);assert.equal(row.actual,13);assert.equal(row.expected,13);assert.equal(row.degustation_remaining,13);assert.equal(reconciliation.hasVariance,false);assert.deepEqual(f.rows,before);
});

test('unmarked historical runs avoid cutover reads and retain their existing reconciliation',async()=>{
 assert.deepEqual([...await centralCutoverQuantities({}, {id:'unmarked'})],[]);
 const f=await fixture(),before=structuredClone(f.rows),run=await f.entities.Dispatch.get('run-a'),reconciliation=await dispatchReconciliationData(f.client.asServiceRole,run);assert.equal(reconciliation.rows[0].centralized_quantity,0);assert.equal(reconciliation.rows[0].actual,10);assert.equal(reconciliation.hasVariance,false);assert.deepEqual(f.rows,before);
});

test('partial pointers and changed activation, movements, totals or balance lineage block cutover reconciliation without writes',async()=>{
 const changes=[
  f=>{delete f.dispatch.central_inventory_cutover_id;},
  f=>{f.dispatch.central_inventory_cutover_no_physical_return=false;},
  f=>f.s.AuditLog.update(f.config.activation_id,{audit_source:'client_reported'}),
  f=>{f.proof.runs[0].quantity=9;return f.s.AuditLog.update(f.config.activation_id,{central_inventory_cutover:f.proof});},
  f=>{f.proof.runs[0].lines[0].total_value=1900;return f.s.AuditLog.update(f.config.activation_id,{central_inventory_cutover:f.proof});},
  f=>f.s.StockMovement.update(f.line.source_movement_id,{quantity:9}),
  f=>f.s.StockMovement.update(f.line.destination_movement_id,{total_value:1900}),
  f=>f.s.StockMovement.update(f.line.destination_movement_id,{qc_status:'quarantine'}),
  f=>f.s.StockMovement.update(f.line.destination_movement_id,{document_type:'Dispatch'}),
  f=>f.s.StockMovement.update(f.line.destination_movement_id,{no_physical_return:false}),
  f=>f.s.StockBalance.update(f.line.destination_balance_id,{central_inventory_cutover_dispatch_id:'other-run'}),
  f=>f.s.StockBalance.update(f.line.source_balance_id,{central_inventory_cutover_id:'other-cutover'}),
 ];
 for(const change of changes){const f=await setup();await change(f);const before=structuredClone(f.rows);await assert.rejects(centralCutoverQuantities(f.s,f.dispatch));await assert.rejects(dispatchReconciliationData(f.client.asServiceRole,f.dispatch));assert.deepEqual(f.rows,before);}
});

test('activated central mode refuses new load approval, loading and top-up even through old server actions',async()=>{
 const f=await setup(),before=structuredClone(f.rows),gm={id:'gm',role:'admin'};
 for(const action of ['approveDispatchRequest','approveDispatch','loadDispatch'])await assert.rejects(dispatchAction(f.client,gm,{action,dispatchId:f.dispatch.id,requestId:'unused'}),/goods issues are no longer required/);
 await assert.rejects(topUpDispatchStock(f.client.asServiceRole,user,{...f.dispatch,status:'loaded'},{existingDispatchId:f.dispatch.id,topUpPolicy:'add-to-current-stock-v1',requestKey:crypto.randomUUID(),warehouseId:'factory',commercialId:'agent-a',driverId:'driver-a',vehicleId:'vehicle-a',date,lines:[{product_id:'product-a',quantity:1}]}),/goods issues are no longer required/);assert.deepEqual(f.rows,before);
});
