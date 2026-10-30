import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { fixture, functionRoute, request, user, date } from './helpers/cashier.mjs';
import { productionAction, prepareProductionBatch, productionExpiry } from '../src/server/domain/production-batches.js';
import { batchTraceAction } from '../src/server/domain/batch-trace.js';
import { accountPosition } from '../src/server/domain/account-position.js';
import { financialPosition } from '../src/lib/financial-position.js';
import { guardMutation } from '../src/server/access.js';
import { materialAvailability } from '../src/server/domain/production-material-availability.js';

test('raw-material check combines recipe units and excludes expired, quarantined and other-warehouse lots',()=>{
  const product={id:'milk',name:'Milk',unit_of_measure:'kg',is_active:true,preferred_supplier_id:'supplier-a'};
  const rows=materialAvailability([{material_id:'milk',quantity:500,unit:'g'},{material_id:'milk',quantity:250,unit:'g'}],new Map([['milk',product]]),[
    {product_id:'milk',warehouse_id:'raw',quantity:1,qc_status:'approved'},
    {product_id:'milk',warehouse_id:'raw',quantity:9,qc_status:'quarantine'},
    {product_id:'milk',warehouse_id:'raw',quantity:5,qc_status:'approved',expiry_date:'2020-01-01'},
    {product_id:'milk',warehouse_id:'other',quantity:4,qc_status:'approved'},
  ],2,1,{id:'raw',name:'Raw materials'});
  assert.deepEqual(rows.map(row=>[row.required,row.available,row.missing,row.unit,row.preferred_supplier_id]),[[1.5,1,0.5,'kg','supplier-a']]);
});

test('submission with missing components makes no order or material; the draft can later pass after stock arrives',async()=>{
  const f=await productionFixture(),s=f.entities;
  const raw=await s.Warehouse.create({name:'Raw materials',warehouse_type:'raw_material',is_active:true});
  const submit={...f.body,status:'awaiting_approval'};
  const blocked=await productionAction(f.client,user,submit);
  assert.equal(blocked.blocked,true);assert.equal(blocked.shortages.length,1);assert.equal(blocked.shortages[0].missing,10);
  assert.equal((await s.ProductionOrder.list()).length,0);assert.equal((await s.ProductionMaterial.list()).length,0);
  const draft=await productionAction(f.client,user,{...f.body,requestKey:crypto.randomUUID()});
  assert.equal(draft.order.status,'draft');
  const requested=await productionAction(f.client,user,{action:'requestProductionAudit',plan:f.body.plan,materialIds:[blocked.shortages[0].material_id]});
  assert.equal(requested.requested,1);
  const queue=await productionAction(f.client,user,{action:'productionAuditRequests'});assert.equal(queue.requests.length,1);
  await s.StockBalance.create({product_id:blocked.shortages[0].material_id,warehouse_id:raw.id,quantity:10,qc_status:'approved'});
  const submitted=await productionAction(f.client,user,{...submit,orderId:draft.order.id});
  assert.equal(submitted.order.status,'approved');assert.equal(submitted.order.production_authorization_role,'production_manager');assert.equal(submitted.shortages.length,0);
  const context={user,employee:{id:'production-staff',role:'production_manager',status:'active'}};
  assert.throws(()=>guardMutation(context,'ProductionOrder','update',{status:'awaiting_approval'},draft.order),/checked manufacturing workflow/);
  await productionAction(f.client,user,{action:'resolveProductionAudit',requestId:queue.requests[0].id});
  assert.equal((await productionAction(f.client,user,{action:'productionAuditRequests'})).requests.length,0);
});

