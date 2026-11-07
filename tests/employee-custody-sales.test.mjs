import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {fixture,functionRoute,request,date} from './helpers/cashier.mjs';
import {distributionControlAction} from '../src/server/domain/distribution-control.js';
import {employeeStockAction} from '../src/server/domain/employee-stock.js';
import {salesOrderAction} from '../src/server/domain/sales-orders.js';
import {dispatchAction,dispatchReconciliationData} from '../src/server/domain/dispatch-operations.js';
import {invoiceAction} from '../src/server/domain/sales-invoices.js';
import {isReadOnlyFunction} from '../src/lib/function-actions.js';
import catalog from '../src/server/generated/schema.json' with {type:'json'};
import {splitRecord} from '../src/server/query.js';
const gm={id:'gm',role:'admin'};
async function setup(db){
 const f=await fixture(db),s=f.entities;
 // Exercise the same required-field checks and defaults as the real entity store.
 for(const name of ['DispatchRequest','Dispatch']){const create=s[name].create;s[name].create=async value=>{const {record,extra}=splitRecord(value,catalog[name],{creating:true});return create({...record,...extra});};}
 for(const name of ['Warehouse','AuditLog']){const create=s[name].create;s[name].create=async value=>{if(!value.id)return create(value);const row={...value};if(db)await db.query('INSERT INTO fixture_entity VALUES($1,$2,$3)',[name,row.id,JSON.stringify(row)]);else {assert.ok(!f.rows[name].some(r=>r.id===row.id));f.rows[name].push(row);}return structuredClone(row);};}
 await s.CompanySettings.update('settings',{company_name:'SOEICAM',next_invoice_number:1});await s.Employee.update('cashier',{role:'employee'});
 await s.Dispatch.deleteMany({});await s.DispatchLine.deleteMany({});await s.Warehouse.update('factory',{warehouse_type:'finished_goods'});
 for(const b of await s.StockBalance.list())await s.StockBalance.update(b.id,{quantity:0,total_value:0});
 await s.StockBalance.create({warehouse_id:'factory',product_id:'product-a',quantity:20,unit_cost:200,total_value:4000,lot_number:'LOT',qc_status:'approved'});
 const actor={id:'cashier-login',role:'user'},body={action:'issueDistributionStock',commercialId:'cashier',driverId:'',vehicleId:'',warehouseId:'factory',requestKey:crypto.randomUUID(),lines:[{product_id:'product-a',quantity:5}],date};
 const issue=()=>distributionControlAction(f.client,gm,body);
 const sale=dispatchId=>({action:'employeeRecordSupply',requestKey:crypto.randomUUID(),sourceType:'issued',dispatchId,customerId:'customer-a',date,paymentType:'cash',receiptReference:'R-001',expectedTotal:1000,lines:[{product_id:'product-a',quantity:2,unit_price:500}]});
 return {...f,s,actor,body,issue,sale};
}
test('unpaired employee issue, own sale, retry and physical return conserve stock and post the sale once',async()=>{
 const f=await setup(),{dispatch}=await f.issue();assert.equal(dispatch.driver_id,'');assert.equal(dispatch.vehicle_id,'');
 const warehouse=await f.s.Warehouse.get(dispatch.vehicle_warehouse_id);assert.equal(warehouse.employee_delivery_custody,true);assert.equal(warehouse.custodian_employee_id,'cashier');assert.equal((await f.s.JournalEntry.list()).length,0);
 assert.equal((await f.issue()).dispatch.id,dispatch.id);
 const options=await employeeStockAction(f.client,f.actor,{action:'employeeSalesWorkspace'});assert.equal(options.runs.length,1);assert.deepEqual(options.warehouses,[]);assert.equal(options.currentSellerId,'cashier');
 const input=f.sale(dispatch.id),result=await employeeStockAction(f.client,f.actor,input),retry=await employeeStockAction(f.client,f.actor,input);assert.equal(retry.reused,true);assert.equal(retry.order.id,result.order.id);assert.equal(result.order.salesperson_id,'cashier');assert.equal(result.order.sales_supply_recorded_by,f.actor.id);assert.equal((await f.s.Invoice.list()).length,1);assert.equal((await f.s.JournalEntry.list()).length,1);
 const recon=await dispatchReconciliationData(f.client.asServiceRole,await f.s.Dispatch.get(dispatch.id));assert.equal(recon.rows[0].actual,3);assert.equal(recon.rows[0].sold,2);assert.equal(recon.hasVariance,false);
 const workspace=await employeeStockAction(f.client,f.actor,{action:'employeeStockWorkspace'});assert.equal(workspace.balances[0].usable_quantity,3);assert.equal(workspace.sales.length,1);assert.equal(workspace.balances[0].unit_cost,undefined);
 await dispatchAction(f.client,gm,{action:'returnDispatchStock',dispatchId:dispatch.id,countedLines:[{product_id:'product-a',quantity:3}]});
 assert.equal((await f.s.StockBalance.filter({warehouse_id:'factory'})).reduce((n,b)=>n+b.quantity,0),18);assert.equal((await f.s.JournalEntry.list()).length,1);
 await assert.rejects(employeeStockAction(f.client,f.actor,{...input,requestKey:crypto.randomUUID()}),/load|assigned/);
});

