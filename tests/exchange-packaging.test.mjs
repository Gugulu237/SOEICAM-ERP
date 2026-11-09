import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {fixture,functionRoute,request,date} from './helpers/cashier.mjs';
import {salesOrderAction} from '../src/server/domain/sales-orders.js';
import {saleReversalAction} from '../src/server/domain/sale-reversals.js';
import {distributionControlAction} from '../src/server/domain/distribution-control.js';
import {employeeStockAction} from '../src/server/domain/employee-stock.js';
import {unsoldStockReturnAction} from '../src/server/domain/unsold-stock-returns.js';
import {expiryRecoveryAction} from '../src/server/domain/expiry-recovery.js';
import {recoverSaleExchangePackaging} from '../src/server/domain/exchange-packaging.js';
import {exchangePackagingEnabled} from '../src/lib/exchange-packaging.js';
import {guardMutation} from '../src/server/access.js';

const gm={id:'gm',role:'admin',full_name:'General Manager'};
async function setup(db){
 const f=await fixture(db),s=f.entities;f.client.auth.me=async()=>gm;
 for(const name of ['Warehouse','AuditLog']){const create=s[name].create;s[name].create=async value=>{if(!value.id)return create(value);const row=structuredClone(value);if(db)await db.query('INSERT INTO fixture_entity VALUES($1,$2,$3)',[name,row.id,JSON.stringify(row)]);else {assert.ok(!f.rows[name].some(r=>r.id===row.id));f.rows[name].push(row);}return structuredClone(row);};}
 await s.CompanySettings.update('settings',{company_name:'SOEICAM',next_invoice_number:1});
 await s.Employee.update('cashier',{role:'employee'});
 await s.Warehouse.update('factory',{warehouse_type:'finished_goods'});
 const factory=await s.StockBalance.create({warehouse_id:'factory',product_id:'product-a',quantity:20,total_value:4000,unit_cost:200,qc_status:'approved',lot_number:'FRESH'});
 const cup=await s.Product.create({name:'Yogurt cup 500g',inventory_type:'inventory_part',material_group:'Packaging',unit_of_measure:'ea',is_active:true,configuration_status:'ready'});
 const lid=await s.Product.create({name:'Lid 500g',inventory_type:'packaging',unit_of_measure:'ea',is_active:true});
 const sticker=await s.Product.create({name:'YOLA sticker',inventory_type:'packaging',unit_of_measure:'ea',is_active:true});
 const carton=await s.Product.create({name:'Shipping carton',inventory_type:'packaging',unit_of_measure:'ea',is_active:true});
 await s.Product.update('product-a',{components:[cup,lid,sticker,carton].map(p=>({component_type:'product',product_id:p.id,quantity:1,unit:'ea'}))});
 const body={action:'recordSuppliedOrder',sourceType:'warehouse',warehouseId:'factory',customerId:'customer-a',sellerId:'cashier',requestKey:crypto.randomUUID(),date,paymentType:'exchange',receiptReference:'EXCHANGE-1',expectedTotal:0,lines:[],replacementsDeclared:true,stockReplacements:[{product_id:'product-a',quantity:2,reason:'expired',expiry_date:'2020-01-01'}]};
 return {...f,s,factory,cup,lid,sticker,carton,body,call:input=>salesOrderAction(f.client,gm,input)};
}
const recovered=s=>s.StockBalance.filter({inventory_recovery_source:'sale_exchange'});

