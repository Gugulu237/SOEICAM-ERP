import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
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


test('principal GM reads all dated verified history with saved attribution without loading stock or party catalogues',async()=>{
 const f=await setup();await f.run();const other=await f.s.Employee.create({role:'commercial',user_id:'other-login',status:'active',full_name:'Agent Two',phone:'private phone',base_salary:999999});
 await f.run({...f.body,requestKey:crypto.randomUUID(),employeeId:other.id,customerId:f.customer.id,lines:[{product_id:'product-a',quantity:3}]},gm);
 await f.s.Employee.update('cashier',{full_name:'Renamed Agent One'});await f.s.Employee.update(other.id,{full_name:'Renamed Agent Two',status:'inactive'});await f.s.Customer.update(f.customer.id,{business_name:'Renamed customer',is_active:false});
 const before=await state(f.s);
 for(const name of ['Product','StockBalance','Customer','Dispatch','Employee','Account','PostingRule'])f.s[name].filter=async()=>{throw Error('Unexpected history catalogue read: '+name);};
 const result=await f.run({action:'centralDegustationHistory',allEmployees:true,from:date,to:date},gm);
 assert.equal(result.allEmployees,true);assert.equal(result.employee,null);assert.equal(result.employeeId,'');assert.equal(result.canChooseEmployee,true);assert.equal(result.costs_visible,true);assert.equal(result.records.length,2);
 assert.deepEqual(new Set(result.records.map(row=>row.employee_name)),new Set(['Agent One','Agent Two']));assert.equal(result.records.find(row=>row.employee_id===other.id).customer_name,'Other agent customer');assert.equal(result.records.reduce((n,row)=>n+row.cost,0),1000);
 assert.ok(result.employees.every(row=>Object.keys(row).sort().join(',')==='full_name,id'));assert.ok(result.customers.every(row=>Object.keys(row).sort().join(',')==='business_name,id'));assert.deepEqual(new Set(result.employees.map(row=>row.full_name)),new Set(['Agent One','Agent Two']));
 assert.deepEqual(await state(f.s),before);
});

test('all-employees scope rejects staff, spoofed feature authority and every writer/workspace flag before mutation',async()=>{
 const f=await setup(),before=await state(f.s),scope={action:'centralDegustationHistory',allEmployees:true,from:date,to:date};
 await assert.rejects(f.run(scope),error=>error.status===403&&/General Manager/.test(error.message));
 await assert.rejects(f.run(scope,{...user,[FEATURE_AUTHORITY]:{role:'admin',module:'sales'}}),error=>error.status===403&&/General Manager/.test(error.message));
 for(const action of ['centralDegustationWorkspace','recordCentralDegustation'])for(const allEmployees of [true,false])await assert.rejects(f.run({...f.body,action,allEmployees},gm),error=>error.status===403&&/read-only/.test(error.message));
 await assert.rejects(f.run({...scope,allEmployees:'true'},gm),/read-only/);await assert.rejects(f.run({...scope,employeeId:'cashier'},gm),/all employees or one employee/);
 f.client.auth.assertModule=()=>{throw Object.assign(Error('Module disabled'),{status:403});};await assert.rejects(f.run(scope,gm),/Module disabled/);
 assert.deepEqual(await state(f.s),before);
});

test('all-employees history verifies corrupted evidence belonging to another employee instead of omitting it',async()=>{
 const changes=[
  async(f,event)=>f.s.AuditLog.update(event.id,{central_degustation_checksum:'bad-checksum'}),
  async(f,event)=>{const movement=(await f.s.StockMovement.filter({central_degustation_id:event.id}))[0];await f.s.StockMovement.update(movement.id,{customer_id:'wrong-customer'});},
  async(f,event)=>{const line=(await f.s.JournalLine.filter({journal_id:event.central_degustation_record.journal.id}))[0];await f.s.JournalLine.update(line.id,{description:'Changed journal evidence'});},
  async(f,event)=>f.s.AuditLog.update(event.id,{central_degustation_employee_id:'cashier'}),
 ];
 for(const change of changes){const f=await setup();await f.run();const other=await f.s.Employee.create({role:'commercial',user_id:'other-login',status:'active',full_name:'Agent Two'});await f.run({...f.body,requestKey:crypto.randomUUID(),employeeId:other.id},gm);const event=(await f.s.AuditLog.filter({central_degustation_employee_id:other.id}))[0];await change(f,event);const before=await state(f.s);await assert.rejects(f.run({action:'centralDegustationHistory',allEmployees:true,from:date,to:date},gm),/Reconcile/);assert.deepEqual(await state(f.s),before);}
});

