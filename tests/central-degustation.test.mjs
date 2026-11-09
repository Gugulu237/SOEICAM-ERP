import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {fixture,date,user} from './helpers/cashier.mjs';
import {centralDegustationAction} from '../src/server/domain/central-degustation.js';
import {FEATURE_AUTHORITY} from '../src/server/domain/roles.js';

const gm={id:'gm',role:'admin',full_name:'General Manager'};
async function setup(db){
 const f=await fixture(db),s=f.entities,create=s.AuditLog.create;
 s.AuditLog.create=async value=>{if(!value.id)return create(value);const row=structuredClone(value);if(db)await db.query('INSERT INTO fixture_entity VALUES($1,$2,$3)',['AuditLog',row.id,JSON.stringify(row)]);else f.rows.AuditLog.push(row);return structuredClone(row);};
 await s.Employee.update('cashier',{role:'commercial',full_name:'Agent One'});
 await s.Dispatch.deleteMany({});await s.DispatchLine.deleteMany({});
 for(const row of await s.StockBalance.list())await s.StockBalance.update(row.id,{quantity:0,total_value:0});
 await s.Warehouse.update('factory',{warehouse_type:'finished_goods',is_active:true});
 const warehouse=await s.Warehouse.create({name:'Company unsold stock',warehouse_type:'general',is_active:true,central_inventory_pool:true});
 const config={policy:'central-company-stock-v1',enabled:true,effective_date:date,activation_id:'CIA-'+'a'.repeat(64),central_warehouse_id:warehouse.id};
 await s.CompanySettings.update('settings',{centralized_inventory:config});
 await s.AuditLog.create({id:config.activation_id,user_id:gm.id,action:'activate_central_inventory',module:'inventory',entity_type:'CompanySettings',entity_id:'settings',audit_source:'server_verified',centralized_inventory_policy:config.policy,centralized_inventory_activation:config});
 await s.Customer.update('customer-a',{acquired_by_id:'cashier',salesperson_id:'cashier'});
 const customer=await s.Customer.create({business_name:'Other agent customer',is_active:true,acquired_by_id:'other',salesperson_id:'other'});
 const inventory=(await s.PostingRule.filter({rule_key:'finished_goods_inventory'}))[0].account_id;
 await s.Account.update(inventory,{account_type:'asset',normal_balance:'debit',currency:'XAF'});
 await s.PostingRule.create({rule_key:'marketing_degustation_expense',account_id:'expense',is_active:true});
 const stock=await s.StockBalance.create({product_id:'product-a',product_name:'YOLA',warehouse_id:warehouse.id,quantity:20,total_value:4000,unit_cost:200,lot_number:'BATCH',expiry_date:'2099-01-01',qc_status:'approved'});
 const body={action:'recordCentralDegustation',source:'company',requestKey:crypto.randomUUID(),date,customerId:'customer-a',reason:'Actual customer tasting',lines:[{product_id:'product-a',quantity:2}]};
 return {...f,s,warehouse,stock,config,customer,inventory,body,run:(value=body,actor=user)=>centralDegustationAction(f.client,actor,value)};
}
const state=async s=>Object.fromEntries(await Promise.all(['StockBalance','StockMovement','AuditLog','JournalEntry','JournalLine','Account','PostingRule','CompanySettings','Invoice','SalesOrder','CashCollection','TreasuryTransaction','Customer'].map(async name=>[name,await s[name].list()])));

test('central giveaway deducts company inventory at actual carrying value, expenses once and never creates COGS, sales or cash',async()=>{
 const f=await setup(),before=await state(f.s),result=await f.run();
 assert.equal(result.record.employee_id,'cashier');assert.equal(result.record.recorded_by,user.id);assert.equal(result.record.cost,undefined);
 assert.equal((await f.s.StockBalance.get(f.stock.id)).quantity,18);
 assert.equal((await f.s.StockBalance.get(f.stock.id)).total_value,3600);
 assert.equal((await f.s.JournalEntry.list()).length,1);
 const lines=await f.s.JournalLine.list();assert.equal(lines.find(row=>row.account_id==='expense').debit,400);assert.equal(lines.find(row=>row.account_id===f.inventory).credit,400);assert.ok(!lines.some(row=>row.account_id==='cogs'||row.account_id==='revenue'));
 for(const name of ['Invoice','SalesOrder','CashCollection','TreasuryTransaction','Customer'])assert.deepEqual(await f.s[name].list(),before[name]);
 const after=await state(f.s);assert.equal((await f.run()).reused,true);assert.deepEqual(await state(f.s),after);
 await assert.rejects(f.run({...f.body,reason:'Changed actual purpose'}),/different details/);assert.deepEqual(await state(f.s),after);
});

test('company giveaways retain all residual cents even when a rounded unit-cost cache cannot represent them',async()=>{
 const f=await setup();await f.s.StockBalance.update(f.stock.id,{quantity:3,total_value:0.10,unit_cost:0.03});
 await f.run({...f.body,lines:[{product_id:'product-a',quantity:3}],customerId:''});
 assert.equal((await f.s.StockBalance.get(f.stock.id)).quantity,0);assert.equal((await f.s.StockBalance.get(f.stock.id)).total_value,0);
 assert.equal((await f.s.JournalEntry.list())[0].total_debit,0.10);
 const result=await f.run({action:'centralDegustationWorkspace'},gm);assert.equal(result.history[0].cost,0.10);
});

