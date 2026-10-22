import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { PGlite } from '@electric-sql/pglite';
import { fixture,user,date,request } from './helpers/cashier.mjs';
import { inventoryGroup,groupedInventory,inventoryVariants } from '../src/lib/inventory-groups.js';
import { inventoryWorkspaceState,INVENTORY_SECTIONS } from '../src/lib/inventory-workspace.js';
import { validateQuickItemChanges } from '../src/lib/item-quick-edit.js';
import { validateItemDefinition } from '../src/server/domain/item-settings.js';
import { expiryRecoveryAction } from '../src/server/domain/expiry-recovery.js';
import { productionAction } from '../src/server/domain/production-batches.js';
import { dispatchFermentationNotifications,fermentationNotifications,acknowledgeFermentation } from '../src/server/domain/fermentation-notifications.js';
import { fermentationTimes,FERMENTATION_MS,FERMENTATION_WARNING_MS } from '../src/lib/fermentation.js';
import { guardMutation } from '../src/server/access.js';

async function setup(db) {
  const f=await fixture(db),s=f.entities;
  await s.Employee.update('cashier',{role:'warehouse_manager'});
  const original=s.AuditLog.create;
  s.AuditLog.create=async value=>{
    if(!value.id)return original(value);
    const row={...structuredClone(value),audit_source:'server_verified'};
    if(db)await db.query('INSERT INTO fixture_entity VALUES($1,$2,$3)',['AuditLog',row.id,JSON.stringify(row)]);
    else {if(f.rows.AuditLog.some(a=>a.id===row.id))throw Error('Duplicate audit event');f.rows.AuditLog.push(row);}
    return row;
  };
  const inventory=await s.Account.create({account_number:'1320',name:'Finished stock',account_type:'asset',normal_balance:'debit',is_active:true,is_posting:true,balance:100});
  const packagingAccount=await s.Account.create({account_number:'1312',name:'Packaging stock',account_type:'asset',normal_balance:'debit',is_active:true,is_posting:true,balance:0});
  await s.Product.update('product-a',{name:'YOLA brassé Nature 500g',inventory_type:'assembly',inventory_account_id:inventory.id,unit_of_measure:'ea',selling_price:10000});
  const pack=await s.Product.create({name:'Recovered cup',inventory_type:'packaging',inventory_account_id:packagingAccount.id,unit_of_measure:'ea',is_active:true});
  const cold=await s.Warehouse.create({name:'Cold Room',warehouse_type:'cold_room',is_active:true});
  const store=await s.Warehouse.create({name:'Packaging',warehouse_type:'packaging',is_active:true});
  const lot=await s.StockBalance.create({product_id:'product-a',product_name:'YOLA',warehouse_id:cold.id,warehouse_name:cold.name,quantity:10,unit_cost:10,total_value:100,lot_number:'EXPIRED',expiry_date:'2020-01-01',qc_status:'quarantine'});
  const call=body=>expiryRecoveryAction(f.client,user,body);
  const body=async()=>{const workspace=await call({action:'workspace'});return {action:'post',requestKey:crypto.randomUUID(),balanceId:lot.id,fingerprint:workspace.lots.find(b=>b.id===lot.id).fingerprint,quantity:10,warehouseId:store.id,lossAccountId:'expense',reference:'DISPOSE-001',reason:'Expired contents physically discarded',inspectionConfirmed:true,recoveries:[{productId:pack.id,quantity:10,value:20}]};};
  return {...f,inventory,packagingAccount,pack,cold,store,lot,call,body};
}

