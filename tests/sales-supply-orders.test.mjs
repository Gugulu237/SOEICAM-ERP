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
import {FEATURE_AUTHORITY} from '../src/server/domain/roles.js';

const admin={id:'gm',role:'admin',full_name:'General Manager'};
test('omitting the salesperson uses the signed-in employee rather than the selected stock holder',async()=>{
  const f=await setup(),self=await f.s.Employee.create({role:'employee',status:'active',full_name:'Signed in seller',user_id:'seller-login'});
  const actor={id:'seller-login',role:'user',full_name:'Signed in seller'};f.client.entities.Employee.filter=async()=>[self];
  const catalogue=await salesOrderAction(f.client,actor,{action:'salesOrderWorkspace'});assert.equal(catalogue.currentSellerId,self.id);
  const {sellerId,...input}=f.body;void sellerId;
  const result=await salesOrderAction(f.client,actor,input);
  assert.equal(result.order.salesperson_id,self.id);assert.equal(result.order.sales_supply_recorded_by,actor.id);assert.equal(result.order.sales_supply_stockholder_id,f.agent.id);
});

test('an authorized account without an employee defaults to its own user identity and rejects impersonation',async()=>{
  const f=await setup();f.client.entities.Employee.filter=async()=>[];
  const workspace=await f.call({action:'salesOrderWorkspace'});assert.equal(workspace.currentSellerId,'user:'+admin.id);
  await assert.rejects(f.call({...f.body,sellerId:'user:somebody-else'}),/active employee|current user|salesperson/i);
  const result=await f.call({...f.body,sellerId:''});assert.equal(result.order.sales_supply_seller_id,'user:'+admin.id);assert.equal(result.order.salesperson_name,admin.full_name);assert.equal(result.order.sales_supply_recorded_by,admin.id);
});
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
  const body={action:'recordSuppliedOrder',receiptReference:'RCPT-100',requestKey:crypto.randomUUID(),sourceType:'issued',dispatchId:'run-a',customerId:'customer-a',sellerId:'cashier',date,paymentType:'cash',expectedTotal:1000,notes:'Delivered now',lines:[{product_id:'product-a',quantity:2,unit_price:500,discount_pct:0}]};
  return {...f,s,agent,driver,factory,body,call:body=>salesOrderAction(f.client,admin,body)};
}

