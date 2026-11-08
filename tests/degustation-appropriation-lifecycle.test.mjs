import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,date} from './helpers/cashier.mjs';
import {distributionControlAction} from '../src/server/domain/distribution-control.js';
import {employeeStockAction} from '../src/server/domain/employee-stock.js';
import {dispatchAction,dispatchReconciliationData} from '../src/server/domain/dispatch-operations.js';
import {stockIssue,stockTransfer,postJournal,appropriatedDegustation} from '../src/server/domain/field-ops.js';
import {guardMutation} from '../src/server/access.js';
import {splitRecord} from '../src/server/query.js';
import catalog from '../src/server/generated/schema.json' with {type:'json'};
const gm={id:'gm',role:'admin'},actor={id:'cashier-login',role:'user'};

async function setup({quantity=3,value=600}={}){
 const f=await fixture(),s=f.entities;
 for(const name of ['DispatchRequest','Dispatch']){const create=s[name].create;s[name].create=async value=>{const {record,extra}=splitRecord(value,catalog[name],{creating:true});return create({...record,...extra});};}
 for(const name of ['Warehouse','AuditLog']){const create=s[name].create;s[name].create=async value=>{if(!value.id)return create(value);f.rows[name].push(structuredClone(value));return structuredClone(value);};}
 await s.Employee.update('cashier',{role:'employee'});await s.Dispatch.deleteMany({});await s.DispatchLine.deleteMany({});await s.Warehouse.update('factory',{warehouse_type:'finished_goods'});
 for(const balance of await s.StockBalance.list())await s.StockBalance.update(balance.id,{quantity:0,total_value:0});
 await s.StockBalance.create({warehouse_id:'factory',product_id:'product-a',quantity:20,unit_cost:200,total_value:4000,lot_number:'LOT',qc_status:'approved'});
 const inventoryId=(await s.PostingRule.filter({rule_key:'finished_goods_inventory'}))[0].account_id;
 await s.Account.update(inventoryId,{account_type:'asset',normal_balance:'debit',balance:4000});
 await s.PostingRule.create({rule_key:'marketing_degustation_expense',account_id:'expense',is_active:true});
 const {dispatch}=await distributionControlAction(f.client,gm,{action:'issueDistributionStock',commercialId:'cashier',driverId:'',vehicleId:'',warehouseId:'factory',requestKey:crypto.randomUUID(),date,lines:[{product_id:'product-a',quantity,degustation_quantity:0}]});
 for(const line of await s.DispatchLine.filter({dispatch_id:dispatch.id}))await s.DispatchLine.update(line.id,{degustation_quantity:quantity});
 const balances=(await s.StockBalance.filter({warehouse_id:dispatch.vehicle_warehouse_id})).filter(row=>row.quantity>0);
 assert.equal(balances.length,1);const lot=balances[0];
 // Model the checked appropriation's result without moving any physical units.
 const id='DGA-lifecycle';await s.StockBalance.update(lot.id,{unit_cost:0,total_value:0,degustation_appropriation_id:id,degustation_appropriation_dispatch_id:dispatch.id,degustation_appropriation_expense_account_id:'expense',degustation_appropriation_inventory_account_id:inventoryId,degustation_appropriation_quantity:quantity,degustation_appropriation_value:value});
 const {journal}=await postJournal(f.client.asServiceRole,{entryDate:date,description:'Reserved giveaway appropriation',sourceModule:'degustation',sourceDocumentType:'DegustationAppropriation',sourceDocumentId:id,userId:gm.id,lines:[{account_id:'expense',debit:value,credit:0},{account_id:inventoryId,debit:0,credit:value}]});
 await s.Dispatch.update(dispatch.id,{degustation_appropriation:{id,date,expense_account_id:'expense',total_quantity:quantity,total_value:value,journal_id:journal.id,journal_number:journal.journal_number,policy:'legacy-degustation-appropriation-v1'}});
 return {...f,s,inventoryId,lotId:lot.id,dispatch:await s.Dispatch.get(dispatch.id),give:n=>({action:'recordDegustation',dispatchId:dispatch.id,customerId:'customer-a',date,requestKey:crypto.randomUUID(),lines:[{product_id:'product-a',quantity:n}]})};
}

test('appropriated promotional stock stays physically held, non-saleable and expensed before any customer giveaway',async()=>{
 const f=await setup(),recon=await dispatchReconciliationData(f.client.asServiceRole,f.dispatch);
 assert.equal(recon.hasVariance,false);assert.equal(recon.rows[0].actual,3);assert.equal(recon.rows[0].degustation_remaining,3);assert.equal(recon.rows[0].degustation_given,0);assert.equal(recon.degustationCost,600);
 const own=await employeeStockAction(f.client,actor,{action:'employeeStockSnapshot'});
 assert.equal(own.balances.reduce((sum,row)=>sum+row.quantity,0),3);assert.equal(own.balances.reduce((sum,row)=>sum+row.usable_quantity,0),0);assert.equal(own.balances.reduce((sum,row)=>sum+row.degustation_quantity,0),3);assert.equal(own.runs[0].degustation_appropriation.remaining_quantity,3);
 assert.equal((await f.s.StockBalance.get(f.lotId)).total_value,0);assert.equal((await f.s.Account.get('expense')).balance,600);
});

