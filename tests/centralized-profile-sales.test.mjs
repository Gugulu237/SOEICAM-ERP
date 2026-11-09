import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {fixture,functionRoute,request,date,user} from './helpers/cashier.mjs';
import {employeeStockAction} from '../src/server/domain/employee-stock.js';
import {salesOrderAction} from '../src/server/domain/sales-orders.js';
import {invoiceAction} from '../src/server/domain/sales-invoices.js';
import {centralizedInventoryPolicy,assertCentralInventory,assertCentralSalesAccess,CENTRAL_INVENTORY_POLICY} from '../src/server/domain/centralized-inventory-policy.js';
import {assertModule,catalogueFromStored,decorateEmployee} from '../src/server/domain/role-catalogue.js';
import {effectiveRole,FEATURE_AUTHORITY} from '../src/server/domain/roles.js';

const gm={id:'gm',role:'admin',full_name:'General Manager'};
async function setup(db,{enabled=true}={}){
 const f=await fixture(db),s=f.entities;
 for(const name of ['Warehouse','AuditLog']){const create=s[name].create;s[name].create=async value=>{if(!value.id)return create(value);const row=structuredClone(value);if(db)await db.query('INSERT INTO fixture_entity VALUES($1,$2,$3)',[name,row.id,JSON.stringify(row)]);else{assert.ok(!f.rows[name].some(other=>other.id===row.id));f.rows[name].push(row);}return row;};}
 await s.Employee.update('cashier',{role:'commercial'});
 await s.CompanySettings.update('settings',{company_name:'SOEICAM',next_invoice_number:1});
 await s.Customer.update('customer-a',{acquired_by_id:'cashier',registered_by_id:user.id});
 await s.Warehouse.update('factory',{warehouse_type:'cold_room',is_active:true});
 const central=await s.Warehouse.create({id:'company-pool',name:'Company stock pool',warehouse_type:'general',is_active:true,central_inventory_pool:true});
 const config={policy:CENTRAL_INVENTORY_POLICY,enabled:true,effective_date:date,activation_id:'CIA-'+'1'.repeat(64),central_warehouse_id:central.id};
 const enable=async()=>{
  await s.AuditLog.create({id:config.activation_id,action:'activate_central_inventory',module:'inventory',entity_type:'CompanySettings',entity_id:'settings',audit_source:'server_verified',user_id:gm.id,centralized_inventory_policy:CENTRAL_INVENTORY_POLICY,centralized_inventory_activation:config});
  await s.CompanySettings.update('settings',{centralized_inventory:config});
 };
 if(enabled)await enable();
 const factory=await s.StockBalance.create({product_id:'product-a',warehouse_id:'factory',quantity:10,total_value:2531.79,unit_cost:253.18,lot_number:'FACTORY',expiry_date:'2099-01-01',qc_status:'approved'});
 const pooled=await s.StockBalance.create({product_id:'product-a',warehouse_id:central.id,quantity:5,total_value:700.13,unit_cost:140.03,lot_number:'CENTRAL',expiry_date:'2098-01-01',qc_status:'approved'});
 const body={action:'employeeRecordSupply',requestKey:crypto.randomUUID(),customerId:'customer-a',date,paymentType:'cash',receiptReference:'CENTRAL-R1',expectedTotal:3000,lines:[{product_id:'product-a',quantity:6,unit_price:500}]};
 const state=async()=>Object.fromEntries(await Promise.all(Object.keys(f.rows).map(async name=>[name,await s[name].list()])));
 return {...f,s,config,enable,factory,pooled,body,state,call:body=>employeeStockAction(f.client,user,body)};
}
async function moduleRole(f,role,modules,actor=user){
 await f.s.Employee.update('cashier',{role});
 const roleCatalogue=catalogueFromStored({roles:{[role]:{template_role:role==='supply_chain_manager'?'warehouse_manager':role,modules,module_permissions_version:5}}});
 const employee=decorateEmployee(actor,await f.s.Employee.get('cashier'),roleCatalogue),context={user:actor,employee,role:effectiveRole(actor,employee),roleCatalogue},calls=[];
 f.client.auth.staff=async()=>employee;
 f.client.auth.assertModule=module=>{calls.push(module);return assertModule(context,module);};
 return {context,calls};
}

