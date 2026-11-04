import {salesOrderAction} from '../src/server/domain/sales-orders.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { fixture, functionRoute, request, user, date } from './helpers/cashier.mjs';
import { warehouseAdjustmentAction } from '../src/server/domain/warehouse-adjustment.js';
import { guardMutation } from '../src/server/access.js';
import {FEATURE_AUTHORITY} from '../src/server/domain/roles.js';
import {physicalItemCount} from '../src/lib/warehouse-item-count.js';

test('packaging physical counts post without entered lots or expiry and retry without duplicate quantities or journals',async()=>{
 const f=await setup(),s=f.entities;
 const p=await s.Product.create({...f.product,id:undefined,name:'Packaging cups',inventory_type:'raw_material',material_group:'Packaging',unit_of_measure:'ea'});
 const ws=await f.call({action:'warehouseAdjustmentWorkspace',itemGroup:'packaging'}),item=ws.items.find(i=>i.id===p.id);
 assert.equal(item.count_group,'packaging');
 const gain=await s.Account.create({name:'Stock surplus',account_number:'7580',account_type:'other_income',normal_balance:'credit',is_active:true,is_posting:true,balance:0});
 const body={action:'postWarehouseAdjustment',requestKey:crypto.randomUUID(),date,itemGroup:'packaging',gainAccountId:gain.id,reference:'PACK-COUNT',reason:'Physical packaging count verified',item_counts:[{product_id:p.id,counted_quantity:100,item_fingerprint:item.count_fingerprint,snapshots:[]}],rows:[{product_id:p.id,unit:'ea',unit_cost:10,counted_quantity:100}]};
 const result=await f.call(body),[stock]=await s.StockBalance.filter({product_id:p.id});
 assert.equal(stock.quantity,100);assert.equal(stock.total_value,1000);assert.ok(!stock.expiry_date);assert.match(stock.lot_number,/^COUNT-[A-F0-9]{16}$/);assert.equal(stock.qc_status,'quarantine');
 assert.equal(result.value_difference,1000);assert.ok(result.journal_id);const count=(await s.JournalEntry.list()).length;
 assert.equal((await f.call(body)).reused,true);assert.equal((await s.StockBalance.filter({product_id:p.id})).length,1);assert.equal((await s.JournalEntry.list()).length,count);
 const line=await s.JournalLine.filter({journal_id:result.journal_id});assert.equal(line.reduce((sum,l)=>sum+l.debit-l.credit,0),0);
 await assert.rejects(f.call({...body,requestKey:crypto.randomUUID()}),/Stock changed/);
});

test('direct count posting is denied to non-admin principals even with elevated feature access',async()=>{
 const f=await setup(),s=f.entities,body=await f.body();
 const before=JSON.stringify(await s.StockBalance.list());
 for(const role of ['warehouse_manager','cashier','driver','production_manager']){
  await s.Employee.update('cashier',{role,allowed_modules:['inventory','inventory_adjustments','accounting']});
  const elevated={...user,[FEATURE_AUTHORITY]:{role:'admin'}};
  await assert.rejects(warehouseAdjustmentAction(f.client,elevated,body),/top administrators/);
 }
 assert.equal(JSON.stringify(await s.StockBalance.list()),before);assert.equal((await s.StockMovement.list()).length,0);assert.equal((await s.JournalEntry.list()).length,0);
});
test('count history returns posted references, actor, values and exact immutable receipts with no writes',async()=>{
 const f=await setup(),s=f.entities,result=await f.call(await f.body());
 const before=JSON.stringify(await s.AuditLog.list());
 const page=await f.call({action:'warehouseAdjustmentHistory'});assert.equal(page.total,1);assert.equal(page.adjustments[0].id,result.id);assert.equal(page.adjustments[0].reference,'COUNT-001');assert.equal(page.adjustments[0].recorded_by,'Cashier');assert.equal(page.adjustments[0].journal_number,result.journal_number);
 const detail=await f.call({action:'warehouseAdjustmentHistory',adjustmentId:result.id});assert.deepEqual(detail.adjustment,result);assert.match(detail.reason,/physical count/);
 assert.equal(JSON.stringify(await s.AuditLog.list()),before);await assert.rejects(f.call({action:'warehouseAdjustmentHistory',page:-1}),/page/);await assert.rejects(f.call({action:'warehouseAdjustmentHistory',adjustmentId:'arbitrary-audit'}),/valid adjustment/);
 await s.Employee.update('cashier',{role:'driver',allowed_modules:['inventory','inventory_adjustments']});await assert.rejects(f.call({action:'warehouseAdjustmentHistory'}));
});

test('physical counts cannot be backdated against current balances or saved with missing monetary values',async()=>{
 const f=await setup(),s=f.entities,body=await f.body();
 await assert.rejects(f.call({...body,date:date.slice(0,4)+'-01-01'}),/today/);
 await s.StockBalance.update(f.lots[0].id,{total_value:undefined});const workspace=await f.workspace();assert.match(workspace.rows[0].count_issue,/missing or invalid/);
 await assert.rejects(f.call({...body,rows:[{balance_id:workspace.rows[0].balance_id,fingerprint:workspace.rows[0].fingerprint,counted_quantity:0}]}),/missing or invalid/);
 assert.equal((await s.JournalEntry.list()).length,0);
});

test('removed items and changed fallback inventory accounts cannot accept an earlier count',async()=>{
 const f=await setup(),s=f.entities;
 await s.Product.update(f.product.id,{inventory_account_id:''});
 const rule=await s.PostingRule.create({rule_key:'raw_material_inventory',account_id:f.inventory.id,is_active:true}),body=await f.body();
 await s.PostingRule.update(rule.id,{account_id:'another-account'});await assert.rejects(f.call(body),/changed since/);
 await s.PostingRule.update(rule.id,{account_id:f.inventory.id});await s.Product.update(f.product.id,{item_removed_at:new Date().toISOString()});await assert.rejects(f.call(body),/active, configured/);
 assert.equal((await s.JournalEntry.list()).length,0);
});

test('a zero-count financial correction cannot silently round away unsupported residual money',async()=>{
 const f=await setup(),s=f.entities;await s.Employee.update('cashier',{role:'admin'});
 await s.StockBalance.update(f.lots[0].id,{quantity:0,total_value:0.004});
 const workspace=await f.workspace();assert.match(workspace.rows[0].count_issue,/precision/);
 const row=workspace.rows[0];await assert.rejects(f.call({action:'postWarehouseAdjustment',requestKey:crypto.randomUUID(),date,accountId:'expense',reason:'Verified empty counted lot',reference:'ROUNDING',rows:[{balance_id:row.balance_id,fingerprint:row.fingerprint,counted_quantity:0,confirm_reconciliation:true}]}),/precision/);
 assert.equal((await s.StockBalance.get(row.balance_id)).total_value,0.004);assert.equal((await s.JournalEntry.list()).length,0);
});

test('new expired or undated finished lots cannot be made saleable through a count flag',async()=>{
 const f=await finishedFixture(),s=f.entities;
 for(const expiry_date of ['', '2020-01-01','2026-02-31']){
  await assert.rejects(f.call({action:'postWarehouseAdjustment',requestKey:crypto.randomUUID(),date,accountId:'expense',reference:'NEW-LOT',reason:'Physical found stock checked',rows:[{product_id:f.product.id,lot_number:'FOUND',unit_cost:10,counted_quantity:3,expiry_date,ready_for_sale:true}]}),/expiry/);
 }
 assert.equal((await s.StockMovement.list()).length,0);assert.equal((await s.JournalEntry.list()).length,0);
});

test('import metadata exceptions require GM and explicit evidence confirmation',async()=>{
 const f=await existingStockFixture(),s=f.entities;
 const row=(await f.call({action:'existingStockWorkspace'})).lots[0];
 const body={action:'correctExistingStock',requestKey:crypto.randomUUID(),reference:'IMPORT-CHECK',reason:'Verified source import mistake',rows:[{id:row.id,fingerprint:row.fingerprint}]};
 await assert.rejects(f.call(body),/Confirm/);
 await s.Employee.update('cashier',{role:'warehouse_manager'});await assert.rejects(f.call({...body,confirm_import_metadata:true}),/General Manager/);
 assert.equal((await s.StockBalance.get(row.id)).qc_status,'quarantine');assert.equal((await s.StockBalance.get(row.id)).expiry_date,'2020-01-01');
});

