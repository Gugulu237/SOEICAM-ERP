import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {PGlite} from '@electric-sql/pglite';
import {fixture,date} from './helpers/cashier.mjs';
import {previewDegustationAppropriation,postDegustationAppropriation} from '../src/server/domain/degustation-appropriation.js';
import {postJournal} from '../src/server/domain/field-ops.js';
import {dispatchAction,dispatchReconciliationData} from '../src/server/domain/dispatch-operations.js';
import {employeeStockAction} from '../src/server/domain/employee-stock.js';

const context={user:{id:'gm',role:'admin',email:'gm@example.test'},role:'admin'};
const money=value=>Math.round(value*100)/100;
const entityNames=['Account','StockBalance','StockMovement','JournalEntry','JournalLine','Dispatch','AuditLog'];
const snapshot=async(s,names=entityNames)=>Object.fromEntries(await Promise.all(names.map(async name=>[name,await s[name].list()])));

// These records reproduce a historical rounded-CPU issuer, rather than using
// today's issuer to generate its own expected historical evidence.
async function historicalFixture({db,partialValue=14.03,exhaustedValue=6.01,partialLoaded=7,partialSold=5,partialCPU=2,costAccountOverride}={}){
 const f=await fixture(db),s=f.entities;
 const create=s.AuditLog.create;s.AuditLog.create=async value=>{if(!value.id)return create(value);const row=structuredClone(value);if(db)await db.query('INSERT INTO fixture_entity VALUES($1,$2,$3)',['AuditLog',row.id,JSON.stringify(row)]);else f.rows.AuditLog.push(row);return row;};
 for(const name of ['StockBalance','StockMovement','Dispatch','DispatchLine','SalesOrder','SalesOrderLine','Invoice','InvoiceLine','JournalEntry','JournalLine'])await s[name].deleteMany({});
 await s.Employee.update('cashier',{role:'commercial',full_name:'Fixture commercial'});await s.Warehouse.update('factory',{warehouse_type:'finished_goods',is_active:true});
 const custody=await s.Warehouse.create({name:'Historical employee custody',warehouse_type:'commercial_custody',custodian_employee_id:'cashier',employee_delivery_custody:true,is_active:true});
 const inventoryId=(await s.PostingRule.filter({rule_key:'finished_goods_inventory'}))[0].account_id,cogsId=(await s.PostingRule.filter({rule_key:'direct_material_cogs'}))[0].account_id,revenueId=(await s.PostingRule.filter({rule_key:'sales_revenue'}))[0].account_id,receivableId=(await s.PostingRule.filter({rule_key:'customer_receivable'}))[0].account_id;
 for(const[id,type,normal]of [[inventoryId,'asset','debit'],[cogsId,'cogs','debit'],[revenueId,'revenue','credit'],[receivableId,'asset','debit']])await s.Account.update(id,{account_type:type,normal_balance:normal,balance:0,currency:'XAF'});
 const opening=await s.Account.create({account_number:'OPEN',name:'Opening equity',account_type:'equity',normal_balance:'credit',balance:0,is_active:true,is_posting:true});
 const marketing=await s.Account.create({account_number:'6970',name:'Marketing & Advertising',account_type:'expense',normal_balance:'debit',balance:0,is_active:true,is_posting:true});
 const expense=await s.Account.create({account_number:'6971',name:'Degustation',account_type:'expense',normal_balance:'debit',parent_id:marketing.id,balance:0,is_active:true,is_posting:true,currency:'XAF'});
 await s.Product.update('product-a',{inventory_account_id:inventoryId,cogs_account_id:cogsId,inventory_type:'finished_product',is_active:true});
 const exhaustedValues=exhaustedValue===null?[]:Array.isArray(exhaustedValue)?exhaustedValue:[exhaustedValue];
 const partialRemaining=Math.round((partialLoaded-partialSold)*1000)/1000,partialLegacy=money(partialRemaining*partialCPU),partialReleased=money(partialSold*partialCPU),loadedQty=partialLoaded+exhaustedValues.length*3,soldQty=partialSold+exhaustedValues.length*3,loadValue=money(partialValue+exhaustedValues.reduce((sum,value)=>sum+value,0)),releasedValue=money(partialReleased+exhaustedValues.length*6);
 await postJournal({entities:s},{entryDate:date,description:'Historical opening inventory',sourceModule:'opening_balances',sourceDocumentType:'OpeningBalances',sourceDocumentId:'rounding-opening',userId:'gm',lines:[{account_id:inventoryId,debit:loadValue,credit:0},{account_id:opening.id,debit:0,credit:loadValue}]});
 const dispatch=await s.Dispatch.create({dispatch_number:'DSP-ROUNDED',status:'loaded',dispatch_date:date,warehouse_id:'factory',vehicle_warehouse_id:custody.id,salesperson_id:'cashier',salesperson_name:'Fixture commercial',driver_id:'',vehicle_id:'',total_loaded_value:loadValue});
 await s.DispatchLine.create({dispatch_id:dispatch.id,product_id:'product-a',product_name:'Product A',loaded_quantity:loadedQty,loaded_value:loadValue,degustation_quantity:partialRemaining,returned_quantity:0});
 const order=await s.SalesOrder.create({order_number:'SO-ROUNDED',status:'invoiced',dispatch_id:dispatch.id,total:2500,amount_due:2500,amount_collected:0,payment_type:'credit'});
 await s.SalesOrderLine.create({order_id:order.id,product_id:'product-a',quantity:soldQty,total:2500});
 const invoice=await s.Invoice.create({invoice_number:'INV-ROUNDED',status:'posted',sales_order_id:order.id,total:2500,balance:2500});
 const lotSpecs=[{lot:'PARTIAL',loaded:partialLoaded,receipt:partialValue,sold:partialSold,released:partialReleased,remaining:partialRemaining,cpu:partialCPU,cache:partialLegacy},...exhaustedValues.map((value,index)=>({lot:exhaustedValues.length===1?'EXHAUSTED':'EXHAUSTED-'+(index+1),loaded:3,receipt:value,sold:3,released:6,remaining:0,cpu:2,cache:0}))];
 const balances=[],receipts=[],issues=[];
 for(const spec of lotSpecs){
  const identity={product_id:'product-a',product_name:'Product A',lot_number:spec.lot,qc_status:'approved',production_order_id:'historical-production',batch_number:'historical-batch'};
  balances.push(await s.StockBalance.create({...identity,warehouse_id:custody.id,quantity:spec.remaining,total_value:spec.cache,unit_cost:spec.cpu}));
  const load={...identity,quantity:spec.loaded,unit_cost:spec.cpu,total_value:spec.receipt,movement_type:'vehicle_load',document_type:'Dispatch',document_id:dispatch.id,dispatch_id:dispatch.id,movement_date:date,status:'approved'};
  await s.StockMovement.create({...load,source_warehouse_id:'factory'});
  receipts.push(await s.StockMovement.create({...load,destination_warehouse_id:custody.id}));
  issues.push(await s.StockMovement.create({...identity,source_warehouse_id:custody.id,quantity:spec.sold,unit_cost:spec.cpu,total_value:spec.released,movement_type:'customer_delivery',document_type:'SalesOrder',document_id:order.id,dispatch_id:dispatch.id,movement_date:date,status:'approved'}));
 }
 const{journal}=await postJournal({entities:s},{entryDate:date,description:'Original rounded sale',sourceModule:'sales',sourceDocumentType:'Invoice',sourceDocumentId:invoice.id,userId:'gm',lines:[{account_id:receivableId,debit:2500,credit:0},{account_id:revenueId,debit:0,credit:2500},{account_id:costAccountOverride||cogsId,debit:releasedValue,credit:0},{account_id:inventoryId,debit:0,credit:releasedValue}]});
 await s.Invoice.update(invoice.id,{journal_id:journal.id});await s.SalesOrder.update(order.id,{invoice_id:invoice.id});
 const body={dispatchId:dispatch.id,expenseAccountId:expense.id,date,reference:'Verified historical rounded unit costs',roundingReviewPolicy:'verified-legacy-rounded-unit-cost-v1'};
 return{...f,s,dispatch,custody,inventoryId,cogsId,revenueId,receivableId,expense,body,balances,receipts,issues,journal,loadValue,releasedValue,preview:()=>previewDegustationAppropriation(s,context,body)};
}

