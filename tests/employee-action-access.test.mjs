import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {PGlite} from '@electric-sql/pglite';
import {commercialActor} from '../src/server/domain/commercial-actor.js';
import {commercialAction} from '../src/server/domain/commercial-workspace.js';
import {productionAction} from '../src/server/domain/production-batches.js';
import {guardMutation} from '../src/server/access.js';
import {authenticatedRecordChanges} from '../src/server/domain/employee-action-access.js';
import {fixture,fieldHandler,validSupply,request,user,staff,date,matches} from './helpers/commercial-supply.mjs';
import {fixture as cashFixture, user as cashierUser} from './helpers/cashier.mjs';

const gmUser={id:'gm-login',role:'admin',full_name:'General Manager',email:'gm@example.test'};
const gmEmployee={id:'gm-employee',user_id:gmUser.id,role:'admin',status:'active',full_name:'General Manager'};
const gm={user:gmUser,role:'admin',employee:gmEmployee};
const operations={user:{id:'ops-login',role:'user'},role:'production_manager',employee:{id:'ops-employee',role:'production_manager',full_name:'Operations Manager',status:'active',allowed_modules:['cashier','expenses','manufacturing']}};

test('management role aliases and administrator login cannot substitute a selected Commercial transaction actor',async()=>{
  for(const role of ['admin','General Manager','commercial']){
    const selected={...gmEmployee,role};
    const f=fixture();f.client.auth.staff=async()=>selected;
    await assert.rejects(commercialActor(f.client,gmUser,staff.id,'record a sale'),{status:403});
    await assert.rejects(commercialActor(f.client,gmUser,selected.id,'record a sale'),{status:403});
  }
  const f=fixture();f.client.auth.staff=async()=>staff;
  assert.equal((await commercialActor(f.client,user,staff.id)).employee.id,staff.id);
  await assert.rejects(commercialActor(f.client,user,'another-agent'),{status:403});
  f.client.auth.staff=async()=>({...staff,user_id:'different-login'});
  await assert.rejects(commercialActor(f.client,user,staff.id),{status:403});
});

test('direct GM function requests cannot record sales, deposits, returns, GPS, registrations or staff reports',async()=>{
  const f=fixture(),handler=await fieldHandler();
  f.client.auth.me=async()=>gmUser;f.client.auth.staff=async()=>gmEmployee;
  globalThis.__dailySupplyClient=f.client;
  const before=structuredClone(f.tables);
  try {
    for(const action of ['saveSale','registerCustomer','updateCustomerGps','commercialDepositCash','submitHandover','recordExpiredReturn','replaceExpiredReturn','driverActivity','submitOutletVisit','submitDeliveryShelfCheck']){
      const response=await handler(request({...validSupply(),action,commercialId:staff.id,driverId:'driver-a',employeeId:staff.id,date,customerId:'customer-a',returnId:'not-real'}));
      assert.ok(response.status>=400&&response.status<500,action+' must be denied');
      assert.deepEqual(f.tables,before,action+' must make no writes');
    }
  } finally {delete globalThis.__dailySupplyClient;}
});

test('actual Commercial records a supply under authenticated identities despite forged actor labels',async()=>{
  const f=fixture(),handler=await fieldHandler();f.client.auth.staff=async()=>staff;
  globalThis.__dailySupplyClient=f.client;
  try {
    const response=await handler(request(validSupply({commercialId:staff.id,recorded_by:gmUser.id,commercial_name:'Forged Manager'})));
    assert.equal(response.status,200);
    const sale=(await response.json()).sale;
    assert.equal(sale.commercial_id,staff.id);assert.equal(sale.recorded_by,user.id);assert.equal(sale.commercial_name,staff.full_name);
    assert.ok(f.tables.AuditLog.every(row=>!['submit_field_sale'].includes(row.action)||row.user_id===user.id));
  } finally {delete globalThis.__dailySupplyClient;}
});