test('exchanges recover only mapped containers at zero value, consume returned contents once, and preserve replacement accounting',async()=>{
 const f=await setup(),result=await f.call(f.body),rows=await recovered(f.s),record=(await f.s.SpoilageRecord.list())[0];
 assert.equal(result.exchangeOnly,true);assert.equal(rows.length,1);assert.equal(rows[0].product_id,f.cup.id);assert.equal(rows[0].quantity,2);assert.equal(rows[0].total_value,0);assert.equal(rows[0].qc_status,'quarantine');assert.ok(rows[0].inventory_recovery_received_at);
 const source=await f.s.StockBalance.get(record.exchange_packaging_result.source_balance_id);assert.equal(source.quantity,0);assert.equal(source.total_value,0);assert.equal((await f.s.StockBalance.get(f.factory.id)).quantity,18);
 const journals=await f.s.JournalEntry.list();assert.equal(journals.length,1);assert.equal(journals[0].source_document_type,'SpoilageRecord');assert.equal((await f.s.Account.get('cogs')).balance,0);assert.equal((await f.s.Account.filter({account_number:'CUSTOMER-REPLACEMENTS'}))[0].balance,400);assert.equal((await f.s.Account.get('revenue')).balance,0);assert.equal((await f.s.Customer.get('customer-a')).balance,0);
 const state=await expiryRecoveryAction(f.client,gm,{action:'workspace'});assert.ok(state.held.some(row=>row.id===rows[0].id));assert.ok(!state.lots.some(row=>row.id===source.id));
 const before=structuredClone(f.rows);assert.equal((await f.call(f.body)).reused,true);assert.deepEqual(f.rows,before);
 await f.call({...f.body,requestKey:crypto.randomUUID(),stockReplacements:[{...f.body.stockReplacements[0],quantity:1}]});assert.equal((await recovered(f.s)).reduce((n,b)=>n+b.quantity,0),3);assert.equal((await f.s.StockBalance.get(f.factory.id)).quantity,17);assert.equal((await f.s.JournalEntry.list()).length,2);
});

test('original production materials determine recovered quantity after the current assembly changes',async()=>{
 const f=await setup(),order=await f.s.ProductionOrder.create({product_id:'product-a',batch_number:'OLD-BATCH',status:'completed',actual_output:10});
 await f.s.ProductionMaterial.create({production_order_id:order.id,material_id:f.cup.id,consumed_quantity:20,issued_quantity:30,unit:'each'});
 await f.s.ProductionMaterial.create({production_order_id:order.id,material_id:f.lid.id,consumed_quantity:20,unit:'ea'});
 await f.s.Product.update('product-a',{components:[{product_id:f.cup.id,quantity:99,unit:'ea'}]});
 await f.call({...f.body,stockReplacements:[{...f.body.stockReplacements[0],lot_number:'OLD-BATCH'}]});
 assert.equal((await recovered(f.s))[0].quantity,4);const record=(await f.s.SpoilageRecord.list())[0];assert.equal(record.exchange_packaging_result.production_order_id,order.id);assert.equal(record.exchange_packaging_result.quantity_basis,'original production material quantities');
});

test('explicit component preferences exclude standard containers and include only an intentional packaging override',async()=>{
 const f=await setup();await f.s.Product.update('product-a',{components:[{product_id:f.cup.id,quantity:1,unit:'ea',recover_on_exchange:false},{product_id:f.lid.id,quantity:1,unit:'ea',recover_on_exchange:true}]});
 await f.call(f.body);assert.deepEqual((await recovered(f.s)).map(b=>[b.product_id,b.quantity]),[[f.lid.id,2]]);
 assert.equal(exchangePackagingEnabled({recover_on_exchange:true},{inventory_type:'assembly',name:'Cup yogurt'}),false);
});