async function apiRoute(){
 const output=await build({entryPoints:['src/app/api/accounting/degustation-appropriation/route.js'],bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'rounding-fixture',setup(builder){builder.onResolve({filter:/^@\/server\/(auth|db|entities)$/},args=>({path:args.path.split('/').at(-1),namespace:'fixture'}));builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:{auth:'export const checkOrigin=()=>{},authenticateRequest=async()=>globalThis.__roundingContext,apiError=e=>Response.json({error:e.message},{status:e.status||400});',db:'export const database=()=>({unsafe:async()=>[]}),transaction=fn=>globalThis.__roundingTx(fn);',entities:'export const serviceEntities=new Proxy({},{get:(_,key)=>globalThis.__roundingStores[key]});'}[args.path]}));}}]});
 return(await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'))).POST;
}

test('verified historical rounding separates exhausted COGS residue from promotional value and cache-only repair',async()=>{
 for(const [partialValue,exhaustedValue,cacheChange,cogsChange,marketingValue,inventoryChange]of [[14.03,6.01,0.03,0.01,4.03,-4.04],[13.97,5.99,-0.03,-0.01,3.97,-3.96]]){
  const f=await historicalFixture({partialValue,exhaustedValue}),before=await snapshot(f.s,['StockMovement','JournalEntry','JournalLine','SalesOrder','SalesOrderLine','Invoice','CashCollection','TreasuryTransaction']),preview=await f.preview(),rounding=preview.legacy_rounding;
  assert.equal(preview.total_quantity,2);assert.equal(preview.total_value,marketingValue);assert.equal(preview.inventory_value_change,inventoryChange);assert.equal(preview.stock_quantity_change,0);assert.equal(preview.cash_change,0);assert.equal(preview.source_journals_verified,true);
  assert.equal(rounding.required,true);assert.equal(rounding.policy,'verified-legacy-rounded-unit-cost-v1');assert.equal(rounding.cogs_change,cogsChange);assert.equal(rounding.inventory_value_change,-cogsChange);assert.equal(rounding.cache_value_change,cacheChange);
  const partial=rounding.lots.find(row=>row.lot_number==='PARTIAL'),exhausted=rounding.lots.find(row=>row.lot_number==='EXHAUSTED');
  assert.equal(partial.receipt_unit_cost,2);assert.equal(partial.legacy_remaining_value,4);assert.equal(partial.reconciled_value,marketingValue);assert.equal(partial.cache_value_change,cacheChange);assert.equal(partial.exhausted,false);assert.equal(partial.cogs_adjustment,0);
  assert.equal(exhausted.reconciled_value,0);assert.equal(exhausted.exhausted,true);assert.equal(exhausted.cogs_adjustment,cogsChange);assert.ok(Math.abs(cogsChange)<=exhausted.rounding_bound);
  assert.deepEqual(preview.journal_lines,[{account_id:f.expense.id,debit:marketingValue,credit:0},{account_id:f.inventoryId,debit:0,credit:marketingValue}]);
  assert.equal(money(rounding.journal_lines.reduce((sum,row)=>sum+row.debit-row.credit,0)),0);
  assert.equal(money(rounding.journal_lines.filter(row=>row.account_id===f.cogsId).reduce((sum,row)=>sum+row.debit-row.credit,0)),cogsChange);
  const body={...f.body,token:preview.token,requestKey:crypto.randomUUID(),confirmed:true},result=await postDegustationAppropriation(f.s,context,body),balance=await f.s.StockBalance.get(f.balances[0].id);
  assert.equal(result.total_value,marketingValue);assert.equal(result.rounding_cogs_change,cogsChange);assert.equal(result.rounding_cache_value_change,cacheChange);assert.equal(result.inventory_value_change,inventoryChange);assert.ok(result.rounding_journal_id);assert.ok(result.rounding_journal_number);
  assert.equal(balance.quantity,2);assert.equal(balance.total_value,0);assert.equal(balance.unit_cost,0);assert.equal(balance.degustation_appropriation_value,marketingValue);
  assert.equal((await f.s.Account.get(f.expense.id)).balance,marketingValue);assert.equal((await f.s.Account.get(f.inventoryId)).balance,0);assert.equal((await f.s.Account.get(f.cogsId)).balance,money(f.releasedValue+cogsChange));assert.equal((await f.s.Account.get(f.revenueId)).balance,2500);
  const correction=await f.s.JournalEntry.get(result.rounding_journal_id);assert.equal(correction.source_document_type,'DegustationRoundingCorrection');assert.equal(correction.total_debit,Math.abs(cogsChange));assert.equal(correction.total_credit,Math.abs(cogsChange));
  const financial=(await f.s.StockMovement.filter({document_type:'DegustationRoundingCorrection'}));assert.equal(financial.length,1);assert.equal(financial[0].quantity,0);assert.equal(financial[0].total_value,Math.abs(cogsChange));assert.equal(financial[0].rounding_value_only,true);assert.equal(financial[0].rounding_cogs_change,cogsChange);assert.equal(financial[0].journal_id,result.rounding_journal_id);
  assert.equal(financial[0][cogsChange>0?'source_warehouse_id':'destination_warehouse_id'],f.custody.id);
  assert.equal((await f.s.StockMovement.filter({document_type:'DegustationAppropriation'})).length,1);
  for(const name of ['SalesOrder','SalesOrderLine','Invoice','CashCollection','TreasuryTransaction'])assert.deepEqual(await f.s[name].list(),before[name]);
  for(const name of ['StockMovement','JournalEntry','JournalLine'])assert.deepEqual((await f.s[name].list()).filter(row=>before[name].some(old=>old.id===row.id)),before[name]);
  const audit=(await f.s.AuditLog.list()).find(row=>row.action==='appropriate_reserved_degustation');assert.equal(audit.accounting_control_degustation_appropriation_preview.legacy_rounding.cache_value_change,cacheChange);assert.equal(audit.accounting_control_degustation_appropriation_before.find(row=>row.id===balance.id).total_value,4);
  const committed=await snapshot(f.s);assert.equal((await postDegustationAppropriation(f.s,context,body)).reused,true);assert.deepEqual(await snapshot(f.s),committed);
 }
});