test('top management keeps report-only access and ordinary warehouse or revoked Supply Chain cannot widen report scope',async()=>{
  const f=await cashFixture(),s=f.entities,modules=[];f.client.auth.assertModule=value=>modules.push(value);
  for(const details of [{role:'admin'},{role:'production_manager'},{role:'warehouse_manager',assigned_role:'supply_chain_manager',allowed_modules:['sales_reports']}]){
    await s.Employee.update('cashier',{...details,status:'active'});
    const report=await commercialAction(f.client,cashierUser,{action:'commercialPerformance',from:date,to:date});
    assert.ok(Array.isArray(report.agents));
  }
  assert.equal(modules.at(-1),'sales_reports');
  for(const details of [{role:'warehouse_manager',assigned_role:'warehouse_manager',allowed_modules:['sales_reports']},{role:'warehouse_manager',assigned_role:'supply_chain_manager',allowed_modules:[]}]){
    await s.Employee.update('cashier',details);
    await assert.rejects(commercialAction(f.client,cashierUser,{action:'commercialPerformance',from:date,to:date}),{status:403});
  }
});

test('even GM cannot forge acquisition credit, reassign expenses, mark them paid, rewrite balances or alter posted finance',()=>{
  const customer={id:'customer',acquired_by_id:staff.id,registered_by_id:user.id,balance:100};
  for(const patch of [{acquired_by_id:gmEmployee.id},{registered_by_id:gmUser.id},{acquisition_verified:'verified_unique'},{balance:0}])assert.throws(()=>guardMutation(gm,'Customer','update',patch,customer),{status:403});
  for(const operation of ['delete','deleteMany'])assert.throws(()=>guardMutation(gm,'Customer',operation,{},customer),{status:403});
  assert.doesNotThrow(()=>guardMutation(gm,'Customer','update',{is_active:false},customer));
  for(const entity of ['Account','Supplier','TreasuryAccount'])assert.throws(()=>guardMutation(gm,entity,'update',{balance:1},{balance:100}),{status:403});
  const expense={id:'expense',status:'paid',requester_id:staff.id,requester_name:staff.full_name,amount:5000};
  for(const patch of [{requester_id:gmEmployee.id},{requester_name:'GM'},{amount:5001},{status:'approved'}])assert.throws(()=>guardMutation(gm,'ExpenseRequest','update',patch,expense),{status:403});
  assert.throws(()=>guardMutation(gm,'ExpenseRequest','update',{status:'paid'},{...expense,status:'approved'}),{status:403});
  assert.doesNotThrow(()=>guardMutation(gm,'ExpenseRequest','update',{receipt_url:'private/receipt'},expense));
  assert.throws(()=>guardMutation(gm,'TreasuryTransaction','update',{amount:1},{amount:5,status:'posted'}),{status:403});
  assert.throws(()=>guardMutation(gm,'Payment','update',{amount:1},{amount:5,payment_type:'customer_payment',status:'posted'}),{status:403});
  for(const user_id of [gmUser.id,'',null])assert.throws(()=>guardMutation(gm,'Employee','update',{user_id},{id:staff.id,role:'commercial',status:'active',user_id:user.id}),{status:403});
  assert.doesNotThrow(()=>guardMutation(gm,'Employee','update',{user_id:user.id,phone:'699000000'},{id:staff.id,role:'commercial',status:'active',user_id:user.id}));
});