test('Inventory opens Items and preserves legacy stock-location links',()=>{
  assert.equal(inventoryWorkspaceState(new URLSearchParams()).section,'items');
  assert.equal(inventoryWorkspaceState(new URLSearchParams('section=warehouses&warehouse=old')).section,'stock');
  assert.equal(inventoryWorkspaceState(new URLSearchParams('section=warehouses&warehouse=old&panel=report')).section,'movements');
  assert.equal(INVENTORY_SECTIONS.includes('warehouses'),false);
  assert.equal(inventoryWorkspaceState(new URLSearchParams('tab=raw')).filter,'ingredients');
});
test('catalogue taxonomy groups existing families, flavours, sizes and configurable material groups without modifying masters',()=>{
  const products=[{name:'YOLA à boire Fraise 330ml',inventory_type:'assembly',flavor:'Fraise',size:'330 ml'},{name:'YOLA brassé Nature',inventory_type:'finished_product',flavor:'Nature',size:'500 g'},{name:'New flavour',inventory_type:'assembly',product_family:'Special products',flavor:'Mango'}];
  const before=structuredClone(products),groups=groupedInventory(products,true);
  assert.deepEqual(groups.map(g=>g.name),['Yaourt brassé','Yaourt à boire','Special products']);
  assert.equal(groups[0].items[0],products[1]);assert.equal(groups[1].items[0],products[0]);assert.deepEqual(inventoryVariants(products[0]),{flavor:'Fraise',size:'330 ml'});
  assert.equal(inventoryGroup({name:'Culture',inventory_type:'raw_material'}),'Additives');
  assert.equal(inventoryGroup({name:'Milk',inventory_type:'raw_material'}),'Raw Material');
  assert.equal(inventoryGroup({name:'Stickers',inventory_type:'packaging'}),'Packaging');
  assert.equal(inventoryGroup({inventory_type:'consumable',material_group:'Cleaning'}),'Cleaning');
  assert.deepEqual(products,before);
});
test('materials save without a selling price or income account and direct material selling-price writes are refused',async()=>{
  const f=await setup(),s=f.entities;
  const cogs=await s.Account.create({account_type:'cogs',is_active:true,is_posting:true});
  const saved=await validateItemDefinition(s,{name:'Milk',inventory_type:'raw_material',unit_of_measure:'kg',purchase_price:500,inventory_account_id:f.packagingAccount.id,cogs_account_id:cogs.id});
  assert.equal(saved.selling_price,null);
  await assert.rejects(validateItemDefinition(s,{inventory_type:'raw_material',selling_price:20},{inventory_type:'raw_material'}),/Only finished products/);
  assert.throws(()=>validateQuickItemChanges({inventory_type:'packaging'},{selling_price:0}),/Only finished products/);
  assert.deepEqual(validateQuickItemChanges({inventory_type:'assembly'},{selling_price:100}),{selling_price:100});
});
test('expired-stock disposal posts the net loss and packaging recovery once, preserving separate quarantined lots and traceability',async()=>{
  const f=await setup(),s=f.entities,body=await f.body(),result=await f.call(body);
  assert.equal(result.content_and_packaging_loss,80);assert.equal(result.recovered_value,20);
  assert.equal((await s.StockBalance.get(f.lot.id)).quantity,0);assert.equal((await s.StockBalance.get(f.lot.id)).total_value,0);
  const recovered=await s.StockBalance.get(result.recovered[0].balance_id);assert.equal(recovered.quantity,10);assert.equal(recovered.total_value,20);assert.equal(recovered.qc_status,'quarantine');
  assert.equal((await s.Account.get('expense')).balance,80);assert.equal((await s.Account.get(f.packagingAccount.id)).balance,20);assert.equal((await s.Account.get(f.inventory.id)).balance,0);
  assert.equal((await s.JournalLine.list()).reduce((n,l)=>n+l.debit-l.credit,0),0);assert.equal((await s.TreasuryTransaction.list()).length,0);
  assert.equal((await f.call(body)).reused,true);assert.equal((await s.JournalEntry.list()).length,1);
  await assert.rejects(f.call({...body,quantity:5}),/different disposal/);
  const moves=await s.StockMovement.list();assert.equal(moves.filter(m=>m.movement_type==='expired_disposal').length,1);assert.equal(moves.filter(m=>m.movement_type==='packaging_recovery').length,1);
});
test('partial disposal preserves the last cent and zero-value customer returns do not create a second loss journal',async()=>{
  const f=await setup(),s=f.entities;
  await s.StockBalance.update(f.lot.id,{quantity:3,total_value:1,unit_cost:1/3});
  const first=await f.body();first.quantity=1;first.recoveries=[];
  await f.call(first);assert.equal((await s.StockBalance.get(f.lot.id)).total_value,0.67);
  const last=await f.body();last.quantity=2;last.recoveries=[];await f.call(last);
  assert.equal((await s.Account.get('expense')).balance,1);
  await s.StockBalance.update(f.lot.id,{quantity:3,total_value:0,unit_cost:0});
  const zero=await f.body();zero.quantity=3;zero.recoveries[0].value=0;zero.recoveries[0].quantity=3;
  const count=(await s.JournalEntry.list()).length,result=await f.call(zero);
  assert.equal(result.content_and_packaging_loss,0);assert.equal(result.recovered_value,0);assert.equal((await s.JournalEntry.list()).length,count);
});
test('disposal rejects stale stock, unreceived vehicle returns, invalid values, excess recovery, closed periods and treasury accounts',async()=>{
  const f=await setup(),s=f.entities,body=await f.body(),before=structuredClone(f.rows);
  for(const quantity of ['',-1,0,11,0.0001,null])await assert.rejects(f.call({...body,quantity}));
  await assert.rejects(f.call({...body,recoveries:[{productId:f.pack.id,quantity:2,value:101}]}),/cannot exceed/);
  await assert.rejects(f.call({...body,recoveries:[{productId:'product-a',quantity:2,value:1}]}),/packaging/);
  await assert.rejects(f.call({...body,inspectionConfirmed:false}),/inspection/);
  await assert.rejects(f.call({...body,lossAccountId:'bank-gl'}),/accounts/);
  assert.deepEqual(f.rows,before);
  await s.StockBalance.update(f.lot.id,{qc_status:'rejected'});await assert.rejects(f.call(body),/lot changed/);
  const fresh=await f.body();await s.AccountingPeriod.update('period',{status:'closed'});await assert.rejects(f.call(fresh),/open accounting period/);
  await s.AccountingPeriod.update('period',{status:'open'});await s.Warehouse.update(f.cold.id,{vehicle_id:'vehicle'});await assert.rejects(f.call(fresh),/physically received/);
});
test('packaging release requires production inspection and generic API writes cannot forge recovery or timer history',async()=>{
  const f=await setup(),s=f.entities,result=await f.call(await f.body()),id=result.recovered[0].balance_id;
  await assert.rejects(f.call({action:'release',balanceId:id,reference:'QC-001',inspectionConfirmed:true}),/quality control/);
  await s.Employee.update('cashier',{role:'production_manager'});
  await assert.rejects(f.call({action:'release',balanceId:id,reference:'',inspectionConfirmed:true}),/evidence/);
  await f.call({action:'release',balanceId:id,reference:'QC-001 sanitation record',inspectionConfirmed:true});assert.equal((await s.StockBalance.get(id)).qc_status,'approved');
  assert.equal((await f.call({action:'release',balanceId:id})).reused,true);
  const context={user:{id:'gm',role:'admin'}};
  for(const [entity,input,existing] of [['AuditLog',{action:'fermentation_notification'}],['StockBalance',{qc_status:'approved'},{inventory_recovery_id:'recovery'}],['StockMovement',{document_type:'ExpiryRecovery'}],['ProductionOrder',{fermentation_due_at:date}]])assert.throws(()=>guardMutation(context,entity,'update',input,existing),/checked/);
  assert.throws(()=>guardMutation(context,'ProductionOrder','update',{status:'completed'},{status:'in_production',fermentation_started_at:date}),/checked manufacturing/);
});
test('disposal is restricted to authorized warehouse staff with inventory-adjustment access',async()=>{
  const f=await setup(),s=f.entities,body=await f.body();
  for(const role of ['production_manager','commercial','employee','cashier','driver','procurement']){await s.Employee.update('cashier',{role});await assert.rejects(f.call(body));}
  await s.Employee.update('cashier',{role:'warehouse_manager',allowed_modules:['inventory']});await assert.rejects(f.call(body),/Special inventory/);
  await s.Employee.update('cashier',{status:'inactive'});await assert.rejects(f.call(body),/active/);
  assert.equal((await s.StockMovement.list()).length,0);
});
test('recovered packaging is bounded by original batch consumption, falling back to the registered assembly only for unlinked lots',async()=>{
  const f=await setup(),s=f.entities;
  await s.Product.update('product-a',{components:[{product_id:f.pack.id,quantity:1,unit:'ea'}]});
  const body=await f.body();body.recoveries[0].quantity=11;
  await assert.rejects(f.call(body),/exceeds the quantity/);
  const order=await s.ProductionOrder.create({actual_output:10});await s.ProductionMaterial.create({production_order_id:order.id,material_id:f.pack.id,issued_quantity:5,consumed_quantity:5});
  await s.StockBalance.update(f.lot.id,{production_order_id:order.id});
  const batchBody=await f.body();await assert.rejects(f.call(batchBody),/exceeds the quantity/);
  batchBody.recoveries[0].quantity=5;const result=await f.call(batchBody);assert.equal(result.packaging_quantity_basis,'original production material quantities');
});
test('eight-hour fermentation starts with the actual operator, is retry safe, and blocks premature output',async()=>{
  const f=await setup(),s=f.entities;await s.Employee.update('cashier',{role:'production_manager'});
  const order=await s.ProductionOrder.create({status:'materials_issued',production_date:date,approved_by:'gm',approved_at:new Date().toISOString(),materials_issued_at:new Date().toISOString(),order_number:'PRD-01',product_id:'product-a'});
  const result=await productionAction(f.client,user,{action:'startFermentation',orderId:order.id,fermentation_started_by:'forged'});
  assert.equal(result.order.fermentation_started_by,user.id);assert.equal(Date.parse(result.order.fermentation_due_at)-Date.parse(result.order.fermentation_started_at),FERMENTATION_MS);assert.equal(Date.parse(result.order.fermentation_due_at)-Date.parse(result.order.fermentation_reminder_at),FERMENTATION_WARNING_MS);
  const replay=await productionAction(f.client,user,{action:'startFermentation',orderId:order.id});assert.equal(replay.reused,true);assert.equal(replay.order.fermentation_due_at,result.order.fermentation_due_at);
  await assert.rejects(productionAction(f.client,user,{action:'completeProduction',orderId:order.id,quantity:10}),/timer has not completed/);
  await s.Employee.update('cashier',{role:'warehouse_manager'});await assert.rejects(productionAction(f.client,user,{action:'startFermentation',orderId:order.id}),/Production management/);
});
test('durable reminders fire once at 7h30 and 8h and an offline restart catches up without a misleading warning',async()=>{
  const f=await setup(),s=f.entities,start=new Date('2026-10-21T00:00:00Z');
  const order=await s.ProductionOrder.create({status:'in_production',order_number:'PRD-02',product_name:'YOLA',...fermentationTimes(start),fermentation_started_by:user.id});
  assert.equal((await dispatchFermentationNotifications(s,new Date(start.getTime()+7*3600000))).sent,0);
  assert.equal((await dispatchFermentationNotifications(s,new Date(start.getTime()+7.5*3600000))).sent,1);
  assert.equal((await dispatchFermentationNotifications(s,new Date(start.getTime()+7.5*3600000))).sent,0);
  assert.equal((await dispatchFermentationNotifications(s,new Date(start.getTime()+8*3600000))).sent,1);
  assert.equal((await dispatchFermentationNotifications(s,new Date(start.getTime()+9*3600000))).sent,0);
  assert.equal((await s.ProductionOrder.get(order.id)).fermentation_next_notification_at,null);
  await s.ProductionOrder.create({status:'in_production',order_number:'PRD-03',...fermentationTimes(start)});
  assert.equal((await dispatchFermentationNotifications(s,new Date(start.getTime()+10*3600000))).sent,1);
  const events=(await s.AuditLog.list()).filter(a=>a.action==='fermentation_notification');assert.deepEqual(events.map(a=>a.notification_kind),['warning','complete','complete']);
});
test('notification acknowledgment is personal, durable and cannot be forged for another department',async()=>{
  const f=await setup(),s=f.entities,start=new Date('2026-10-21T00:00:00Z');
  await s.ProductionOrder.create({status:'in_production',...fermentationTimes(start)});await dispatchFermentationNotifications(s,new Date(start.getTime()+FERMENTATION_MS));
  const context={user,role:'production_manager'},rows=(await fermentationNotifications(context,s)).notifications;
  assert.equal(rows.length,1);assert.equal(rows[0].read,false);
  await assert.rejects(acknowledgeFermentation({user:{id:'different'},role:'employee'},s,rows[0].id),/not found/);
  await acknowledgeFermentation(context,s,rows[0].id);assert.equal((await fermentationNotifications(context,s)).notifications[0].read,true);
  assert.equal((await fermentationNotifications({user:{id:'other-manager'},role:'production_manager'},s)).notifications[0].read,false);
});
test('the HTTP transaction rolls back stock, recovery lots and journal when final audit persistence fails',async()=>{
  const db=new PGlite();try{
    const f=await setup(db),body=await f.body(),s=f.entities;
    const output=await build({entryPoints:['src/app/api/inventory/recovery/route.js'],bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'route-fixture',setup(b){b.onResolve({filter:/^@\/server\/auth$/},()=>({path:'auth',namespace:'mock'}));b.onResolve({filter:/^@\/server\/db$/},()=>({path:'db',namespace:'mock'}));b.onResolve({filter:/^@\/server\/request-client$/},()=>({path:'client',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},({path})=>({contents:{auth:'export const checkOrigin=()=>{};export const apiError=e=>Response.json({error:e.message},{status:400});',db:'export const transaction=fn=>globalThis.__recoveryTransaction(fn);',client:'export const createClientFromRequest=()=>globalThis.__recoveryClient;'}[path]}));}}]});
    const route=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
    globalThis.__recoveryClient=f.client;globalThis.__recoveryTransaction=async fn=>{await db.exec('BEGIN');try{const result=await fn();await db.exec('COMMIT');return result;}catch(e){await db.exec('ROLLBACK');throw e;}};
    const before=(await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows,create=s.AuditLog.create;
    s.AuditLog.create=async row=>{if(row.action==='dispose_expired_stock')throw Error('Audit unavailable');return create(row);};
    const response=await route.POST(request(body));assert.equal(response.status,400);assert.deepEqual((await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows,before);
    s.AuditLog.create=create;assert.equal((await route.POST(request(body))).status,200);
  }finally{delete globalThis.__recoveryClient;delete globalThis.__recoveryTransaction;await db.close();}
});