test('missing, ambiguous and incompatible container mappings warn without blocking sale or inventing stock',async()=>{
 for(const scenario of ['missing','units','ambiguous']){
  const f=await setup();let input=f.body;
  if(scenario==='missing')await f.s.Product.update('product-a',{components:[]});
  if(scenario==='units')await f.s.Product.update('product-a',{components:[{product_id:f.cup.id,quantity:1,unit:'kg'}]});
  if(scenario==='ambiguous'){for(let n=0;n<2;n++)await f.s.ProductionOrder.create({product_id:'product-a',batch_number:'OLD',status:'completed',actual_output:10});input={...f.body,stockReplacements:[{...f.body.stockReplacements[0],lot_number:'OLD'}]};}
  const result=await f.call(input),record=(await f.s.SpoilageRecord.list())[0];assert.equal((await recovered(f.s)).length,0);assert.equal(result.order.exchange_packaging_warnings.length,1);assert.equal(record.exchange_packaging_result.warnings.length,1);assert.equal((await f.s.StockBalance.filter({lot_number:'ER-'+record.id}))[0].quantity,2);assert.equal((await f.s.StockBalance.get(f.factory.id)).quantity,18);
  await f.s.Product.update('product-a',{components:[{product_id:f.cup.id,quantity:1,unit:'ea'}]});
  const retry=await recoverSaleExchangePackaging(f.client.asServiceRole,{record,product:await f.s.Product.get('product-a'),warehouse:await f.s.Warehouse.get(record.collection_warehouse_id),date,user:gm});assert.equal(retry.reused,true);assert.equal((await recovered(f.s)).length,0,'later mapping changes never backfill history');
 }
});

test('employee exchanges without a vehicle remain unreceived until counted request and warehouse acceptance, then QC releases exact packaging',async()=>{
 const f=await setup(),actor={id:'cashier-login',role:'user'};
 await f.s.Dispatch.deleteMany({});await f.s.DispatchLine.deleteMany({});
 const {dispatch}=await distributionControlAction(f.client,gm,{action:'issueDistributionStock',commercialId:'cashier',driverId:'',vehicleId:'',warehouseId:'factory',requestKey:crypto.randomUUID(),lines:[{product_id:'product-a',quantity:5}],date});
 const input={...f.body,action:'employeeRecordSupply',sourceType:'issued',warehouseId:undefined,dispatchId:dispatch.id,sellerId:undefined};await employeeStockAction(f.client,actor,input);
 const record=(await f.s.SpoilageRecord.list())[0],held=(await recovered(f.s))[0],bin=await f.s.Warehouse.get(record.collection_warehouse_id);
 assert.equal(bin.field_return_bin,true);assert.ok(!record.return_received_at);assert.ok(!held.inventory_recovery_received_at);
 await assert.rejects(expiryRecoveryAction(f.client,gm,{action:'receive',balanceId:held.id,quantity:2,reference:'Counted',inspectionConfirmed:true}),/awaiting warehouse receipt/);
 await assert.rejects(expiryRecoveryAction(f.client,gm,{action:'release',balanceId:held.id,reference:'Inspected',inspectionConfirmed:true}),/recovered packaging lot/);
 const workspace=await unsoldStockReturnAction(f.client,actor,{action:'unsoldReturnWorkspace'}),run=workspace.runs[0];assert.equal(run.error,'');assert.equal(run.rows[0].quantity,3);assert.deepEqual(run.collections.map(r=>[r.product_name,r.quantity]),[[f.cup.name,2]]);
 const counts=run.rows.map(({product_id,quantity})=>({product_id,quantity}));
 const pending=await unsoldStockReturnAction(f.client,actor,{action:'requestUnsoldReturn',dispatchId:run.id,token:run.token,countedLines:counts,confirmed:true,requestKey:crypto.randomUUID()});assert.equal((await f.s.StockBalance.get(held.id)).quantity,2);assert.ok(!(await f.s.StockBalance.get(held.id)).inventory_recovery_received_at);
 const accept={action:'receiveUnsoldReturn',requestId:pending.request.id,token:pending.request.token,countedLines:counts,confirmed:true};await unsoldStockReturnAction(f.client,gm,accept);assert.equal((await unsoldStockReturnAction(f.client,gm,accept)).reused,true);
 const returned=(await recovered(f.s)).filter(b=>b.quantity>0);assert.equal(returned.length,1);assert.equal(returned[0].quantity,2);assert.equal(returned[0].total_value,0);assert.equal(returned[0].qc_status,'quarantine');assert.ok(returned[0].inventory_recovery_received_at);assert.equal(returned[0].inventory_recovery_return_dispatch_id,dispatch.id);assert.equal((await f.s.StockBalance.get(held.id)).quantity,0);
 assert.ok((await f.s.SpoilageRecord.get(record.id)).return_received_at);assert.equal((await f.s.JournalEntry.list()).length,1);
 await expiryRecoveryAction(f.client,gm,{action:'release',balanceId:returned[0].id,reference:'QC passed',inspectionConfirmed:true});assert.equal((await f.s.StockBalance.get(returned[0].id)).qc_status,'approved');
});