test('actual customer giveaway releases custody once at zero additional expense while preserving original basis evidence',async()=>{
 const f=await setup(),input=f.give(1);await employeeStockAction(f.client,actor,input);const stock=await f.s.StockBalance.get(f.lotId);
 assert.equal(stock.quantity,2);assert.equal(stock.total_value,0);assert.equal(stock.degustation_appropriation_quantity,2);assert.equal(stock.degustation_appropriation_value,400);
 const movements=await f.s.StockMovement.filter({document_type:'Degustation'});assert.equal(movements.length,1);assert.equal(movements[0].total_value,0);assert.equal(movements[0].degustation_appropriation_value,200);assert.equal(movements[0].degustation_already_expensed,true);
 assert.equal((await f.s.JournalEntry.list()).length,1);assert.equal((await f.s.Account.get('expense')).balance,600);
 assert.equal((await employeeStockAction(f.client,actor,input)).reused,true);assert.equal((await f.s.StockBalance.get(f.lotId)).quantity,2);
 const recon=await dispatchReconciliationData(f.client.asServiceRole,await f.s.Dispatch.get(f.dispatch.id));assert.equal(recon.rows[0].degustation_given,1);assert.equal(recon.rows[0].actual,2);assert.equal(recon.hasVariance,false);assert.equal(recon.degustationCost,600);
});

test('fully appropriated giveaways do not provision another expense account or posting rule',async()=>{
 const f=await setup();await f.s.PostingRule.deleteMany({rule_key:'marketing_degustation_expense'});
 const accounts=await f.s.Account.list(),rules=await f.s.PostingRule.list();await employeeStockAction(f.client,actor,f.give(1));
 assert.deepEqual(await f.s.Account.list(),accounts);assert.deepEqual(await f.s.PostingRule.list(),rules);assert.equal((await f.s.JournalEntry.list()).length,1);assert.match((await f.s.AuditLog.list()).at(-1).description,/previously expensed promotional custody/);
});

test('partial giveaway then return restores only remaining original basis and quantity, reversing the matching expense once',async()=>{
 const f=await setup();await employeeStockAction(f.client,actor,f.give(1));
 const returned=await dispatchAction(f.client,gm,{action:'returnDispatchStock',dispatchId:f.dispatch.id,countedLines:[{product_id:'product-a',quantity:2}]});
 assert.equal(returned.totalValue,400);assert.equal((await f.s.Account.get('expense')).balance,200);assert.equal((await f.s.Account.get(f.inventoryId)).balance,3800);
 const factory=await f.s.StockBalance.filter({warehouse_id:'factory'});assert.equal(factory.reduce((sum,row)=>sum+row.quantity,0),19);assert.equal(factory.reduce((sum,row)=>sum+row.total_value,0),3800);
 const custody=await f.s.StockBalance.get(f.lotId);assert.equal(custody.quantity,0);assert.equal(appropriatedDegustation(custody),null);
 const journals=await f.s.JournalEntry.list();assert.equal(journals.length,2);const restoration=journals.find(row=>row.source_document_type==='DegustationReturn');assert.equal(restoration.total_debit,400);assert.equal(restoration.total_credit,400);
 const recon=await dispatchReconciliationData(f.client.asServiceRole,await f.s.Dispatch.get(f.dispatch.id));assert.equal(recon.rows[0].degustation_given,1);assert.equal(recon.rows[0].degustation_returned,2);assert.equal(recon.rows[0].actual,0);assert.equal(recon.degustationCost,200);assert.equal(recon.hasVariance,false);
 assert.equal((await dispatchAction(f.client,gm,{action:'returnDispatchStock',dispatchId:f.dispatch.id})).reused,true);assert.equal((await f.s.JournalEntry.list()).length,2);
});

test('fractional original basis reconciles final cent residual on giveaways and returns',async()=>{
 const f=await setup({quantity:3,value:0.10});await employeeStockAction(f.client,actor,f.give(1));assert.equal((await f.s.StockBalance.get(f.lotId)).degustation_appropriation_value,0.07);
 await dispatchAction(f.client,gm,{action:'returnDispatchStock',dispatchId:f.dispatch.id,countedLines:[{product_id:'product-a',quantity:2}]});assert.equal((await f.s.Account.get('expense')).balance,0.03);assert.equal((await f.s.Dispatch.get(f.dispatch.id)).degustation_appropriation_return.total_value,0.07);
});

