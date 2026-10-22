import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { fixture, functionRoute, request, user, date } from './helpers/cashier.mjs';
import { productionAction } from '../src/server/domain/production-batches.js';
import { productionPurchaseAction } from '../src/server/domain/production-purchasing.js';
import { supplierAction } from '../src/server/domain/supplier-workspace.js';
import { supplierCatalogue } from '../src/lib/supplier-catalogue.js';
import { guardMutation } from '../src/server/access.js';
import { operationalStaffData } from '../src/server/domain/staff-workspace.js';

async function setup(db) {
  const f=await fixture(db),s=f.entities;
  await s.Employee.update('cashier',{role:'production_manager',department_id:'production'});
  await s.Product.update('product-a',{shelf_life_days:10});
  const raw=await s.Warehouse.create({name:'Ingredients',warehouse_type:'raw_material',is_active:true});
  const packaging=await s.Warehouse.create({name:'Packaging store',warehouse_type:'packaging',is_active:true});
  const cold=await s.Warehouse.create({name:'Finished batches',warehouse_type:'cold_room',is_active:true});
  const milk=await s.Product.create({name:'Milk powder',inventory_type:'raw_material',unit_of_measure:'kg',current_cost:10,is_active:true});
  const cups=await s.Product.create({name:'YOLA cups',inventory_type:'packaging',unit_of_measure:'ea',current_cost:2,is_active:true});
  const inventory=await s.Account.create({account_number:'1310',account_type:'asset',name:'Raw stock',is_active:true,is_posting:true,normal_balance:'debit',balance:1000});
  const wip=await s.Account.create({account_number:'1315',account_type:'asset',name:'WIP',is_active:true,is_posting:true,normal_balance:'debit',balance:0});
  const finished=await s.Account.create({account_number:'1320',account_type:'asset',name:'Finished stock',is_active:true,is_posting:true,normal_balance:'debit',balance:0});
  await s.PostingRule.create({rule_key:'raw_material_inventory',account_id:inventory.id,account_number:'1310',account_name:'Raw stock',is_active:true});
  await s.PostingRule.create({rule_key:'supplier_payable',account_id:'payable',account_number:'4010',account_name:'Payable',is_active:true});
  const recipe=await s.Recipe.create({recipe_name:'YOLA recipe',product_id:'product-a',batch_output:10,status:'approved'});
  await s.RecipeLine.create({recipe_id:recipe.id,material_id:milk.id,quantity:500,unit:'g'});
  await s.RecipeLine.create({recipe_id:recipe.id,material_id:cups.id,quantity:10,unit:'ea'});
  const plan={recipe_id:recipe.id,planned_output:20,production_date:date};
  const {order}=await productionAction(f.client,user,{action:'saveProductionPlan',requestKey:crypto.randomUUID(),status:'draft',plan});
  const milkLot=await s.StockBalance.create({product_id:milk.id,warehouse_id:raw.id,quantity:1,unit_cost:10,total_value:10,qc_status:'approved',lot_number:'MILK-01'});
  const cupLot=await s.StockBalance.create({product_id:cups.id,warehouse_id:packaging.id,quantity:20,unit_cost:2,total_value:40,qc_status:'approved',lot_number:'CUPS-01'});
  await s.ProductionOrder.update(order.id,{status:'awaiting_approval'});
  await s.Employee.update('cashier',{role:'admin'});
  await productionAction(f.client,user,{action:'approveProductionOrder',orderId:order.id,approved_by:'forged'});
  await s.Employee.update('cashier',{role:'warehouse_manager'});
  return {...f,raw,packaging,cold,milk,cups,inventory,wip,finished,recipe,plan,order,milkLot,cupLot};
}
const action=(f,body)=>productionAction(f.client,user,{orderId:f.order.id,...body});
const finishFermentation=async f=>{
  await action(f,{action:'startFermentation'});
  await f.entities.ProductionOrder.update(f.order.id,{fermentation_started_at:new Date(Date.now()-9*3600000).toISOString(),fermentation_due_at:new Date(Date.now()-3600000).toISOString()});
};
const pending=async f=>{
  await f.entities.ProductionOrder.update(f.order.id,{status:'awaiting_approval',approved_by:'',approved_at:''});
  await f.entities.Employee.update('cashier',{role:'admin'});
};

