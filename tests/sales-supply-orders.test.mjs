import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {fixture,functionRoute,request,date} from './helpers/cashier.mjs';
import {salesOrderAction} from '../src/server/domain/sales-orders.js';
import {invoiceAction} from '../src/server/domain/sales-invoices.js';
import {distributionControlAction} from '../src/server/domain/distribution-control.js';
import {dispatchReconciliationData} from '../src/server/domain/dispatch-operations.js';
import {companySalesRegister} from '../src/lib/company-sales.js';
import {invoiceDefaults} from '../src/lib/invoice-documents.js';
import {guardMutation} from '../src/server/access.js';
import {isReadOnlyFunction} from '../src/lib/function-actions.js';

const admin={id:'gm',role:'admin',full_name:'General Manager'};
async function setup(db){
  const f=await fixture(db),s=f.entities;f.client.auth.me=async()=>admin;
  await s.CompanySettings.update('settings',{company_name:'SOEICAM',next_invoice_number:1});
  await s.Employee.create({id:'agent-a',role:'commercial',status:'active',full_name:'Agent A'});
  await s.Employee.create({id:'driver-a',role:'driver',status:'active',full_name:'Driver A'});
  // The fixture's ordinary create assigns IDs; bind the run to the real rows.
  const staff=await s.Employee.list(),agent=staff.find(e=>e.role==='commercial'),driver=staff.find(e=>e.role==='driver');
  await s.Dispatch.update('run-a',{salesperson_id:agent.id,driver_id:driver.id});
  const factory=await s.StockBalance.create({warehouse_id:'factory',product_id:'product-a',quantity:20,total_value:6000,unit_cost:300,qc_status:'approved',lot_number:'FACTORY-LOT'});
  const create=s.AuditLog.create;s.AuditLog.create=async value=>{
    if(!value.id)return create(value);
    const row={...structuredClone(value),audit_source:'server_verified'};
    if(db)await db.query('INSERT INTO fixture_entity VALUES($1,$2,$3)',['AuditLog',row.id,JSON.stringify(row)]);
    else{if(f.rows.AuditLog.some(r=>r.id===row.id))throw Error('Duplicate save reference');f.rows.AuditLog.push(row);}
    return row;
  };
  const body={action:'recordSuppliedOrder',requestKey:crypto.randomUUID(),sourceType:'issued',dispatchId:'run-a',customerId:'customer-a',sellerId:'cashier',date,paymentType:'cash',expectedTotal:1000,notes:'Delivered now',lines:[{product_id:'product-a',quantity:2,unit_price:500,discount_pct:0}]};
  return {...f,s,agent,driver,factory,body,call:body=>salesOrderAction(f.client,admin,body)};
}

test('Sales offers actual issued loads first and keeps empty main finished warehouses available for special customer orders',async()=>{
  const f=await setup();await f.s.Warehouse.create({name:'Main Cold Room',warehouse_type:'cold_room',is_active:true});await f.s.Warehouse.create({name:'Ingredients',warehouse_type:'raw_material',is_active:true});
  const options=await f.call({action:'salesOrderWorkspace'});
  assert.equal(options.runs[0].commercial_name,'Agent A');assert.ok(options.warehouses.some(w=>w.name==='Main Cold Room'));
  assert.ok(!options.warehouses.some(w=>w.name==='Ingredients'));
  const stock=await f.call({action:'salesOrderStock',sourceType:'issued',dispatchId:'run-a'});
  assert.equal(stock.source.stock_warehouse_id,'van-stock');assert.equal(stock.products[0].available,10);
  assert.equal('unit_cost' in stock.products[0],false);assert.equal('cost_of_goods' in stock,false);
  assert.equal(isReadOnlyFunction('fieldOps','salesOrderWorkspace'),true);assert.equal(isReadOnlyFunction('fieldOps','recordSuppliedOrder'),false);
});