test('legitimate approvals and separate cheque signatures remain available and stamp the real approver',()=>{
  const expense={id:'expense',status:'pending_approval',requester_id:staff.id,requester_name:staff.full_name,amount:5000};
  const approval={status:'approved',approved_by:'Forged Other Employee',approved_at:'2000-01-01'};
  guardMutation(gm,'ExpenseRequest','update',approval,expense);
  const actual=authenticatedRecordChanges(gm,'ExpenseRequest',approval,expense);
  assert.equal(actual.approved_by,gmEmployee.full_name);assert.equal(actual.approved_by_user_id,gmUser.id);assert.notEqual(actual.approved_at,approval.approved_at);
  const recipeApproval=authenticatedRecordChanges(operations,'Recipe',{status:'approved',approved_by:'Fake',approved_at:'old'},{status:'draft'});
  assert.equal(recipeApproval.approved_by,operations.employee.full_name);assert.equal(recipeApproval.approved_by_user_id,operations.user.id);
  const cheque={id:'cheque',payment_method:'cheque',payment_type:'supplier_payment',status:'draft',amount:5000};
  const gmSign={cheque_gm_signed_by:'Forged Agent',cheque_gm_signed_at:'old'};
  guardMutation(gm,'Payment','update',gmSign,cheque);
  const signed=authenticatedRecordChanges(gm,'Payment',gmSign,cheque);
  assert.equal(signed.cheque_gm_signed_by,gmEmployee.full_name);assert.equal(signed.cheque_gm_signed_by_user_id,gmUser.id);
  assert.throws(()=>guardMutation(gm,'Payment','update',{cheque_pm_signed_by:'Operations',cheque_pm_signed_at:'now'},cheque),{status:403});
  const pmSign={status:'confirmed',cheque_pm_signed_by:'Forged Agent',cheque_pm_signed_at:'old'};
  guardMutation(operations,'Payment','update',pmSign,{...cheque,...signed});
  const confirmed=authenticatedRecordChanges(operations,'Payment',pmSign,{...cheque,...signed});
  assert.equal(confirmed.cheque_pm_signed_by,operations.employee.full_name);assert.equal(confirmed.cheque_pm_signed_by_user_id,operations.user.id);
  assert.throws(()=>guardMutation(gm,'Payment','update',{amount:6000},{...cheque,...signed}),{status:403});
  for(const field of ['cheque_bank','cheque_number','cheque_payee'])assert.throws(()=>guardMutation(gm,'Payment','update',{[field]:'Changed after signature'},{...cheque,...signed}),{status:403});
  assert.throws(()=>guardMutation(gm,'Recipe','update',{status:'approved',approved_by:'Another approver',approved_at:'old'},{id:'recipe',status:'approved',approved_by:'Original approver',approved_at:'2026-01-01'}),{status:403});
  assert.throws(()=>guardMutation(gm,'SalesOrder','update',{recorded_by:gmUser.id},{id:'order',recorded_by:user.id,status:'draft'}),{status:403});
});

