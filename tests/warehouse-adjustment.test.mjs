import {salesOrderAction} from '../src/server/domain/sales-orders.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { fixture, functionRoute, request, user, date } from './helpers/cashier.mjs';
import { warehouseAdjustmentAction } from '../src/server/domain/warehouse-adjustment.js';
import { guardMutation } from '../src/server/access.js';

async function setup(db) {
  const f=await fixture(db),s=f.entities;
  await s.Employee.update('cashier',{role:'warehouse_manager'});
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

test('new counted lots use established cost and are immediately available; existing lots and forged costs cannot be duplicated',async()=>{
  const f=await setup(),s=f.entities,body={...(await f.body()),rows:[{product_id:f.product.id,lot_number:'FOUND-LOT',expiry_date:'2027-02-01',unit_cost:10,counted_quantity:2}]};
  await assert.rejects(f.call({...body,rows:[{...body.rows[0],unit_cost:0.01}]}),/carrying cost changed/);
  const result=await f.call(body),balance=await s.StockBalance.get(result.rows[0].balance_id);assert.equal(balance.quantity,2);assert.equal(balance.total_value,20);assert.equal(balance.qc_status,'approved');assert.equal(balance.expiry_date,'');
  await assert.rejects(f.call({...body,requestKey:crypto.randomUUID()}),/already exists/);
  assert.equal((await s.Account.get('expense')).balance,-20);
});

test('managed vehicle and agent locations, inactive staff, disabled modules and unauthorized roles cannot use warehouse corrections',async()=>{
  const f=await setup(),s=f.entities;
  for(const role of ['production_manager','procurement','cashier','employee','commercial','driver']){await s.Employee.update('cashier',{role});await assert.rejects(f.workspace());}
  await s.Employee.update('cashier',{role:'warehouse_manager',assigned_role:'production_manager'});await assert.rejects(f.workspace(),/warehouse management/);
  await s.Employee.update('cashier',{assigned_role:'warehouse_manager',status:'inactive'});await assert.rejects(f.workspace(),/active warehouse/);
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
 const workspace=await f.workspace();assert.equal(workspace.rows[0].requires_reconciliation,true);assert.equal(workspace.can_reconcile_value,false);assert.equal(workspace.rows.length,2);
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
 let body=await f.body([1,5]);body.rows=[{...body.rows[0],verified_unit_cost:10,confirm_reconciliation:true}];await assert.rejects(f.call(body),/Accounting or the General Manager/);
 await s.Employee.update('cashier',{role:'cashier',allowed_modules:['accounting','inventory_adjustments']});await assert.rejects(f.call({...body,rows:[{...body.rows[0],verified_unit_cost:''}]}),/verified positive unit cost/);
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
 const id=first.rows[0].balance_id;await s.StockBalance.update(id,{qc_status:'quarantine',expiry_date:'2020-01-01'});const held=await s.StockBalance.get(id);assert.equal(held.qc_status,'quarantine');
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
 await s.StockBalance.update(first.rows[0].balance_id,{qc_status:'quarantine',expiry_date:'2020-01-01'});
 const row=(await f.workspace()).rows.find(r=>r.balance_id===first.rows[0].balance_id),before=await s.StockBalance.get(row.balance_id),journals=(await s.JournalEntry.list()).length;
 const saved=await f.call({action:'postWarehouseAdjustment',requestKey:crypto.randomUUID(),date,reference:'USE-VERIFIED',reason:'Material quality physically verified',rows:[{balance_id:row.balance_id,fingerprint:row.fingerprint,counted_quantity:3,ready_for_use:true}]});
 const after=await s.StockBalance.get(row.balance_id);assert.equal(after.qc_status,'approved');assert.equal(after.quantity,before.quantity);assert.equal(after.total_value,before.total_value);assert.equal((await s.JournalEntry.list()).length,journals);assert.equal(saved.journal_id,'');
});


test('adjusted finished goods need no expiry or release flag and are immediately saleable',async()=>{
 const f=await finishedFixture(),s=f.entities;
 const saved=await f.call({action:'postWarehouseAdjustment',requestKey:crypto.randomUUID(),date,accountId:'expense',reference:'FOUND-STOCK',reason:'Existing inventory counted',rows:[{product_id:f.product.id,lot_number:'NO-EXPIRY',unit_cost:10,counted_quantity:9}]});
 const lot=await s.StockBalance.get(saved.rows[0].balance_id);assert.equal(lot.expiry_date,'');assert.equal(lot.qc_status,'approved');
 const admin={id:'gm',role:'admin'};f.client.auth.me=async()=>admin;
 const stock=await salesOrderAction(f.client,admin,{action:'salesOrderStock',sourceType:'company',date});assert.equal(stock.products.find(p=>p.id===f.product.id).available,14);
});

test('existing adjusted expiry is cleared even when approved; original values remain audited and retry is safe',async()=>{
 const f=await finishedFixture(),s=f.entities;
 await s.StockBalance.update(f.lots[1].id,{production_order_id:'',opening_batch_id:'opening-1',expiry_date:'2020-01-01'});
 const row=(await f.workspace()).rows.find(r=>r.balance_id===f.lots[1].id);assert.equal(row.adjusted_stock,true);
 const body={action:'postWarehouseAdjustment',requestKey:crypto.randomUUID(),date,reference:'CLEAR-EXPIRY',reason:'Remove expiry from adjusted opening stock',rows:[{balance_id:row.balance_id,fingerprint:row.fingerprint,counted_quantity:5,ready_for_sale:true}]};
 const saved=await f.call(body),lot=await s.StockBalance.get(row.balance_id);assert.equal(lot.expiry_date,'');assert.equal(lot.quantity,5);assert.equal(lot.total_value,50);assert.equal(saved.journal_id,'');assert.equal(saved.rows[0].previous_expiry_date,'2020-01-01');assert.equal((await s.StockMovement.list()).length,0);assert.equal((await f.call(body)).reused,true);
});


async function existingStockFixture(db){
 const f=await finishedFixture(db),s=f.entities;
 const b=await s.StockBalance.create({product_id:f.product.id,product_name:f.product.name,warehouse_id:f.warehouse.id,lot_number:'EXISTING',quantity:7,total_value:70,unit_cost:10,opening_batch_id:'OPEN-1',qc_status:'quarantine',expiry_date:'2020-01-01'});
 return {...f,existing:b};
}

test('existing stock correction releases imported stock across locations without touching stock, GL or production history',async()=>{
 const f=await existingStockFixture(),s=f.entities;
 const workspace=await f.call({action:'existingStockWorkspace'});assert.equal(workspace.lots.length,1);
 const beforeJ=await s.JournalEntry.list(),beforeM=await s.StockMovement.list(),beforeP=await s.ProductionOrder.list();
 const body={action:'correctExistingStock',requestKey:crypto.randomUUID(),reference:'MIGRATION-FIX',reason:'Existing business stock is usable',rows:workspace.lots.map(({id,fingerprint})=>({id,fingerprint}))};
 const saved=await f.call(body),b=await s.StockBalance.get(f.existing.id);assert.equal(saved.corrected,1);assert.equal(b.qc_status,'approved');assert.equal(b.expiry_date,'');assert.equal(b.quantity,7);assert.equal(b.total_value,70);assert.equal(b.unit_cost,10);assert.equal(saved.rows[0].previous_qc_status,'quarantine');assert.equal(saved.rows[0].previous_expiry_date,'2020-01-01');
 assert.deepEqual(await s.JournalEntry.list(),beforeJ);assert.deepEqual(await s.StockMovement.list(),beforeM);assert.deepEqual(await s.ProductionOrder.list(),beforeP);assert.equal((await f.call(body)).reused,true);
 await assert.rejects(f.call({...body,reason:'Changed reason'}),/different details/);
 const admin={id:'gm',role:'admin'};f.client.auth.me=async()=>admin;const stock=await salesOrderAction(f.client,admin,{action:'salesOrderStock',sourceType:'company',date});assert.equal(stock.products.find(p=>p.id===f.product.id).available,12);
});

test('rejected imported stock requires real GM and explicit physical-usability confirmation',async()=>{
 const f=await existingStockFixture(),s=f.entities;await s.StockBalance.update(f.existing.id,{qc_status:'rejected'});
 const workspace=await f.call({action:'existingStockWorkspace'}),body={action:'correctExistingStock',requestKey:crypto.randomUUID(),reference:'MIGRATION-FIX',reason:'Accidental rejection of existing stock',rows:workspace.lots.map(({id,fingerprint})=>({id,fingerprint}))};
 assert.equal(workspace.can_correct_rejected,false);await assert.rejects(f.call({...body,confirm_rejected_stock:true}),/General Manager/);
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
  await assert.rejects(f.call({action:'correctExistingStock',requestKey:crypto.randomUUID(),reference:'TEST-FIX',reason:'Do not release manufactured stock',rows:[{id:f.existing.id,fingerprint:'forged'}]}),/cannot be corrected/);
 }
 const f=await existingStockFixture(),row=(await f.call({action:'existingStockWorkspace'})).lots[0];await f.entities.StockBalance.update(row.id,{quantity:6});
 await assert.rejects(f.call({action:'correctExistingStock',requestKey:crypto.randomUUID(),reference:'STALE-FIX',reason:'Check stale count protection',rows:[{id:row.id,fingerprint:row.fingerprint}]}),/Stock changed/);
});


test('existing-stock correction rolls back quality metadata on audit failure and retries once through the real route',async()=>{
 const db=new PGlite();try{
  const f=await existingStockFixture(db),s=f.entities,route=await functionRoute();globalThis.__cashierClient=f.client;
  globalThis.__cashierTransaction=async fn=>{await db.exec('BEGIN');try{const result=await fn();await db.exec('COMMIT');return result;}catch(e){await db.exec('ROLLBACK');throw e;}};
  const rows=(await f.call({action:'existingStockWorkspace'})).lots.map(({id,fingerprint})=>({id,fingerprint}));
  const body={action:'correctExistingStock',requestKey:crypto.randomUUID(),reference:'ATOMIC-FIX',reason:'Remove mistaken manufacturing controls',rows};
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