test('recording a supplied order deducts issued goods and posts one invoice immediately, retaining the real recorder and assigned team',async()=>{
  const f=await setup(),r=await f.call({...f.body,salesperson_id:'forged',created_by:'forged'});
  assert.equal((await f.s.StockBalance.get('stock')).quantity,8);assert.equal((await f.s.StockBalance.get(f.factory.id)).quantity,20);
  assert.equal(r.order.status,'invoiced');assert.equal(r.order.sales_supply_recorded_by,admin.id);assert.equal(r.order.created_by,admin.id);assert.equal(r.order.salesperson_id,'cashier');assert.equal(r.order.sales_supply_stockholder_id,f.agent.id);assert.equal(r.order.driver_id,f.driver.id);
  const invoice=await f.s.Invoice.get(r.invoiceId);assert.equal(invoice.dispatch_id,'run-a');assert.equal(invoice.salesperson_name,'Cashier');assert.equal(invoice.stock_holder_id,f.agent.id);
  const issue=(await f.s.StockMovement.list())[0];assert.equal(issue.source_warehouse_id,'van-stock');assert.equal(issue.dispatch_id,'run-a');assert.equal(issue.document_type,'SalesOrder');assert.equal(issue.lot_number,'LOT');
  assert.equal((await f.s.InvoiceLine.list())[0].cogs_total,400);assert.equal((await f.s.Customer.get('customer-a')).balance,0);
  assert.equal((await f.s.JournalEntry.list()).length,1);assert.equal((await f.s.JournalLine.list()).reduce((n,l)=>n+l.debit-l.credit,0),0);
  const recon=await dispatchReconciliationData(f.client.asServiceRole,await f.s.Dispatch.get('run-a'));
  const dashboard=await distributionControlAction(f.client,admin,{action:'distributionControl',date});assert.equal(dashboard.agents.find(a=>a.id===f.agent.id).sales,0,'stock custody does not impersonate the actual seller');
  const register=companySalesRegister({invoices:await f.s.Invoice.list(),fieldSales:await f.s.FieldSale.list(),from:date,to:date});assert.equal(register.totals.count,1);assert.equal(register.rows[0].commercial_name,'Cashier');
  assert.equal(recon.rows[0].sold,2);assert.equal(recon.rows[0].actual,8);assert.equal(recon.hasVariance,false);assert.equal(recon.cashSales,1000);assert.equal(recon.creditSales,0);
  assert.equal((await f.call(f.body)).reused,true);assert.equal((await f.s.StockMovement.list()).length,1);
  const printed=await invoiceAction(f.client,admin,{action:'createSalesInvoice',sourceType:'order',sourceId:r.order.id,invoiceDate:date,dueDate:date,options:invoiceDefaults({business_name:'Customer A'})});
  assert.equal(printed.reused,true);assert.equal((await f.s.StockMovement.list()).length,1);assert.equal((await f.s.JournalEntry.list()).length,1);
  await assert.rejects(f.call({...f.body,lines:[{...f.body.lines[0],quantity:3}]}),/different supply/);
});

test('direct customer supplies deduct the selected main finished warehouse and retain credit receivables without touching issued stock',async()=>{
  const f=await setup(),r=await f.call({...f.body,sourceType:'warehouse',dispatchId:'',warehouseId:'factory',paymentType:'credit'});
  assert.equal((await f.s.StockBalance.get(f.factory.id)).quantity,18);assert.equal((await f.s.StockBalance.get('stock')).quantity,10);
  assert.equal((await f.s.InvoiceLine.list())[0].cogs_total,600);assert.equal((await f.s.Customer.get('customer-a')).balance,1000);
  assert.equal(r.order.dispatch_id,'');assert.equal(r.order.amount_due,1000);
});

test('run manifests, live QC, expiry and returns prevent issuing unrelated vehicle goods or reusing a completed load',async()=>{
  for(const scenario of ['manifest','held','expired','returned','conflict','inactive']){
    const f=await setup();
    if(scenario==='manifest')await f.s.DispatchLine.update('load-a',{loaded_quantity:1});
    if(scenario==='held')await f.s.StockBalance.update('stock',{qc_status:'quarantine'});
    if(scenario==='expired')await f.s.StockBalance.update('stock',{expiry_date:'2020-01-01'});
    if(scenario==='returned')await f.s.Dispatch.update('run-a',{status:'returned'});
    if(scenario==='conflict')await f.s.Dispatch.create({...await f.s.Dispatch.get('run-a'),id:undefined,status:'loaded'});
    if(scenario==='inactive')await f.s.Employee.update(f.agent.id,{status:'inactive'});
    await assert.rejects(f.call(f.body));assert.equal((await f.s.Invoice.list()).length,0);assert.equal((await f.s.StockMovement.list()).length,0);
  }
});