test('a manager-entered sale belongs to the selected commercial monthly history without assigning cash to the recorder',async()=>{
 const f=await setup();await f.s.Employee.update('cashier',{role:'commercial'});
 const {dispatch}=await f.issue(),staffFilter=f.client.entities.Employee.filter;
 f.client.entities.Employee.filter=async()=>[];
 const result=await salesOrderAction(f.client,gm,{...f.sale(dispatch.id),action:'recordSuppliedOrder',sellerId:'cashier'});
 f.client.entities.Employee.filter=staffFilter;
 const invoice=await f.s.Invoice.get(result.invoiceId),event=await f.s.AuditLog.get(result.order.sales_supply_request_id);
 assert.equal(result.order.salesperson_id,'cashier');assert.equal(result.order.sales_supply_recorded_by,gm.id);assert.equal(invoice.salesperson_id,'cashier');assert.equal(invoice.recorded_by,gm.id);assert.equal(event.user_id,gm.id);
 const before=structuredClone(f.rows),workspace=await employeeStockAction(f.client,f.actor,{action:'employeeStockWorkspace'});
 assert.deepEqual(workspace.sales.map(s=>s.id),[result.order.id]);assert.deepEqual(f.rows,before,'monthly visibility is read-only');
 assert.equal((await f.s.Payment.list()).length,0);assert.equal((await f.s.TreasuryTransaction.list()).length,0);assert.ok(!(await f.s.CashCollection.list()).some(c=>c.recorded_by===gm.id||c.collector_user_id===gm.id));assert.equal(invoice.cash_deposited,false);
 await f.s.AuditLog.update(event.id,{entity_id:'unrelated-order'});assert.deepEqual((await employeeStockAction(f.client,f.actor,{action:'employeeStockWorkspace'})).sales,[]);
 await f.s.AuditLog.update(event.id,{entity_id:result.order.id,audit_source:'client_reported'});assert.deepEqual((await employeeStockAction(f.client,f.actor,{action:'employeeStockWorkspace'})).sales,[]);
 await f.s.AuditLog.update(event.id,{audit_source:'server_verified'});
 await f.s.SalesOrder.update(result.order.id,{salesperson_id:'another-commercial'});assert.deepEqual((await employeeStockAction(f.client,f.actor,{action:'employeeStockWorkspace'})).sales,[]);
});