test('profile sales use the activated company pool without an issued load and post exact FEFO cost once',async()=>{
 const f=await setup(),beforeCustody=await f.s.StockBalance.get('stock');
 const workspace=await f.call({action:'employeeSalesWorkspace'});
 assert.equal(workspace.centralized_inventory.enabled,true);assert.equal(workspace.defaultSource,'company');assert.deepEqual(workspace.runs,[]);assert.deepEqual(workspace.warehouses,[]);assert.equal(workspace.canChooseSeller,false);assert.deepEqual(workspace.sellers.map(row=>row.id),['cashier']);
 const stock=await f.call({action:'employeeSalesStock'});assert.equal(stock.source.source_type,'company');assert.equal(stock.products[0].available,15);assert.equal('unit_cost'in stock.products[0],false);
 const result=await f.call(f.body),retry=await f.call(f.body),invoice=await f.s.Invoice.get(result.invoiceId),line=(await f.s.InvoiceLine.filter({invoice_id:invoice.id}))[0];
 assert.equal(retry.reused,true);assert.equal(result.order.salesperson_id,'cashier');assert.equal(result.order.sales_supply_recorded_by,user.id);assert.equal(result.order.dispatch_id,'');assert.equal(invoice.salesperson_id,'cashier');assert.equal(invoice.recorded_by,user.id);assert.equal(invoice.sales_supply_acquisition_agent_id,'cashier');assert.equal(invoice.sales_supply_registration_user_id,user.id);assert.equal(line.cogs_total,953.31);
 assert.equal((await f.s.StockBalance.get(f.pooled.id)).quantity,0);assert.equal((await f.s.StockBalance.get(f.factory.id)).quantity,9);assert.equal((await f.s.StockBalance.get(f.factory.id)).total_value,2278.61);assert.deepEqual(await f.s.StockBalance.get('stock'),beforeCustody);
 assert.equal((await f.s.Invoice.list()).length,1);assert.equal((await f.s.JournalEntry.list()).length,1);assert.equal((await f.s.JournalLine.list()).reduce((sum,row)=>sum+row.debit-row.credit,0),0);assert.equal((await f.s.StockMovement.list()).length,2);assert.equal((await f.s.Customer.get('customer-a')).balance,0);
});

test('authorized central sellers can supply all active company customers while preserving the original acquisition beneficiary',async()=>{
 const f=await setup();
 const ownBranch=await f.s.Customer.create({is_active:true,business_name:'Own branch',parent_id:'customer-a'}),assigned=await f.s.Customer.create({is_active:true,business_name:'Assigned',salesperson_id:'cashier'}),registered=await f.s.Customer.create({is_active:true,business_name:'Registered user',registered_by_id:user.id}),stranger=await f.s.Customer.create({is_active:true,business_name:'Other commercial',acquired_by_id:'other-agent',registered_by_id:'original-registrar',balance:0}),unassigned=await f.s.Customer.create({is_active:true,business_name:'Existing unassigned customer'}),inactive=await f.s.Customer.create({is_active:false,business_name:'Inactive customer'}),removed=await f.s.Customer.create({is_active:true,business_name:'Removed customer',customer_removed_at:new Date().toISOString()});
 const workspace=await f.call({action:'employeeSalesWorkspace'}),ids=workspace.customers.map(row=>row.id);
 for(const id of ['customer-a',ownBranch.id,assigned.id,registered.id,stranger.id,unassigned.id])assert.ok(ids.includes(id));for(const id of [inactive.id,removed.id])assert.ok(!ids.includes(id));
 const before=await f.state();
 for(const id of [inactive.id,removed.id]){await assert.rejects(f.call({...f.body,customerId:id}),/Choose an active customer/);await assert.rejects(f.call({action:'employeeSalesDeliveryPoints',customerId:id}),/Choose an active customer/);}
 assert.deepEqual(await f.state(),before);
 await f.call({action:'employeeSalesDeliveryPoints',customerId:stranger.id});
 const result=await f.call({...f.body,customerId:stranger.id}),invoice=await f.s.Invoice.get(result.invoiceId);
 assert.equal(result.order.salesperson_id,'cashier');assert.equal(result.order.sales_supply_acquisition_agent_id,'other-agent');assert.equal(invoice.sales_supply_acquisition_agent_id,'other-agent');assert.equal(invoice.sales_supply_registration_user_id,'original-registrar');assert.deepEqual(await f.s.Customer.get(stranger.id),stranger);
});