test('personal history keeps self scope and cost redaction, including fields outside the public line whitelist',async()=>{
 const f=await setup();await f.run();const other=await f.s.Employee.create({role:'commercial',user_id:'other-login',status:'active',full_name:'Agent Two'});await f.run({...f.body,requestKey:crypto.randomUUID(),employeeId:other.id},gm);
 const event=(await f.s.AuditLog.filter({central_degustation_employee_id:'cashier'}))[0],proof=event.central_degustation_record;Object.assign(proof.lines[0],{unit_cost:200,total_value:400,internal_note:'private'});
 const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
 await f.s.AuditLog.update(event.id,{central_degustation_record:proof,central_degustation_checksum:createHash('sha256').update(JSON.stringify(canonical(proof))).digest('hex')});
 const result=await f.run({action:'centralDegustationHistory',allEmployees:false,from:date,to:date});assert.equal(result.records.length,1);assert.equal(result.records[0].employee_id,'cashier');assert.equal(result.costs_visible,false);assert.equal(result.canChooseEmployee,false);assert.equal(result.allEmployees,false);assert.equal(result.records[0].cost,undefined);assert.equal(result.records[0].journal_id,undefined);assert.equal(result.records[0].journal_number,undefined);assert.deepEqual(Object.keys(result.records[0].lines[0]).sort(),['product_id','product_name','quantity']);assert.equal(result.employees.length,1);
 await assert.rejects(f.run({action:'centralDegustationHistory',employeeId:other.id}),/own profile/);
});

test('aggregate legacy history keeps reused documents separate by actual employee and leaves unassigned movements unattributed',async()=>{
 const f=await setup();for(const [employee_id,employee_name,quantity] of [['cashier','Saved Agent One',2],['other','Saved Agent Two',3],['','Unlinked saved name',4],['','Another unlinked name',5]])await f.s.StockMovement.create({document_type:'Degustation',document_id:'REUSED-LEGACY-REF',status:'approved',movement_type:'promotional_issue',movement_date:date,product_id:'product-a',product_name:'YOLA',quantity,total_value:quantity*10,employee_id,employee_name,customer_id:'customer-a',customer_name:'Saved customer',recorded_by:'legacy-recorder'});
 const result=await f.run({action:'centralDegustationHistory',allEmployees:true,from:date,to:date},gm);assert.equal(result.records.length,4);assert.equal(new Set(result.records.map(row=>row.id)).size,4);assert.deepEqual(result.records.filter(row=>row.employee_id).map(row=>[row.employee_id,row.employee_name,row.lines[0].quantity]).sort(),[['cashier','Saved Agent One',2],['other','Saved Agent Two',3]]);assert.equal(result.records.filter(row=>row.employee_attribution_missing).length,2);assert.ok(result.records.filter(row=>row.employee_attribution_missing).every(row=>row.employee_id===''));assert.equal(result.records.reduce((n,row)=>n+row.cost,0),140);assert.ok(!result.employees.some(row=>row.id===''));
 const personal=await f.run({action:'centralDegustationHistory',from:date,to:date});assert.equal(personal.records.length,1);assert.equal(personal.records[0].id,'REUSED-LEGACY-REF');assert.equal(personal.records[0].employee_name,'Saved Agent One');assert.equal(personal.records[0].cost,undefined);
});

test('aggregate history bounds reporting days and filter choices without silently truncating history rows',async()=>{
 const f=await setup();for(let index=0;index<501;index++)await f.s.StockMovement.create({document_type:'Degustation',document_id:'legacy-'+index,status:'approved',movement_type:'promotional_issue',movement_date:date,product_id:'product-a',product_name:'YOLA',quantity:1,total_value:1,employee_id:'employee-'+index,employee_name:'Employee '+index,customer_id:'customer-'+index,customer_name:'Customer '+index});
 const result=await f.run({action:'centralDegustationHistory',allEmployees:true,from:date,to:date},gm);assert.equal(result.records.length,501);assert.equal(result.employees.length,500);assert.equal(result.customers.length,500);assert.equal(result.filter_choices_truncated,true);
 const start=days=>{const value=new Date(date+'T12:00:00Z');value.setUTCDate(value.getUTCDate()-days);return value.toISOString().slice(0,10);};
 assert.equal((await f.run({action:'centralDegustationHistory',allEmployees:true,from:start(365),to:date},gm)).records.length,501);
 await assert.rejects(f.run({action:'centralDegustationHistory',allEmployees:true,from:start(366),to:date},gm),/at most 366 days/);
 assert.equal((await f.run({action:'centralDegustationHistory',from:start(366),to:date})).records.length,0);
});