test('only an exact historical rounded-CPU chain qualifies; arbitrary caches, costs, identities and non-COGS source entries stay blocked',async()=>{
 for(const change of ['cache','receipt-cpu','issue-cpu','balance-cpu','issue-value','identity','duplicate-receipt','source-journal','cost-counterpart']){
  const f=await historicalFixture({costAccountOverride:change==='cost-counterpart'?'expense':undefined});
  if(change==='cache')await f.s.StockBalance.update(f.balances[0].id,{total_value:4.01});
  if(change==='receipt-cpu'){for(const move of await f.s.StockMovement.filter({document_type:'Dispatch'}))await f.s.StockMovement.update(move.id,{unit_cost:2.01});}
  if(change==='issue-cpu')await f.s.StockMovement.update(f.issues[0].id,{unit_cost:2.01});
  if(change==='balance-cpu')await f.s.StockBalance.update(f.balances[0].id,{unit_cost:2.01});
  if(change==='issue-value')await f.s.StockMovement.update(f.issues[0].id,{total_value:10.01});
  if(change==='identity')await f.s.StockBalance.update(f.balances[0].id,{batch_number:'different-batch'});
  if(change==='duplicate-receipt'){for(const move of (await f.s.StockMovement.filter({document_type:'Dispatch'})).filter(row=>row.lot_number==='EXHAUSTED')){await f.s.StockMovement.update(move.id,{quantity:2,total_value:4.01});await f.s.StockMovement.create({...move,id:undefined,quantity:1,total_value:2});}}
  if(change==='source-journal')await f.s.JournalEntry.update(f.journal.id,{total_debit:2516.01});
  const before=await snapshot(f.s);await assert.rejects(f.preview(),error=>{if(change==='source-journal'){assert.match(error.message,/original sale and stock journals/);assert.equal(error.degustation_appropriation_diagnostics,undefined);}return true;},change);assert.deepEqual(await snapshot(f.s),before,change);
 }
 const negative=await historicalFixture({partialValue:0.02,partialLoaded:3,partialSold:2.999,partialCPU:0.01,exhaustedValue:null}),before=await snapshot(negative.s);await assert.rejects(negative.preview(),/remaining lot quantities or carrying values/);assert.deepEqual(await snapshot(negative.s),before);
});