test('central profile cannot choose a different seller, issued source, warehouse, old order or driver role',async()=>{
 for(const change of [{sellerId:'another-agent'},{sourceType:'issued',dispatchId:'run-a'},{sourceType:'warehouse',warehouseId:'factory'},{sourceType:'company',warehouseId:'factory'},{orderId:'foreign-draft'}]){
  const f=await setup(),before=await f.state();await assert.rejects(f.call({...f.body,...change}));assert.deepEqual(await f.state(),before);
 }
 const driver=await setup();await driver.s.Employee.update('cashier',{role:'driver'});const before=await driver.state();await assert.rejects(driver.call(driver.body),/Drivers cannot record/);assert.deepEqual(await driver.state(),before);
 const admin=await setup();await assert.rejects(salesOrderAction(admin.client,gm,{...admin.body,action:'recordSuppliedOrder',sourceType:'issued',dispatchId:'run-a'}),/Centralized sales/);
});

test('central self sales require real Sales or Commercial module permission before serving lookups or writing stock',async()=>{
 for(const [role,modules,expectedCalls] of [['employee',['inventory'],['sales','commercial']],['production_manager',['inventory'],['sales','commercial']],['commercial',['inventory','sales'],['commercial']]]){
  const f=await setup(),{calls}=await moduleRole(f,role,modules),before=await f.state();
  for(const body of [{action:'employeeSalesWorkspace'},{action:'employeeSalesStock'},{action:'employeeSalesDeliveryPoints',customerId:'customer-a'},f.body]){
   calls.length=0;await assert.rejects(f.call(body),error=>error.status===403);assert.deepEqual(calls,expectedCalls);assert.deepEqual(await f.state(),before);
  }
 }
});

test('commercial-only PM and Supply Chain staff can record their own central sales without Sales reporting permission',async()=>{
 for(const role of ['production_manager','supply_chain_manager']){
  const f=await setup(),{context,calls}=await moduleRole(f,role,['inventory','commercial']);
  assert.throws(()=>assertModule(context,'sales'),error=>error.status===403);assert.throws(()=>assertModule(context,'sales_reports'),error=>error.status===403);
  const workspace=await f.call({action:'employeeSalesWorkspace'});assert.equal(workspace.canChooseSeller,false);assert.deepEqual(calls,['sales','commercial']);calls.length=0;
  const result=await f.call(f.body),invoice=await f.s.Invoice.get(result.invoiceId);
  assert.equal(invoice.salesperson_id,'cashier');assert.equal(invoice.recorded_by,user.id);assert.deepEqual(calls,['sales','commercial']);assert.equal((await f.s.StockBalance.get(f.pooled.id)).quantity,0);
 }
});

test('Sales-enabled staff and an actually linked General Manager retain their own central sale access',async()=>{
 const staff=await setup(),{calls}=await moduleRole(staff,'employee',['inventory','sales']);await staff.call(staff.body);assert.deepEqual(calls,['sales']);
 const manager=await setup();await manager.s.Employee.update('cashier',{user_id:gm.id,role:'admin'});const access=await moduleRole(manager,'admin',['inventory'],gm);
 const result=await salesOrderAction(manager.client,gm,{...manager.body,action:'recordSuppliedOrder'},{ownIssuedStock:true});assert.equal(result.order.salesperson_id,'cashier');assert.equal(result.order.sales_supply_recorded_by,gm.id);assert.deepEqual(access.calls,[]);
});