async function productionFixture(db) {
  const f=await fixture(db),s=f.entities;
  await s.Employee.update('cashier',{role:'production_manager'});
  await s.Product.update('product-a',{shelf_life_days:7});
  const material=await s.Product.create({name:'Milk',current_cost:20,is_active:true,unit_of_measure:'kg'});
  const recipe=await s.Recipe.create({product_id:'product-a',product_name:'YOLA',recipe_name:'YOLA',batch_output:10,status:'approved'});
  await s.RecipeLine.create({recipe_id:recipe.id,material_id:material.id,quantity:5,unit:'kg'});
  const warehouse=await s.Warehouse.create({name:'Cold room',warehouse_type:'cold_room',is_active:true});
  const fg=await s.Account.create({account_number:'1320',name:'Finished inventory',is_active:true,is_posting:true,normal_balance:'debit',balance:0});
  await s.Account.create({account_number:'1315',name:'Work in progress',is_active:true,is_posting:true,normal_balance:'debit',balance:200});
  const body={action:'saveProductionPlan',requestKey:crypto.randomUUID(),status:'draft',plan:{recipe_id:recipe.id,planned_output:20,production_date:date}};
  return {...f,body,fg,warehouse};
}
async function issued(f) {
  const {order}=await productionAction(f.client,user,f.body);
  await f.entities.ProductionOrder.update(order.id,{status:'in_production',fermentation_started_at:'2020-01-01T00:00:00Z',fermentation_due_at:'2020-01-01T08:00:00Z',approved_by:'General Manager',approved_at:new Date().toISOString()});
  for(const m of await f.entities.ProductionMaterial.list())await f.entities.ProductionMaterial.update(m.id,{issued_quantity:m.standard_quantity,consumed_quantity:m.standard_quantity});
  return order;
}

test('production plans get distinct immutable batches and calendar-safe expiry, with one plan on retry',async()=>{
  const f=await productionFixture(),s=f.entities;
  assert.equal(productionExpiry('2028-02-28',1),'2028-02-29');assert.equal(productionExpiry('2026-02-28',1),'2026-03-01');
  const first=await productionAction(f.client,user,f.body),retry=await productionAction(f.client,user,f.body);
  assert.equal(first.order.id,retry.order.id);assert.equal(retry.reused,true);
  assert.match(first.order.batch_number,/^B-\d{8}-[A-F0-9]{12}$/);assert.equal(first.order.expiry_date,productionExpiry(date,7));
  await assert.rejects(productionAction(f.client,user,{...f.body,plan:{...f.body.plan,planned_output:99}}),/already saved/);
  assert.equal((await s.ProductionMaterial.list()).length,1);
  const second=await productionAction(f.client,user,{...f.body,requestKey:crypto.randomUUID()});assert.notEqual(second.order.batch_number,first.order.batch_number);
  await assert.rejects(prepareProductionBatch(s,{batch_number:'RENAME'},first.order),/cannot be changed/);
  const context={user,employee:{id:'production-staff',role:'production_manager',status:'active'}};
  assert.throws(()=>guardMutation(context,'ProductionOrder','delete',{}, {...first.order,status:'released',actual_output:20}),/cannot be deleted/);
  assert.throws(()=>guardMutation(context,'StockMovement','update',{lot_number:'RENAME'}, {status:'approved'}),/immutable/);
  await assert.rejects(prepareProductionBatch(s,{product_id:'product-a',production_date:date,batch_number:first.order.batch_number.toLowerCase()}),/already in use/);
  await s.ProductionOrder.update(first.order.id,{status:'approved'});
  await assert.rejects(productionAction(f.client,user,{...f.body,orderId:first.order.id}),/Only a draft/);
});

test('completion preserves batch and expiry on quarantined stock and posts one journal on retries',async()=>{
  const f=await productionFixture(),order=await issued(f),body={action:'completeProduction',orderId:order.id,quantity:20};
  const result=await productionAction(f.client,user,body);await productionAction(f.client,user,body);
  const stock=(await f.entities.StockBalance.list()).filter(b=>b.production_order_id===order.id);
  assert.equal(stock.length,1);assert.equal(stock[0].quantity,20);assert.equal(stock[0].lot_number,order.batch_number);assert.equal(stock[0].expiry_date,order.expiry_date);assert.equal(stock[0].qc_status,'quarantine');
  assert.equal(result.order.status,'awaiting_qc');assert.equal((await f.entities.JournalEntry.list()).length,1);
  assert.equal((await f.entities.StockMovement.list()).filter(m=>m.movement_type==='production_output').length,1);
});

