import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fixture,date} from './helpers/cashier.mjs';
import {stockReceive,stockIssue} from '../src/server/domain/field-ops.js';
import {issueDegustation} from '../src/server/domain/degustation.js';

const actor={id:'gm',role:'admin'},event=key=>'DLA-'+createHash('sha256').update(actor.id+':'+key).digest('hex');
async function setup(){
 const f=await fixture(),s=f.entities;
 await s.StockBalance.deleteMany({});await s.Dispatch.deleteMany({});
 await s.PostingRule.create({rule_key:'marketing_degustation_expense',account_id:'expense',is_active:true});
 const employee=await s.Employee.get('cashier'),product=await s.Product.get('product-a');
 const warehouse=await s.Warehouse.create({name:'Employee-held stock',warehouse_type:'commercial_custody',employee_delivery_custody:true,custodian_employee_id:employee.id,is_active:true});
 const dispatch=await s.Dispatch.create({status:'loaded',dispatch_date:date,salesperson_id:employee.id,vehicle_warehouse_id:warehouse.id,warehouse_id:'factory',degustation_appropriation:{id:'DGA-fixture',policy:'legacy-degustation-appropriation-v1',expense_account_id:'expense',total_quantity:13,total_value:2600}});
 const old=await s.StockBalance.create({product_id:product.id,warehouse_id:warehouse.id,lot_number:'SAME-LOT',expiry_date:'2099-12-31',production_order_id:'production',batch_number:'batch',qc_status:'approved',quantity:13,unit_cost:0,total_value:0,
  degustation_appropriation_id:'DGA-fixture',degustation_appropriation_dispatch_id:dispatch.id,degustation_appropriation_expense_account_id:'expense',degustation_appropriation_inventory_account_id:'inventory',degustation_appropriation_quantity:13,degustation_appropriation_value:2600});
 const receive=(quantity=3,totalValue=600)=>stockReceive(f.client.asServiceRole,{productId:product.id,productName:product.name,warehouseId:warehouse.id,warehouseName:warehouse.name,quantity,unitCost:200,totalValue,lotNumber:old.lot_number,expiryDate:old.expiry_date,qcStatus:old.qc_status,productionOrderId:old.production_order_id,batchNumber:old.batch_number,movementType:'vehicle_load',documentType:'Dispatch',documentId:dispatch.id,movementDate:date});
 const give=(quantity,eventId)=>issueDegustation(f.client.asServiceRole,actor,employee,dispatch,[{product,line:{degustation_quantity:quantity}}],date,eventId===undefined?undefined:{eventId});
 const snapshot=async()=>Object.fromEntries(await Promise.all(['StockBalance','StockMovement','JournalEntry','JournalLine','Account','PostingRule','AuditLog'].map(async name=>[name,await s[name].list()])));
 return {...f,s,old,dispatch,employee,product,warehouse,receive,give,snapshot};
}

test('normal stock received into the same printed lot stays separate from protected expensed Dégustation',async()=>{
 const f=await setup();await f.receive(3,600);
 const after=(await f.s.StockBalance.list()),normal=after.find(row=>row.id!==f.old.id);
 assert.equal(after.length,2);assert.deepEqual(await f.s.StockBalance.get(f.old.id),f.old);
 assert.equal(normal.quantity,3);assert.equal(normal.total_value,600);assert.equal(normal.degustation_appropriation_id,undefined);
 await f.receive(2,400);assert.equal((await f.s.StockBalance.list()).length,2);
 const merged=await f.s.StockBalance.get(normal.id);assert.equal(merged.quantity,5);assert.equal(merged.total_value,1000);assert.equal(merged.unit_cost,200);
 assert.deepEqual(await f.s.StockBalance.get(f.old.id),f.old);assert.equal((await f.s.JournalEntry.list()).length,0);
});

test('matching malformed Dégustation markers still block receipt before any stock or accounting write',async()=>{
 for(const change of [{degustation_appropriation_quantity:12},{degustation_appropriation_value:null},{total_value:1},{unit_cost:1},{degustation_appropriation_unrecognized:'bad'}]){
  const f=await setup();await f.s.StockBalance.update(f.old.id,change);const before=await f.snapshot();
  await assert.rejects(f.receive(),/Reconcile the expensed/);assert.deepEqual(await f.snapshot(),before);
 }
});