test('native drivers stay denied under feature grants and central module fallback propagates non-permission failures',async()=>{
 const actor={...user,[FEATURE_AUTHORITY]:{role:'admin',module:'sales'}},f=await setup(),{context,calls}=await moduleRole(f,'driver',['inventory','sales','commercial'],actor),before=await f.state();
 assert.equal(context.role,'admin');await assert.rejects(salesOrderAction(f.client,actor,{...f.body,action:'recordSuppliedOrder'},{ownIssuedStock:true}),error=>error.status===403&&/Drivers cannot record/.test(error.message));assert.deepEqual(calls,[]);assert.deepEqual(await f.state(),before);
 await assert.rejects(assertCentralSalesAccess(f.client,user,{...context.employee,role:'hotesse',access_template:'hotesse'}),error=>error.status===403);
 const broken=await setup();await moduleRole(broken,'production_manager',['inventory','commercial']);const outage=Object.assign(Error('Permission service unavailable'),{status:503}),checked=[];
 broken.client.auth.assertModule=module=>{checked.push(module);throw outage;};const unchanged=await broken.state();await assert.rejects(broken.call(broken.body),error=>error===outage);assert.deepEqual(checked,['sales']);assert.deepEqual(await broken.state(),unchanged);
});

test('central mode requires matching protected activation, valid warehouse and activation date before any stock write',async()=>{
 for(const alter of [
  async f=>f.s.AuditLog.update(f.config.activation_id,{audit_source:'client_reported'}),
  async f=>f.s.AuditLog.update(f.config.activation_id,{centralized_inventory_activation:{...f.config,central_warehouse_id:'different'}}),
  async f=>f.s.CompanySettings.update('settings',{centralized_inventory:{...f.config,activation_id:'forged'}}),
  async f=>f.s.Warehouse.update(f.config.central_warehouse_id,{central_inventory_pool:false}),
  async f=>f.s.Warehouse.update(f.config.central_warehouse_id,{custodian_employee_id:'cashier'}),
 ]){const f=await setup();await alter(f);const before=await f.state();await assert.rejects(f.call(f.body),/protected centralized/);assert.deepEqual(await f.state(),before);}
 const f=await setup(),before=await f.state();await assert.rejects(f.call({...f.body,date:'2020-01-01'}),/activation date/);assert.deepEqual(await f.state(),before);
 const legacy=await setup(undefined,{enabled:false});assert.equal(await centralizedInventoryPolicy(legacy.s),null);await assert.rejects(assertCentralInventory(legacy.s,date),/not been activated/);await assert.rejects(legacy.call(legacy.body),/own employee/);
});

test('administrators retain actual Commercial attribution while explicit empty acquisition snapshots remain empty',async()=>{
 const f=await setup();await f.s.Customer.update('customer-a',{acquired_by_id:'',registered_employee_id:'',salesperson_id:'cashier'});
 const result=await salesOrderAction(f.client,gm,{...f.body,action:'recordSuppliedOrder',sourceType:'company',sellerId:'cashier'}),invoice=await f.s.Invoice.get(result.invoiceId);
 assert.equal(result.order.salesperson_id,'cashier');assert.equal(result.order.sales_supply_recorded_by,gm.id);assert.equal(invoice.sales_supply_acquisition_agent_id,'');assert.equal(Object.hasOwn(invoice,'sales_supply_acquisition_agent_id'),true);assert.equal(invoice.recorded_by,gm.id);
 const before=await f.state();await assert.rejects(invoiceAction(f.client,user,{action:'invoiceWorkspace'},{ownIssuedStock:true}),/Only your/);assert.deepEqual(await f.state(),before);
});