test('generic movement creation cannot forge counts, returns or orphan approved inventory history',()=>{
 const context={user:{id:'gm',role:'admin'},role:'admin',employee:null};
 for(const type of ['stock_count_variance','stock_adjustment','customer_return','purchase_receipt']){
  for(const operation of ['create','bulkCreate'])assert.throws(()=>guardMutation(context,'StockMovement',operation,{movement_type:type,quantity:1,status:'approved'}),/checked stock workflow/);
 }
 assert.throws(()=>guardMutation(context,'StockMovement','update',{status:'approved'},{id:'pending',status:'pending'}),/checked stock workflow/);
});

async function setup(db) {
  const f=await fixture(db),s=f.entities;
  const filterAudit=s.AuditLog.filter;
  s.AuditLog.filter=async(query,sort,...args)=>{
    if(!sort||typeof sort!=='object')return filterAudit(query,sort,...args);
    const rows=await filterAudit(query),skip=sort.skip||0;
    return {items:rows.slice(skip,skip+sort.limit),total:rows.length,has_more:skip+sort.limit<rows.length};
  };
  await s.Employee.update('cashier',{role:'admin'});
  const original=s.AuditLog.create;
  s.AuditLog.create=async value=>{
    if(!value.id)return original(value);
    if(db)await db.query('INSERT INTO fixture_entity VALUES($1,$2,$3)',['AuditLog',value.id,JSON.stringify(value)]);
    else {if(f.rows.AuditLog.some(r=>r.id===value.id))throw Error('Duplicate audit reference');f.rows.AuditLog.push(structuredClone(value));}
    return structuredClone(value);
  };
  const warehouse=await s.Warehouse.create({name:'Ingredient store',warehouse_type:'raw_material',is_active:true});
  const other=await s.Warehouse.create({name:'Other store',warehouse_type:'general',is_active:true});
  const inventory=await s.Account.create({name:'Inventory',account_number:'1310',account_type:'asset',normal_balance:'debit',is_active:true,is_posting:true,balance:150});
  const product=await s.Product.create({name:'Milk powder',sku:'MILK',inventory_type:'raw_material',configuration_status:'configured',is_active:true,current_cost:10,unit_of_measure:'kg',inventory_account_id:inventory.id});
  const lots=[];
  for(const [quantity,qc] of [[10,'quarantine'],[5,'approved']])lots.push(await s.StockBalance.create({product_id:product.id,product_name:product.name,warehouse_id:warehouse.id,lot_number:'LOT-'+quantity,batch_number:'BATCH-'+quantity,production_order_id:'production-1',expiry_date:'2027-01-01',quantity,unit_cost:10,total_value:quantity*10,qc_status:qc}));
  const call=body=>warehouseAdjustmentAction(f.client,user,{warehouseId:warehouse.id,...body});
  const workspace=()=>call({action:'warehouseAdjustmentWorkspace'});
  const body=async(counts=[8,6])=>({action:'postWarehouseAdjustment',warehouseId:warehouse.id,requestKey:crypto.randomUUID(),date,accountId:'expense',reference:'COUNT-001',reason:'Signed physical count confirmed',rows:(await workspace()).rows.map((r,i)=>({balance_id:r.balance_id,fingerprint:r.fingerprint,counted_quantity:counts[i]}))});
  return {...f,warehouse,other,inventory,product,lots,call,workspace,body};
}

test('new count entries cannot duplicate an existing physical lot through whitespace, case or production batch aliases',async()=>{
 const f=await setup(),s=f.entities;
 await s.StockBalance.update(f.lots[0].id,{lot_number:' LOT-10 ',batch_number:' BATCH-10 '});
 const snapshot=JSON.stringify(await s.StockBalance.list());
 for(const lot_number of ['lot-10',' LOT-10 ','batch-10',' BATCH-10 ']){
   await assert.rejects(f.call({action:'postWarehouseAdjustment',requestKey:crypto.randomUUID(),date,accountId:'expense',reference:'COUNT-ALIAS',reason:'Verify known lot before counting',rows:[{product_id:f.product.id,lot_number,unit_cost:10,counted_quantity:8}]}),/already exists/);
   assert.equal(JSON.stringify(await s.StockBalance.list()),snapshot);
 }
 assert.equal((await s.JournalEntry.list()).length,0);assert.equal((await s.StockMovement.list()).length,0);
});

test('warehouse count posts signed quantity and carrying-value changes together, preserving lot holds and leaving cash unchanged',async()=>{
  const f=await setup(),s=f.entities,beforeTreasury=await s.TreasuryAccount.list(),body=await f.body();
  const result=await f.call(body);assert.equal(result.rows.length,2);assert.equal(result.value_difference,-10);assert.ok(result.journal_id);
  assert.equal((await s.StockBalance.get(f.lots[0].id)).quantity,8);assert.equal((await s.StockBalance.get(f.lots[1].id)).quantity,6);
  const first=await s.StockBalance.get(f.lots[0].id);assert.equal(first.qc_status,'quarantine');assert.equal(first.batch_number,'BATCH-10');assert.equal(first.expiry_date,'2027-01-01');assert.equal(first.production_order_id,'production-1');
  assert.equal((await s.Account.get(f.inventory.id)).balance,140);assert.equal((await s.Account.get('expense')).balance,10);
  const lines=await s.JournalLine.list();assert.equal(lines.reduce((n,l)=>n+l.debit-l.credit,0),0);
  assert.deepEqual(await s.TreasuryAccount.list(),beforeTreasury);assert.equal((await s.TreasuryTransaction.list()).length,0);
  assert.equal((await f.call(body)).reused,true);assert.equal((await s.JournalEntry.list()).length,1);
  await assert.rejects(f.call({...body,reference:'DIFFERENT'}),/different details/);
});

test('explicit zero writes off the complete last-cent carrying value without deleting the stock record',async()=>{
  const f=await setup(),s=f.entities;await s.StockBalance.update(f.lots[0].id,{quantity:3,total_value:1,unit_cost:1/3});
  const body=await f.body([0,5]);await f.call(body);const lot=await s.StockBalance.get(f.lots[0].id);assert.equal(lot.quantity,0);assert.equal(lot.total_value,0);assert.equal((await s.Account.get('expense')).balance,1);
});

test('blank, negative, non-finite, duplicate, excessive-precision and foreign-warehouse quantities cannot change stock',async()=>{
  const f=await setup(),s=f.entities,body=await f.body();
  for(const counted_quantity of ['',null,-1,NaN,Infinity,0.0001])await assert.rejects(f.call({...body,rows:[{...body.rows[0],counted_quantity}]}));
  await assert.rejects(f.call({...body,rows:[body.rows[0],body.rows[0]]}),/only once/);
  await assert.rejects(f.call({...body,warehouseId:f.other.id}),/another warehouse/);
  assert.equal((await s.StockBalance.get(f.lots[0].id)).quantity,10);assert.equal((await s.JournalEntry.list()).length,0);
});

test('an existing empty lot can be increased from zero using the established item cost, without releasing its quality hold',async()=>{
  const f=await setup(),s=f.entities;await s.StockBalance.update(f.lots[0].id,{quantity:0,total_value:0,unit_cost:0});
  const body=await f.body([2,5]);await f.call(body);const lot=await s.StockBalance.get(f.lots[0].id);assert.equal(lot.quantity,2);assert.equal(lot.total_value,20);assert.equal(lot.qc_status,'quarantine');assert.equal((await s.Account.get('expense')).balance,-20);
});

test('concurrent stock, QC and valuation changes invalidate the count snapshot; missing accounts and closed periods block posting',async()=>{
  const f=await setup(),s=f.entities,body=await f.body();
  await s.StockBalance.update(f.lots[0].id,{qc_status:'approved'});await assert.rejects(f.call(body),/changed since/);
  const fresh=await f.body();await assert.rejects(f.call({...fresh,accountId:'till-gl'}),/expense account/);
  await s.Account.update(f.inventory.id,{is_posting:false});await assert.rejects(f.call(fresh),/inventory asset account/);
  await s.Account.update(f.inventory.id,{is_posting:true});await s.AccountingPeriod.update('period',{status:'closed'});await assert.rejects(f.call(fresh),/open accounting period/);
  assert.equal((await s.StockMovement.list()).length,0);
});

test('new counted lots retain printed expiry and stay held until verified; existing lots and forged costs cannot be duplicated',async()=>{
  const f=await setup(),s=f.entities,body={...(await f.body()),rows:[{product_id:f.product.id,lot_number:'FOUND-LOT',expiry_date:'2027-02-01',unit_cost:10,counted_quantity:2}]};
  await assert.rejects(f.call({...body,rows:[{...body.rows[0],unit_cost:0.01}]}),/carrying cost changed/);
  const result=await f.call(body),balance=await s.StockBalance.get(result.rows[0].balance_id);assert.equal(balance.quantity,2);assert.equal(balance.total_value,20);assert.equal(balance.qc_status,'quarantine');assert.equal(balance.expiry_date,'2027-02-01');
  await assert.rejects(f.call({...body,requestKey:crypto.randomUUID()}),/already exists/);
  assert.equal((await s.Account.get('expense')).balance,-20);
});