test('authorized profiles may give company products to any active customer without changing acquisition; inactive customers and actor overrides are rejected',async()=>{
 const changes=[
  async f=>({...f.body,employeeId:'other'}),
  async f=>{await f.s.Customer.update(f.customer.id,{is_active:false});return {...f.body,customerId:f.customer.id};},
  async f=>{await f.s.Customer.update(f.customer.id,{customer_removed_at:new Date().toISOString()});return {...f.body,customerId:f.customer.id};},
  async f=>{await f.s.Employee.update('cashier',{status:'suspended'});return f.body;},
  async f=>{await f.s.Employee.update('cashier',{role:'driver'});return f.body;},
  async f=>{await f.s.Employee.update('cashier',{role:'hotesse'});return f.body;},
 ];
 for(const change of changes){const f=await setup(),body=await change(f),before=await state(f.s);await assert.rejects(f.run(body,{...user,[FEATURE_AUTHORITY]:{role:'admin',module:'sales'}}));assert.deepEqual(await state(f.s),before);}
 const f=await setup(),other=await f.s.Employee.create({role:'commercial',user_id:'other-login',status:'active',full_name:'Agent Two'});
 const recipientBefore=await f.s.Customer.get(f.customer.id),own=await f.run({...f.body,customerId:f.customer.id});
 assert.equal(own.record.customer_id,f.customer.id);assert.equal(own.record.employee_id,'cashier');assert.equal(own.record.recorded_by,user.id);assert.equal(own.record.cost,undefined);assert.deepEqual(await f.s.Customer.get(f.customer.id),recipientBefore);
 const result=await f.run({...f.body,employeeId:other.id,customerId:f.customer.id},gm);assert.equal(result.record.employee_id,other.id);assert.equal(result.record.recorded_by,gm.id);assert.equal(result.record.cost,400);
});

test('workspace and history expose only the selected profile and hide carrying costs from ordinary staff',async()=>{
 const f=await setup();await f.run();const other=await f.s.Employee.create({role:'commercial',user_id:'other-login',status:'active',full_name:'Agent Two'});
 await f.run({...f.body,requestKey:crypto.randomUUID(),employeeId:other.id,customerId:f.customer.id},gm);
 const view=await f.run({action:'centralDegustationWorkspace'});assert.equal(view.canChooseEmployee,false);assert.equal(view.employees.length,1);assert.equal(view.history.length,1);assert.equal(view.history[0].employee_id,'cashier');assert.equal(view.history[0].cost,undefined);assert.equal(view.history[0].journal_id,undefined);assert.deepEqual(new Set(view.customers.map(row=>row.id)),new Set(['customer-a',f.customer.id]));assert.ok(view.customers.every(row=>Object.keys(row).every(key=>['id','business_name'].includes(key))));
 const report=await f.run({action:'centralDegustationHistory',employeeId:other.id},gm);assert.equal(report.records.length,1);assert.equal(report.records[0].employee_id,other.id);assert.equal(report.records[0].cost,400);
 await assert.rejects(f.run({action:'centralDegustationHistory',employeeId:other.id}),/own profile/);
});

test('invalid quantities, stock holds, expiry, invalid accounts and closed periods stop central giveaways',async()=>{
 const changes=[
  async f=>({...f.body,lines:[{product_id:'product-a',quantity:21}]}),
  async f=>({...f.body,lines:[{product_id:'product-a',quantity:0.0001}]}),
  async f=>({...f.body,lines:[{product_id:'product-a',quantity:true}]}),
  async f=>({...f.body,reason:''}),
  async f=>{await f.s.StockBalance.update(f.stock.id,{qc_status:'quarantine'});return f.body;},
  async f=>{await f.s.StockBalance.update(f.stock.id,{expiry_date:'2000-01-01'});return f.body;},
  async f=>{await f.s.Account.update('expense',{account_type:'cogs'});return f.body;},
  async f=>{await f.s.AccountingPeriod.update('period',{status:'closed'});return f.body;},
  async f=>{await f.s.CompanySettings.update('settings',{centralized_inventory:{...f.config,enabled:false}});return f.body;},
 ];
 for(const change of changes){const f=await setup(),body=await change(f),before=await state(f.s);await assert.rejects(f.run(body));assert.deepEqual(await state(f.s),before);}
});

test('module restrictions and changed persisted movement or journal evidence block recording or retries',async()=>{
 const f=await setup(),before=await state(f.s);f.client.auth.assertModule=()=>{throw Object.assign(Error('Module disabled'),{status:403});};await assert.rejects(f.run(),/Module disabled/);assert.deepEqual(await state(f.s),before);delete f.client.auth.assertModule;
 await f.run();const move=(await f.s.StockMovement.list())[0];await f.s.StockMovement.update(move.id,{quantity:3});const changed=await state(f.s);await assert.rejects(f.run(),/Reconcile/);assert.deepEqual(await state(f.s),changed);
});