test('a delegated replacement-only exchange remains visible with its checked completion evidence',async()=>{
 const f=await setup();await f.s.Employee.update('cashier',{role:'commercial'});const {dispatch}=await f.issue(),staffFilter=f.client.entities.Employee.filter;f.client.entities.Employee.filter=async()=>[];
 const result=await salesOrderAction(f.client,gm,{...f.sale(dispatch.id),action:'recordSuppliedOrder',sellerId:'cashier',lines:[],paymentType:'exchange',expectedTotal:0,replacementsDeclared:true,stockReplacements:[{product_id:'product-a',quantity:2,reason:'damaged',expiry_date:''}]});
 f.client.entities.Employee.filter=staffFilter;const workspace=await employeeStockAction(f.client,f.actor,{action:'employeeStockWorkspace'});assert.deepEqual(workspace.sales.map(s=>s.id),[result.order.id]);assert.equal(workspace.sales[0].total,0);assert.equal(workspace.sales[0].status,'delivered');
});

test('monthly history includes delegated company and warehouse sales while preserving existing own-issued history',async()=>{
 const f=await setup();await f.s.Employee.update('cashier',{role:'commercial'});const staffFilter=f.client.entities.Employee.filter;
 const expected=[];
 for(const sourceType of ['company','warehouse']){
  f.client.entities.Employee.filter=async()=>[];
  const result=await salesOrderAction(f.client,gm,{...f.sale(''),action:'recordSuppliedOrder',sourceType,warehouseId:sourceType==='warehouse'?'factory':'',sellerId:'cashier'});expected.push(result.order.id);
 }
 f.client.entities.Employee.filter=staffFilter;
 const legacy=await f.s.SalesOrder.create({order_number:'LEGACY-DRAFT',salesperson_id:'cashier',sales_supply_recorded_by:f.actor.id,dispatch_id:'former-run',order_date:date,status:'draft',total:200});expected.push(legacy.id);
 await f.s.SalesOrder.create({order_number:'UNVERIFIED',salesperson_id:'cashier',sales_supply_recorded_by:gm.id,dispatch_id:'former-run',order_date:date,status:'invoiced',total:500});
 const workspace=await employeeStockAction(f.client,f.actor,{action:'employeeStockWorkspace'});assert.deepEqual(workspace.sales.map(s=>s.id).sort(),expected.sort());assert.equal(workspace.sales.find(s=>s.id===legacy.id).status,'draft');
});
test('all active employee types except Hotesse can receive goods; optional transport is independently validated',async()=>{
 for(const role of ['admin','procurement','warehouse_manager','cashier','production_manager','employee','commercial','driver']){const f=await setup();await f.s.Employee.update('cashier',{role});const r=await f.issue();assert.ok(r.dispatch.vehicle_warehouse_id);}
 for(const change of [{role:'hotesse'},{status:'inactive'},{employee_removed_at:new Date().toISOString()}]){const f=await setup();await f.s.Employee.update('cashier',change);await assert.rejects(f.issue(),/active employee other than Hotesse/);assert.equal((await f.s.StockMovement.list()).length,0);}
 const f=await setup();f.body.vehicleId='vehicle-a';assert.equal((await f.issue()).dispatch.driver_id,'');
 const g=await setup(),driver=await g.s.Employee.create({role:'driver',status:'active'});g.body.driverId=driver.id;assert.equal((await g.issue()).dispatch.vehicle_id,'');
 const h=await setup();h.body.driverId='missing';await assert.rejects(h.issue(),/active assigned driver/);
 const invalidVehicle=await setup();invalidVehicle.body.vehicleId='missing';await assert.rejects(invalidVehicle.issue(),/active vehicle/);
});