test('managed vehicle and agent locations, inactive staff, disabled modules and unauthorized roles cannot use warehouse corrections',async()=>{
  const f=await setup(),s=f.entities;
  for(const role of ['warehouse_manager','production_manager','procurement','cashier','employee','commercial','driver']){await s.Employee.update('cashier',{role});await assert.rejects(f.workspace());}
  await s.Employee.update('cashier',{role:'warehouse_manager',assigned_role:'production_manager'});await assert.rejects(f.workspace(),/warehouse management/);
  await s.Employee.update('cashier',{role:'admin',assigned_role:'admin',status:'inactive'});await assert.rejects(f.workspace(),/active warehouse/);
  await s.Employee.update('cashier',{status:'active'});f.client.auth.assertModule=()=>{throw Error('Inventory module disabled');};await assert.rejects(f.workspace(),/disabled/);delete f.client.auth.assertModule;
  await s.Warehouse.update(f.warehouse.id,{warehouse_type:'vehicle'});await assert.rejects(f.workspace(),/Distribution/);
  const context={user,role:'admin',employee:{role:'admin',status:'active'}};
  for(const entity of ['AuditLog','StockMovement','JournalEntry'])assert.throws(()=>guardMutation(context,entity,'create',{document_type:'WarehouseAdjustment'}),/checked warehouse form/);
});

