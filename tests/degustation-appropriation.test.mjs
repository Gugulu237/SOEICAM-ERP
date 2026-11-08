import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {PGlite} from '@electric-sql/pglite';
import {fixture,date} from './helpers/cashier.mjs';
import {previewDegustationAppropriation,postDegustationAppropriation} from '../src/server/domain/degustation-appropriation.js';
import {postJournal,stockTransfer,stockIssue} from '../src/server/domain/field-ops.js';
import {dispatchReconciliationData,dispatchAction} from '../src/server/domain/dispatch-operations.js';
import {employeeStockAction} from '../src/server/domain/employee-stock.js';
import {FEATURE_AUTHORITY} from '../src/server/domain/roles.js';

const context={user:{id:'gm',role:'admin',email:'gm@example.test'},role:'admin'};
async function setup(db){
 const f=await fixture(db),s=f.entities;
 const create=s.AuditLog.create;s.AuditLog.create=async value=>{if(!value.id)return create(value);const row=structuredClone(value);if(db)await db.query('INSERT INTO fixture_entity VALUES($1,$2,$3)',['AuditLog',row.id,JSON.stringify(row)]);else f.rows.AuditLog.push(row);return row;};
 for(const name of ['StockBalance','StockMovement','Dispatch','DispatchLine','SalesOrder','SalesOrderLine','Invoice','InvoiceLine','JournalEntry','JournalLine'])await s[name].deleteMany({});
 await s.Employee.update('cashier',{role:'commercial',full_name:'Fixture commercial'});await s.Warehouse.update('factory',{warehouse_type:'finished_goods',is_active:true});
 const custody=await s.Warehouse.create({name:'Employee custody',warehouse_type:'commercial_custody',custodian_employee_id:'cashier',employee_delivery_custody:true,is_active:true});
 const inventoryId=(await s.PostingRule.filter({rule_key:'finished_goods_inventory'}))[0].account_id,cogsId=(await s.PostingRule.filter({rule_key:'direct_material_cogs'}))[0].account_id,revenueId=(await s.PostingRule.filter({rule_key:'sales_revenue'}))[0].account_id,receivableId=(await s.PostingRule.filter({rule_key:'customer_receivable'}))[0].account_id;
 for(const[id,type,normal]of [[inventoryId,'asset','debit'],[cogsId,'cogs','debit'],[revenueId,'revenue','credit'],[receivableId,'asset','debit']])await s.Account.update(id,{account_type:type,normal_balance:normal,balance:0,currency:'XAF'});
 const opening=await s.Account.create({account_number:'OPEN',name:'Opening equity',account_type:'equity',normal_balance:'credit',balance:0,is_active:true,is_posting:true});
 const marketing=await s.Account.create({account_number:'6970',name:'Marketing & Advertising',account_type:'expense',normal_balance:'debit',balance:0,is_active:true,is_posting:true});
 const expense=await s.Account.create({account_number:'6971',name:'Degustation',account_type:'expense',normal_balance:'debit',parent_id:marketing.id,balance:0,is_active:true,is_posting:true,currency:'XAF'});
 await s.Product.update('product-a',{inventory_account_id:inventoryId,inventory_type:'finished_product',is_active:true});
 await s.StockBalance.create({warehouse_id:'factory',product_id:'product-a',quantity:10,unit_cost:200,total_value:2000,lot_number:'LOT',qc_status:'approved'});
 await postJournal({entities:s},{entryDate:date,description:'Opening inventory',sourceModule:'opening_balances',sourceDocumentType:'OpeningBalances',sourceDocumentId:'opening',userId:'gm',lines:[{account_id:inventoryId,debit:2000,credit:0},{account_id:opening.id,debit:0,credit:2000}]});
 const dispatch=await s.Dispatch.create({dispatch_number:'DSP-LEGACY',status:'loaded',dispatch_date:date,warehouse_id:'factory',vehicle_warehouse_id:custody.id,salesperson_id:'cashier',salesperson_name:'Fixture commercial',driver_id:'',vehicle_id:'',total_loaded_value:1400});
 await s.DispatchLine.create({dispatch_id:dispatch.id,product_id:'product-a',product_name:'Product A',loaded_quantity:7,loaded_value:1400,degustation_quantity:2,returned_quantity:0});
 await stockTransfer({entities:s},{productId:'product-a',productName:'Product A',fromWarehouseId:'factory',toWarehouseId:custody.id,toWarehouseName:custody.name,quantity:7,movementType:'vehicle_load',documentType:'Dispatch',documentId:dispatch.id,movementDate:date,saleableOnly:true});
 const order=await s.SalesOrder.create({order_number:'SO-OLD',status:'invoiced',dispatch_id:dispatch.id,total:2500,amount_due:2500,amount_collected:0,payment_type:'credit'});
 await s.SalesOrderLine.create({order_id:order.id,product_id:'product-a',quantity:5,total:2500});
 const invoice=await s.Invoice.create({invoice_number:'INV-OLD',status:'posted',sales_order_id:order.id,total:2500,balance:2500});
 await stockIssue({entities:s},{productId:'product-a',productName:'Product A',warehouseId:custody.id,quantity:5,movementType:'customer_delivery',documentType:'SalesOrder',documentId:order.id,dispatchId:dispatch.id,movementDate:date,saleableOnly:true});
 const{journal}=await postJournal({entities:s},{entryDate:date,description:'Original sale',sourceModule:'sales',sourceDocumentType:'Invoice',sourceDocumentId:invoice.id,userId:'gm',lines:[{account_id:receivableId,debit:2500,credit:0},{account_id:revenueId,debit:0,credit:2500},{account_id:cogsId,debit:1000,credit:0},{account_id:inventoryId,debit:0,credit:1000}]});
 await s.Invoice.update(invoice.id,{journal_id:journal.id});await s.SalesOrder.update(order.id,{invoice_id:invoice.id});
 const body={dispatchId:dispatch.id,expenseAccountId:expense.id,date,reference:'Verified reserved promotional stock'};
 return{...f,s,dispatch,custody,inventoryId,cogsId,revenueId,receivableId,expense,marketing,body,preview:()=>previewDegustationAppropriation(s,context,body)};
}
const snapshot=async(s,names)=>Object.fromEntries(await Promise.all(names.map(async name=>[name,await s[name].list()])));
async function apiRoute(){
 const output=await build({entryPoints:['src/app/api/accounting/degustation-appropriation/route.js'],bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'appropriation-fixture',setup(builder){builder.onResolve({filter:/^@\/server\/(auth|db|entities)$/},args=>({path:args.path.split('/').at(-1),namespace:'fixture'}));builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:{auth:'export const checkOrigin=()=>{},authenticateRequest=async()=>globalThis.__dgaContext,apiError=e=>Response.json({error:e.message},{status:e.status||400});',db:'export const database=()=>({unsafe:async()=>[]}),transaction=fn=>globalThis.__dgaTx(fn);',entities:'export const serviceEntities=new Proxy({},{get:(_,key)=>globalThis.__dgaStores[key]});'}[args.path]}));}}]});
 return(await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'))).POST;
}
test('legacy appropriation expenses exact carrying value while preserving physical custody, sales and original records',async()=>{
 const f=await setup(),before=await snapshot(f.s,['StockBalance','StockMovement','JournalEntry','JournalLine','SalesOrder','Invoice','Customer','CashCollection','TreasuryTransaction']),preview=await f.preview();
 assert.equal(preview.total_quantity,2);assert.equal(preview.total_value,400);assert.equal(preview.stock_quantity_change,0);assert.equal(preview.cash_change,0);assert.equal(preview.inventory_value_change,-400);assert.equal(preview.expense_account.parent_id,f.marketing.id);assert.deepEqual(preview.journal_lines,[{account_id:f.expense.id,debit:400,credit:0},{account_id:f.inventoryId,debit:0,credit:400}]);
 const body={...f.body,token:preview.token,requestKey:crypto.randomUUID(),confirmed:true},result=await postDegustationAppropriation(f.s,context,body),balance=(await f.s.StockBalance.filter({warehouse_id:f.custody.id}))[0];
 assert.equal(balance.quantity,2);assert.equal(balance.total_value,0);assert.equal(balance.unit_cost,0);assert.equal(balance.degustation_appropriation_quantity,2);assert.equal(balance.degustation_appropriation_value,400);assert.equal(balance.degustation_appropriation_dispatch_id,f.dispatch.id);assert.equal(balance.degustation_appropriation_expense_account_id,f.expense.id);assert.equal(balance.degustation_appropriation_inventory_account_id,f.inventoryId);
 assert.equal((await f.s.Account.get(f.expense.id)).balance,400);assert.equal((await f.s.Account.get(f.inventoryId)).balance,600);assert.equal((await f.s.Account.get(f.cogsId)).balance,1000);assert.equal((await f.s.Account.get(f.revenueId)).balance,2500);
 const journal=await f.s.JournalEntry.get(result.journal_id);assert.equal(journal.source_document_type,'DegustationAppropriation');assert.equal(journal.total_debit,400);assert.equal(journal.total_credit,400);
 const movement=(await f.s.StockMovement.filter({document_type:'DegustationAppropriation'}))[0];assert.equal(movement.quantity,0);assert.equal(movement.total_value,400);assert.equal(movement.appropriation_value_only,true);
 const saved=await f.s.Dispatch.get(f.dispatch.id);assert.equal(saved.degustation_appropriation.journal_id,journal.id);assert.equal(saved.degustation_appropriation.total_quantity,2);
 const recon=await dispatchReconciliationData({entities:f.s},saved);assert.equal(recon.hasVariance,false);assert.equal(recon.rows[0].actual,2);assert.equal(recon.rows[0].degustation_given,0);assert.equal(recon.rows[0].degustation_remaining,2);
 for(const name of ['SalesOrder','Invoice','Customer','CashCollection','TreasuryTransaction'])assert.deepEqual(await f.s[name].list(),before[name]);
 for(const name of ['JournalEntry','JournalLine','StockMovement'])assert.deepEqual((await f.s[name].list()).filter(row=>before[name].some(old=>old.id===row.id)),before[name]);
 const committed=await snapshot(f.s,['Account','Dispatch','StockBalance','StockMovement','JournalEntry','JournalLine','AuditLog']);assert.equal((await postDegustationAppropriation(f.s,context,body)).reused,true);assert.deepEqual(await snapshot(f.s,Object.keys(committed)),committed);
 await assert.rejects(postDegustationAppropriation(f.s,context,{...body,requestKey:crypto.randomUUID()}),/different Dégustation appropriation/);await assert.rejects(f.preview(),/already has a Dégustation appropriation/);
});
test('authorization, marketing hierarchy, dates and account caches fail before any appropriation mutation',async()=>{
 const f=await setup(),override={user:{id:'cashier-login',role:'user'},role:'admin',employee:{role:'cashier',status:'active',[FEATURE_AUTHORITY]:{module:'accounting',role:'admin'}}};await assert.rejects(previewDegustationAppropriation(f.s,override,f.body),{status:403});
 for(const change of ['parent','type','inactive','closed','date','cache','pending-return','holder','location']){
  const g=await setup();
  if(change==='parent')await g.s.Account.update(g.expense.id,{parent_id:''});if(change==='type')await g.s.Account.update(g.expense.id,{account_type:'cogs'});if(change==='inactive')await g.s.Account.update(g.expense.id,{is_active:false});if(change==='closed')await g.s.AccountingPeriod.update('period',{status:'closed'});if(change==='date')g.body.date='2000-01-01';if(change==='cache')await g.s.Account.update(g.inventoryId,{balance:1001});if(change==='pending-return')await g.s.Dispatch.update(g.dispatch.id,{unsold_return_request_id:'return-pending'});if(change==='holder')await g.s.Employee.update('cashier',{status:'inactive'});if(change==='location')await g.s.Warehouse.update(g.custody.id,{custodian_employee_id:'someone-else'});
  const before=await snapshot(g.s,['Account','StockBalance','StockMovement','JournalEntry','JournalLine','Dispatch','AuditLog']);await assert.rejects(g.preview());assert.deepEqual(await snapshot(g.s,Object.keys(before)),before);
 }
});
test('appropriation uses separate lot carrying values despite stale unit costs and preserves quantities on every layer',async()=>{
 const f=await setup(),balance=(await f.s.StockBalance.filter({warehouse_id:f.custody.id}))[0];
 await f.s.StockBalance.update(balance.id,{quantity:1,total_value:300,unit_cost:99999});
 await f.s.StockBalance.create({...balance,id:undefined,lot_number:'SECOND',quantity:1,total_value:100,unit_cost:88888});
 const loads=(await f.s.StockMovement.list()).filter(row=>row.document_type==='Dispatch'&&row.movement_type==='vehicle_load');
 for(const move of loads){await f.s.StockMovement.update(move.id,{quantity:6,total_value:1300});await f.s.StockMovement.create({...move,id:undefined,lot_number:'SECOND',quantity:1,total_value:100});}
 const preview=await f.preview();assert.equal(preview.lots.length,2);assert.equal(preview.total_quantity,2);assert.equal(preview.total_value,400);assert.deepEqual(preview.lots.map(row=>row.value).sort((a,b)=>a-b),[100,300]);
 await postDegustationAppropriation(f.s,context,{...f.body,token:preview.token,requestKey:crypto.randomUUID(),confirmed:true});
 const marked=await f.s.StockBalance.filter({warehouse_id:f.custody.id});assert.equal(marked.reduce((sum,row)=>sum+row.quantity,0),2);assert.equal(marked.reduce((sum,row)=>sum+row.total_value,0),0);assert.equal(marked.reduce((sum,row)=>sum+row.degustation_appropriation_value,0),400);
});
test('earlier customer giveaways remain expensed and only the residual allocation is appropriated',async()=>{
 const f=await setup();await stockIssue({entities:f.s},{productId:'product-a',productName:'Product A',warehouseId:f.custody.id,quantity:1,movementType:'promotional_issue',documentType:'Degustation',documentId:'already-given',dispatchId:f.dispatch.id,movementDate:date,saleableOnly:true});
 const{journal}=await postJournal({entities:f.s},{entryDate:date,description:'Customer sample already given',sourceModule:'degustation',sourceDocumentType:'Degustation',sourceDocumentId:'already-given',userId:'gm',lines:[{account_id:'expense',debit:200,credit:0},{account_id:f.inventoryId,debit:0,credit:200}]});
 const movement=(await f.s.StockMovement.filter({document_type:'Degustation'}))[0];await f.s.StockMovement.update(movement.id,{journal_id:journal.id});
 const preview=await f.preview();assert.equal(preview.total_quantity,1);assert.equal(preview.total_value,200);
 await postDegustationAppropriation(f.s,context,{...f.body,token:preview.token,requestKey:crypto.randomUUID(),confirmed:true});
 assert.equal((await f.s.Account.get('expense')).balance,200);assert.equal((await f.s.Account.get(f.expense.id)).balance,200);assert.equal((await f.s.StockMovement.filter({document_type:'Degustation'})).length,1);
 const recon=await dispatchReconciliationData({entities:f.s},await f.s.Dispatch.get(f.dispatch.id));assert.equal(recon.hasVariance,false);assert.equal(recon.rows[0].degustation_given,1);assert.equal(recon.rows[0].degustation_remaining,1);assert.equal(recon.rows[0].actual,1);
});
test('the real appropriation markers support subsequent employee giveaway and checked warehouse return without double expense',async()=>{
 const f=await setup();await f.s.PostingRule.create({rule_key:'marketing_degustation_expense',account_id:f.expense.id,is_active:true});
 const preview=await f.preview(),body={...f.body,token:preview.token,requestKey:crypto.randomUUID(),confirmed:true};await postDegustationAppropriation(f.s,context,body);
 const count=(await f.s.JournalEntry.list()).length;
 await employeeStockAction(f.client,{id:'cashier-login',role:'user'},{action:'recordDegustation',dispatchId:f.dispatch.id,customerId:'customer-a',date,requestKey:crypto.randomUUID(),lines:[{product_id:'product-a',quantity:1}],notes:'Actual customer sample after appropriation'});
 assert.equal((await f.s.JournalEntry.list()).length,count);assert.equal((await f.s.Account.get(f.expense.id)).balance,400);
 const remaining=(await f.s.StockBalance.filter({warehouse_id:f.custody.id}))[0];assert.equal(remaining.quantity,1);assert.equal(remaining.degustation_appropriation_quantity,1);assert.equal(remaining.degustation_appropriation_value,200);assert.equal(remaining.total_value,0);
 await dispatchAction(f.client,context.user,{action:'returnDispatchStock',dispatchId:f.dispatch.id,countedLines:[{product_id:'product-a',quantity:1}]});
 assert.equal((await f.s.Account.get(f.expense.id)).balance,200);assert.equal((await f.s.Account.get(f.inventoryId)).balance,800);assert.equal((await f.s.Account.get(f.cogsId)).balance,1000);
 const recon=await dispatchReconciliationData({entities:f.s},await f.s.Dispatch.get(f.dispatch.id));assert.equal(recon.hasVariance,false);assert.equal(recon.degustationCost,200);assert.equal(recon.rows[0].actual,0);assert.equal(recon.rows[0].degustation_given,1);assert.equal(recon.rows[0].degustation_returned,1);
 assert.equal((await postDegustationAppropriation(f.s,context,body)).reused,true);
});
test('remaining sale stock, count variance, changed lot value and incomplete original load or journal evidence block appropriation',async()=>{
 for(const change of ['sale-stock','variance','value','missing-value','missing-movement-value','load','source-leg','source-journal','pending-movement','expired','marked','overlap']){
  const f=await setup(),balance=(await f.s.StockBalance.filter({warehouse_id:f.custody.id}))[0],line=(await f.s.DispatchLine.filter({dispatch_id:f.dispatch.id}))[0];
  if(change==='sale-stock')await f.s.DispatchLine.update(line.id,{degustation_quantity:1});if(change==='variance')await f.s.StockBalance.update(balance.id,{quantity:3});if(change==='value')await f.s.StockBalance.update(balance.id,{total_value:401});if(change==='load')await f.s.DispatchLine.update(line.id,{loaded_value:1401});
  if(change==='missing-value')await f.s.StockBalance.update(balance.id,{total_value:null});if(change==='missing-movement-value'){const load=(await f.s.StockMovement.list()).find(row=>row.source_warehouse_id==='factory');await f.s.StockMovement.update(load.id,{total_value:null});}
  if(change==='source-leg'){const load=(await f.s.StockMovement.list()).find(row=>row.source_warehouse_id==='factory');await f.s.StockMovement.update(load.id,{total_value:1401});}
  if(change==='source-journal'){const journal=(await f.s.JournalEntry.list()).find(row=>row.source_document_type==='Invoice');await f.s.JournalEntry.update(journal.id,{total_credit:3501});}
  if(change==='pending-movement')await f.s.StockMovement.create({product_id:'product-a',source_warehouse_id:f.custody.id,dispatch_id:f.dispatch.id,document_type:'Degustation',document_id:'pending',movement_type:'promotional_issue',quantity:1,total_value:200,status:'pending',movement_date:date});
  if(change==='expired')await f.s.StockBalance.update(balance.id,{expiry_date:'2000-01-01'});if(change==='marked')await f.s.StockBalance.update(balance.id,{degustation_appropriation_id:'old'});if(change==='overlap')await f.s.Dispatch.create({...f.dispatch,id:undefined,dispatch_number:'OTHER'});
  const before=await snapshot(f.s,['Account','StockBalance','StockMovement','JournalEntry','JournalLine','Dispatch','AuditLog']);await assert.rejects(f.preview());assert.deepEqual(await snapshot(f.s,Object.keys(before)),before,change);
 }
});
test('review token binds quantities, cost evidence, accounts and reference; confirmation is required',async()=>{
 for(const change of ['account','reference','unrelated-ledger']){
  const f=await setup(),preview=await f.preview(),body={...f.body,token:preview.token,requestKey:crypto.randomUUID(),confirmed:true};
  if(change==='account')await f.s.Account.update(f.expense.id,{name:'Changed expense'});if(change==='reference')body.reference='Changed evidence';if(change==='unrelated-ledger')await f.s.JournalEntry.create({entry_date:date,status:'draft',description:'New review'});
  await assert.rejects(postDegustationAppropriation(f.s,context,body),/changed/);
 }
 const f=await setup(),preview=await f.preview();await assert.rejects(postDegustationAppropriation(f.s,context,{...f.body,token:preview.token,requestKey:crypto.randomUUID(),confirmed:false}),/Preview and confirm/);
});
test('blocked lot diagnostics expose exact identity and deltas only after original cost journals verify',async()=>{
 const f=await setup(),balance=(await f.s.StockBalance.filter({warehouse_id:f.custody.id}))[0];
 await f.s.StockBalance.update(balance.id,{total_value:401});
 let error;try{await f.preview();}catch(caught){error=caught;}
 assert.equal(error?.status,409);assert.match(error.message,/remaining lot quantities or carrying values/);
 const diagnostic=error.degustation_appropriation_diagnostics;assert.equal(diagnostic.dispatch_id,f.dispatch.id);assert.equal(diagnostic.stock_warehouse_id,f.custody.id);assert.equal(diagnostic.source_journals_verified,true);assert.equal(diagnostic.source_journals.length,1);assert.equal(diagnostic.source_journals[0].inventory_cost,1000);
 assert.deepEqual(diagnostic.mismatches.map(row=>({product_id:row.product_id,lot_number:row.lot_number,expiry_date:row.expiry_date,qc_status:row.qc_status,production_order_id:row.production_order_id,batch_number:row.batch_number,balance_ids:row.balance_ids,loaded_quantity:row.loaded_quantity,loaded_value:row.loaded_value,released_quantity:row.released_quantity,released_value:row.released_value,expected_quantity:row.expected_quantity,expected_value:row.expected_value,current_quantity:row.current_quantity,current_value:row.current_value,quantity_delta:row.quantity_delta,value_delta:row.value_delta})),[{product_id:'product-a',lot_number:'LOT',expiry_date:'',qc_status:'approved',production_order_id:'',batch_number:'',balance_ids:[balance.id],loaded_quantity:7,loaded_value:1400,released_quantity:5,released_value:1000,expected_quantity:2,expected_value:400,current_quantity:2,current_value:401,quantity_delta:0,value_delta:1}]);
 assert.deepEqual(diagnostic.mismatches[0].current_unit_costs,[200]);assert.equal(diagnostic.mismatches[0].load_movement_ids.length,1);assert.equal(diagnostic.mismatches[0].issue_movement_ids.length,1);
 // A provenance discrepancy produces two separate identities; it must never
 // disappear through a product-only quantity total.
 await f.s.StockBalance.update(balance.id,{total_value:400,production_order_id:'changed-origin',batch_number:'changed-batch'});
 try{await f.preview();}catch(caught){error=caught;}
 assert.equal(error.degustation_appropriation_diagnostics.mismatches.length,2);assert.ok(error.degustation_appropriation_diagnostics.mismatches.some(row=>row.production_order_id==='changed-origin'&&row.batch_number==='changed-batch'&&row.quantity_delta===2&&row.value_delta===400));assert.ok(error.degustation_appropriation_diagnostics.mismatches.some(row=>row.production_order_id===''&&row.quantity_delta===-2&&row.value_delta===-400));
 const journal=(await f.s.JournalEntry.list()).find(row=>row.source_document_type==='Invoice');await f.s.JournalEntry.update(journal.id,{total_debit:3501});
 await assert.rejects(f.preview(),caught=>{assert.match(caught.message,/original sale and stock journals/);assert.equal(caught.degustation_appropriation_diagnostics,undefined);return true;});
});
test('duplicate ledger-bearing source journals block appropriation even when their account caches agree with the ledger',async()=>{
 const f=await setup(),original=(await f.s.JournalEntry.list()).find(row=>row.source_document_type==='Invoice'),duplicate=await f.s.JournalEntry.create({...original,id:undefined,journal_number:'JV-DUPLICATE'});
 for(const line of await f.s.JournalLine.filter({journal_id:original.id})){
  await f.s.JournalLine.create({...line,id:undefined,journal_id:duplicate.id});
  const account=await f.s.Account.get(line.account_id),delta=account.normal_balance==='debit'?line.debit-line.credit:line.credit-line.debit;await f.s.Account.update(account.id,{balance:Number(account.balance)+delta});
 }
 const before=await snapshot(f.s,['Account','StockBalance','StockMovement','JournalEntry','JournalLine','Dispatch','AuditLog']);
 await assert.rejects(f.preview(),error=>{assert.match(error.message,/original sale and stock journals/);assert.equal(error.degustation_appropriation_diagnostics,undefined);return true;});assert.deepEqual(await snapshot(f.s,Object.keys(before)),before);
});