test('invalid quantities, prices, customer branches, source locations and credit limits stop the supply before it changes stock',async()=>{
  const f=await setup(),before=structuredClone(f.rows);
  for(const change of [{quantity:''},{quantity:0},{quantity:-1},{quantity:11},{quantity:1.0001},{unit_price:-1},{unit_price:0},{discount_pct:101}])await assert.rejects(f.call({...f.body,lines:[{...f.body.lines[0],...change}]}));
  await assert.rejects(f.call({...f.body,lines:[f.body.lines[0],f.body.lines[0]]}),/distinct/);
  await assert.rejects(f.call({...f.body,locationId:'unrelated'}),/delivery point/);
  await assert.rejects(f.call({...f.body,sourceType:'warehouse',dispatchId:'',warehouseId:'van-stock'}),/finished-goods warehouse/);
  await assert.rejects(f.call({...f.body,warehouseId:'factory'}),/does not match/);
  await assert.rejects(f.call({...f.body,date:'2099-01-01'}),/valid sale date/);
  await assert.rejects(f.call({...f.body,sellerId:'missing'}),/active employee/);
  await assert.rejects(f.call({...f.body,expectedTotal:900}),/sale total changed/);
  assert.deepEqual(f.rows,before);
  await f.s.Customer.update('customer-a',{credit_limit:500});await assert.rejects(f.call({...f.body,paymentType:'credit'}),/credit limit/);
});

test('stock-moving Sales records cannot be forged or edited through the generic API, and read-only management and field roles cannot record them',async()=>{
  const f=await setup();
  for(const role of ['commercial','driver','warehouse_manager','production_manager','cashier']){
    await f.s.Employee.update('cashier',{role});
    await assert.rejects(salesOrderAction(f.client,{id:'cashier-login',role:'user'},f.body));
  }
  const context={user:admin,role:'admin'};
  for(const entity of ['SalesOrder','SalesOrderLine','AuditLog'])assert.throws(()=>guardMutation(context,entity,'create',{sales_supply_recorded_by:'forged'}),/checked Sales/);
  const r=await f.call(f.body),line=(await f.s.SalesOrderLine.list())[0];
  assert.throws(()=>guardMutation(context,'SalesOrderLine','update',{quantity:20},line),/checked Sales/);
  assert.throws(()=>guardMutation(context,'SalesOrder','delete',{},r.order),/checked Sales/);
});