test('reversing the paid-product sale leaves separate exchange recovery and replacement cost intact',async()=>{
 const f=await setup(),result=await f.call({...f.body,paymentType:'credit',expectedTotal:500,lines:[{product_id:'product-a',quantity:1,unit_price:500,discount_pct:0}]}),before=await recovered(f.s),record=(await f.s.SpoilageRecord.list())[0];
 const input={invoiceId:result.invoiceId},preview=await saleReversalAction(f.client,gm,{action:'previewSaleReversal',...input});assert.equal(preview.can_restore_stock,true);assert.equal(preview.items[0].quantity,1);
 await saleReversalAction(f.client,gm,{action:'reverseSale',...input,reviewToken:preview.reviewToken,reason:'Customer returned purchased item',stockDisposition:'return_stock',warehouseId:'factory',confirmed:true});
 assert.deepEqual(await recovered(f.s),before);assert.equal((await f.s.StockBalance.get(record.exchange_packaging_result.source_balance_id)).quantity,0);assert.equal((await f.s.StockBalance.filter({stock_origin:'sale_reversal'}))[0].quantity,1);assert.equal((await f.s.Account.get('cogs')).balance,0);assert.equal((await f.s.Account.filter({account_number:'CUSTOMER-REPLACEMENTS'}))[0].balance,400,'fresh no-charge replacements retain their actual expense');assert.equal((await f.s.SpoilageRecord.get(record.id)).status,'replaced');
});

test('generic entity API cannot forge exchange recovery results or quantities',()=>{
 for(const entity of ['SpoilageRecord','SalesOrder','FieldSale','StockBalance','AuditLog'])assert.throws(()=>guardMutation({user:gm,role:'admin'},entity,'update',{exchange_packaging_result:{recovered:[]}},{}),/checked.*workflow/);
});

test('late packaging audit failure rolls back stock, replacement cost and source documents; identical retry commits once',async()=>{
 const db=new PGlite();try{
  const f=await setup(db),route=await functionRoute(),create=f.s.AuditLog.create;globalThis.__cashierClient=f.client;globalThis.__cashierTransaction=async fn=>{await db.exec('BEGIN');try{const result=await fn();await db.exec('COMMIT');return result;}catch(e){await db.exec('ROLLBACK');throw e;}};
  f.s.AuditLog.create=async value=>{if(value.action==='recover_sale_exchange_packaging')throw Error('Late recovery audit failure');return create(value);};
  const before=(await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows,response=await route(request(f.body),{params:Promise.resolve({name:'fieldOps'})});assert.equal(response.status,400);assert.match((await response.json()).error,/Late recovery audit failure/);assert.deepEqual((await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows,before);
  f.s.AuditLog.create=create;const success=await route(request(f.body),{params:Promise.resolve({name:'fieldOps'})});assert.equal(success.status,200,JSON.stringify(await success.json()));const retry=await route(request(f.body),{params:Promise.resolve({name:'fieldOps'})});assert.equal(retry.status,200);assert.equal((await retry.json()).reused,true);assert.equal((await recovered(f.s)).length,1);assert.equal((await f.s.JournalEntry.list()).length,1);
 }finally{delete globalThis.__cashierClient;delete globalThis.__cashierTransaction;await db.close();}
});