test('offsetting exhausted residues retain both signed corrections, while a partial cache-only repair creates no COGS movement',async()=>{
 const f=await historicalFixture({exhaustedValue:[6.01,5.99]}),preview=await f.preview();assert.equal(preview.legacy_rounding.cogs_change,0);assert.equal(preview.legacy_rounding.journal_lines.length,4);assert.equal(preview.total_value,4.03);assert.equal(preview.inventory_value_change,-4.03);
 const result=await postDegustationAppropriation(f.s,context,{...f.body,token:preview.token,requestKey:crypto.randomUUID(),confirmed:true}),journal=await f.s.JournalEntry.get(result.rounding_journal_id),moves=await f.s.StockMovement.filter({document_type:'DegustationRoundingCorrection'});
 assert.equal(journal.total_debit,0.02);assert.equal(journal.total_credit,0.02);assert.equal((await f.s.Account.get(f.cogsId)).balance,22);assert.equal((await f.s.Account.get(f.inventoryId)).balance,0);assert.equal(moves.length,2);assert.deepEqual(moves.map(row=>row.rounding_cogs_change).sort((a,b)=>a-b),[-0.01,0.01]);assert.ok(moves.every(row=>row.quantity===0));
 const g=await historicalFixture({exhaustedValue:null}),only=await g.preview();assert.equal(only.legacy_rounding.cogs_change,0);assert.equal(only.legacy_rounding.cache_value_change,0.03);assert.deepEqual(only.legacy_rounding.journal_lines,[]);assert.equal(only.total_value,4.03);
 await postDegustationAppropriation(g.s,context,{...g.body,token:only.token,requestKey:crypto.randomUUID(),confirmed:true});assert.equal((await g.s.StockMovement.filter({document_type:'DegustationRoundingCorrection'})).length,0);assert.equal((await g.s.JournalEntry.filter({source_document_type:'DegustationRoundingCorrection'})).length,0);assert.equal((await g.s.Account.get(g.cogsId)).balance,10);assert.equal((await g.s.Account.get(g.inventoryId)).balance,0);assert.equal((await g.s.StockMovement.filter({document_type:'DegustationAppropriation'}))[0].total_value,4.03);
});