test('ordinary sales, material issues and transfers cannot consume expensed promotional custody',async()=>{
 for(const [movementType,documentType]of [['customer_delivery','SalesOrder'],['production_issue','ProductionOrder'],['promotional_issue','SpoilageRecord']]){
  const f=await setup(),before=structuredClone(f.rows);
  await assert.rejects(stockIssue(f.client.asServiceRole,{productId:'product-a',warehouseId:f.dispatch.vehicle_warehouse_id,quantity:1,movementType,documentType,documentId:'forged',dispatchId:f.dispatch.id}),/Insufficient stock/);assert.deepEqual(f.rows,before);
 }
 const f=await setup();await assert.rejects(stockTransfer(f.client.asServiceRole,{productId:'product-a',fromWarehouseId:f.dispatch.vehicle_warehouse_id,toWarehouseId:'factory',quantity:1,movementType:'warehouse_transfer',documentType:'Dispatch',documentId:f.dispatch.id}),/Insufficient stock/);
 await assert.rejects(stockTransfer(f.client.asServiceRole,{productId:'product-a',fromWarehouseId:f.dispatch.vehicle_warehouse_id,toWarehouseId:'factory',quantity:1,movementType:'warehouse_transfer',documentType:'Dispatch',documentId:f.dispatch.id,restoreAppropriatedValue:true,dispatchId:'wrong'}),/Reconcile/);
});

test('incomplete markers and changed remaining basis fail closed before a stock move',async()=>{
 for(const changes of [{degustation_appropriation_quantity:4},{degustation_appropriation_value:0.001},{degustation_appropriation_inventory_account_id:''},{total_value:1},{degustation_appropriation_id:null}]){
  const f=await setup();await f.s.StockBalance.update(f.lotId,changes);const before=structuredClone(f.rows);
  await assert.rejects(employeeStockAction(f.client,actor,f.give(1)),/Reconcile/);assert.deepEqual(f.rows,before);
 }
 const f=await setup();await f.s.StockBalance.update(f.lotId,{degustation_appropriation_value:599});const before=structuredClone(f.rows);await assert.rejects(dispatchReconciliationData(f.client.asServiceRole,f.dispatch),/Reconcile/);await assert.rejects(employeeStockAction(f.client,actor,f.give(1)),/Reconcile/);assert.deepEqual(f.rows,before);
});

test('closed accounting periods and invalid original accounts block returns before physical or financial writes',async()=>{
 for(const kind of ['closed','inactive','wrong-type']){
  const f=await setup();
  if(kind==='closed')await f.s.AccountingPeriod.update('period',{status:'closed'});
  else await f.s.Account.update('expense',kind==='inactive'?{is_active:false}:{account_type:'revenue'});
  const before=structuredClone(f.rows);await assert.rejects(dispatchAction(f.client,gm,{action:'returnDispatchStock',dispatchId:f.dispatch.id,countedLines:[{product_id:'product-a',quantity:3}]}),/open accounting period|original Dégustation expense/);assert.deepEqual(f.rows,before);
 }
});

test('a complete customer giveaway consumes final original-cost residual and creates no second journal',async()=>{
 const f=await setup({value:0.10});await employeeStockAction(f.client,actor,f.give(1));await employeeStockAction(f.client,actor,f.give(2));
 const lot=await f.s.StockBalance.get(f.lotId);assert.equal(lot.quantity,0);assert.equal(lot.total_value,0);assert.equal(appropriatedDegustation(lot),null);
 const given=await f.s.StockMovement.filter({document_type:'Degustation'});assert.equal(given.reduce((sum,row)=>Math.round((sum+row.degustation_appropriation_value)*100)/100,0),0.10);assert.equal((await f.s.JournalEntry.list()).length,1);
 const recon=await dispatchReconciliationData(f.client.asServiceRole,await f.s.Dispatch.get(f.dispatch.id));assert.equal(recon.rows[0].degustation_given,3);assert.equal(recon.rows[0].actual,0);assert.equal(recon.degustationCost,0.10);assert.equal(recon.hasVariance,false);
});

test('generic mutations cannot forge or detach appropriation metadata, return evidence or custody markers',()=>{
 const context={user:gm,employee:null};
 for(const [entity,payload,existing]of [['StockBalance',{degustation_appropriation_value:1},{}],['StockBalance',{notes:'erase custody'},{degustation_appropriation_id:'DGA-1'}],['Dispatch',{degustation_appropriation:{id:'forged'}},{}],['Dispatch',{degustation_appropriation_return:{total_value:9}},{}],['Dispatch',{status:'returned'},{degustation_appropriation:{id:'DGA-1'}}],['AuditLog',{document_type:'DegustationAppropriation'},{}]])assert.throws(()=>guardMutation(context,entity,'update',payload,existing),/checked Distribution/);
});