test('Sales offers actual issued loads first and keeps empty main finished warehouses available for special customer orders',async()=>{
  const f=await setup();await f.s.Warehouse.create({name:'Main Cold Room',warehouse_type:'cold_room',is_active:true});await f.s.Warehouse.create({name:'Ingredients',warehouse_type:'raw_material',is_active:true});
  const options=await f.call({action:'salesOrderWorkspace'});
  assert.equal(options.runs[0].commercial_name,'Agent A');assert.ok(options.warehouses.some(w=>w.name==='Main Cold Room'));
  assert.ok(!options.warehouses.some(w=>w.name==='Ingredients'));
  await f.s.Product.update('product-a',{product_family:'Yaourt brasse',flavor:'Vanille',size:'500 g'});
  const stock=await f.call({action:'salesOrderStock',sourceType:'issued',dispatchId:'run-a'});
  assert.deepEqual([stock.products[0].product_family,stock.products[0].flavor,stock.products[0].size],['Yaourt brasse','Vanille','500 g']);
  const companyStock=await f.call({action:'salesOrderStock',sourceType:'company'});
  assert.deepEqual([companyStock.products[0].product_family,companyStock.products[0].flavor,companyStock.products[0].size],['Yaourt brasse','Vanille','500 g']);
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
  assert.equal((await f.s.JournalEntry.list()).length,1);assert.equal((await f.s.JournalLine.list()).reduce((cents,line)=>cents+Math.round(line.debit*100)-Math.round(line.credit*100),0),0);
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
  await assert.rejects(f.call({...f.body,sellerId:'missing'}),/active employee as the salesperson/);
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
  const f=await setup();await f.s.Product.update('product-a',{tax_rate:5});
  const result=await f.call({...f.body,expectedTotal:899.99,lines:[{product_id:'product-a',quantity:3,unit_price:333.33,discount_pct:10}]});
  const invoice=await f.s.Invoice.get(result.invoiceId),line=(await f.s.InvoiceLine.list())[0];
  assert.equal(line.discount_amount,100);assert.equal(line.tax_amount,145.28);assert.equal(line.total,899.99);
  assert.equal(invoice.subtotal,754.71);assert.equal(invoice.total,899.99);
  assert.equal((await f.s.InvoiceLine.list())[0].tax_rate,19.25);
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

test('historical sale dates retain the signed-in seller regardless of stock custody',async()=>{
  const f=await setup(),past=new Date(Date.parse(date+'T12:00:00Z')-86400000).toISOString().slice(0,10);
  const result=await f.call({...f.body,sourceType:'warehouse',dispatchId:'',warehouseId:'factory',date:past,sellerId:'cashier',paymentType:'credit'});
  const invoice=await f.s.Invoice.get(result.invoiceId),journal=(await f.s.JournalEntry.list())[0];
  assert.equal(result.order.order_date,past);assert.equal(invoice.invoice_date,past);assert.equal(journal.entry_date,past);
  assert.equal(result.order.salesperson_id,'cashier');assert.equal(result.order.sales_supply_recorded_by,admin.id);
  assert.equal(result.order.sales_supply_stockholder_id,'');assert.equal((await f.s.StockBalance.get(f.factory.id)).quantity,18);assert.equal((await f.s.StockBalance.get('stock')).quantity,10);
  await f.s.Employee.update('cashier',{status:'inactive'});
  await assert.rejects(f.call({...f.body,requestKey:crypto.randomUUID()}),/active employee as the salesperson/);
});

test('multiple customer delivery points require an explicit current selection before stock moves',async()=>{
  const f=await setup(),branch=await f.s.Customer.create({business_name:'Customer A branch',parent_id:'customer-a',is_active:true});
  await f.s.CustomerLocation.create({name:'Main outlet',customer_id:'customer-a',is_active:true});
  const points=await f.call({action:'salesOrderDeliveryPoints',customerId:'customer-a'});
  assert.ok(points.points.some(p=>p.id===branch.id));
  await assert.rejects(f.call(f.body),/customer branch/);
  assert.equal((await f.s.StockMovement.list()).length,0);
  const result=await f.call({...f.body,locationId:branch.id});assert.equal(result.order.location_id,branch.id);
  assert.equal((await f.s.StockMovement.list()).length,1);
});

test('customers without active delivery points can record supplies even when marked decentralized',async()=>{
  const f=await setup();await f.s.Customer.update('customer-a',{financial_centralization_mode:'decentralized'});
  const removed=await f.s.Customer.create({business_name:'Removed branch',parent_id:'customer-a',is_active:true,customer_removed_at:new Date().toISOString()});
  const inactive=await f.s.Customer.create({business_name:'Inactive branch',parent_id:'customer-a',is_active:false});
  const location=await f.s.CustomerLocation.create({name:'Closed outlet',customer_id:'customer-a',is_active:false});
  assert.deepEqual((await f.call({action:'salesOrderDeliveryPoints',customerId:'customer-a'})).points,[]);
  for(const id of [removed.id,inactive.id,location.id])await assert.rejects(f.call({...f.body,locationId:id}),/delivery point belonging/);
  assert.equal((await f.s.StockMovement.list()).length,0);
  const result=await f.call(f.body),invoice=await f.s.Invoice.get(result.invoiceId);
  assert.equal(result.order.customer_id,'customer-a');assert.equal(result.order.location_id,'');assert.equal(invoice.billing_mode,'decentralized');assert.equal(invoice.bill_to_location_id,'');assert.equal(invoice.customer_id,'customer-a');
  assert.equal((await f.s.StockMovement.list()).length,1);assert.equal((await f.call(f.body)).reused,true);
});

test('one available branch or outlet resolves automatically and retry retains its original delivery point',async()=>{
  for(const kind of ['Customer','CustomerLocation']){
    const f=await setup();await f.s.Customer.update('customer-a',{financial_centralization_mode:'decentralized'});
    const point=await f.s[kind].create(kind==='Customer'?{business_name:'Only branch',parent_id:'customer-a',is_active:true}:{name:'Only outlet',customer_id:'customer-a',is_active:true});
    const foreign=await f.s.CustomerLocation.create({name:'Different customer outlet',customer_id:'customer-b',is_active:true});
    assert.equal((await f.call({action:'salesOrderDeliveryPoints',customerId:'customer-a'})).points.length,1);
    await assert.rejects(f.call({...f.body,locationId:foreign.id}),/delivery point belonging/);
    const result=await f.call(f.body),invoice=await f.s.Invoice.get(result.invoiceId);assert.equal(result.order.location_id,point.id);assert.equal(invoice.bill_to_location_id,point.id);
    await f.s[kind].update(point.id,{is_active:false});
    await f.s.Customer.create({business_name:'Later branch 1',parent_id:'customer-a',is_active:true});await f.s.Customer.create({business_name:'Later branch 2',parent_id:'customer-a',is_active:true});
    const retry=await f.call(f.body);assert.equal(retry.reused,true);assert.equal(retry.order.location_id,point.id);assert.equal(retry.invoiceId,result.invoiceId);assert.equal((await f.s.StockMovement.list()).length,1);
    await assert.rejects(f.call({...f.body,requestKey:crypto.randomUUID(),locationId:point.id}),/delivery point belonging/);
  }
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
 const ledger=await f.s.JournalLine.list();assert.equal(ledger.reduce((cents,line)=>cents+Math.round(line.debit*100)-Math.round(line.credit*100),0),0);assert.equal((await f.s.JournalEntry.list()).length,1);
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


test('pooled cash sale rolls back stock, invoice, treasury and ledger if the final audit fails',async()=>{
 const db=new PGlite();try{
  const f=await setup(db),route=await functionRoute(),create=f.s.AuditLog.create;
  await f.s.StockBalance.update(f.factory.id,{quantity:1,total_value:300});
  const room=await f.s.Warehouse.create({name:'Second storage',warehouse_type:'general',is_active:true});await f.s.StockBalance.create({warehouse_id:room.id,product_id:'product-a',quantity:2,total_value:800,unit_cost:400,qc_status:'approved'});
  globalThis.__cashierClient=f.client;globalThis.__cashierTransaction=async fn=>{await db.exec('BEGIN');try{const result=await fn();await db.exec('COMMIT');return result;}catch(e){await db.exec('ROLLBACK');throw e;}};
  f.s.AuditLog.create=async value=>{if(value.action==='record_supplied_order')throw Error('Late audit failure');return create(value);};
  const body={...f.body,sourceType:'company',dispatchId:'',paymentType:'cash',treasuryAccountId:'bank',expectedTotal:1500,lines:[{...f.body.lines[0],quantity:3}]};
  const before=(await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows;
  const call=()=>route(request(body),{params:Promise.resolve({name:'fieldOps'})});
  assert.equal((await call()).status,400);assert.deepEqual((await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows,before);
  f.s.AuditLog.create=create;assert.equal((await call()).status,200);assert.equal((await (await call()).json()).reused,true);
  assert.equal((await f.s.StockMovement.list()).length,2);assert.equal((await f.s.JournalEntry.list()).length,1);assert.equal((await f.s.InvoiceLine.list())[0].cogs_total,1100);
  assert.equal((await f.s.TreasuryAccount.get('bank')).balance,101500);
  assert.equal((await f.s.TreasuryTransaction.list()).length,1);
 }finally{delete globalThis.__cashierClient;delete globalThis.__cashierTransaction;await db.close();}
});

test('workspace returns a named signed-in seller independently of missing employee names or list membership',async()=>{
  const f=await setup();await f.s.Employee.update('cashier',{full_name:''});
  const list=f.s.Employee.filter;f.s.Employee.filter=async(...args)=>(await list(...args)).filter(e=>e.id!=='cashier');
  const workspace=await f.call({action:'salesOrderWorkspace'});
  assert.equal(workspace.currentSellerId,'cashier');assert.deepEqual(workspace.currentSeller,{id:'cashier',name:admin.full_name,user_id:admin.id});
  assert.ok(workspace.sellers.some(s=>s.id==='cashier'&&s.name===admin.full_name));
  const result=await f.call({...f.body,sellerId:undefined});assert.equal(result.order.salesperson_id,'cashier');assert.equal(result.order.salesperson_name,admin.full_name);
});

test('loaded vehicle choices use the stored registration, independently of its descriptive vehicle name',async()=>{
  const f=await setup();await f.s.Vehicle.update('vehicle-a',{registration:'CE 456 CD',name:'A long refrigerated delivery vehicle name'});
  const data=await f.call({action:'salesOrderWorkspace'});assert.equal(data.runs[0].vehicle_registration,'CE 456 CD');
});

test('receipt reference is required before stock or ledger writes, saved on the order and invoice, and bound to retries',async()=>{
  const f=await setup(),before=structuredClone(f.rows);
  for(const receiptReference of [undefined,'','   ',5,'x'.repeat(201),'A\nB']){
    await assert.rejects(f.call({...f.body,receiptReference}),/receipt reference|reference number of the receipt/i);
    assert.deepEqual(f.rows,before);
  }
  const body={...f.body,receiptReference:'  PAPER-025  '},result=await f.call(body);
  assert.equal(result.order.receipt_reference,'PAPER-025');
  const invoice=await f.s.Invoice.get(result.invoiceId);
  assert.equal(invoice.receipt_reference,'PAPER-025');assert.equal(invoice.invoice_document.options.reference,'PAPER-025');
  assert.equal((await f.call({...body,receiptReference:'PAPER-025'})).reused,true);
  await assert.rejects(f.call({...body,receiptReference:'PAPER-OTHER'}),/different supply details/);
  assert.equal((await f.s.SalesOrder.list()).length,1);assert.equal((await f.s.Invoice.list()).length,1);assert.equal((await f.s.StockMovement.list()).length,1);
});


for(const source of ['issued','warehouse','company'])for(const paymentType of ['cash','credit'])test(source+' supply replaces spoiled units once without charging them, while recording actual cost and quarantine',async()=>{
  const f=await setup(),sourceArgs=source==='issued'?{}:source==='company'?{sourceType:'company',dispatchId:''}:{sourceType:'warehouse',warehouseId:'factory',dispatchId:''};
  const body={...f.body,...sourceArgs,paymentType,replacementsDeclared:true,stockReplacements:[{product_id:'product-a',quantity:3,reason:'expired',expiry_date:'2000-01-01',lot_number:'CUSTOMER-OLD'}]};
  const result=await f.call(body),record=(await f.s.SpoilageRecord.list())[0];
  assert.equal(record.source_order_id,result.order.id);assert.equal(record.posting_basis,'sales_order_exchange');assert.equal(record.status,'replaced');assert.equal(record.recorded_by,admin.id);
  assert.equal((await f.s.Invoice.get(result.invoiceId)).total,1000);assert.equal((await f.s.InvoiceLine.list()).length,1);assert.equal((await f.s.InvoiceLine.list())[0].quantity,2);
  const cost=source==='issued'?200:300;assert.equal(record.replacement_cost,3*cost);
  assert.equal((await f.s.StockBalance.get(source==='issued'?'stock':f.factory.id)).quantity,source==='issued'?5:15);
  const quarantine=(await f.s.StockBalance.list()).find(b=>b.warehouse_id===record.collection_warehouse_id);assert.equal(quarantine.quantity,3);assert.equal(quarantine.qc_status,'quarantine');assert.equal(quarantine.total_value,0);
  assert.equal((await f.s.Customer.get('customer-a')).balance,paymentType==='cash'?0:1000);assert.equal((await f.s.JournalEntry.list()).length,2);
  assert.equal((await f.s.JournalLine.list()).reduce((cents,line)=>cents+Math.round(line.debit*100)-Math.round(line.credit*100),0),0);
  const before=structuredClone(f.rows);assert.equal((await f.call(body)).reused,true);assert.deepEqual(f.rows,before);
  await assert.rejects(f.call({...body,stockReplacements:[{...body.stockReplacements[0],quantity:2}]}),/different supply details/);assert.deepEqual(f.rows,before);
  if(source==='issued'){const recon=await dispatchReconciliationData(f.client.asServiceRole,await f.s.Dispatch.get('run-a'));assert.equal(recon.hasVariance,false);}
});

test('replacement declaration, dates, branch ownership and combined stock are checked before supply writes',async()=>{
  const f=await setup(),row={product_id:'product-a',quantity:3,reason:'expired',expiry_date:'2000-01-01'},before=structuredClone(f.rows);
  assert.throws(()=>guardMutation({user:admin},'SalesOrder','create',{stock_replacements:[row]}),/checked Sales workflow/);
  assert.throws(()=>guardMutation({user:admin},'SalesOrder','update',{stock_replacements_declared:true},{status:'draft'}),/checked Sales workflow/);
  for(const changes of [{replacementsDeclared:false,stockReplacements:[row]},{replacementsDeclared:true,stockReplacements:[]},{replacementsDeclared:'yes',stockReplacements:[row]},{stockReplacements:[{...row,quantity:9}]},{stockReplacements:[{...row,expiry_date:date}]},{stockReplacements:[{...row,quantity:true}]},{stockReplacements:[row],locationId:'another-branch'}]){
    await assert.rejects(f.call({...f.body,replacementsDeclared:true,...changes}));assert.deepEqual(f.rows,before);
  }
  const branch=await f.s.Customer.create({business_name:'Annex',parent_id:'customer-a',is_active:true});
  const result=await f.call({...f.body,locationId:branch.id,replacementsDeclared:true,stockReplacements:[row]});
  const record=(await f.s.SpoilageRecord.list())[0];assert.equal(record.location_id,branch.id);assert.equal(record.location_name,'Annex');assert.equal(record.source_order_id,result.order.id);
});

test('a late replacement failure rolls back the sale, invoice, stock, quarantine, ledger and counter together',async()=>{
  const db=new PGlite();try{
    const f=await setup(db),route=await functionRoute();globalThis.__cashierClient=f.client;globalThis.__cashierTransaction=async fn=>{await db.exec('BEGIN');try{const result=await fn();await db.exec('COMMIT');return result;}catch(e){await db.exec('ROLLBACK');throw e;}};
    const body={...f.body,replacementsDeclared:true,stockReplacements:[{product_id:'product-a',quantity:3,reason:'damaged',expiry_date:''}]},post=()=>route(request(body),{params:Promise.resolve({name:'fieldOps'})});
    const before=(await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows,update=f.s.SpoilageRecord.update;
    f.s.SpoilageRecord.update=async()=>{throw Error('Replacement write unavailable');};assert.equal((await post()).status,400);assert.deepEqual((await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows,before);
    f.s.SpoilageRecord.update=update;const response=await post();assert.equal(response.status,200,JSON.stringify(await response.json()));assert.equal((await (await post()).json()).reused,true);assert.equal((await f.s.Invoice.list()).length,1);assert.equal((await f.s.SpoilageRecord.list()).length,1);
  }finally{delete globalThis.__cashierClient;delete globalThis.__cashierTransaction;await db.close();}
});


for(const sourceType of ['company','warehouse','issued'])test(sourceType+' replacement-only receipt creates an accounted exchange without an invoice or customer debt',async()=>{
  const f=await setup();await f.s.Customer.update('customer-a',{balance:400,credit_limit:100,credit_status:'blocked'});
  const cashBefore=await f.s.CashCollection.list(),args={...f.body,sourceType,dispatchId:sourceType==='issued'?'run-a':'',warehouseId:sourceType==='warehouse'?'factory':'',lines:[],paymentType:'exchange',expectedTotal:0,replacementsDeclared:true,stockReplacements:[{product_id:'product-a',quantity:3,reason:'damaged',expiry_date:''}]};
  const result=await f.call(args);assert.equal(result.exchangeOnly,true);assert.equal(result.invoiceId,'');assert.equal(result.order.supply_kind,'exchange');assert.equal(result.order.status,'delivered');assert.equal(result.order.total,0);
  assert.equal((await f.s.Invoice.list()).length,0);assert.equal((await f.s.SalesOrderLine.list()).length,0);assert.deepEqual(await f.s.CashCollection.list(),cashBefore);assert.equal((await f.s.Customer.get('customer-a')).balance,400);
  assert.equal((await f.s.StockBalance.get(sourceType==='issued'?'stock':f.factory.id)).quantity,sourceType==='issued'?7:17);
  const records=await f.s.SpoilageRecord.list();assert.equal(records.length,1);assert.equal(records[0].replacement_cost,sourceType==='issued'?600:900);
  const returned=(await f.s.StockBalance.list()).find(b=>b.qc_status==='quarantine');assert.equal(returned.quantity,3);assert.equal(returned.total_value,0);
  const journals=await f.s.JournalEntry.list(),lines=await f.s.JournalLine.list();assert.equal(journals.length,1);assert.equal(journals[0].source_document_type,'SpoilageRecord');assert.equal(lines.reduce((n,l)=>n+Number(l.debit||0)-Number(l.credit||0),0),0);assert.ok(lines.every(l=>!['revenue','receivable','clearing'].includes(l.account_id)));
  const before=structuredClone(f.rows);assert.equal((await f.call(args)).reused,true);assert.deepEqual(f.rows,before);
  const workspace=await invoiceAction(f.client,admin,{action:'invoiceWorkspace'});assert.ok(!workspace.sources.some(s=>s.id===result.order.id));
  await assert.rejects(invoiceAction(f.client,admin,{action:'createSalesInvoice',sourceType:'order',sourceId:result.order.id,invoiceDate:date,dueDate:date,options:invoiceDefaults({business_name:'Customer A'})}),/exchange has no sales invoice/);
});

test('Sales stock loads every active finished product across pages and reflects changed stock, holds and setup state',async()=>{
  const f=await setup();let last;
  for(let i=0;i<420;i++)last=await f.s.Product.create({name:'Finished '+i,inventory_type:'assembly',is_active:true,selling_price:500});
  const draft=await f.s.Product.create({name:'Draft assembly',inventory_type:'assembly',is_active:true,configuration_status:'draft'});
  await f.s.Product.create({name:'Packaging',inventory_type:'packaging',is_active:true});await f.s.Product.create({name:'Inactive',inventory_type:'assembly',is_active:false});
  const balance=await f.s.StockBalance.create({warehouse_id:'factory',product_id:last.id,quantity:7,qc_status:'approved'});
  await f.s.StockBalance.create({warehouse_id:'factory',product_id:draft.id,quantity:99,qc_status:'approved'});
  const get=()=>f.call({action:'salesOrderStock',sourceType:'company'});let data=await get();assert.equal(data.products.length,422);assert.equal(data.products.find(p=>p.id===last.id).available,7);assert.equal(data.products.find(p=>p.id===draft.id).available,99);assert.equal(data.products.find(p=>p.id===draft.id).unavailable_reason,'');
  await f.s.StockBalance.update(balance.id,{quantity:5});data=await get();assert.equal(data.products.find(p=>p.id===last.id).available,5);
  await f.s.StockBalance.update(balance.id,{qc_status:'quarantine'});data=await get();assert.equal(data.products.length,422);assert.equal(data.products.find(p=>p.id===last.id).available,0);
  const before=structuredClone(f.rows);await assert.rejects(f.call({...f.body,sourceType:'company',dispatchId:'',lines:[{product_id:last.id,quantity:1,unit_price:500}],expectedTotal:500}),/quantity/);assert.deepEqual(f.rows,before);
});

test('a late exchange-only audit failure rolls back replacement stock and accounting, then an identical retry commits once',async()=>{
  const db=new PGlite();try{
    const f=await setup(db),route=await functionRoute(),create=f.s.AuditLog.create;
    globalThis.__cashierClient=f.client;globalThis.__cashierTransaction=async fn=>{await db.exec('BEGIN');try{const result=await fn();await db.exec('COMMIT');return result;}catch(e){await db.exec('ROLLBACK');throw e;}};
    const body={...f.body,lines:[],expectedTotal:0,paymentType:'exchange',stockReplacements:[{product_id:'product-a',quantity:3,reason:'damaged'}]},before=(await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows;
    f.s.AuditLog.create=async value=>{if(value.action==='record_supplied_order')throw Error('Late exchange audit failure');return create(value);};
    const call=()=>route(request(body),{params:Promise.resolve({name:'fieldOps'})});const failed=await call();assert.equal(failed.status,400);assert.deepEqual((await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows,before);
    f.s.AuditLog.create=create;const ok=await call();assert.equal(ok.status,200,JSON.stringify(await ok.clone().json()));const retry=await call();assert.equal((await retry.json()).reused,true);assert.equal((await f.s.StockBalance.get('stock')).quantity,7);assert.equal((await f.s.JournalEntry.list()).length,1);assert.equal((await f.s.Invoice.list()).length,0);
  }finally{delete globalThis.__cashierClient;delete globalThis.__cashierTransaction;await db.close();}
});

for(const sourceType of ['company','warehouse','issued'])for(const exchangeOnly of [false,true])test(sourceType+' existing finished stock remains available through sale or exchange with incomplete assembly setup: '+exchangeOnly,async()=>{
 const f=await setup();await f.s.Product.update('product-a',{configuration_status:'draft',components:[]});
 const source={sourceType,dispatchId:sourceType==='issued'?'run-a':'',warehouseId:sourceType==='warehouse'?'factory':''};
 const stock=()=>f.call({action:'salesOrderStock',...source,date});
 const before=sourceType==='issued'?10:20;
 assert.equal((await stock()).products.find(p=>p.id==='product-a').available,before);
 const args={...f.body,...source,...(exchangeOnly?{lines:[],paymentType:'exchange',expectedTotal:0,replacementsDeclared:true,stockReplacements:[{product_id:'product-a',quantity:2,reason:'damaged',expiry_date:''}]}:{})};
 const result=await f.call(args);assert.equal(result.exchangeOnly,exchangeOnly);
 assert.equal((await stock()).products.find(p=>p.id==='product-a').available,before-2);
 assert.equal((await f.s.Invoice.list()).length,exchangeOnly?0:1);
 const lines=await f.s.JournalLine.list();assert.equal(lines.reduce((cents,line)=>cents+Math.round(Number(line.debit||0)*100)-Math.round(Number(line.credit||0)*100),0),0);
 const snapshot=structuredClone(f.rows);assert.equal((await f.call(args)).reused,true);assert.deepEqual(f.rows,snapshot);
});

test('legacy administrators can choose every active employee, including staff without sign-in accounts',async()=>{
 const f=await setup(),inactive=await f.s.Employee.create({role:'commercial',status:'inactive',full_name:'Inactive seller'}),removed=await f.s.Employee.create({role:'commercial',status:'active',full_name:'Removed seller',employee_removed_at:date}),unrelated=await f.s.Employee.create({role:'employee',status:'active',full_name:'Unrelated employee'});
 const workspace=await f.call({action:'salesOrderWorkspace'});assert.equal(workspace.canChooseSeller,true);assert.equal(workspace.sellers[0].id,workspace.currentSellerId);
 assert.ok(workspace.sellers.some(s=>s.id===f.agent.id&&s.name==='Agent A'&&s.user_id===''));
 for(const id of [inactive.id,removed.id])assert.ok(!workspace.sellers.some(s=>s.id===id)); for(const id of [f.driver.id,unrelated.id])assert.ok(workspace.sellers.some(s=>s.id===id));
 assert.equal(workspace.runs.find(run=>run.id==='run-a').salesperson_id,f.agent.id);
 await f.s.Employee.update('cashier',{role:'employee'});
 for(const actor of [{id:'cashier-login',role:'user'},{id:'cashier-login',role:'user',[FEATURE_AUTHORITY]:{module:'sales',role:'admin'}}]){
  const own=await salesOrderAction(f.client,actor,{action:'salesOrderWorkspace'});assert.equal(own.canChooseSeller,false);assert.deepEqual(own.sellers.map(s=>s.id),['cashier']);
  for(const action of ['salesOrderStock','recordSuppliedOrder'])await assert.rejects(salesOrderAction(f.client,actor,{...f.body,action,sellerId:f.agent.id}),/signed-in account/);
 }
 assert.equal((await f.s.SalesOrder.list()).length,0);
 await f.s.Dispatch.update('run-a',{salesperson_id:'cashier'});
 const ownWorkspace=await salesOrderAction(f.client,admin,{action:'salesOrderWorkspace'},{ownIssuedStock:true});assert.equal(ownWorkspace.canChooseSeller,false);assert.deepEqual(ownWorkspace.sellers.map(s=>s.id),['cashier']);
 await assert.rejects(salesOrderAction(f.client,admin,{...f.body,sellerId:f.agent.id},{ownIssuedStock:true}),/signed-in account/);
});

test('an admin recording an offline Commercial sale preserves seller, stock holder and recorder separately',async()=>{
 const f=await setup(),before=Object.fromEntries(await Promise.all(['Payment','CashCollection'].map(async entity=>[entity,await f.s[entity].list()]))),body={...f.body,sellerId:f.agent.id,sales_supply_seller_role:'admin'};
 const stock=await f.call({action:'salesOrderStock',sourceType:'issued',dispatchId:'run-a',sellerId:f.agent.id});assert.equal(stock.source.salesperson_id,f.agent.id);
 const result=await f.call(body),invoice=await f.s.Invoice.get(result.invoiceId),audit=(await f.s.AuditLog.list()).find(row=>row.action==='record_supplied_order');
 assert.equal(result.order.salesperson_id,f.agent.id);assert.equal(result.order.salesperson_name,'Agent A');assert.equal(result.order.sales_supply_seller_id,f.agent.id);assert.equal(result.order.sales_supply_stockholder_id,f.agent.id);
 assert.equal(result.order.sales_supply_recorded_by,admin.id);assert.equal(result.order.created_by,admin.id);assert.equal(invoice.salesperson_id,f.agent.id);assert.equal(invoice.recorded_by,admin.id);
 assert.equal(audit.user_id,admin.id);assert.equal(audit.sales_supply_recorded_by,admin.id);assert.equal(audit.sales_supply_seller_id,f.agent.id);assert.equal(audit.sales_supply_seller_name,'Agent A');assert.equal(audit.sales_supply_on_behalf,true);
 assert.equal(result.order.sales_supply_seller_role,'commercial');assert.equal(audit.sales_supply_seller_role,'commercial');
 assert.equal((await f.s.StockBalance.get('stock')).quantity,8);assert.equal((await f.s.JournalEntry.list()).length,1);assert.equal((await f.s.Invoice.list()).length,1);
 const [movement]=await f.s.TreasuryTransaction.list();assert.equal(movement.amount,1000);assert.equal(movement.source_document_id,invoice.id);assert.equal(movement.created_by,admin.id);
 for(const [entity,records] of Object.entries(before))assert.deepEqual(await f.s[entity].list(),records);
 await f.s.Employee.update(f.agent.id,{role:'procurement',status:'inactive',full_name:'Renamed after posting'});
 const committed=structuredClone(f.rows),retry=await f.call({...body,sales_supply_seller_role:'driver'});assert.equal(retry.reused,true);assert.equal(retry.order.sales_supply_seller_role,'commercial');assert.deepEqual(f.rows,committed);
 await assert.rejects(f.call({...body,sellerId:'cashier'}),/different supply details/);
 await assert.rejects(f.call({...body,requestKey:crypto.randomUUID()}),/active employee as the salesperson/);
});

test('on-behalf issued stock must belong to the selected seller while company and warehouse supplies remain explicit options',async()=>{
 const f=await setup(),other=await f.s.Employee.create({role:'commercial',status:'active',full_name:'Other Commercial'}),body={...f.body,sellerId:other.id};
 for(const action of ['salesOrderStock','recordSuppliedOrder'])await assert.rejects(f.call({...body,action}),/assigned to the selected salesperson/);
 assert.equal((await f.s.StockBalance.get('stock')).quantity,10);assert.equal((await f.s.SalesOrder.list()).length,0);
 for(const sourceType of ['company','warehouse']){
  const options={...body,sourceType,dispatchId:'',warehouseId:sourceType==='warehouse'?'factory':'',requestKey:crypto.randomUUID(),paymentType:'credit'};
  const preview=await f.call({...options,action:'salesOrderStock'});assert.equal(preview.source.source_type,sourceType);
  const result=await f.call(options);assert.equal(result.order.salesperson_id,other.id);assert.equal(result.order.sales_supply_recorded_by,admin.id);assert.equal(result.order.dispatch_id,'');assert.equal(result.order.sales_supply_stockholder_id,'');
 }
 assert.equal((await f.s.StockBalance.get('stock')).quantity,10);assert.equal((await f.s.StockBalance.get(f.factory.id)).quantity,16);
});

test('seller validation is fresh and accepts all registered employees while rejecting unrelated user identities',async()=>{
 const f=await setup(),custom=await f.s.Employee.create({role:'field_representative',status:'active',full_name:'Offline representative'});
 await f.s.CompanySettings.update('settings',{staff_role_catalogue:{roles:{field_representative:{key:'field_representative',template_role:'commercial',label:'Field representative',modules:['commercial']}}}});
 const workspace=await f.call({action:'salesOrderWorkspace'});assert.ok(workspace.sellers.some(s=>s.id===custom.id));
 const company={...f.body,sourceType:'company',dispatchId:''};
 for(const sellerId of ['user:another-admin','missing',true])await assert.rejects(f.call({...company,sellerId}),/active employee as the salesperson/);
 await f.s.Employee.update(custom.id,{status:'inactive'});await assert.rejects(f.call({...company,sellerId:custom.id}),/active employee as the salesperson/);
 await f.s.Employee.update(custom.id,{status:'active'});const result=await f.call({...company,sellerId:custom.id});assert.equal(result.order.salesperson_id,custom.id);assert.equal(result.order.salesperson_name,'Offline representative');assert.equal(result.order.sales_supply_seller_role,'commercial');
});

test('seller role snapshots use the principal role and ignore client or feature-elevated roles',async()=>{
 for(const principalAdmin of [true,false]){
  const f=await setup();await f.s.Employee.update('cashier',{role:'employee'});
  const actor=principalAdmin?admin:{id:'cashier-login',role:'user',[FEATURE_AUTHORITY]:{module:'sales',role:'admin'}};
  const result=await salesOrderAction(f.client,actor,{...f.body,sales_supply_seller_role:'commercial'});
  const expected=principalAdmin?'admin':'employee',audit=(await f.s.AuditLog.list()).find(row=>row.action==='record_supplied_order');
  assert.equal(result.order.sales_supply_seller_role,expected);assert.equal(audit.sales_supply_seller_role,expected);
 }
});