test('API mismatch diagnostics remain admin-only and never permit a blocked appropriation post',async()=>{
 const f=await setup(),route=await apiRoute(),preview=await f.preview(),body={action:'post',...f.body,token:preview.token,requestKey:crypto.randomUUID(),confirmed:true},balance=(await f.s.StockBalance.filter({warehouse_id:f.custody.id}))[0];await f.s.StockBalance.update(balance.id,{total_value:401});
 const before=await snapshot(f.s,['Account','StockBalance','StockMovement','JournalEntry','JournalLine','Dispatch','AuditLog']);
 globalThis.__dgaStores=f.s;globalThis.__dgaTx=fn=>fn();
 try{
  const call=body=>route(new Request('http://localhost/api/accounting/degustation-appropriation',{method:'POST',body:JSON.stringify(body)}));
  globalThis.__dgaContext={user:{id:'cashier-login',role:'user'},role:'admin',employee:{role:'cashier',status:'active',[FEATURE_AUTHORITY]:{module:'accounting',role:'admin'}}};
  let response=await call({action:'preview',...f.body});assert.equal(response.status,403);assert.equal((await response.json()).diagnostics,undefined);
  globalThis.__dgaContext=context;
  for(const input of [{action:'preview',...f.body},body]){response=await call(input);assert.equal(response.status,409);assert.equal(response.headers.get('Cache-Control'),'private, no-store');const result=await response.json();assert.equal(result.token,undefined);assert.equal(result.diagnostics.source_journals_verified,true);assert.equal(result.diagnostics.mismatches[0].value_delta,1);}
  assert.deepEqual(await snapshot(f.s,Object.keys(before)),before);
 }finally{delete globalThis.__dgaContext;delete globalThis.__dgaStores;delete globalThis.__dgaTx;}
});
test('the actual API transaction rolls back a late audit failure and identical retry commits one appropriation',async()=>{
 const db=new PGlite();try{
  const f=await setup(db),route=await apiRoute();
  globalThis.__dgaContext=context;globalThis.__dgaStores=f.s;globalThis.__dgaTx=async fn=>{await db.exec('BEGIN');try{const result=await fn();await db.exec('COMMIT');return result;}catch(error){await db.exec('ROLLBACK');throw error;}};
  const preview=await f.preview(),body={action:'post',...f.body,token:preview.token,requestKey:crypto.randomUUID(),confirmed:true},call=()=>route(new Request('http://localhost/api/accounting/degustation-appropriation',{method:'POST',body:JSON.stringify(body)}));
  const names=['Account','StockBalance','StockMovement','JournalEntry','JournalLine','Dispatch','AuditLog'],before=await snapshot(f.s,names),create=f.s.AuditLog.create;let failed=true;
  f.s.AuditLog.create=async value=>{if(failed&&value.action==='appropriate_reserved_degustation')throw Error('Simulated appropriation audit failure');return create(value);};
  let response=await call();assert.equal(response.status,400);assert.match((await response.json()).error,/Simulated appropriation audit failure/);assert.deepEqual(await snapshot(f.s,names),before);
  failed=false;response=await call();assert.equal(response.status,200,JSON.stringify(await response.clone().json()));const result=await response.json();assert.ok(result.journal_id);assert.equal((await(await call()).json()).reused,true);assert.equal((await f.s.JournalEntry.filter({source_document_type:'DegustationAppropriation'})).length,1);assert.equal((await f.s.StockMovement.filter({document_type:'DegustationAppropriation'})).length,1);
 }finally{delete globalThis.__dgaContext;delete globalThis.__dgaStores;delete globalThis.__dgaTx;await db.close();}
});