test('normal receipt finds an existing unmarked lot after a complete page of marked lots',async()=>{
 const f=await setup();await f.s.StockBalance.deleteMany({});
 for(let index=0;index<200;index++){const {id,...row}=f.old;void id;await f.s.StockBalance.create({...row,quantity:1,degustation_appropriation_quantity:1,degustation_appropriation_value:200});}
 const {id,...oldFields}=f.old;void id;
 const normal=await f.s.StockBalance.create({...Object.fromEntries(Object.entries(oldFields).filter(([key])=>!key.startsWith('degustation_appropriation_'))),quantity:2,unit_cost:200,total_value:400});
 await f.receive(3,600);assert.equal((await f.s.StockBalance.list()).length,201);
 assert.equal((await f.s.StockBalance.get(normal.id)).quantity,5);assert.equal((await f.s.StockBalance.get(normal.id)).total_value,1000);
 assert.equal((await f.s.StockBalance.list()).filter(row=>row.degustation_appropriation_id).reduce((n,row)=>n+row.quantity,0),200);
});

test('separate top-up giveaway events expense only new normal stock and never consume old zero-value Dégustation',async()=>{
 const f=await setup(),first=event('first'),second=event('second');
 await f.receive(3,600);const initial=await f.give(2,first);assert.equal(initial.record.id,'DEG-ISSUE-'+first);
 assert.deepEqual(await f.s.StockBalance.get(f.old.id),f.old);
 let normal=(await f.s.StockBalance.list()).find(row=>row.id!==f.old.id);assert.equal(normal.quantity,1);assert.equal(normal.total_value,200);
 await f.receive(2,400);const next=await f.give(1,second);assert.equal(next.record.id,'DEG-ISSUE-'+second);
 assert.deepEqual(await f.s.StockBalance.get(f.old.id),f.old);
 normal=await f.s.StockBalance.get(normal.id);assert.equal(normal.quantity,2);assert.equal(normal.total_value,400);
 const journals=await f.s.JournalEntry.list();assert.equal(journals.length,2);assert.deepEqual(journals.map(j=>j.total_debit),[400,200]);assert.equal(new Set(journals.map(j=>j.source_document_id)).size,2);
 const issues=await f.s.StockMovement.filter({document_type:'Degustation'});
 assert.equal(issues.reduce((n,m)=>n+m.total_value,0),600);assert.ok(issues.every(m=>m.degustation_at_issue&&m.degustation_issue_event_id&&m.degustation_already_expensed!==true));
 assert.equal((await f.s.Account.get('expense')).balance,600);
 const before=await f.snapshot();assert.equal((await f.give(1,second)).reused,true);assert.deepEqual(await f.snapshot(),before);
 await assert.rejects(f.give(2,second),/already recorded with different details/);assert.deepEqual(await f.snapshot(),before);
});

test('a new at-issue giveaway cannot fall back to previously expensed custody when normal stock is exhausted',async()=>{
 const f=await setup(),before=await f.snapshot();
 await assert.rejects(f.give(1,event('no-new-stock')),/Insufficient stock/);assert.deepEqual(await f.snapshot(),before);
 await f.s.StockBalance.update(f.old.id,{degustation_appropriation_quantity:12});const invalid=await f.snapshot();
 await assert.rejects(f.give(1,event('invalid-old-stock')),/Reconcile the expensed/);assert.deepEqual(await f.snapshot(),invalid);
});

test('the original issue giveaway source id remains stable and later ordinary giveaways can consume expensed allocation without another cost',async()=>{
 const f=await setup();await f.receive(1,200);const result=await f.give(1);
 assert.equal(result.record.id,'DEG-ISSUE-'+f.dispatch.id);assert.deepEqual(await f.s.StockBalance.get(f.old.id),f.old);
 const before=await f.snapshot();assert.equal((await f.give(1)).reused,true);assert.deepEqual(await f.snapshot(),before);
 const ordinary=await stockIssue(f.client.asServiceRole,{productId:f.product.id,productName:f.product.name,warehouseId:f.warehouse.id,quantity:1,movementType:'promotional_issue',documentType:'Degustation',documentId:'DEG-customer',dispatchId:f.dispatch.id,movementDate:date,saleableOnly:true});
 assert.equal(ordinary.totalValue,0);assert.equal(ordinary.layers[0].appropriation.value,200);
 assert.equal((await f.s.StockBalance.get(f.old.id)).quantity,12);assert.equal((await f.s.StockBalance.get(f.old.id)).degustation_appropriation_value,2400);
});