test('rounding review binds source CPU evidence and all journal plans before either journal can be posted',async()=>{
 const f=await historicalFixture(),preview=await f.preview(),body={...f.body,token:preview.token,requestKey:crypto.randomUUID(),confirmed:true};
 await f.s.Account.update(f.cogsId,{name:'Changed COGS review target'});const before=await snapshot(f.s);await assert.rejects(postDegustationAppropriation(f.s,context,body),/changed/);assert.deepEqual(await snapshot(f.s),before);
 const fresh=await f.preview();await assert.rejects(postDegustationAppropriation(f.s,context,{...body,token:fresh.token,confirmed:false}),/Preview and confirm/);
});

test('a client must explicitly acknowledge the exact rounding policy before either reviewed journal can be posted',async()=>{
 for(const policy of [undefined,'unreviewed-policy']){
  const f=await historicalFixture(),preview=await f.preview(),body={...f.body,token:preview.token,requestKey:crypto.randomUUID(),confirmed:true,roundingReviewPolicy:policy},before=await snapshot(f.s);
  await assert.rejects(postDegustationAppropriation(f.s,context,body),error=>{assert.equal(error.status,409);assert.match(error.message,/Preview and confirm/);return true;});assert.deepEqual(await snapshot(f.s),before);
  await postDegustationAppropriation(f.s,context,{...body,roundingReviewPolicy:preview.legacy_rounding.policy});const committed=await snapshot(f.s);await assert.rejects(postDegustationAppropriation(f.s,context,body),/different Dégustation appropriation/);assert.deepEqual(await snapshot(f.s),committed);
 }
});