async function genericFixture(db){
  const tables={AuditLog:[],ExpenseRequest:[],Customer:[],Recipe:[{id:'recipe',status:'draft',product_id:'finished',version:1,batch_output:100,output_unit:'ea'}],
    RecipeLine:[{id:'ingredient',recipe_id:'recipe',material_id:'milk',quantity:25,unit:'kg',expected_wastage_pct:0}],
    Product:[{id:'finished',is_active:true,inventory_type:'assembly'},{id:'milk',is_active:true,inventory_type:'raw_material'}],
    Payment:[],Employee:[structuredClone(staff)]};let sequence=0;
  if(db){await db.exec('CREATE TABLE attribution_fixture(entity text,id text,data jsonb,PRIMARY KEY(entity,id))');for(const [name,rows] of Object.entries(tables))for(const row of rows)await db.query('INSERT INTO attribution_fixture VALUES($1,$2,$3)',[name,row.id,JSON.stringify(row)]);}
  const stores=Object.fromEntries(Object.entries(tables).map(([name,rows])=>{
    const all=async()=>db?(await db.query('SELECT data FROM attribution_fixture WHERE entity=$1 ORDER BY id',[name])).rows.map(row=>row.data):structuredClone(rows);
    return [name,{
    filter:async query=>(await all()).filter(row=>matches(row,query)),get:async id=>(await all()).find(row=>row.id===id),
    create:async input=>{const row={id:'row-'+ ++sequence,...structuredClone(input)};if(db)await db.query('INSERT INTO attribution_fixture VALUES($1,$2,$3)',[name,row.id,JSON.stringify(row)]);else rows.push(row);return structuredClone(row);},
    update:async(id,input)=>{const row={...(await all()).find(row=>row.id===id),...structuredClone(input)};if(db)await db.query('UPDATE attribution_fixture SET data=$1 WHERE entity=$2 AND id=$3',[JSON.stringify(row),name,id]);else Object.assign(rows.find(row=>row.id===id),row);return structuredClone(row);},
  }];}));
  const output=await build({entryPoints:['src/server/entity-api.js'],bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'attribution-offline',setup(b){
    b.onResolve({filter:/^(?:\.\/entities\.js|\.\/db\.js|server-only)$/},a=>({path:a.path,namespace:'offline'}));
    b.onLoad({filter:/.*/,namespace:'offline'},a=>({contents:a.path==='server-only'?'':a.path.includes('entities')?'export const serviceEntities=new Proxy({},{get:(_,n)=>globalThis.__attributionStores[n]});export const entityStore=n=>globalThis.__attributionStores[n];':'export const transaction=async run=>{const db=globalThis.__attributionDb;if(!db)return run();await db.exec("BEGIN");try{const result=await run();await db.exec("COMMIT");return result;}catch(error){await db.exec("ROLLBACK");throw error;}};export const database=()=>({unsafe:async()=>[{extra_data:{staff_role_catalogue:globalThis.__attributionCatalogue}}]});'}));
  }}]});
  return {tables,stores,entityOperation:(await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'))).entityOperation};
}

test('generic API binds audit and request identities, preserves append-only audit history and server-stamps decisions',async()=>{
  const f=await genericFixture();globalThis.__attributionStores=f.stores;
  try {
    const log=await f.entityOperation(gm,'AuditLog','create',[{action:'claim_approval',user_id:staff.id,user_name:staff.full_name,audit_source:'server_verified'}]);
    assert.equal(log.audit_source,'client_reported');assert.equal(log.user_id,gmUser.id);assert.equal(log.user_name,gmEmployee.full_name);
    for(const operation of ['update','updateMany','delete','deleteMany'])await assert.rejects(f.entityOperation(gm,'AuditLog',operation,operation.endsWith('Many')?[{id:log.id},{description:'overwrite'}]:[log.id,{description:'overwrite'}]),{status:403});
    assert.equal(f.tables.AuditLog.length,1);assert.equal(f.tables.AuditLog[0].action,'claim_approval');
    await assert.rejects(f.entityOperation(gm,'AuditLog','create',[{action:'production_material_audit_requested',module:'inventory',entity_type:'Product',entity_id:'milk'}]),{status:403});assert.equal(f.tables.AuditLog.length,1);
    const request=await f.entityOperation(gm,'ExpenseRequest','create',[{title:'Manager request',amount:5000,status:'pending_approval'}]);
    assert.equal(request.requester_id,gmEmployee.id);assert.equal(request.requester_name,gmEmployee.full_name);
    const customer=await f.entityOperation(gm,'Customer','create',[{business_name:'Management customer'}]);
    assert.equal(customer.registered_by_id,gmUser.id);assert.equal(customer.acquired_by_id,undefined);assert.equal(customer.acquisition_source,'management_entry');
    const recipe=await f.entityOperation(gm,'Recipe','update',['recipe',{status:'approved',approved_by:'Fake',approved_at:'old'}]);
    assert.equal(recipe.approved_by_user_id,gmUser.id);assert.equal(recipe.approved_by,gmEmployee.full_name);assert.notEqual(recipe.approved_at,'old');
    const event=f.tables.AuditLog.find(row=>row.action==='approve_recipe');assert.equal(event.audit_source,'server_verified');assert.equal(event.user_id,gmUser.id);assert.equal(event.entity_id,recipe.id);
    const count=f.tables.AuditLog.length;
    await assert.rejects(f.entityOperation(gm,'Recipe','update',['recipe',{status:'approved',approved_by:'Fake replacement',approved_at:'old'}]),{status:403});
    assert.equal(f.tables.AuditLog.length,count);assert.equal(f.tables.Recipe[0].approved_by,gmEmployee.full_name);
    const employee=await f.entityOperation(gm,'Employee','update',[staff.id,{status:'inactive'}]);assert.equal(employee.status,'inactive');
    const access=f.tables.AuditLog.find(row=>row.action==='update_staff_access');assert.equal(access.user_id,gmUser.id);assert.equal(access.before_values.status,'active');assert.equal(access.after_values.status,'inactive');
    const prior=structuredClone(f.tables);
    await assert.rejects(f.entityOperation(gm,'Employee','update',[staff.id,{user_id:gmUser.id}]),{status:403});assert.deepEqual(f.tables,prior);
  } finally {delete globalThis.__attributionStores;}
});

test('failed trusted audit write rolls back an approval; retry records one decision with its real actor',async()=>{
  const db=new PGlite();
  try {
    const f=await genericFixture(db);globalThis.__attributionStores=f.stores;globalThis.__attributionDb=db;
    const before=(await db.query('SELECT * FROM attribution_fixture ORDER BY entity,id')).rows;
    const create=f.stores.AuditLog.create;f.stores.AuditLog.create=async()=>{throw Error('Audit unavailable');};
    await assert.rejects(f.entityOperation(gm,'Recipe','update',['recipe',{status:'approved',approved_by:'Forgery',approved_at:'old'}]),/Audit unavailable/);
    assert.deepEqual((await db.query('SELECT * FROM attribution_fixture ORDER BY entity,id')).rows,before);
    f.stores.AuditLog.create=create;
    await f.entityOperation(gm,'Recipe','update',['recipe',{status:'approved'}]);
    const event=(await f.stores.AuditLog.filter({action:'approve_recipe'}));assert.equal(event.length,1);assert.equal(event[0].user_id,gmUser.id);assert.equal(event[0].audit_source,'server_verified');
    await f.entityOperation(gm,'Recipe','update',['recipe',{status:'approved'}]);assert.equal((await f.stores.AuditLog.filter({action:'approve_recipe'})).length,1);
  } finally {delete globalThis.__attributionStores;delete globalThis.__attributionDb;await db.close();}
});

test('client audit claims cannot open or resolve production count tasks; genuine legacy requests remain usable',async()=>{
  const f=await cashFixture(),s=f.entities;await s.Employee.update('cashier',{role:'admin'});
  const legacy=await s.AuditLog.create({module:'inventory',action:'production_material_audit_requested',entity_id:'milk',description:'Legitimate legacy count request'});
  const forged=await s.AuditLog.create({module:'inventory',action:'production_material_audit_requested',entity_id:'cups',audit_source:'client_reported',description:'Forged request'});
  await s.AuditLog.create({module:'inventory',action:'production_material_audit_resolved',entity_id:legacy.id,audit_source:'client_reported'});
  const pending=await productionAction(f.client,cashierUser,{action:'productionAuditRequests'});assert.deepEqual(pending.requests.map(row=>row.id),[legacy.id]);
  const before=structuredClone(f.rows);
  await assert.rejects(productionAction(f.client,cashierUser,{action:'resolveProductionAudit',requestId:forged.id}),/not found/);assert.deepEqual(f.rows,before);
  await productionAction(f.client,cashierUser,{action:'resolveProductionAudit',requestId:legacy.id,note:'Count checked'});
  assert.deepEqual((await productionAction(f.client,cashierUser,{action:'productionAuditRequests'})).requests,[]);
  const verified=(await s.AuditLog.filter({action:'production_material_audit_resolved'})).filter(row=>row.audit_source==='server_verified');assert.equal(verified.length,1);assert.equal(verified[0].user_id,cashierUser.id);
  assert.equal((await productionAction(f.client,cashierUser,{action:'resolveProductionAudit',requestId:legacy.id})).reused,true);
});

test('generic Employee role writes recheck the locked catalogue rather than an earlier authentication snapshot',async()=>{
  const f=await genericFixture();globalThis.__attributionStores=f.stores;
  globalThis.__attributionCatalogue={deleted_roles:['driver']};
  try{
    const before=structuredClone(f.tables);
    await assert.rejects(f.entityOperation({...gm,roleCatalogue:{roles:{driver:{key:'driver'}}}},'Employee','update',[staff.id,{role:'driver'}]),/configured system role/);
    assert.deepEqual(f.tables,before);
  }finally{delete globalThis.__attributionStores;delete globalThis.__attributionCatalogue;}
});