test('a profile credit sale and free customer exchange deduct central stock once with separate receivable, COGS and replacement expense',async()=>{
 const f=await setup(),result=await f.call({...f.body,paymentType:'credit',expectedTotal:1000,lines:[{product_id:'product-a',quantity:2,unit_price:500}],replacementsDeclared:true,stockReplacements:[{product_id:'product-a',quantity:1,reason:'damaged',expiry_date:''}]}),invoice=await f.s.Invoice.get(result.invoiceId);
 assert.equal(invoice.total,1000);assert.equal(invoice.balance,1000);assert.equal((await f.s.Customer.get('customer-a')).balance,1000);assert.equal((await f.s.StockBalance.get(f.pooled.id)).quantity,2);assert.equal((await f.s.StockBalance.get(f.factory.id)).quantity,10);
 assert.equal((await f.s.InvoiceLine.filter({invoice_id:invoice.id}))[0].cogs_total,280.05);assert.equal((await f.s.JournalEntry.list()).length,2);
 const cogs=new Set((await f.s.Account.list()).filter(row=>row.account_type==='cogs').map(row=>row.id)),cogsTotal=(await f.s.JournalLine.list()).filter(row=>cogs.has(row.account_id)).reduce((sum,row)=>sum+row.debit-row.credit,0);assert.equal(cogsTotal,280.05);
 const replacement=(await f.s.Account.list()).find(row=>row.account_number==='CUSTOMER-REPLACEMENTS');assert.ok(replacement);assert.equal(replacement.balance,140.03);assert.equal((await f.s.JournalLine.list()).reduce((sum,row)=>sum+row.debit-row.credit,0),0);
});

test('activation does not repost an exact completed legacy personal sale retry',async()=>{
 const f=await setup(undefined,{enabled:false}),driver=await f.s.Employee.create({full_name:'Driver',role:'driver',status:'active'});await f.s.Dispatch.update('run-a',{salesperson_id:'cashier',driver_id:driver.id,dispatch_date:date});
 const input={...f.body,sourceType:'issued',dispatchId:'run-a',expectedTotal:1000,lines:[{product_id:'product-a',quantity:2,unit_price:500}]};
 const result=await f.call(input);await f.enable();await f.s.Dispatch.update('run-a',{status:'completed'});const before=await f.state(),retry=await f.call(input);
 assert.equal(retry.reused,true);assert.equal(retry.invoiceId,result.invoiceId);assert.deepEqual(await f.state(),before);await assert.rejects(f.call({...input,requestKey:crypto.randomUUID()}),/Centralized sales/);
});

test('a late central sale failure rolls back all stock, invoice, ledger and attribution before an identical persisted retry',async()=>{
 const db=new PGlite();try{const f=await setup(db),route=await functionRoute(),create=f.s.AuditLog.create;
  f.s.AuditLog.create=async row=>{if(row.action==='record_supplied_order')throw Error('Late central sale failure');return create(row);};
  globalThis.__cashierClient=f.client;globalThis.__cashierTransaction=async fn=>{await db.exec('BEGIN');try{const result=await fn();await db.exec('COMMIT');return result;}catch(error){await db.exec('ROLLBACK');throw error;}};
  const before=await f.state(),failed=await route(request(f.body),{params:Promise.resolve({name:'fieldOps'})});assert.equal(failed.status,400);assert.deepEqual(await f.state(),before);
  f.s.AuditLog.create=create;const success=await route(request(f.body),{params:Promise.resolve({name:'fieldOps'})});assert.equal(success.status,200,await success.clone().text());const saved=await f.state(),retry=await route(request(f.body),{params:Promise.resolve({name:'fieldOps'})});assert.equal(retry.status,200);assert.equal((await retry.json()).reused,true);assert.deepEqual(await f.state(),saved);
 }finally{delete globalThis.__cashierClient;delete globalThis.__cashierTransaction;await db.close();}
});