test('an invalid cost on a later selected product blocks every giveaway before the first inventory write',async()=>{
 const f=await setup(),product=await f.s.Product.create({name:'Another finished product',inventory_type:'assembly',is_active:true,configuration_status:'ready',storage_unit:'ea'});
 await f.s.StockBalance.create({product_id:product.id,warehouse_id:f.warehouse.id,quantity:10,total_value:null,unit_cost:100,lot_number:'BROKEN',qc_status:'approved'});
 const before=await state(f.s);await assert.rejects(f.run({...f.body,lines:[{product_id:'product-a',quantity:1},{product_id:product.id,quantity:1}]}),/Reconcile/);assert.deepEqual(await state(f.s),before);
});

async function protectedLoad(f){
 const s=f.s,custody=await s.Warehouse.create({name:'Old promotional custody',warehouse_type:'commercial_custody',employee_delivery_custody:true,custodian_employee_id:'cashier',is_active:true});
 const summary={id:'appropriation-fixture',policy:'legacy-degustation-appropriation-v1',expense_account_id:'expense',total_quantity:13,total_value:1300};
 const run=await s.Dispatch.create({dispatch_number:'LEGACY-PROMO',dispatch_date:date,status:'loaded',warehouse_id:'factory',vehicle_warehouse_id:custody.id,salesperson_id:'cashier',driver_id:'',vehicle_id:'',degustation_appropriation:summary});
 await s.DispatchLine.create({dispatch_id:run.id,product_id:'product-a',product_name:'YOLA',loaded_quantity:16,loaded_value:1600,returned_quantity:0,degustation_quantity:13});
 const marked=await s.StockBalance.create({warehouse_id:custody.id,product_id:'product-a',product_name:'YOLA',quantity:13,total_value:0,unit_cost:0,qc_status:'approved',lot_number:'PREVIOUS',expiry_date:'2099-01-01',degustation_appropriation_id:summary.id,degustation_appropriation_dispatch_id:run.id,degustation_appropriation_expense_account_id:'expense',degustation_appropriation_inventory_account_id:f.inventory,degustation_appropriation_quantity:13,degustation_appropriation_value:1300});
 const normal=await s.StockBalance.create({warehouse_id:custody.id,product_id:'product-a',product_name:'YOLA',quantity:3,total_value:300,unit_cost:100,qc_status:'approved',lot_number:'NORMAL',expiry_date:'2090-01-01'});
 return {run,custody,marked,normal};
}

test('previously expensed promotional custody is tracked and consumed without another expense, even beside older normal stock',async()=>{
 const f=await setup(),legacy=await protectedLoad(f),body={...f.body,source:'previously_expensed',legacyDispatchId:legacy.run.id,lines:[{product_id:'product-a',quantity:2}]},before=await state(f.s);
 const workspace=await f.run({action:'centralDegustationWorkspace'});assert.equal(workspace.previously_expensed[0].products[0].available,13);
 const result=await f.run(body);assert.equal(result.record.source,'previously_expensed');assert.equal(result.record.cost,undefined);
 assert.equal((await f.s.StockBalance.get(legacy.marked.id)).quantity,11);assert.equal((await f.s.StockBalance.get(legacy.marked.id)).degustation_appropriation_value,1100);assert.deepEqual(await f.s.StockBalance.get(legacy.normal.id),before.StockBalance.find(row=>row.id===legacy.normal.id));
 assert.deepEqual(await f.s.StockBalance.get(f.stock.id),before.StockBalance.find(row=>row.id===f.stock.id));assert.deepEqual(await f.s.JournalEntry.list(),before.JournalEntry);assert.deepEqual(await f.s.Account.list(),before.Account);
 const after=await state(f.s);assert.equal((await f.run(body)).reused,true);assert.deepEqual(await state(f.s),after);
 await assert.rejects(f.run({...body,requestKey:crypto.randomUUID(),lines:[{product_id:'product-a',quantity:12}]}),/previously expensed/);
 const gmView=await f.run({action:'centralDegustationHistory'},gm);assert.equal(gmView.records[0].cost,0);
});

test('a late failure rolls back stock, expense, sequence and audit; the same persisted request retries once through a real database transaction',async()=>{
 const db=new PGlite();try{
  const f=await setup(db),before=await state(f.s),create=f.s.AuditLog.create;
  f.s.AuditLog.create=async value=>{if(value.action==='record_central_degustation')throw Error('Simulated final giveaway audit failure');return create(value);};
  const transaction=async fn=>{await db.exec('BEGIN');try{const result=await fn();await db.exec('COMMIT');return result;}catch(error){await db.exec('ROLLBACK');throw error;}};
  await assert.rejects(transaction(()=>f.run()),/Simulated final/);assert.deepEqual(await state(f.s),before);
  f.s.AuditLog.create=create;await transaction(()=>f.run());const after=await state(f.s);assert.equal((await transaction(()=>f.run())).reused,true);assert.deepEqual(await state(f.s),after);
 }finally{await db.close();}
});