test('the API issues sale goods, mixed loads and degustation-only loads without a vehicle using production record validation',async()=>{
 const db=new PGlite();
 try{
  const f=await setup(db),route=await functionRoute();f.client.auth.me=async()=>gm;globalThis.__cashierClient=f.client;
  globalThis.__cashierTransaction=async fn=>{await db.exec('BEGIN');try{const result=await fn();await db.exec('COMMIT');return result;}catch(e){await db.exec('ROLLBACK');throw e;}};
  for(const [index,degustation] of [0,2,5].entries()){
   const recipient=await f.s.Employee.create({full_name:'Recipient '+index,role:'employee',status:'active'});
   const body={...f.body,commercialId:recipient.id,requestKey:crypto.randomUUID(),vehicleId:[undefined,'',null][index],lines:[{product_id:'product-a',quantity:5,degustation_quantity:degustation}]};
   const response=await route(request(body),{params:Promise.resolve({name:'fieldOps'})}),result=await response.json();
   assert.equal(response.status,200,JSON.stringify(result));const dispatch=result.dispatch;
   assert.equal(dispatch.status,'loaded');assert.equal(dispatch.vehicle_id,'');assert.equal(dispatch.driver_id,'');assert.equal(dispatch.salesperson_id,recipient.id);
   const location=await f.s.Warehouse.get(dispatch.vehicle_warehouse_id);assert.equal(location.employee_delivery_custody,true);assert.equal(location.custodian_employee_id,recipient.id);
   assert.equal((await f.s.DispatchRequest.get(dispatch.request_id)).status,'processed');
   assert.equal((await f.s.DispatchLine.filter({dispatch_id:dispatch.id}))[0].degustation_quantity,degustation);
   const recon=await dispatchReconciliationData(f.client.asServiceRole,dispatch);assert.equal(recon.hasVariance,false);assert.equal(recon.rows[0].actual,5);assert.equal(recon.rows[0].degustation_remaining,degustation);
   const retry=await route(request(body),{params:Promise.resolve({name:'fieldOps'})});assert.equal(retry.status,200);assert.equal((await retry.json()).dispatch.id,dispatch.id);
  }
  assert.equal((await f.s.Dispatch.list()).length,3);assert.equal((await f.s.DispatchRequest.list()).length,3);
  assert.equal((await f.s.StockBalance.filter({warehouse_id:'factory'})).reduce((n,b)=>n+b.quantity,0),5);assert.equal((await f.s.JournalEntry.list()).length,0);
 }finally{delete globalThis.__cashierClient;delete globalThis.__cashierTransaction;await db.close();}
});
test('personal stock endpoints refuse other employees, company warehouses, spoofed sellers and invoice authority',async()=>{
 const f=await setup(),{dispatch}=await f.issue();
 for(const changes of [{sourceType:'company'},{dispatchId:'missing'},{sellerId:'somebody-else'},{orderId:'another-order'}])await assert.rejects(employeeStockAction(f.client,f.actor,{...f.sale(dispatch.id),...changes}),/own employee|salesperson/);
 const other=await f.s.Employee.create({role:'employee',status:'active',full_name:'Other'});f.client.entities.Employee.filter=async()=>[other];await assert.rejects(employeeStockAction(f.client,{id:'other',role:'user'},f.sale(dispatch.id)),/own employee/);
 await assert.rejects(invoiceAction(f.client,{id:'other',role:'user'},{action:'invoiceWorkspace'},{ownIssuedStock:true}),/Only your/);
 await f.s.Employee.update('cashier',{role:'hotesse'});f.client.entities.Employee.filter=async()=>[await f.s.Employee.get('cashier')];await assert.rejects(employeeStockAction(f.client,f.actor,{action:'employeeStockWorkspace'}),/Not permitted/);
 assert.equal(isReadOnlyFunction('fieldOps','employeeSalesStock'),true);assert.equal(isReadOnlyFunction('fieldOps','employeeRecordSupply'),false);
});
test('two employees without vehicles have separate custody and no blank-team conflict',async()=>{
 const f=await setup(),first=(await f.issue()).dispatch,other=await f.s.Employee.create({full_name:'Second',role:'procurement',status:'active'});
 const second=await distributionControlAction(f.client,gm,{...f.body,commercialId:other.id,requestKey:crypto.randomUUID()});assert.notEqual(first.vehicle_warehouse_id,second.dispatch.vehicle_warehouse_id);
 assert.equal((await dispatchReconciliationData(f.client.asServiceRole,first)).rows[0].actual,5);
 await assert.rejects(distributionControlAction(f.client,gm,{...f.body,requestKey:crypto.randomUUID()}),/open delivery run/);
});
test('a failure after employee custody transfer rolls back stock, location and request at the actual API boundary',async()=>{
 const db=new PGlite();try{const f=await setup(db),route=await functionRoute();f.client.auth.me=async()=>gm;globalThis.__cashierClient=f.client;globalThis.__cashierTransaction=async fn=>{await db.exec('BEGIN');try{const result=await fn();await db.exec('COMMIT');return result;}catch(e){await db.exec('ROLLBACK');throw e;}};
 const create=f.s.AuditLog.create;f.s.AuditLog.create=async v=>{if(v.action==='load_dispatch')throw Error('Simulated audit failure');return create(v);};
 const response=await route(request(f.body),{params:Promise.resolve({name:'fieldOps'})});assert.equal(response.status,400);assert.equal((await f.s.Dispatch.list()).length,0);assert.equal((await f.s.StockMovement.list()).length,0);assert.equal((await f.s.Warehouse.filter({employee_delivery_custody:true})).length,0);assert.equal((await f.s.DispatchRequest.list()).length,0);
 }finally{delete globalThis.__cashierClient;delete globalThis.__cashierTransaction;await db.close();}
});