test('approval rechecks current usable stock and leaves all records unchanged when ingredients or packaging are short',async()=>{
  const f=await setup(),s=f.entities;await pending(f);
  await s.StockBalance.update(f.milkLot.id,{quantity:0.25});
  await s.StockBalance.update(f.cupLot.id,{quantity:7});
  for(const extra of [{qc_status:'quarantine'},{qc_status:'approved',expiry_date:'2020-01-01'},{qc_status:'approved',warehouse_id:f.cold.id}])await s.StockBalance.create({product_id:f.cups.id,warehouse_id:f.packaging.id,quantity:100,...extra});
  const before=structuredClone(f.rows);
  const result=await action(f,{action:'approveProductionOrder',availability:[{missing:0}],plan:{planned_output:0.01}});
  assert.equal(result.blocked,true);assert.deepEqual(result.shortages.map(r=>[r.material_id,r.required,r.available,r.missing]),[[f.milk.id,1,0.25,0.75],[f.cups.id,20,7,13]]);
  assert.deepEqual(f.rows,before);assert.equal((await s.ProductionOrder.get(f.order.id)).status,'awaiting_approval');
  const queue=await operationalStaffData(f.client.asServiceRole,'warehouse_manager',date,['manufacturing'],await s.Employee.get('cashier'),'warehouse_manager');assert.deepEqual(queue.materialIssueOrders,[]);
  // Replenishment is checked against the submitted snapshot, not later recipe edits.
  await s.StockBalance.update(f.milkLot.id,{quantity:1});await s.StockBalance.update(f.cupLot.id,{quantity:20});
  const line=(await s.RecipeLine.list())[0];await s.RecipeLine.update(line.id,{quantity:999999});
  const approved=await action(f,{action:'approveProductionOrder'});assert.equal(approved.order.status,'approved');assert.equal(approved.order.approved_by,user.id);
  const audits=(await s.AuditLog.list()).length;assert.equal((await action(f,{action:'approveProductionOrder'})).reused,true);assert.equal((await s.AuditLog.list()).length,audits);
  assert.equal((await s.StockBalance.get(f.milkLot.id)).quantity,1);assert.equal((await s.StockMovement.list()).length,0);
  await s.StockBalance.update(f.cupLot.id,{quantity:0});await s.Employee.update('cashier',{role:'warehouse_manager'});
  assert.equal((await action(f,{action:'issueProductionMaterials'})).blocked,true);
});

test('approval requires an unambiguous source store and saves the checked selection for warehouse issue',async()=>{
  const f=await setup(),s=f.entities;await pending(f);
  const other=await s.Warehouse.create({name:'Second ingredients store',warehouse_type:'raw_material',is_active:true});
  await s.StockBalance.create({product_id:f.milk.id,warehouse_id:other.id,quantity:2,unit_cost:10,qc_status:'approved'});
  await s.ProductionOrder.update(f.order.id,{material_warehouses:{}});
  const blocked=await action(f,{action:'approveProductionOrder'});assert.equal(blocked.blocked,true);assert.equal(blocked.shortages[0].warehouse_id,'');
  const approved=await action(f,{action:'approveProductionOrder',sourceWarehouses:{[f.milk.id]:other.id}});
  assert.equal(approved.order.material_warehouses[f.milk.id],other.id);assert.equal(approved.order.material_warehouses[f.cups.id],f.packaging.id);
  await s.Employee.update('cashier',{role:'warehouse_manager'});await action(f,{action:'issueProductionMaterials'});
  assert.equal((await s.StockBalance.get(f.milkLot.id)).quantity,1);assert.equal((await s.StockBalance.list()).find(b=>b.product_id===f.milk.id && b.warehouse_id===other.id).quantity,1);
});