test('the real HTTP transaction rolls back every stock, journal and audit write on a late failure, then retries once',async()=>{
  const db=new PGlite();try{
    const f=await setup(db),s=f.entities,route=await functionRoute(),body=await f.body();globalThis.__cashierClient=f.client;
    globalThis.__cashierTransaction=async fn=>{await db.exec('BEGIN');try{const r=await fn();await db.exec('COMMIT');return r;}catch(e){await db.exec('ROLLBACK');throw e;}};
    const original=s.AuditLog.create,before=(await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows;
    s.AuditLog.create=async()=>{throw Error('Audit save failed');};
    const call=()=>route(request(body),{params:Promise.resolve({name:'fieldOps'})});
    assert.equal((await call()).status,400);assert.deepEqual((await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows,before);
    s.AuditLog.create=original;assert.equal((await call()).status,200);const retry=await call();assert.equal(retry.status,200);assert.equal((await retry.json()).reused,true);assert.equal((await s.JournalEntry.list()).length,1);
  }finally{delete globalThis.__cashierClient;delete globalThis.__cashierTransaction;await db.close();}
});

test('finished-product counts use the existing company location while retaining manufacturing QC',async()=>{
 const f=await setup(),s=f.entities;await s.Product.update(f.product.id,{inventory_type:'assembly'});
 await f.call(await f.body([11,5]));assert.equal((await s.StockBalance.get(f.lots[0].id)).quantity,11);assert.equal((await s.StockBalance.get(f.lots[0].id)).qc_status,'quarantine');
 await f.call(await f.body([9,5]));assert.equal((await s.StockBalance.get(f.lots[0].id)).quantity,9);
 await s.Warehouse.update(f.warehouse.id,{warehouse_type:'cold_room'});await f.call(await f.body([10,5]));assert.equal((await s.StockBalance.get(f.lots[0].id)).quantity,10);
});

test('one legacy zero-quantity residual does not block the warehouse or adjustments to valid lots',async()=>{
 const f=await setup(),s=f.entities;await s.StockBalance.update(f.lots[0].id,{quantity:0,total_value:25});
 const workspace=await f.workspace();assert.equal(workspace.rows[0].requires_reconciliation,true);assert.equal(workspace.can_reconcile_value,true);assert.equal(workspace.rows.length,2);
 const body=await f.body([0,6]);body.rows=body.rows.slice(1);await f.call(body);assert.equal((await s.StockBalance.get(f.lots[1].id)).quantity,6);assert.equal((await s.StockBalance.get(f.lots[0].id)).total_value,25);
});
test('verified zero count clears a residual value through balanced accounting without silently discarding it',async()=>{
 const f=await setup(),s=f.entities;await s.Employee.update('cashier',{role:'admin'});await s.StockBalance.update(f.lots[0].id,{quantity:0,total_value:25});await s.Account.update(f.inventory.id,{balance:75});
 const body=await f.body([0,5]);body.rows=[{...body.rows[0],confirm_reconciliation:true}];
 const withoutConfirmation={...body,rows:[{...body.rows[0],confirm_reconciliation:false}]};await assert.rejects(f.call(withoutConfirmation),/Confirm the accounting correction/);
 const result=await f.call(body);assert.equal(result.value_difference,-25);assert.equal(result.rows[0].difference,0);assert.equal((await s.Account.get(f.inventory.id)).balance,50);assert.equal((await s.Account.get('expense')).balance,25);
 assert.equal((await s.StockBalance.get(f.lots[0].id)).total_value,0);const movement=(await s.StockMovement.list()).at(-1);assert.equal(movement.quantity,0);assert.equal(movement.source_warehouse_id,f.warehouse.id);assert.equal(movement.total_value,25);
 assert.equal((await f.call(body)).reused,true);assert.equal((await s.JournalEntry.list()).length,1);
});
test('negative legacy balances can be corrected from a verified count and cost, while warehouse staff cannot change valuation',async()=>{
 const f=await setup(),s=f.entities;await s.StockBalance.update(f.lots[0].id,{quantity:-2,total_value:-20,unit_cost:10});await s.Account.update(f.inventory.id,{balance:30});
 let body=await f.body([1,5]);body.rows=[{...body.rows[0],verified_unit_cost:10,confirm_reconciliation:true}];await s.Employee.update('cashier',{role:'warehouse_manager'});await assert.rejects(f.call(body),/top administrators/);
 await s.Employee.update('cashier',{role:'admin',allowed_modules:['accounting','inventory_adjustments']});await assert.rejects(f.call({...body,rows:[{...body.rows[0],verified_unit_cost:''}]}),/verified positive unit cost/);
 await f.call(body);assert.equal((await s.StockBalance.get(f.lots[0].id)).quantity,1);assert.equal((await s.StockBalance.get(f.lots[0].id)).total_value,10);assert.equal((await s.Account.get(f.inventory.id)).balance,60);assert.equal((await s.Account.get('expense')).balance,-30);
});
test('missing or non-finite lot data is reported per row, and role permission cannot be bypassed by opening or posting directly',async()=>{
 const f=await setup(),s=f.entities;await s.StockBalance.update(f.lots[0].id,{quantity:'invalid'});const workspace=await f.workspace();assert.match(workspace.rows[0].count_issue,/missing or invalid/);assert.equal(workspace.rows[1].count_issue,'');
 await s.Employee.update('cashier',{allowed_modules:['inventory']});await assert.rejects(f.workspace(),/Special inventory adjustment access/);
 await s.Employee.update('cashier',{role:'cashier',allowed_modules:['accounting']});await assert.rejects(f.workspace(),/Special inventory adjustment access/);
 await s.Employee.update('cashier',{role:'production_manager',allowed_modules:['inventory','inventory_adjustments']});await assert.rejects(f.workspace());
});

test('a residual-value correction rolls back stock, GL and audit together after a late failure, then retries once',async()=>{
 const db=new PGlite();try{
  const f=await setup(db),s=f.entities;await s.Employee.update('cashier',{role:'admin'});await s.StockBalance.update(f.lots[0].id,{quantity:0,total_value:25});const body=await f.body([0,5]);body.rows=[{...body.rows[0],confirm_reconciliation:true}];
  const route=await functionRoute();globalThis.__cashierClient=f.client;globalThis.__cashierTransaction=async fn=>{await db.exec('BEGIN');try{const result=await fn();await db.exec('COMMIT');return result;}catch(e){await db.exec('ROLLBACK');throw e;}};
  const before=(await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows,create=s.AuditLog.create;s.AuditLog.create=async()=>{throw Error('Audit unavailable');};const post=()=>route(request(body),{params:Promise.resolve({name:'fieldOps'})});
  assert.equal((await post()).status,400);assert.deepEqual((await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows,before);s.AuditLog.create=create;assert.equal((await post()).status,200);assert.equal((await post()).status,200);assert.equal((await s.JournalEntry.list()).length,1);
 }finally{delete globalThis.__cashierClient;delete globalThis.__cashierTransaction;await db.close();}
});

test('an item-specific count opens the warehouse that currently holds its stock; an unstocked finished item defaults to Cold Room',async()=>{
 const f=await setup(),s=f.entities;
 let workspace=await warehouseAdjustmentAction(f.client,user,{action:'warehouseAdjustmentWorkspace',productId:f.product.id});
 assert.equal(workspace.warehouse.id,f.warehouse.id);assert.equal(workspace.rows.length,2);
 const cold=await s.Warehouse.create({name:'Cold Room',warehouse_type:'cold_room',is_active:true});
 const finished=await s.Product.create({name:'500 g yogurt',inventory_type:'assembly',is_active:true,current_cost:100,configuration_status:'ready'});
 workspace=await warehouseAdjustmentAction(f.client,user,{action:'warehouseAdjustmentWorkspace',productId:finished.id});assert.equal(workspace.warehouse.id,cold.id);
});


async function finishedFixture(db){
 const f=await setup(db),s=f.entities;
 await s.Warehouse.update(f.warehouse.id,{warehouse_type:'cold_room'});
 await s.Product.update(f.product.id,{inventory_type:'assembly'});
 return f;
}
test('counted finished goods can be marked ready for sale without a manufacturing order',async()=>{
 const f=await finishedFixture(),s=f.entities;
 const body={action:'postWarehouseAdjustment',requestKey:crypto.randomUUID(),date,accountId:'expense',reference:'OPEN-COUNT',reason:'Existing finished goods physically checked',rows:[{product_id:f.product.id,lot_number:'OPEN-2026',expiry_date:'2099-12-31',unit_cost:10,counted_quantity:12,ready_for_sale:true}]};
 const saved=await f.call(body),lot=await s.StockBalance.get(saved.rows[0].balance_id);
 assert.equal(lot.qc_status,'approved');assert.equal(lot.quantity,12);assert.equal(lot.production_order_id,undefined);assert.equal(lot.qc_released_by_user_id,user.id);
 f.client.auth.me=async()=>({id:'gm',role:'admin'});
 const stock=await salesOrderAction(f.client,{id:'gm',role:'admin'},{action:'salesOrderStock',sourceType:'company',date});
 assert.equal(stock.products.find(p=>p.id===f.product.id).available,17); // Includes the earlier approved lot of five.
 assert.equal((await s.JournalEntry.list()).length,1);
});
test('already counted stock on hold can be released with its same quantity and value, without another journal or stock movement',async()=>{
 const f=await finishedFixture(),s=f.entities;
 const first=await f.call({action:'postWarehouseAdjustment',requestKey:crypto.randomUUID(),date,accountId:'expense',reference:'COUNT-HOLD',reason:'Opening finished goods counted',rows:[{product_id:f.product.id,lot_number:'OPEN-HOLD',expiry_date:'2099-12-31',unit_cost:10,counted_quantity:8}]});
 const id=first.rows[0].balance_id;await s.StockBalance.update(id,{qc_status:'quarantine',expiry_date:'2099-01-01'});const held=await s.StockBalance.get(id);assert.equal(held.qc_status,'quarantine');
 const beforeJ=(await s.JournalEntry.list()).length,beforeM=(await s.StockMovement.list()).length;
 const row=(await f.workspace()).rows.find(r=>r.balance_id===id);
 const release={action:'postWarehouseAdjustment',requestKey:crypto.randomUUID(),date,accountId:'expense',reference:'QUALITY-CHECK',reason:'Physical condition and printed expiry verified',rows:[{balance_id:id,fingerprint:row.fingerprint,counted_quantity:8,ready_for_sale:true}]};
 const result=await f.call(release);assert.equal(result.journal_id,'');assert.equal((await s.StockBalance.get(id)).qc_status,'approved');assert.equal((await s.StockBalance.get(id)).total_value,held.total_value);assert.equal((await s.StockBalance.get(id)).quantity,held.quantity);
 assert.equal((await s.JournalEntry.list()).length,beforeJ);assert.equal((await s.StockMovement.list()).length,beforeM);assert.equal((await f.call(release)).reused,true);
 await assert.rejects(f.call({...release,requestKey:crypto.randomUUID()}),/changed/);
});
test('ready-for-sale confirmation cannot release production batches, rejected lots or expired goods',async()=>{
 for(const mode of ['production','expired','rejected']){
  const f=await finishedFixture(),s=f.entities;
  await s.StockBalance.update(f.lots[0].id,{...(mode!=='production'?{production_order_id:''}:{}),...(mode==='expired'?{expiry_date:'2020-01-01'}:{}),...(mode==='rejected'?{qc_status:'rejected'}:{})});
  const row=(await f.workspace()).rows.find(r=>r.balance_id===f.lots[0].id);
  await assert.rejects(f.call({action:'postWarehouseAdjustment',requestKey:crypto.randomUUID(),date,accountId:'expense',reference:'CHECK',reason:'Verify physical stock',rows:[{balance_id:row.balance_id,fingerprint:row.fingerprint,counted_quantity:row.book_quantity,ready_for_sale:true}]}),/Only verified/);
  assert.equal((await s.StockBalance.get(row.balance_id)).qc_status,mode==='rejected'?'rejected':'quarantine');assert.equal((await s.JournalEntry.list()).length,0);
 }
});


test('counted ingredients and packaging can be released for production without making them sale products',async()=>{
 for(const type of ['raw_material','packaging']){
  const f=await setup(),s=f.entities;await s.Product.update(f.product.id,{inventory_type:type});
  const body={action:'postWarehouseAdjustment',requestKey:crypto.randomUUID(),date,accountId:'expense',reference:'MATERIAL-COUNT',reason:'Materials counted and checked for production use',rows:[{product_id:f.product.id,lot_number:'COUNTED-MATERIAL',unit_cost:10,counted_quantity:4,ready_for_use:true}]};
  const saved=await f.call(body),lot=await s.StockBalance.get(saved.rows[0].balance_id);assert.equal(lot.qc_status,'approved');assert.equal(lot.quantity,4);assert.equal(saved.rows[0].release_for_sale,false);assert.equal(saved.rows[0].release_for_use,true);
  const admin={id:'gm',role:'admin'};f.client.auth.me=async()=>admin;
  const stock=await salesOrderAction(f.client,admin,{action:'salesOrderStock',sourceType:'company',date});assert.ok(!stock.products.some(p=>p.id===f.product.id));
  const workspace=await f.workspace();assert.equal(workspace.items.find(p=>p.id===f.product.id).inventory_type,type);
 }
});

test('request flags cannot mark an ingredient or packaging item ready for sale',async()=>{
 for(const type of ['raw_material','packaging']){
  const f=await setup(),s=f.entities;await s.Product.update(f.product.id,{inventory_type:type});
  await assert.rejects(f.call({action:'postWarehouseAdjustment',requestKey:crypto.randomUUID(),date,accountId:'expense',reference:'COUNT-TEST',reason:'Physical materials count verified',rows:[{product_id:f.product.id,lot_number:'MATERIAL-LOT',expiry_date:'2099-01-01',unit_cost:10,counted_quantity:4,ready_for_sale:true}]}),/Only finished products/);
  assert.equal((await s.JournalEntry.list()).length,0);assert.equal((await s.StockMovement.list()).length,0);
 }
});

test('existing counted materials release without changing quantity, inventory value or posting a second journal',async()=>{
 const f=await setup(),s=f.entities;
 const first=await f.call({action:'postWarehouseAdjustment',requestKey:crypto.randomUUID(),date,accountId:'expense',reference:'MATERIAL-HOLD',reason:'Materials counted for production',rows:[{product_id:f.product.id,lot_number:'MATERIAL-HOLD',unit_cost:10,counted_quantity:3}]});
 await s.StockBalance.update(first.rows[0].balance_id,{qc_status:'quarantine',expiry_date:'2099-01-01'});
 const row=(await f.workspace()).rows.find(r=>r.balance_id===first.rows[0].balance_id),before=await s.StockBalance.get(row.balance_id),journals=(await s.JournalEntry.list()).length;
 const saved=await f.call({action:'postWarehouseAdjustment',requestKey:crypto.randomUUID(),date,reference:'USE-VERIFIED',reason:'Material quality physically verified',rows:[{balance_id:row.balance_id,fingerprint:row.fingerprint,counted_quantity:3,ready_for_use:true}]});
 const after=await s.StockBalance.get(row.balance_id);assert.equal(after.qc_status,'approved');assert.equal(after.quantity,before.quantity);assert.equal(after.total_value,before.total_value);assert.equal((await s.JournalEntry.list()).length,journals);assert.equal(saved.journal_id,'');
});


test('counting finished goods without a printed expiry does not make them saleable',async()=>{
 const f=await finishedFixture(),s=f.entities;
 const saved=await f.call({action:'postWarehouseAdjustment',requestKey:crypto.randomUUID(),date,accountId:'expense',reference:'FOUND-STOCK',reason:'Existing inventory counted',rows:[{product_id:f.product.id,lot_number:'NO-EXPIRY',unit_cost:10,counted_quantity:9}]});
 const lot=await s.StockBalance.get(saved.rows[0].balance_id);assert.equal(lot.expiry_date,'');assert.equal(lot.qc_status,'quarantine');
 const admin={id:'gm',role:'admin'};f.client.auth.me=async()=>admin;
 const stock=await salesOrderAction(f.client,admin,{action:'salesOrderStock',sourceType:'company',date});assert.equal(stock.products.find(p=>p.id===f.product.id).available,5);
});

test('counting opening stock preserves expiry and holds and rejects an expired release',async()=>{
 const f=await finishedFixture(),s=f.entities;
 await s.StockBalance.update(f.lots[1].id,{production_order_id:'',opening_batch_id:'opening-1',qc_status:'quarantine',expiry_date:'2020-01-01'});
 const row=(await f.workspace()).rows.find(r=>r.balance_id===f.lots[1].id);assert.equal(row.adjusted_stock,true);
 const body={action:'postWarehouseAdjustment',requestKey:crypto.randomUUID(),date,reference:'COUNT-EXPIRED',reason:'Count expired stock pending disposal',accountId:'expense',rows:[{balance_id:row.balance_id,fingerprint:row.fingerprint,counted_quantity:4}]};
 await assert.rejects(f.call({...body,rows:[{...body.rows[0],ready_for_sale:true}]}),/expiry/);
 const saved=await f.call(body),lot=await s.StockBalance.get(row.balance_id);assert.equal(lot.expiry_date,'2020-01-01');assert.equal(lot.qc_status,'quarantine');assert.equal(lot.quantity,4);assert.equal(lot.total_value,40);assert.ok(saved.journal_id);assert.equal(saved.rows[0].previous_expiry_date,'2020-01-01');assert.equal((await f.call(body)).reused,true);
});


async function existingStockFixture(db){
 const f=await finishedFixture(db),s=f.entities;await s.Employee.update('cashier',{role:'admin'});
 const b=await s.StockBalance.create({product_id:f.product.id,product_name:f.product.name,warehouse_id:f.warehouse.id,lot_number:'EXISTING',quantity:7,total_value:70,unit_cost:10,opening_batch_id:'OPEN-1',qc_status:'quarantine',expiry_date:'2020-01-01'});
 return {...f,existing:b};
}

test('existing stock correction releases imported stock across locations without touching stock, GL or production history',async()=>{
 const f=await existingStockFixture(),s=f.entities;
 const workspace=await f.call({action:'existingStockWorkspace'});assert.equal(workspace.lots.length,1);
 const beforeJ=await s.JournalEntry.list(),beforeM=await s.StockMovement.list(),beforeP=await s.ProductionOrder.list();
 const body={action:'correctExistingStock',confirm_import_metadata:true,requestKey:crypto.randomUUID(),reference:'MIGRATION-FIX',reason:'Existing business stock is usable',rows:workspace.lots.map(({id,fingerprint})=>({id,fingerprint}))};
 const saved=await f.call(body),b=await s.StockBalance.get(f.existing.id);assert.equal(saved.corrected,1);assert.equal(b.qc_status,'approved');assert.equal(b.expiry_date,'');assert.equal(b.quantity,7);assert.equal(b.total_value,70);assert.equal(b.unit_cost,10);assert.equal(saved.rows[0].previous_qc_status,'quarantine');assert.equal(saved.rows[0].previous_expiry_date,'2020-01-01');
 assert.deepEqual(await s.JournalEntry.list(),beforeJ);assert.deepEqual(await s.StockMovement.list(),beforeM);assert.deepEqual(await s.ProductionOrder.list(),beforeP);assert.equal((await f.call(body)).reused,true);
 await assert.rejects(f.call({...body,reason:'Changed reason'}),/different details/);
 const admin={id:'gm',role:'admin'};f.client.auth.me=async()=>admin;const stock=await salesOrderAction(f.client,admin,{action:'salesOrderStock',sourceType:'company',date});assert.equal(stock.products.find(p=>p.id===f.product.id).available,12);
});

test('rejected imported stock requires real GM and explicit physical-usability confirmation',async()=>{
 const f=await existingStockFixture(),s=f.entities;await s.StockBalance.update(f.existing.id,{qc_status:'rejected'});
 const workspace=await f.call({action:'existingStockWorkspace'}),body={action:'correctExistingStock',confirm_import_metadata:true,requestKey:crypto.randomUUID(),reference:'MIGRATION-FIX',reason:'Accidental rejection of existing stock',rows:workspace.lots.map(({id,fingerprint})=>({id,fingerprint}))};
 assert.equal(workspace.can_correct_rejected,true);await s.Employee.update('cashier',{role:'warehouse_manager'});await assert.rejects(f.call({action:'existingStockWorkspace'}),/top administrators/);await assert.rejects(f.call({...body,confirm_rejected_stock:true}),/General Manager/);
 await s.Employee.update('cashier',{role:'admin'});await assert.rejects(f.call(body),/General Manager/);await f.call({...body,confirm_rejected_stock:true});assert.equal((await s.StockBalance.get(f.existing.id)).qc_status,'approved');
});

test('existing stock correction cannot release production, legacy production, recovered or issued goods and rejects stale snapshots',async()=>{
 for(const mode of ['production','legacy-production','recovery','vehicle']){
  const f=await existingStockFixture(),s=f.entities;
  if(mode==='production')await s.StockBalance.update(f.existing.id,{production_order_id:'PROD-1'});
  if(mode==='legacy-production')await s.StockMovement.create({product_id:f.product.id,destination_warehouse_id:f.warehouse.id,lot_number:'EXISTING',movement_type:'production_output'});
  if(mode==='recovery')await s.StockBalance.update(f.existing.id,{inventory_recovery_id:'REC-1'});
  if(mode==='vehicle')await s.Warehouse.update(f.warehouse.id,{warehouse_type:'vehicle'});
  assert.equal((await f.call({action:'existingStockWorkspace'})).lots.length,0);
  await assert.rejects(f.call({action:'correctExistingStock',confirm_import_metadata:true,requestKey:crypto.randomUUID(),reference:'TEST-FIX',reason:'Do not release manufactured stock',rows:[{id:f.existing.id,fingerprint:'forged'}]}),/cannot be corrected/);
 }
 const f=await existingStockFixture(),row=(await f.call({action:'existingStockWorkspace'})).lots[0];await f.entities.StockBalance.update(row.id,{quantity:6});
 await assert.rejects(f.call({action:'correctExistingStock',confirm_import_metadata:true,requestKey:crypto.randomUUID(),reference:'STALE-FIX',reason:'Check stale count protection',rows:[{id:row.id,fingerprint:row.fingerprint}]}),/Stock changed/);
});


test('existing-stock correction rolls back quality metadata on audit failure and retries once through the real route',async()=>{
 const db=new PGlite();try{
  const f=await existingStockFixture(db),s=f.entities,route=await functionRoute();globalThis.__cashierClient=f.client;
  globalThis.__cashierTransaction=async fn=>{await db.exec('BEGIN');try{const result=await fn();await db.exec('COMMIT');return result;}catch(e){await db.exec('ROLLBACK');throw e;}};
  const rows=(await f.call({action:'existingStockWorkspace'})).lots.map(({id,fingerprint})=>({id,fingerprint}));
  const body={action:'correctExistingStock',confirm_import_metadata:true,requestKey:crypto.randomUUID(),reference:'ATOMIC-FIX',reason:'Remove mistaken manufacturing controls',rows};
  const original=s.AuditLog.create;s.AuditLog.create=async()=>{throw Error('Audit unavailable');};
  const post=()=>route(request(body),{params:Promise.resolve({name:'fieldOps'})});
  assert.equal((await post()).status,400);assert.equal((await s.StockBalance.get(f.existing.id)).qc_status,'quarantine');assert.equal((await s.StockBalance.get(f.existing.id)).expiry_date,'2020-01-01');
  s.AuditLog.create=original;const response=await post();assert.equal(response.status,200,JSON.stringify(await response.clone().json()));assert.equal((await post()).status,200);assert.equal((await s.StockBalance.get(f.existing.id)).qc_status,'approved');assert.equal((await s.AuditLog.list()).filter(a=>a.action==='correct_existing_stock').length,1);
 }finally{delete globalThis.__cashierClient;delete globalThis.__cashierTransaction;await db.close();}
});


test('opening and adjusted stock quality and expiry cannot be changed through the generic API',()=>{
 const context={user:{id:'gm',role:'admin'},role:'admin',employee:null};
 for(const marker of [{opening_batch_id:'OPEN-1'},{stock_origin:'adjustment'}])for(const change of [{qc_status:'rejected'},{expiry_date:'2026-10-29'},{stock_origin:'manufacturing'}])assert.throws(()=>guardMutation(context,'StockBalance','update',change,{...marker,id:'existing'}),/checked/);
});


test('reviewed current-price count sets quantity and value together and posts the entire value difference',async()=>{
 const f=await setup(),s=f.entities;await s.Employee.update('cashier',{role:'admin'});await s.Product.update(f.product.id,{purchase_price:12,purchase_to_storage_factor:1});
 const body=await f.body([8,5]);body.rows=[{...body.rows[0],use_current_cost:true}];const saved=await f.call(body),b=await s.StockBalance.get(f.lots[0].id);
 assert.equal(b.quantity,8);assert.equal(b.total_value,96);assert.equal(b.unit_cost,12);assert.equal(saved.value_difference,-4);assert.equal((await s.Account.get(f.inventory.id)).balance,146);assert.equal((await s.Account.get('expense')).balance,4);assert.equal(saved.rows[0].applied_unit_cost,12);
 const lines=await s.JournalLine.list();assert.equal(lines.reduce((n,l)=>n+l.debit-l.credit,0),0);assert.equal((await f.call(body)).reused,true);
});

test('same-quantity revaluation posts a zero-quantity movement and a balanced value adjustment',async()=>{
 const f=await setup(),s=f.entities;await s.Employee.update('cashier',{role:'admin'});await s.Product.update(f.product.id,{purchase_price:12});const body=await f.body([10,5]);body.rows=[{...body.rows[0],use_current_cost:true}];
 const saved=await f.call(body);assert.equal(saved.value_difference,20);assert.equal((await s.StockBalance.get(f.lots[0].id)).total_value,120);const movement=(await s.StockMovement.list()).at(-1);assert.equal(movement.quantity,0);assert.equal(movement.total_value,20);assert.equal(movement.unit_cost,12);
});

test('changed material prices invalidate adjustment snapshots and warehouse-only roles cannot revalue stock',async()=>{
 const f=await setup(),s=f.entities;await s.Product.update(f.product.id,{purchase_price:12});const body=await f.body([10,5]);body.rows=[{...body.rows[0],use_current_cost:true}];await s.Employee.update('cashier',{role:'warehouse_manager'});await assert.rejects(f.call(body),/top administrators/);
 await s.Employee.update('cashier',{role:'admin'});await s.Product.update(f.product.id,{purchase_price:14});await assert.rejects(f.call(body),/changed since/);assert.equal((await s.JournalEntry.list()).length,0);
 const workspace=await f.workspace();assert.equal(workspace.items.find(p=>p.id===f.product.id).unit_cost,14);assert.equal(workspace.rows[0].configured_unit_cost,14);
});


test('an empty existing lot takes its configured purchase cost instead of a stale zero carrying-cost cache',async()=>{
 const f=await setup(),s=f.entities;await s.Product.update(f.product.id,{purchase_price:12,current_cost:0});await s.StockBalance.update(f.lots[0].id,{quantity:0,total_value:0,unit_cost:0});const body=await f.body([2,5]);body.rows=body.rows.slice(0,1);await f.call(body);const b=await s.StockBalance.get(f.lots[0].id);assert.equal(b.quantity,2);assert.equal(b.unit_cost,12);assert.equal(b.total_value,24);
});


async function simpleBody(f,counts=[8,6]){
 const original=await f.body(counts),workspace=await f.workspace();
 const surplus=await f.entities.Account.create({name:'Stock surplus',account_number:'7580',account_type:'other_income',normal_balance:'credit',currency:'XAF',is_active:true,is_posting:true,balance:0});
 const {accountId,...body}=original;void accountId;
 return {...body,lossAccountId:'expense',gainAccountId:surplus.id,item_counts:[{product_id:f.product.id,item_fingerprint:workspace.items.find(p=>p.id===f.product.id).count_fingerprint,counted_quantity:counts.reduce((sum,n)=>sum+n,0),snapshots:workspace.rows.map(row=>({balance_id:row.balance_id,fingerprint:row.fingerprint}))}]};
}
async function automaticShortageFixture(){
 const f=await setup(),s=f.entities;
 await s.StockBalance.update(f.lots[1].id,{unit_cost:20,total_value:100,expiry_date:'2027-02-01'});
 const untouched=await s.StockBalance.create({product_id:f.product.id,product_name:f.product.name,warehouse_id:f.warehouse.id,lot_number:'LATER-HELD',batch_number:'BATCH-LATER',production_order_id:'production-2',expiry_date:'2027-03-01',quantity:4,unit_cost:30,total_value:120,qc_status:'rejected'});
 const empty=await s.StockBalance.create({product_id:f.product.id,product_name:f.product.name,warehouse_id:f.warehouse.id,lot_number:'EMPTY-HISTORY',expiry_date:'2026-01-01',quantity:0,unit_cost:10,total_value:0,qc_status:'quarantine'});
 await s.Account.update(f.inventory.id,{balance:320});
 await s.Account.update('payable',{account_type:'liability'});
 const loss=await s.Account.create({name:'Verified stock shortage',account_number:'6590',account_type:'expense',normal_balance:'debit',currency:'XAF',is_active:true,is_posting:true,balance:0});
 const workspace=await f.call({action:'warehouseAdjustmentWorkspace',itemGroup:'ingredients'}),item=workspace.items.find(row=>row.id===f.product.id);
 const plan=physicalItemCount(item,workspace.rows,7);
 const body={action:'postWarehouseAdjustment',requestKey:crypto.randomUUID(),date,itemGroup:'ingredients',lossAccountId:loss.id,reference:'SHORTAGE-COUNT',reason:'Physical shortage confirmed from item totals',
  item_counts:[{product_id:item.id,item_fingerprint:item.count_fingerprint,counted_quantity:plan.counted_quantity,allocation_method:plan.allocation_method,snapshots:workspace.rows.map(row=>({balance_id:row.balance_id,fingerprint:row.fingerprint}))}],
  rows:plan.rows.map(row=>({balance_id:row.balance_id,fingerprint:row.fingerprint,counted_quantity:row.counted_quantity}))};
 return {...f,untouched,empty,loss,workspace,plan,shortageBody:body};
}

test('an automatic multi-lot shortage posts the selected loss expense at individual carrying costs without a surplus account or payable',async()=>{
 const f=await automaticShortageFixture(),s=f.entities,body=f.shortageBody;
 assert.equal(f.plan.needs_batches,undefined);assert.equal(f.plan.allocation_method,'fefo');assert.equal(f.plan.value_difference,-140);
 assert.ok(f.workspace.accounts.some(row=>row.id==='expense'));assert.ok(f.workspace.accounts.some(row=>row.id===f.loss.id));
 assert.equal(body.gainAccountId,undefined);assert.equal(body.item_counts[0].snapshots.length,4);assert.equal(body.rows.length,2);
 const beforeStock=await s.StockBalance.list(),beforeAccounts=await s.Account.list();
 const financialEntities=['Bill','Payment','PaymentAllocation','Supplier','TreasuryAccount','TreasuryTransaction'];
 const beforeOther=await Promise.all(financialEntities.map(name=>s[name].list()));
 const result=await f.call(body);
 assert.equal(result.value_difference,-140);assert.equal(result.loss_account.id,f.loss.id);assert.equal(result.gain_account,null);
 assert.deepEqual(result.item_counts.map(row=>[row.book_quantity,row.counted_quantity,row.difference,row.allocation_method]),[[19,7,-12,'fefo']]);
 const posted=await s.JournalLine.filter({journal_id:result.journal_id});
 assert.deepEqual(posted.map(row=>({account_id:row.account_id,debit:row.debit,credit:row.credit})).sort((a,b)=>a.account_id.localeCompare(b.account_id)),[
  {account_id:f.inventory.id,debit:0,credit:140},{account_id:f.loss.id,debit:140,credit:0},
 ].sort((a,b)=>a.account_id.localeCompare(b.account_id)));
 assert.equal(posted.reduce((sum,row)=>sum+row.debit-row.credit,0),0);
 const actual=await s.StockBalance.list();
 assert.deepEqual([f.lots[0],f.lots[1],f.untouched,f.empty].map(lot=>{const row=actual.find(value=>value.id===lot.id);return [row.quantity,row.total_value];}),[[0,0],[3,60],[4,120],[0,0]]);
 for(const old of beforeStock){const row=actual.find(value=>value.id===old.id);for(const field of ['qc_status','expiry_date','lot_number','batch_number','production_order_id'])assert.equal(row[field],old[field]);}
 assert.equal((await s.Account.get(f.inventory.id)).balance,180);assert.equal((await s.Account.get(f.loss.id)).balance,140);
 for(const old of beforeAccounts.filter(row=>![f.inventory.id,f.loss.id].includes(row.id)))assert.deepEqual(await s.Account.get(old.id),old);
 assert.equal((await s.Account.list()).length,beforeAccounts.length);assert.deepEqual(await Promise.all(financialEntities.map(name=>s[name].list())),beforeOther);
 const saved=await Promise.all(['StockBalance','StockMovement','JournalEntry','JournalLine','AuditLog'].map(name=>s[name].list()));
 assert.equal((await f.call(body)).reused,true);assert.deepEqual(await Promise.all(['StockBalance','StockMovement','JournalEntry','JournalLine','AuditLog'].map(name=>s[name].list())),saved);
 await assert.rejects(f.call({...body,requestKey:crypto.randomUUID()}),/changed since this item count/);
 assert.deepEqual(await Promise.all(['StockBalance','StockMovement','JournalEntry','JournalLine','AuditLog'].map(name=>s[name].list())),saved);
});

test('automatic shortages still require unchanged and empty layer snapshots and reject a fresh receipt before posting',async()=>{
 for(const mode of ['omitted-empty','changed-untouched','new-receipt']){
  const f=await automaticShortageFixture(),s=f.entities,body=f.shortageBody;
  if(mode==='omitted-empty')body.item_counts[0].snapshots=body.item_counts[0].snapshots.filter(row=>row.balance_id!==f.empty.id);
  if(mode==='changed-untouched')await s.StockBalance.update(f.untouched.id,{quantity:5,total_value:150});
  if(mode==='new-receipt')await s.StockBalance.create({product_id:f.product.id,warehouse_id:f.warehouse.id,lot_number:'ARRIVED-AFTER-COUNT',quantity:2,unit_cost:40,total_value:80,qc_status:'approved'});
  const before=await s.StockBalance.list();await assert.rejects(f.call(body),/changed since this item count/);
  assert.deepEqual(await s.StockBalance.list(),before);assert.equal((await s.JournalEntry.list()).length,0);assert.equal((await s.StockMovement.list()).length,0);
 }
});

test('an automatic shortage cannot post its loss to a liability account',async()=>{
 const f=await automaticShortageFixture(),s=f.entities,before=await s.StockBalance.list();
 await assert.rejects(f.call({...f.shortageBody,lossAccountId:'payable'}),/inventory loss expense account/);
 assert.deepEqual(await s.StockBalance.list(),before);assert.equal((await s.JournalEntry.list()).length,0);assert.equal((await s.StockMovement.list()).length,0);assert.equal((await s.Account.get('payable')).balance,0);
});

test('packaging and raw-material shortages use their configured stock rule and carrying costs without requiring batch or expiry metadata',async()=>{
 const categories=[
  {name:'Packaging cups',inventory_type:'packaging',unit_of_measure:'ea',group:'packaging'},
  {name:'Packaging stickers',inventory_type:'raw_material',material_group:'Packaging',unit_of_measure:'ea',group:'packaging'},
  {name:'Raw milk powder',inventory_type:'raw_material',material_group:'Raw materials',unit_of_measure:'g',group:'ingredients'},
  {name:'Purchased sugar',inventory_type:'inventory_item',material_group:'Ingredients',unit_of_measure:'kg',group:'ingredients'},
 ];
 for(const {group,...category} of categories){
  const f=await setup(),s=f.entities;
  await s.Product.update(f.product.id,{...category,inventory_account_id:'',purchase_price:50000,purchase_to_storage_factor:1000});
  await s.PostingRule.create({rule_key:'raw_material_inventory',account_id:f.inventory.id,is_active:true});
  await s.Account.update(f.inventory.id,{balance:200});
  for(const [index,lot] of f.lots.entries())await s.StockBalance.update(lot.id,{lot_number:'',batch_number:'',expiry_date:'',production_order_id:'',unit_cost:index?20:10,total_value:100,stock_origin:'purchase'});
  const workspace=await f.call({action:'warehouseAdjustmentWorkspace',itemGroup:group}),item=workspace.items.find(row=>row.id===f.product.id),plan=physicalItemCount(item,workspace.rows,3);
  assert.equal(item.count_group,group);assert.equal(item.unit_cost,50);assert.equal(item.inventory_account.id,f.inventory.id);
  assert.equal(plan.needs_batches,undefined);assert.equal(plan.needs_lot,undefined);assert.equal(plan.value_difference,-140);
  const body={action:'postWarehouseAdjustment',requestKey:crypto.randomUUID(),date,itemGroup:group,lossAccountId:'expense',reference:'MATERIAL-COUNT',reason:'Verified non-finished stock shortage',
   item_counts:[{product_id:item.id,item_fingerprint:item.count_fingerprint,counted_quantity:3,allocation_method:plan.allocation_method,snapshots:workspace.rows.map(row=>({balance_id:row.balance_id,fingerprint:row.fingerprint}))}],
   rows:plan.rows.map(row=>({balance_id:row.balance_id,fingerprint:row.fingerprint,counted_quantity:row.counted_quantity}))};
  const result=await f.call(body),remaining=await s.StockBalance.filter({product_id:item.id});
  assert.equal(result.item_group,group);assert.equal(result.value_difference,-140);assert.equal(result.gain_account,null);
  assert.equal((await s.Account.get('expense')).balance,140);assert.equal((await s.Account.get(f.inventory.id)).balance,60);
  assert.equal(remaining.reduce((sum,row)=>sum+row.quantity,0),3);assert.equal(remaining.reduce((sum,row)=>sum+row.total_value,0),60);
  for(const original of workspace.rows){const row=remaining.find(value=>value.id===original.balance_id);assert.equal(row.qc_status,original.qc_status);assert.equal(row.lot_number,'');assert.equal(row.batch_number,'');assert.equal(row.expiry_date,'');assert.equal(row.stock_origin,'purchase');}
  assert.equal((await s.Bill.list()).length,0);assert.equal((await s.Account.get('payable')).balance,0);
  assert.equal((await f.call(body)).reused,true);assert.equal((await s.JournalEntry.list()).length,1);
 }
});

test('item counts post losses and surpluses to dedicated accounts and retain a balanced immutable item receipt',async()=>{
 const f=await setup(),body=await simpleBody(f),beforeCash=await f.entities.TreasuryAccount.list();
 const result=await f.call(body);
 assert.deepEqual(result.item_counts.map(row=>[row.book_quantity,row.counted_quantity,row.difference]),[[15,14,-1]]);
 assert.equal((await f.entities.Account.get('expense')).balance,20);
 assert.equal((await f.entities.Account.get(body.gainAccountId)).balance,10);
 assert.equal((await f.entities.Account.get(f.inventory.id)).balance,140);
 assert.equal(result.posting_lines.reduce((sum,line)=>sum+line.debit-line.credit,0),0);
 assert.equal(result.loss_account.id,'expense');assert.equal(result.gain_account.id,body.gainAccountId);
 assert.deepEqual(await f.entities.TreasuryAccount.list(),beforeCash);
 const first=await f.entities.StockBalance.get(f.lots[0].id);assert.equal(first.qc_status,'quarantine');assert.equal(first.expiry_date,'2027-01-01');
 assert.equal((await f.call(body)).reused,true);assert.equal((await f.entities.JournalEntry.list()).length,1);
});
test('a total-only request cannot quietly overwrite different batch totals or omit unchanged stock evidence',async()=>{
 for(const mutate of [
  body=>{body.item_counts[0].counted_quantity=1;},
  body=>{body.item_counts[0].snapshots.pop();},
  body=>{body.item_counts.push(structuredClone(body.item_counts[0]));},
  body=>{body.item_counts[0].item_fingerprint='changed';},
  body=>{body.rows[0].ready_for_sale=true;},
 ]){
  const f=await setup(),body=await simpleBody(f),before=JSON.stringify(await f.entities.StockBalance.list());mutate(body);
  await assert.rejects(f.call(body),/physical item count|changed|once|separately/);
  assert.equal(JSON.stringify(await f.entities.StockBalance.list()),before);assert.equal((await f.entities.JournalEntry.list()).length,0);assert.equal((await f.entities.StockMovement.list()).length,0);
 }
});
test('changes to an unchanged batch or a newly received batch invalidate the whole item count before posting',async()=>{
 for(const newBatch of [false,true]){
  const f=await setup(),body=await simpleBody(f,[8,5]);body.rows=body.rows.slice(0,1);
  if(newBatch)await f.entities.StockBalance.create({product_id:f.product.id,warehouse_id:f.warehouse.id,lot_number:'ARRIVED',quantity:3,total_value:30,unit_cost:10,qc_status:'approved'});
  else await f.entities.StockBalance.update(f.lots[1].id,{quantity:6,total_value:60});
  const before=JSON.stringify(await f.entities.StockBalance.list());
  await assert.rejects(f.call(body),/changed since this item count/);assert.equal(JSON.stringify(await f.entities.StockBalance.list()),before);
  assert.equal((await f.entities.JournalEntry.list()).length,0);
 }
});
test('simple surplus counts cannot credit an expense, treasury or foreign-currency account',async()=>{
 for(const patch of [{account_type:'expense',normal_balance:'debit'},{is_treasury:true},{currency:'USD'},{is_posting:false},{account_number:'1050'}]){
  const f=await setup(),body=await simpleBody(f,[11,5]);await f.entities.Account.update(body.gainAccountId,patch);
  const before=JSON.stringify(await f.entities.StockBalance.list());await assert.rejects(f.call(body),/surplus income account/);
  assert.equal(JSON.stringify(await f.entities.StockBalance.list()),before);assert.equal((await f.entities.JournalEntry.list()).length,0);
 }
});
test('new counted items validate their account fingerprint and remain on quality hold',async()=>{
 const f=await setup(),s=f.entities;
 for(const lot of f.lots)f.rows.StockBalance.splice(f.rows.StockBalance.findIndex(row=>row.id===lot.id),1);
 const data=await f.workspace(),item=data.items.find(p=>p.id===f.product.id);
 const income=await s.Account.create({name:'Surplus',account_number:'7580',account_type:'other_income',normal_balance:'credit',is_active:true,is_posting:true,balance:0});
 const body={action:'postWarehouseAdjustment',requestKey:crypto.randomUUID(),date,reference:'FOUND-COUNT',reason:'Counted unrecorded sealed stock',gainAccountId:income.id,item_counts:[{product_id:item.id,item_fingerprint:item.count_fingerprint,counted_quantity:3,snapshots:[]}],rows:[{product_id:item.id,unit:item.unit,lot_number:'FOUND-LOT',unit_cost:item.unit_cost,counted_quantity:3}]};
 await s.Product.update(item.id,{inventory_account_id:'changed'});
 await assert.rejects(f.call(body),/accounts changed/);
 await s.Product.update(item.id,{inventory_account_id:f.inventory.id});
 const result=await f.call(body),row=await s.StockBalance.get(result.rows[0].balance_id);
 assert.equal(row.quantity,3);assert.equal(row.qc_status,'quarantine');assert.equal(row.total_value,30);assert.equal(result.item_counts[0].book_quantity,0);
});


test('grouped count workspaces return only the selected group and live balances from the selected warehouse',async()=>{
 const f=await setup(),s=f.entities;
 const pack=await s.Warehouse.create({name:'Packaging store',warehouse_type:'packaging',is_active:true});
 const cold=await s.Warehouse.create({name:'Cold room',warehouse_type:'cold_room',is_active:true});
 const cup=await s.Product.create({...f.product,id:undefined,name:'YOLA sticker 500g',inventory_type:'inventory_item',material_group:'Labels'});
 const finished=await s.Product.create({...f.product,id:undefined,name:'YOLA 500g',inventory_type:'assembly'});
 const local=await s.StockBalance.create({product_id:cup.id,warehouse_id:f.warehouse.id,quantity:7,total_value:70,unit_cost:10,qc_status:'quarantine'});
 await s.StockBalance.create({product_id:cup.id,warehouse_id:pack.id,quantity:90,total_value:900,unit_cost:10,qc_status:'approved'});
 await s.StockBalance.create({product_id:finished.id,warehouse_id:f.warehouse.id,quantity:3,total_value:30,unit_cost:10,qc_status:'approved'});
 const expected={ingredients:f.product.id,packaging:cup.id,finished:finished.id};
 for(const [itemGroup,id] of Object.entries(expected)){
  const data=await f.call({action:'warehouseAdjustmentWorkspace',itemGroup});
  assert.equal(data.item_group,itemGroup);assert.ok(data.items.some(item=>item.id===id));
  assert.ok(data.items.every(item=>item.count_group===itemGroup));assert.ok(data.rows.every(row=>row.product_id===id&&row.warehouse_id===f.warehouse.id));
  assert.equal(data.warehouse.warehouse_type,'raw_material');assert.ok(Number.isFinite(Date.parse(data.as_of)));
 }
 assert.equal((await f.call({action:'warehouseAdjustmentWorkspace',itemGroup:'auto'})).item_group,'ingredients');
 const preferred=await f.call({action:'warehouseAdjustmentWorkspace',warehouseId:undefined,itemGroup:'packaging'});
 assert.equal(preferred.warehouse.id,pack.id);assert.equal(preferred.rows.reduce((sum,row)=>sum+row.book_quantity,0),90);
 assert.equal((await f.call({action:'warehouseAdjustmentWorkspace',warehouseId:cold.id,itemGroup:'auto'})).item_group,'finished');
 await s.StockBalance.update(local.id,{quantity:9,total_value:90});
 const fresh=await f.call({action:'warehouseAdjustmentWorkspace',itemGroup:'packaging'});
 assert.equal(fresh.rows.reduce((sum,row)=>sum+row.book_quantity,0),9);
 await assert.rejects(f.call({action:'warehouseAdjustmentWorkspace',itemGroup:'unknown'}),/valid stock count item group/);
});

test('independent group posting cannot change another group or another warehouse and stores its scope on the receipt',async()=>{
 const f=await setup(),s=f.entities,body=await simpleBody(f,[8,5]);
 const cup=await s.Product.create({...f.product,id:undefined,name:'Yogurt cups',inventory_type:'packaging'});
 const local=await s.StockBalance.create({product_id:cup.id,warehouse_id:f.warehouse.id,quantity:7,total_value:70,unit_cost:10,qc_status:'approved'});
 const elsewhere=await s.StockBalance.create({product_id:cup.id,warehouse_id:f.other.id,quantity:90,total_value:900,unit_cost:10,qc_status:'approved'});
 body.rows=body.rows.slice(0,1);body.itemGroup='packaging';
 await assert.rejects(f.call(body),/selected group/);assert.equal((await s.JournalEntry.list()).length,0);
 body.itemGroup='ingredients';const posted=await f.call(body);assert.equal(posted.item_group,'ingredients');
 assert.equal((await s.StockBalance.get(local.id)).quantity,7);assert.equal((await s.StockBalance.get(elsewhere.id)).quantity,90);
 const data=await f.call({action:'warehouseAdjustmentWorkspace',itemGroup:'packaging'}),item=data.items.find(p=>p.id===cup.id),row=data.rows.find(r=>r.balance_id===local.id);
 const second={...body,requestKey:crypto.randomUUID(),reference:'PACK-COUNT',itemGroup:'packaging',item_counts:[{product_id:cup.id,item_fingerprint:item.count_fingerprint,counted_quantity:6,snapshots:[{balance_id:row.balance_id,fingerprint:row.fingerprint}]}],rows:[{balance_id:row.balance_id,fingerprint:row.fingerprint,counted_quantity:6}]};
 const saved=await f.call(second);assert.equal(saved.item_group,'packaging');assert.equal((await s.StockBalance.get(local.id)).quantity,6);assert.equal((await s.StockBalance.get(elsewhere.id)).quantity,90);
 assert.equal((await s.StockBalance.get(f.lots[0].id)).quantity,8);assert.equal((await s.StockBalance.get(f.lots[1].id)).quantity,5);
 assert.equal((await f.call(second)).reused,true);assert.equal((await s.JournalEntry.list()).length,2);
});

test('reclassifying an item during counting blocks the previous group snapshot',async()=>{
 const f=await setup(),body=await simpleBody(f,[8,5]);body.rows=body.rows.slice(0,1);body.itemGroup='ingredients';
 await f.entities.Product.update(f.product.id,{material_group:'Packaging'});
 await assert.rejects(f.call(body),/selected group/);
 body.itemGroup='packaging';await assert.rejects(f.call(body),/accounts changed/);
 assert.equal((await f.entities.JournalEntry.list()).length,0);
 assert.equal((await f.entities.StockBalance.get(f.lots[0].id)).quantity,10);
});