test('custom job profiles include eligible employees and exclude all Hotesse templates',async()=>{
 const f=await setup();await f.s.CompanySettings.update('settings',{staff_role_catalogue:{roles:{delivery_clerk:{key:'delivery_clerk',template_role:'procurement',label:'Delivery clerk',modules:[]},retail_host:{key:'retail_host',template_role:'hotesse',label:'Outlet host',modules:['outlets']}}}});
 await f.s.Employee.update('cashier',{role:'delivery_clerk'});let workspace=await distributionControlAction(f.client,gm,{action:'distributionIssueWorkspace'});assert.ok(workspace.staff.some(e=>e.id==='cashier'));await f.issue();
 await f.s.Employee.update('cashier',{role:'retail_host'});workspace=await distributionControlAction(f.client,gm,{action:'distributionIssueWorkspace'});assert.ok(!workspace.staff.some(e=>e.id==='cashier'));await assert.rejects(distributionControlAction(f.client,gm,{...f.body,requestKey:crypto.randomUUID()}),/other than Hotesse/);
});

test('replacement-only employee supplies keep damaged goods in custody quarantine until physical return',async()=>{
 const f=await setup(),{dispatch}=await f.issue();
 const input={...f.sale(dispatch.id),lines:[],paymentType:'exchange',expectedTotal:0,replacementsDeclared:true,stockReplacements:[{product_id:'product-a',quantity:2,reason:'damaged',expiry_date:''}]};
 const result=await employeeStockAction(f.client,f.actor,input);assert.equal(result.exchangeOnly,true);assert.equal(result.invoiceId,'');assert.equal((await f.s.Invoice.list()).length,0);assert.equal((await f.s.Customer.get('customer-a')).balance,0);
 const record=(await f.s.SpoilageRecord.list())[0];assert.ok(!record.return_received_at);const bin=await f.s.Warehouse.get(record.collection_warehouse_id);assert.equal(bin.source_warehouse_id,dispatch.vehicle_warehouse_id);assert.equal(bin.warehouse_type,'quarantine');
 await dispatchAction(f.client,gm,{action:'returnDispatchStock',dispatchId:dispatch.id,countedLines:[{product_id:'product-a',quantity:3}]});
 const returned=await f.s.SpoilageRecord.get(record.id);assert.ok(returned.return_received_at);assert.equal((await f.s.Warehouse.get(returned.return_received_warehouse_id)).warehouse_type,'quarantine');assert.equal((await f.s.StockBalance.filter({warehouse_id:bin.id})).reduce((n,b)=>n+b.quantity,0),0);
 const lines=await f.s.JournalLine.list();assert.ok(lines.every(l=>!['revenue','receivable','clearing'].includes(l.account_id)));assert.equal(lines.reduce((n,l)=>n+Number(l.debit||0)-Number(l.credit||0),0),0);
});