test('appropriated repaired basis supports later real giveaways and warehouse return without duplicate expense or altered COGS',async()=>{
 const f=await historicalFixture(),preview=await f.preview();await postDegustationAppropriation(f.s,context,{...f.body,token:preview.token,requestKey:crypto.randomUUID(),confirmed:true});
 const journalCount=(await f.s.JournalEntry.list()).length;
 await employeeStockAction(f.client,{id:'cashier-login',role:'user'},{action:'recordDegustation',dispatchId:f.dispatch.id,customerId:'customer-a',date,requestKey:crypto.randomUUID(),lines:[{product_id:'product-a',quantity:1}],notes:'Actual sample from corrected promotional lot'});
 assert.equal((await f.s.JournalEntry.list()).length,journalCount);assert.equal((await f.s.Account.get(f.expense.id)).balance,4.03);assert.equal((await f.s.Account.get(f.cogsId)).balance,16.01);
 const balance=await f.s.StockBalance.get(f.balances[0].id);assert.equal(balance.quantity,1);assert.equal(balance.total_value,0);assert.equal(balance.degustation_appropriation_value,2.01);
 await dispatchAction(f.client,context.user,{action:'returnDispatchStock',dispatchId:f.dispatch.id,countedLines:[{product_id:'product-a',quantity:1}]});
 assert.equal((await f.s.Account.get(f.expense.id)).balance,2.02);assert.equal((await f.s.Account.get(f.inventoryId)).balance,2.01);assert.equal((await f.s.Account.get(f.cogsId)).balance,16.01);assert.equal((await f.s.Account.get(f.revenueId)).balance,2500);
 const recon=await dispatchReconciliationData({entities:f.s},await f.s.Dispatch.get(f.dispatch.id));assert.equal(recon.hasVariance,false);assert.equal(recon.degustationCost,2.02);assert.equal(recon.rows[0].degustation_given,1);assert.equal(recon.rows[0].degustation_returned,1);
});

test('real API transaction rolls back both correction journals, repaired caches and markers after late failure, then retries once',async()=>{
 const db=new PGlite();try{
  const f=await historicalFixture({db}),route=await apiRoute();globalThis.__roundingContext=context;globalThis.__roundingStores=f.s;globalThis.__roundingTx=async fn=>{await db.exec('BEGIN');try{const result=await fn();await db.exec('COMMIT');return result;}catch(error){await db.exec('ROLLBACK');throw error;}};
  const preview=await f.preview(),body={action:'post',...f.body,token:preview.token,requestKey:crypto.randomUUID(),confirmed:true},call=()=>route(new Request('http://localhost/api/accounting/degustation-appropriation',{method:'POST',body:JSON.stringify(body)})),before=await snapshot(f.s),create=f.s.AuditLog.create;let failed=true;
  f.s.AuditLog.create=async value=>{if(failed&&value.action==='appropriate_reserved_degustation'){assert.equal((await f.s.JournalEntry.filter({source_document_type:'DegustationRoundingCorrection'})).length,1);assert.equal((await f.s.JournalEntry.filter({source_document_type:'DegustationAppropriation'})).length,1);throw Error('Simulated late two-journal audit failure');}return create(value);};
  let response=await call();assert.equal(response.status,400);assert.match((await response.json()).error,/Simulated late two-journal audit failure/);assert.deepEqual(await snapshot(f.s),before);
  failed=false;response=await call();assert.equal(response.status,200,JSON.stringify(await response.clone().json()));const result=await response.json();assert.equal(result.total_value,4.03);assert.equal(result.rounding_cogs_change,0.01);assert.ok(result.journal_id);assert.ok(result.rounding_journal_id);const committed=await snapshot(f.s);assert.equal((await(await call()).json()).reused,true);assert.deepEqual(await snapshot(f.s),committed);assert.equal((await f.s.JournalEntry.filter({source_document_type:'DegustationRoundingCorrection'})).length,1);assert.equal((await f.s.JournalEntry.filter({source_document_type:'DegustationAppropriation'})).length,1);
 }finally{delete globalThis.__roundingContext;delete globalThis.__roundingStores;delete globalThis.__roundingTx;await db.close();}
});