test('a late supply audit failure rolls back order, invoice, stock, customer balance and journal together, then the identical retry commits once',async()=>{
  const db=new PGlite();try{
    const f=await setup(db),route=await functionRoute(),create=f.s.AuditLog.create;
    globalThis.__cashierClient=f.client;globalThis.__cashierTransaction=async fn=>{await db.exec('BEGIN');try{const result=await fn();await db.exec('COMMIT');return result;}catch(e){await db.exec('ROLLBACK');throw e;}};
    f.s.AuditLog.create=async value=>{if(value.action==='record_supplied_order')throw Error('Late supplied order audit failure');return create(value);};
    const body={...f.body,paymentType:'credit'},before=(await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows;
    const call=()=>route(request(body),{params:Promise.resolve({name:'fieldOps'})});
    const failed=await call();assert.equal(failed.status,400);assert.deepEqual((await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows,before);
    f.s.AuditLog.create=create;const ok=await call();assert.equal(ok.status,200);const second=await call();assert.equal(second.status,200);assert.equal((await second.json()).reused,true);
    assert.equal((await f.s.Invoice.list()).length,1);assert.equal((await f.s.StockMovement.list()).length,1);assert.equal((await f.s.StockBalance.get('stock')).quantity,8);assert.equal((await f.s.Customer.get('customer-a')).balance,1000);
  }finally{delete globalThis.__cashierClient;delete globalThis.__cashierTransaction;await db.close();}
});

test('tax and discounts post the reviewed total without a rounding drift',async()=>{
  const f=await setup();await f.s.Product.update('product-a',{tax_rate:19.25});
  const result=await f.call({...f.body,expectedTotal:1073.24,lines:[{product_id:'product-a',quantity:3,unit_price:333.33,discount_pct:10}]});
  const invoice=await f.s.Invoice.get(result.invoiceId),line=(await f.s.InvoiceLine.list())[0];
  assert.equal(line.discount_amount,100);assert.equal(line.tax_amount,173.25);assert.equal(line.total,1073.24);
  assert.equal(invoice.subtotal,899.99);assert.equal(invoice.total,1073.24);
  assert.equal((await f.s.JournalLine.list()).reduce((n,l)=>Math.round((n+l.debit-l.credit)*100)/100,0),0);
});

test('an existing unsupplied draft is posted in place while stale drafts and orders already issued remain protected',async()=>{
  const f=await setup();
  const draft=await f.s.SalesOrder.create({order_number:'OLD-DRAFT',customer_id:'customer-a',warehouse_id:'factory',status:'draft',updated_date:'v1'});
  await f.s.SalesOrderLine.create({order_id:draft.id,product_id:'product-a',quantity:1,unit_price:500,total:500});
  await assert.rejects(f.call({...f.body,orderId:draft.id,updatedDate:'old'}),/order changed/);
  assert.equal((await f.s.StockMovement.list()).length,0);
  const posted=await f.call({...f.body,orderId:draft.id,updatedDate:'v1'});
  assert.equal(posted.order.id,draft.id);assert.equal((await f.s.SalesOrder.list()).length,1);assert.equal((await f.s.SalesOrderLine.list()).length,1);
  const other=await f.s.SalesOrder.create({order_number:'ALREADY-DELIVERED',customer_id:'customer-a',warehouse_id:'factory',status:'draft'});
  await f.s.StockMovement.create({document_id:other.id,document_type:'SalesOrder',source_warehouse_id:'factory',quantity:1,status:'approved'});
  await assert.rejects(f.call({...f.body,requestKey:crypto.randomUUID(),orderId:other.id}),/already has goods issued/);
});

test('the sale date and actual seller remain independent of current stock custody and the authenticated recorder',async()=>{
  const f=await setup(),past=new Date(Date.parse(date+'T12:00:00Z')-86400000).toISOString().slice(0,10);
  const result=await f.call({...f.body,sourceType:'warehouse',dispatchId:'',warehouseId:'factory',date:past,sellerId:f.agent.id,paymentType:'credit'});
  const invoice=await f.s.Invoice.get(result.invoiceId),journal=(await f.s.JournalEntry.list())[0];
  assert.equal(result.order.order_date,past);assert.equal(invoice.invoice_date,past);assert.equal(journal.entry_date,past);
  assert.equal(result.order.salesperson_id,f.agent.id);assert.equal(result.order.sales_supply_recorded_by,admin.id);
  assert.equal(result.order.sales_supply_stockholder_id,'');assert.equal((await f.s.StockBalance.get(f.factory.id)).quantity,18);assert.equal((await f.s.StockBalance.get('stock')).quantity,10);
  await f.s.Employee.update('cashier',{status:'inactive'});
  await assert.rejects(f.call({...f.body,requestKey:crypto.randomUUID()}),/active employee/);
});

test('customer branches are selected explicitly and confirmed again when recording the sale',async()=>{
  const f=await setup(),branch=await f.s.Customer.create({business_name:'Customer A branch',parent_id:'customer-a',is_active:true});
  const points=await f.call({action:'salesOrderDeliveryPoints',customerId:'customer-a'});
  assert.ok(points.points.some(p=>p.id===branch.id));
  await assert.rejects(f.call(f.body),/customer branch/);
  assert.equal((await f.s.StockMovement.list()).length,0);
  const result=await f.call({...f.body,locationId:branch.id});assert.equal(result.order.location_id,branch.id);
  assert.equal((await f.s.StockMovement.list()).length,1);
});


test('new sales default to one company stock pool even when an issued load exists',async()=>{
 const f=await setup(),catalogue=await f.call({action:'salesOrderWorkspace'});
 assert.equal(catalogue.defaultSource,'company');assert.equal(catalogue.runs.length,1);
 const stock=await f.call({action:'salesOrderStock',sourceType:'company',date});
 assert.equal(stock.products.find(p=>p.id==='product-a').available,20,'issued van stock is excluded');
 assert.equal(stock.source.stock_warehouse_name,'Company stock');
});

test('pooled sale issues earliest-expiring lots across company locations once and posts their exact combined costs',async()=>{
 const f=await setup();
 await f.s.StockBalance.update(f.factory.id,{quantity:1,total_value:300,expiry_date:'2099-12-31'});
 const room=await f.s.Warehouse.create({name:'Old cold room',warehouse_type:'cold_room',is_active:true});
 const extra=await f.s.StockBalance.create({warehouse_id:room.id,product_id:'product-a',quantity:2,total_value:800,unit_cost:400,qc_status:'approved',lot_number:'EARLY',expiry_date:'2099-01-01'});
 const stock=await f.call({action:'salesOrderStock',sourceType:'company',date});assert.equal(stock.products[0].available,3);
 const body={...f.body,sourceType:'company',dispatchId:'',paymentType:'credit',expectedTotal:1500,lines:[{...f.body.lines[0],quantity:3}]};
 const result=await f.call(body),movements=await f.s.StockMovement.list();
 assert.equal((await f.s.StockBalance.get(extra.id)).quantity,0);assert.equal((await f.s.StockBalance.get(f.factory.id)).quantity,0);assert.equal((await f.s.StockBalance.get('stock')).quantity,10);
 assert.deepEqual(movements.map(m=>m.source_warehouse_id),[room.id,'factory']);assert.deepEqual(movements.map(m=>m.quantity),[2,1]);
 assert.equal((await f.s.InvoiceLine.list())[0].cogs_total,1100);assert.equal((await f.s.Invoice.get(result.invoiceId)).balance,1500);
 const ledger=await f.s.JournalLine.list();assert.equal(ledger.reduce((n,l)=>n+l.debit-l.credit,0),0);assert.equal((await f.s.JournalEntry.list()).length,1);
 assert.equal((await f.call(body)).reused,true);assert.equal((await f.s.StockMovement.list()).length,2);
 const printed=await invoiceAction(f.client,admin,{action:'createSalesInvoice',sourceType:'order',sourceId:result.order.id,invoiceDate:date,dueDate:date,options:invoiceDefaults({business_name:'Customer A'})});assert.equal(printed.reused,true);assert.equal((await f.s.StockMovement.list()).length,2);
});

test('pooled stock excludes isolated, expired, held, inactive, unfinished and delivery inventory',async()=>{
 const f=await setup();
 for(const type of ['vehicle','commercial_custody','field_delivery_pending','quarantine','damaged','wip']){
  const w=await f.s.Warehouse.create({name:type,warehouse_type:type,is_active:true});await f.s.StockBalance.create({warehouse_id:w.id,product_id:'product-a',quantity:100,unit_cost:300,qc_status:'approved'});
 }
 const inactive=await f.s.Warehouse.create({name:'Inactive',warehouse_type:'cold_room',is_active:false});await f.s.StockBalance.create({warehouse_id:inactive.id,product_id:'product-a',quantity:100,qc_status:'approved'});
 for(const data of [{qc_status:'quarantine'},{expiry_date:'2020-01-01'}])await f.s.StockBalance.create({warehouse_id:'factory',product_id:'product-a',quantity:100,unit_cost:300,...data});
 assert.equal((await f.call({action:'salesOrderStock',sourceType:'company',date})).products[0].available,20);
 await assert.rejects(f.call({...f.body,sourceType:'company',dispatchId:'' ,expectedTotal:10500,lines:[{...f.body.lines[0],quantity:21}]}),/quantity/);
 assert.equal((await f.s.StockMovement.list()).length,0);
 await assert.rejects(f.call({action:'salesOrderStock',sourceType:'company',warehouseId:'van-stock',date}),/automatically/);
});

test('approved finished stock in legacy general storage is available without creating another warehouse',async()=>{
 const f=await setup();await f.s.Warehouse.update('factory',{warehouse_type:'raw_material'});
 const stock=await f.call({action:'salesOrderStock',sourceType:'company',date});assert.equal(stock.products[0].available,20);
 const result=await f.call({...f.body,sourceType:'company',dispatchId:'',paymentType:'credit'});assert.ok(result.invoiceId);assert.equal((await f.s.StockBalance.get(f.factory.id)).quantity,18);
});


test('pooled sale fully rolls back both locations and the ledger if the final audit fails',async()=>{
 const db=new PGlite();try{
  const f=await setup(db),route=await functionRoute(),create=f.s.AuditLog.create;
  await f.s.StockBalance.update(f.factory.id,{quantity:1,total_value:300});
  const room=await f.s.Warehouse.create({name:'Second storage',warehouse_type:'general',is_active:true});await f.s.StockBalance.create({warehouse_id:room.id,product_id:'product-a',quantity:2,total_value:800,unit_cost:400,qc_status:'approved'});
  globalThis.__cashierClient=f.client;globalThis.__cashierTransaction=async fn=>{await db.exec('BEGIN');try{const result=await fn();await db.exec('COMMIT');return result;}catch(e){await db.exec('ROLLBACK');throw e;}};
  f.s.AuditLog.create=async value=>{if(value.action==='record_supplied_order')throw Error('Late audit failure');return create(value);};
  const body={...f.body,sourceType:'company',dispatchId:'',paymentType:'credit',expectedTotal:1500,lines:[{...f.body.lines[0],quantity:3}]};
  const before=(await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows;
  const call=()=>route(request(body),{params:Promise.resolve({name:'fieldOps'})});
  assert.equal((await call()).status,400);assert.deepEqual((await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows,before);
  f.s.AuditLog.create=create;assert.equal((await call()).status,200);assert.equal((await (await call()).json()).reused,true);
  assert.equal((await f.s.StockMovement.list()).length,2);assert.equal((await f.s.JournalEntry.list()).length,1);assert.equal((await f.s.InvoiceLine.list())[0].cogs_total,1100);
 }finally{delete globalThis.__cashierClient;delete globalThis.__cashierTransaction;await db.close();}
});