test('approval returns a shortage at the HTTP boundary and rolls back approval metadata if auditing fails',async()=>{
  const db=new PGlite();try{
    const f=await setup(db),s=f.entities,route=await functionRoute();await pending(f);
    globalThis.__cashierClient=f.client;globalThis.__cashierTransaction=async fn=>{await db.exec('BEGIN');try{const value=await fn();await db.exec('COMMIT');return value;}catch(e){await db.exec('ROLLBACK');throw e;}};
    await s.StockBalance.update(f.cupLot.id,{quantity:0});const before=(await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows;
    const submit=()=>route(request({action:'approveProductionOrder',orderId:f.order.id}),{params:Promise.resolve({name:'fieldOps'})});
    const response=await submit();assert.equal(response.status,200);assert.equal((await response.json()).blocked,true);assert.deepEqual((await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows,before);
    await s.StockBalance.update(f.cupLot.id,{quantity:20});const available=(await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows,original=s.AuditLog.create;
    s.AuditLog.create=async row=>{if(row.action==='approve_production')throw Error('Approval audit unavailable');return original(row);};
    assert.equal((await submit()).status,400);assert.deepEqual((await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows,available);
    s.AuditLog.create=original;const success=await submit();assert.equal(success.status,200);assert.equal((await success.json()).order.status,'approved');
  }finally{delete globalThis.__cashierClient;delete globalThis.__cashierTransaction;await db.close();}
});
async function vendor(f,id,name,products) {
  return f.entities.Supplier.create({id,name,is_active:true,supplier_items:products.map(p=>({product_id:p.id,unit:p.unit_of_measure,unit_price:p.current_cost}))});
}
async function shortage(f) {
  await f.entities.StockBalance.update(f.milkLot.id,{quantity:0,total_value:0});
  await f.entities.StockBalance.update(f.cupLot.id,{quantity:0,total_value:0});
  const dairy=await vendor(f,'dairy','Dairy supplier',[f.milk]);
  const packs=await vendor(f,'packs','Packaging supplier',[f.cups]);
  return {dairy,packs,body:{action:'requestProductionPurchase',orderId:f.order.id,requestKey:crypto.randomUUID(),lines:[{product_id:f.milk.id,supplier_id:dairy.id,quantity:1,unit_price:10},{product_id:f.cups.id,supplier_id:packs.id,quantity:20,unit_price:2}]}};
}

test('saved component requirements use their physical ingredient and packaging stores, issue once, and transfer inventory value through WIP to finished goods',async()=>{
  const f=await setup(),s=f.entities;
  const check=await action(f,{action:'checkProductionMaterials'});
  assert.equal(check.shortages.length,0);
  assert.deepEqual(check.availability.map(r=>[r.material_id,r.required,r.warehouse_id]),[[f.milk.id,1,f.raw.id],[f.cups.id,20,f.packaging.id]]);
  assert.equal((await s.ProductionOrder.get(f.order.id)).approved_by,user.id);
  const first=await action(f,{action:'issueProductionMaterials'});
  const retry=await action(f,{action:'issueProductionMaterials'});
  assert.equal(first.order.status,'materials_issued');assert.equal(retry.reused,true);
  assert.equal((await s.StockBalance.get(f.milkLot.id)).quantity,0);assert.equal((await s.StockBalance.get(f.cupLot.id)).quantity,0);
  assert.equal((await s.StockMovement.list()).filter(m=>m.document_id===f.order.id).length,2);
  assert.equal((await s.Account.get(f.wip.id)).balance,50);assert.equal((await s.Account.get(f.inventory.id)).balance,950);
  assert.equal((await s.JournalEntry.list()).length,1);
  await s.Employee.update('cashier',{role:'production_manager'});
  await finishFermentation(f);
  const output=await action(f,{action:'completeProduction',quantity:20,warehouseId:f.cold.id});
  assert.equal(output.order.status,'awaiting_qc');assert.equal((await s.Account.get(f.wip.id)).balance,0);assert.equal((await s.Account.get(f.finished.id)).balance,50);
  const batch=(await s.StockBalance.list()).find(b=>b.production_order_id===f.order.id);
  assert.equal(batch.qc_status,'quarantine');assert.equal(batch.quantity,20);assert.equal((await s.JournalEntry.list()).length,2);
});

test('a short second component blocks the entire issue without deducting the first or counting expired and quarantined lots',async()=>{
  const f=await setup(),s=f.entities;
  await s.StockBalance.update(f.cupLot.id,{quantity:2});
  for(const extra of [{qc_status:'quarantine'},{qc_status:'approved',expiry_date:'2020-01-01'}])await s.StockBalance.create({product_id:f.cups.id,warehouse_id:f.packaging.id,quantity:100,unit_cost:2,...extra});
  const result=await action(f,{action:'issueProductionMaterials'});
  assert.equal(result.blocked,true);assert.equal(result.shortages[0].missing,18);assert.equal((await s.StockBalance.get(f.milkLot.id)).quantity,1);
  assert.equal((await s.StockMovement.list()).filter(m=>m.document_id===f.order.id).length,0);assert.equal((await s.JournalEntry.list()).length,0);assert.equal((await s.ProductionOrder.get(f.order.id)).status,'approved');
});

test('lot issuance reads beyond the first 200 rows and uses the same stock set as the material check',async()=>{
  const f=await setup(),s=f.entities;
  await s.StockBalance.update(f.milkLot.id,{quantity:0});
  for(let i=0;i<205;i++)await s.StockBalance.create({product_id:f.milk.id,warehouse_id:f.raw.id,quantity:i===204?1:0,unit_cost:10,total_value:i===204?10:0,qc_status:'approved',lot_number:'LONG-'+i});
  assert.equal((await action(f,{action:'checkProductionMaterials'})).shortages.length,0);
  assert.equal((await action(f,{action:'issueProductionMaterials'})).order.status,'materials_issued');
  assert.ok((await s.StockMovement.list()).some(m=>m.lot_number==='LONG-204'));
});

test('ambiguous ingredient stores require a selected source; changing the recipe never rewrites an approved order’s saved requirements',async()=>{
  const f=await setup(),s=f.entities,other=await s.Warehouse.create({name:'Second ingredients store',warehouse_type:'raw_material',is_active:true});
  await s.ProductionOrder.update(f.order.id,{material_warehouses:{}});
  const check=await action(f,{action:'checkProductionMaterials'});assert.equal(check.availability.find(r=>r.material_id===f.milk.id).warehouse_id,'');
  await assert.rejects(action(f,{action:'issueProductionMaterials'}),/source warehouse/);
  const recipeLine=(await s.RecipeLine.list()).find(r=>r.material_id===f.milk.id);await s.RecipeLine.update(recipeLine.id,{quantity:9000});
  const chosen=await action(f,{action:'checkProductionMaterials',sourceWarehouses:{[f.milk.id]:f.raw.id}});assert.equal(chosen.availability.find(r=>r.material_id===f.milk.id).required,1);assert.equal(chosen.shortages.length,0);
  const wrong=await action(f,{action:'checkProductionMaterials',sourceWarehouses:{[f.milk.id]:other.id}});assert.equal(wrong.shortages[0].missing,1);
});

test('roles, direct record edits and inconsistent earlier issues cannot bypass warehouse issuance',async()=>{
  const f=await setup(),s=f.entities;
  await s.Employee.update('cashier',{role:'production_manager'});await assert.rejects(action(f,{action:'issueProductionMaterials'}),/warehouse management/);
  await assert.rejects(action(f,{action:'approveProductionOrder'}),/General Manager/);
  await s.Employee.update('cashier',{role:'warehouse_manager'});await assert.rejects(action(f,{action:'completeProduction',quantity:20}),/production management/);
  const context={user:{id:'gm',role:'admin'},role:'admin'};
  for(const [entity,payload] of [['ProductionOrder',{status:'materials_issued'}],['ProductionMaterial',{issued_quantity:10}],['StockMovement',{movement_type:'production_issue'}]])assert.throws(()=>guardMutation(context,entity,'create',payload),/checked manufacturing/);
  await s.StockMovement.create({document_type:'ProductionOrder',document_id:f.order.id,movement_type:'production_issue',product_id:f.milk.id,quantity:0.5,status:'approved'});
  await assert.rejects(action(f,{action:'issueProductionMaterials'}),/Reconcile the earlier/);assert.equal((await s.StockBalance.get(f.milkLot.id)).quantity,1);
});

test('shortages create vendor-specific approval requests for their receiving stores and retries or reopening cannot duplicate outstanding quantities',async()=>{
  const f=await setup(),s=f.entities,{body}=await shortage(f);
  const options=await productionPurchaseAction(f.client,user,{action:'productionPurchaseOptions',orderId:f.order.id});assert.equal(options.shortages.length,2);
  const result=await productionPurchaseAction(f.client,user,body);assert.equal(result.orders.length,2);
  assert.equal((await productionPurchaseAction(f.client,user,body)).reused,true);
  const orders=(await s.PurchaseOrder.list()).filter(po=>po.production_source_order_id===f.order.id);
  assert.deepEqual(orders.map(po=>po.warehouse_id).sort(),[f.raw.id,f.packaging.id].sort());assert.ok(orders.every(po=>po.status==='pending_approval'&&po.requested_by_id==='cashier'));
  assert.equal((await s.JournalEntry.list()).length,0);assert.equal((await s.GoodsReceipt.list()).length,0);
  const refreshed=await productionPurchaseAction(f.client,user,{action:'productionPurchaseOptions',orderId:f.order.id});assert.ok(refreshed.shortages.every(r=>r.purchase_quantity===0));
  await assert.rejects(productionPurchaseAction(f.client,user,{...body,requestKey:crypto.randomUUID()}),/already covered/);
  await assert.rejects(productionPurchaseAction(f.client,user,{...body,lines:[...body.lines].reverse()}),/already submitted/);
});

test('one supplier for ingredients and packaging still creates distinct orders for the two receiving warehouses',async()=>{
  const f=await setup(),{body,dairy}=await shortage(f);
  await f.entities.Supplier.update(dairy.id,{supplier_items:[f.milk,f.cups].map(p=>({product_id:p.id,unit:p.unit_of_measure,unit_price:p.current_cost}))});
  const result=await productionPurchaseAction(f.client,user,{...body,lines:body.lines.map(l=>({...l,supplier_id:dairy.id}))});assert.equal(result.orders.length,2);
});

test('vendor selection and quantity shortages are rechecked on the server, and receiving approved requests makes the original production issuable',async()=>{
  const f=await setup(),s=f.entities,{body,dairy}=await shortage(f);
  await assert.rejects(productionPurchaseAction(f.client,user,{...body,lines:body.lines.map(l=>({...l,supplier_id:'unknown-supplier'}))}),/active registered supplier/);
  await assert.rejects(productionPurchaseAction(f.client,user,{...body,lines:body.lines.map(l=>({...l,quantity:0.1}))}),/shortage changed/);
  const {orders}=await productionPurchaseAction(f.client,user,body);
  await s.Employee.update('cashier',{role:'admin'});
  for(const po of orders)await supplierAction(f.client,user,{action:'approveSupplierOrder',orderId:po.id});
  await s.Employee.update('cashier',{role:'warehouse_manager'});
  for(const po of orders){const order=await s.PurchaseOrder.get(po.id),lines=(await s.PurchaseOrderLine.list()).filter(l=>l.po_id===po.id);await supplierAction(f.client,user,{action:'receiveSupplierOrder',orderId:po.id,requestKey:crypto.randomUUID(),date,warehouseId:order.warehouse_id,lines:lines.map(l=>({po_line_id:l.id,quantity:l.quantity,lot_number:'RECEIVED-'+l.id}))});}
  assert.equal((await action(f,{action:'checkProductionMaterials'})).shortages.length,0);assert.equal((await action(f,{action:'issueProductionMaterials'})).order.status,'materials_issued');
});

test('the goods catalogue never falls back to unrelated inventory and checked purchase saves reject unlinked items',async()=>{
  const f=await setup(),s=f.entities,supplier=await vendor(f,'dairy','Dairy',[f.milk]);
  const products=[{...f.milk,unit:'kg',cost:99},{...f.cups,unit:'ea',cost:2}];
  assert.deepEqual(supplierCatalogue(supplier,products).map(p=>[p.id,p.supplier_price]),[[f.milk.id,10]]);assert.deepEqual(supplierCatalogue({id:'empty'},products),[]);
  await assert.rejects(supplierAction(f.client,user,{action:'saveSupplierOrder',requestKey:crypto.randomUUID(),status:'draft',order:{supplier_id:supplier.id,order_date:date,catalogue_only:true,lines:[{product_id:f.cups.id,quantity:1,unit_price:2}]}}),/goods linked/);
});

test('Production Management reads available materials and owns its submitted request, but cannot approve or issue even with forged role flags',async()=>{
  const f=await setup(),s=f.entities;
  await s.Employee.update('cashier',{role:'production_manager'});
  const check=await action(f,{action:'checkProductionMaterials'});assert.equal(check.shortages.length,0);
  const order=await s.ProductionOrder.get(f.order.id);assert.equal(order.production_requested_by_user_id,user.id);assert.equal(order.production_requester_role,'production_manager');
  await assert.rejects(action(f,{action:'approveProductionOrder',role:'admin',canApproveProduction:true}),/General Manager/);
  await assert.rejects(action(f,{action:'issueProductionMaterials',role:'warehouse_manager',canIssueMaterials:true}),/warehouse management/);
  assert.equal((await s.StockBalance.get(f.milkLot.id)).quantity,1);assert.equal((await s.StockMovement.list()).filter(m=>m.document_id===order.id).length,0);
  const context={user,employee:{id:'cashier',role:'production_manager',status:'active'}};
  assert.throws(()=>guardMutation(context,'ProductionOrder','update',{production_requested_by_user_id:'another'},order),/Requester details/);
  await s.Employee.update('cashier',{role:'warehouse_manager',assigned_role:'production_manager'});
  await assert.rejects(action(f,{action:'issueProductionMaterials'}),/warehouse management/);
  await s.Employee.update('cashier',{assigned_role:'warehouse_manager'});
  await assert.rejects(action(f,{action:'saveProductionPlan',status:'draft',requestKey:crypto.randomUUID(),plan:f.plan}),/Production Management/);
});

test('Warehouse Management receives the issue task only after GM approval and it disappears after material issue',async()=>{
  const f=await setup(),s=f.entities,employee=await s.Employee.get('cashier');
  const queue=()=>operationalStaffData(f.client.asServiceRole,'warehouse_manager',date,['manufacturing'],employee,'warehouse_manager');
  await s.ProductionOrder.update(f.order.id,{status:'awaiting_approval',approved_by:'',approved_at:''});
  assert.equal((await queue()).materialIssueOrders.length,0);
  await s.Employee.update('cashier',{role:'admin'});await action(f,{action:'approveProductionOrder'});
  const ready=(await queue()).materialIssueOrders;assert.equal(ready.length,1);assert.equal(ready[0].id,f.order.id);assert.equal(ready[0].approved_by,user.id);assert.equal(ready[0].production_requested_by_name,'Cashier');
  await s.Employee.update('cashier',{role:'warehouse_manager'});await action(f,{action:'issueProductionMaterials'});assert.equal((await queue()).materialIssueOrders.length,0);
  const disabled=await operationalStaffData(f.client.asServiceRole,'warehouse_manager',date,[],employee,'warehouse_manager');assert.deepEqual(disabled.materialIssueOrders,[]);
});

test('late issue or multi-vendor purchasing failures roll back all stock, journals, order headers, lines and audits at the real API boundary',async()=>{
  const db=new PGlite();try{
    const f=await setup(db),s=f.entities,route=await functionRoute();
    globalThis.__cashierClient=f.client;globalThis.__cashierTransaction=async fn=>{await db.exec('BEGIN');try{const r=await fn();await db.exec('COMMIT');return r;}catch(e){await db.exec('ROLLBACK');throw e;}};
    const before=(await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows,original=s.AuditLog.create;
    s.AuditLog.create=async row=>{if(row.action==='issue_materials')throw Error('Issue audit unavailable');return original(row);};
    const response=await route(request({action:'issueProductionMaterials',orderId:f.order.id}),{params:Promise.resolve({name:'fieldOps'})});assert.equal(response.status,400);assert.deepEqual((await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows,before);
    s.AuditLog.create=original;const {body}=await shortage(f),purchaseBefore=(await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows;
    let n=0;const create=s.PurchaseOrder.create;s.PurchaseOrder.create=async row=>{if(++n===2)throw Error('Second supplier unavailable');return create(row);};
    const failed=await route(request(body),{params:Promise.resolve({name:'fieldOps'})});assert.equal(failed.status,400);assert.deepEqual((await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows,purchaseBefore);
    s.PurchaseOrder.create=create;const success=await route(request(body),{params:Promise.resolve({name:'fieldOps'})});assert.equal(success.status,200);assert.equal((await success.json()).orders.length,2);
  }finally{delete globalThis.__cashierClient;delete globalThis.__cashierTransaction;await db.close();}
});

test('production output requires an active Cold Room, with explicit selection for multiple rooms, and records the receiving location once',async()=>{
  const f=await setup(),s=f.entities;await action(f,{action:'issueProductionMaterials'});await s.Employee.update('cashier',{role:'production_manager'});
  await finishFermentation(f);
  const dry=await s.Warehouse.create({name:'Dry finished goods',warehouse_type:'finished_goods',is_active:true});
  await assert.rejects(action(f,{action:'completeProduction',quantity:20,warehouseId:dry.id}),/Cold Room/);
  await s.Warehouse.update(f.cold.id,{is_active:false});await assert.rejects(action(f,{action:'completeProduction',quantity:20}),/Create an active Cold Room/);
  assert.equal((await s.StockMovement.filter({movement_type:'production_output'})).length,0);
  await s.Warehouse.update(f.cold.id,{is_active:true});await s.Warehouse.create({name:'Second Cold Room',warehouse_type:'cold_room',is_active:true});
  await assert.rejects(action(f,{action:'completeProduction',quantity:20}),/Select the active Cold Room/);
  const result=await action(f,{action:'completeProduction',quantity:20,warehouseId:f.cold.id});assert.equal(result.order.output_warehouse_id,f.cold.id);assert.equal(result.order.output_warehouse_name,f.cold.name);
  const balances=await s.StockBalance.filter({product_id:'product-a',warehouse_id:f.cold.id});assert.equal(balances[0].quantity,20);assert.equal(balances[0].qc_status,'quarantine');
  assert.equal((await action(f,{action:'completeProduction',quantity:20,warehouseId:f.cold.id})).reused,true);assert.equal((await s.StockMovement.filter({movement_type:'production_output'})).length,1);
});

test('purchased finished assemblies cannot be received into a dry warehouse but can be received into Cold Room',async()=>{
 const f=await setup(),s=f.entities;
 const line=await s.PurchaseOrderLine.create({po_id:'po',product_id:'product-a',product_name:'YOLA',quantity:5,unit:'ea',unit_price:10,total:50,received_quantity:0});
 await s.Employee.update('cashier',{role:'warehouse_manager'});
 const body={action:'receiveSupplierOrder',orderId:'po',requestKey:crypto.randomUUID(),date,warehouseId:f.raw.id,lines:[{po_line_id:line.id,quantity:5,lot_number:'PUR-FG-1',expiry_date:'2027-01-01'}]};
 await assert.rejects(supplierAction(f.client,user,body),/Cold Room/);assert.equal((await s.GoodsReceipt.list()).length,0);
 const result=await supplierAction(f.client,user,{...body,warehouseId:f.cold.id});assert.equal(result.receipt.warehouse_id,f.cold.id);assert.equal((await s.StockBalance.filter({warehouse_id:f.cold.id,product_id:'product-a'}))[0].quantity,5);
});

test('an active unlinked supplier can receive a shortage proposal, but approval waits for Procurement confirmation and does not edit its catalogue',async()=>{
 const f=await setup(),s=f.entities,{body,dairy}=await shortage(f);await s.Supplier.update(dairy.id,{supplier_items:[]});await s.Employee.update('cashier',{role:'production_manager'});
 const proposal={...body,lines:body.lines.map(l=>({...l,supplier_id:dairy.id}))};const before=await s.Supplier.get(dairy.id),result=await productionPurchaseAction(f.client,user,proposal);assert.equal(result.orders.length,2);assert.ok(result.orders.every(po=>po.supplier_catalogue_review_required));assert.deepEqual(await s.Supplier.get(dairy.id),before);
 await s.Employee.update('cashier',{role:'admin'});await assert.rejects(supplierAction(f.client,user,{action:'approveSupplierOrder',orderId:result.orders[0].id}),/Procurement must confirm/);assert.equal((await s.PurchaseOrder.get(result.orders[0].id)).status,'pending_approval');
 await s.Supplier.update(dairy.id,{supplier_items:JSON.stringify([f.milk,f.cups].map(p=>({product_id:p.id,unit:p.unit_of_measure,unit_price:p.current_cost})))});
 for(const po of result.orders){const approved=await supplierAction(f.client,user,{action:'approveSupplierOrder',orderId:po.id});assert.equal(approved.order.status,'approved');assert.equal(approved.order.supplier_catalogue_review_required,false);}
 assert.equal((await productionPurchaseAction(f.client,user,proposal)).reused,true);
});
test('legacy JSON supplier catalogues are readable, inactive suppliers are excluded, and public order saves cannot forge the production exception',async()=>{
 const f=await setup(),s=f.entities,supplier=await vendor(f,'dairy','Dairy',[f.milk]);const entries=JSON.stringify(supplier.supplier_items),products=[{...f.milk,unit:'kg',cost:99},{...f.cups,unit:'ea',cost:2}];
 assert.equal(supplierCatalogue({...supplier,supplier_items:entries},products)[0].supplier_price,10);
 assert.deepEqual(supplierCatalogue({...supplier,supplier_items:'invalid'},products),[]);
 await assert.rejects(supplierAction(f.client,user,{action:'saveSupplierOrder',requestKey:crypto.randomUUID(),status:'pending_approval',allowUnlistedProductionRequest:true,order:{supplier_id:supplier.id,order_date:date,catalogue_only:true,lines:[{product_id:f.cups.id,quantity:1,unit_price:2}]}}),/goods linked/);
 const {body}=await shortage(f);await s.Supplier.update(body.lines[0].supplier_id,{is_active:false});await assert.rejects(productionPurchaseAction(f.client,user,body),/active registered supplier/);
});