test('a late completion error rolls back stock, production, sequences and ledger before a successful retry',async()=>{
  const db=new PGlite();
  try {
    const f=await productionFixture(db),order=await issued(f),route=await functionRoute();
    globalThis.__cashierClient=f.client;
    globalThis.__cashierTransaction=async fn=>{await db.exec('BEGIN');try{const r=await fn();await db.exec('COMMIT');return r;}catch(e){await db.exec('ROLLBACK');throw e;}};
    const before=(await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows;
    const original=f.entities.Account.update;let fail=true;
    f.entities.Account.update=async(id,value)=>{if(id===f.fg.id&&fail)throw Error('Ledger unavailable');return original(id,value);};
    const body={action:'completeProduction',orderId:order.id,quantity:20},params={params:Promise.resolve({name:'fieldOps'})};
    const failed=await route(request(body),params);assert.equal(failed.status,400);
    assert.deepEqual((await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows,before);
    fail=false;assert.equal((await route(request(body),params)).status,200);assert.equal((await route(request(body),params)).status,200);
    assert.equal((await f.entities.JournalEntry.list()).length,1);
  }finally{delete globalThis.__cashierClient;delete globalThis.__cashierTransaction;await db.close();}
});

test('trace finds exact-lot Commercial, legacy and replacement supplies without counting transfers or other products',async()=>{
  const {client,entities:s}=await fixture();await s.Employee.update('cashier',{role:'production_manager'});
  const field=await s.FieldSale.create({sale_number:'FS-01',customer_id:'customer-a',customer_name:'Customer A',status:'approved_posted'});
  const legacy=await s.SalesOrder.create({order_number:'SO-01',customer_id:'customer-a',customer_name:'Customer A',status:'delivered'});
  const replacement=await s.SpoilageRecord.create({record_type:'field_expired_return',record_number:'ER-01',customer_id:'customer-a',customer_name:'Customer A',status:'replaced'});
  const move=(quantity,movement_type,rest={})=>s.StockMovement.create({product_id:'product-a',lot_number:'B-EXACT',quantity,movement_type,status:'approved',movement_date:date,...rest});
  await move(10,'production_output',{destination_warehouse_id:'factory'});
  await move(10,'vehicle_load',{source_warehouse_id:'factory'});await move(10,'vehicle_load',{destination_warehouse_id:'van-stock'});
  await move(3,'field_delivery',{source_warehouse_id:'van-stock',document_type:'FieldSale',document_id:field.id});
  await move(3,'field_delivery',{destination_warehouse_id:'pending',document_type:'FieldSale',document_id:field.id});
  await move(2,'customer_delivery',{source_warehouse_id:'van-stock',document_type:'SalesOrder',document_id:legacy.id});
  await move(1,'promotional_issue',{source_warehouse_id:'van-stock',document_type:'SpoilageRecord',document_id:replacement.id});
  await move(1,'customer_return',{destination_warehouse_id:'factory'});
  await move(100,'field_delivery',{source_warehouse_id:'van-stock',document_type:'FieldSale',document_id:field.id,status:'reversed'});
  await move(99,'field_delivery',{product_id:'another-product',source_warehouse_id:'van-stock',document_type:'FieldSale',document_id:field.id});
  const trace=await batchTraceAction(client,user,{action:'batchTrace',lotNumber:'B-EXACT',productId:'product-a'});
  assert.equal(trace.forward.produced,10);assert.equal(trace.forward.delivered,6);assert.equal(trace.forward.returned,1);assert.equal(trace.forward.customers.length,3);
  assert.ok(trace.forward.customers.every(c=>c.customer_name==='Customer A'));
  const catalogue=await batchTraceAction(client,user,{action:'batchCatalogue'});
  assert.equal(catalogue.batches.filter(b=>b.lot_number==='B-EXACT').length,2,'depleted batches remain separate by product');
  assert.equal(catalogue.batches.find(b=>b.product_id==='product-a').supplied_quantity,5,'historical supplies exclude replacement promotions and transfer receipts');
  await s.Employee.update('cashier',{role:'commercial'});
  await assert.rejects(batchTraceAction(client,user,{action:'batchCatalogue'}),/Not permitted/);
});

test('financial position includes contra assets, equity and earnings without double-counting account headers',()=>{
  const accounts=[['header','asset'],['cash','asset'],['depreciation','asset'],['payable','liability'],['capital','equity'],['sales','revenue'],['cost','expense']].map(([id,account_type])=>({id,name:id,account_number:id,account_type}));
  const balances={header:{debit:50,credit:0},cash:{debit:1000,credit:0},depreciation:{debit:0,credit:100},payable:{debit:0,credit:300},capital:{debit:0,credit:400},sales:{debit:0,credit:300},cost:{debit:50,credit:0}};
  const p=financialPosition(accounts,balances);assert.equal(p.totalAssets,950);assert.equal(p.totalLiabilities,300);assert.equal(p.earnings,250);assert.equal(p.totalEquity,650);assert.equal(p.difference,0);
  assert.equal(p.assets.find(a=>a.id==='depreciation').amount,-100);
  assert.equal(financialPosition(accounts,{...balances,cash:{debit:1100,credit:0}}).difference,100,'a true imbalance is shown, never plugged');
});

test('account position includes only posted dated lines, permits management and rejects cashier and commercial access',async()=>{
  const {client,entities:s}=await fixture();
  const posted=await s.JournalEntry.create({status:'posted',entry_date:date}),draft=await s.JournalEntry.create({status:'draft',entry_date:date}),future=await s.JournalEntry.create({status:'posted',entry_date:'2099-01-01'});
  await s.JournalLine.create({journal_id:posted.id,account_id:'till-gl',debit:100,credit:0});
  await s.JournalLine.create({journal_id:draft.id,account_id:'till-gl',debit:900,credit:0,status:'posted'});
  await s.JournalLine.create({journal_id:future.id,account_id:'till-gl',debit:900,credit:0,status:'posted'});
  await s.JournalLine.create({journal_id:'missing',account_id:'till-gl',debit:900,credit:0,status:'posted'});
  await assert.rejects(accountPosition(client,user),/restricted to authorized management/);await s.Employee.update('cashier',{role:'production_manager'});
  const result=await accountPosition(client,user);assert.equal(result.balances['till-gl'].debit,100);assert.equal(result.balances['till-gl'].entries,1);
  await s.Employee.update('cashier',{role:'production_manager'});assert.equal((await accountPosition(client,user)).balances['till-gl'].debit,100);
  await s.Employee.update('cashier',{role:'commercial'});await assert.rejects(accountPosition(client,user),/Not permitted/);
});

test('PostgreSQL uniqueness prevents case-insensitive duplicate printed batches and duplicate plan retries',async()=>{
  const db=new PGlite();try{
    await db.exec('CREATE TABLE public.production_order(id text,batch_number text,extra_data jsonb);CREATE TABLE public.stock_movement(lot_number text,product_id text);');
    await db.exec(await readFile('supabase/migrations/202610180004_production_batch_integrity.sql','utf8'));
    await db.query('INSERT INTO production_order VALUES($1,$2,$3)',['one','B-ONE',JSON.stringify({production_request_key:'one'})]);
    await assert.rejects(db.query('INSERT INTO production_order VALUES($1,$2,$3)',['two','b-one','{}']),e=>e.code==='23505');
    await assert.rejects(db.query('INSERT INTO production_order VALUES($1,$2,$3)',['three','B-TWO',JSON.stringify({production_request_key:'one'})]),e=>e.code==='23505');
  }finally{await db.close();}
});
