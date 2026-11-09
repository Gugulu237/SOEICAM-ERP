import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {fixture,functionRoute,request,date} from './helpers/cashier.mjs';
import {invoiceAction} from '../src/server/domain/sales-invoices.js';
import {saleReversalAction} from '../src/server/domain/sale-reversals.js';
import {postJournal} from '../src/server/domain/field-ops.js';
import {invoiceDefaults} from '../src/lib/invoice-documents.js';
import {previewSetupStockCorrection,postSetupStockCorrection} from '../src/server/domain/setup-stock-correction.js';
import {openingSaleCostBasis} from '../src/server/domain/opening-cost-basis.js';
import {journalPayload} from '../src/server/domain/journal-validation.js';
import {approveReceipt} from '../src/server/domain/customer-receipts.js';

const gm={id:'gm',role:'admin',full_name:'Fixture manager'},markerKey='accounting_control_opening_cost_correction',correctionPolicy='owner-confirmed-opening-lot-cost-v1',retainedPolicy='unreturned-goods-operating-expense-v1';
const snapshot=async stores=>Object.fromEntries(await Promise.all(['Account','PostingRule','JournalEntry','JournalLine','StockBalance','StockMovement','Customer','Invoice','InvoiceLine','SalesOrder','AuditLog'].map(async name=>[name,await stores[name].list()])));

async function setup(db,{mixed=false}={}){
 const f=await fixture(db),s=f.entities;f.client.auth.me=async()=>gm;
 for(const entity of Object.values(s)){const filter=entity.filter;entity.filter=async(query,options,limit,skip)=>!options||typeof options!=='object'?filter(query,options,limit,skip):{items:await filter(query,options.sort,options.limit,Number(options.cursor||options.skip||0)),has_more:false};entity.updateMany=async(query,value)=>{for(const row of await filter(query))await entity.update(row.id,value.$set||value);};}
 const originalCreate=s.AuditLog.create;s.AuditLog.create=async value=>{if(!value.id)return originalCreate(value);const row=structuredClone(value);if(db)await db.query('INSERT INTO fixture_entity VALUES($1,$2,$3)',['AuditLog',row.id,row]);else f.rows.AuditLog.push(row);return structuredClone(row);};
 await s.CompanySettings.update('settings',{company_name:'Fixture dairy',next_invoice_number:1});
 await s.StockBalance.update('stock',{warehouse_id:'factory',quantity:2,total_value:400,unit_cost:200,stock_origin:'adjustment'});
 const opening=await s.Account.create({account_number:'OPEN-FIXTURE',name:'Opening equity',account_type:'equity',normal_balance:'credit',currency:'XAF',is_active:true,is_posting:true,balance:0});
 const gain=await s.Account.create({account_number:'OTHER-FIXTURE',name:'Fixture setup surplus',account_type:'other_income',normal_balance:'credit',currency:'XAF',is_active:true,is_posting:true,balance:0}),openingAuditId='WA-FIXTURE-OPENING';
 let otherProduct=null,otherBalance=null;
 if(mixed){otherProduct=await s.Product.create({name:'Fixture uncorrected yogurt',inventory_type:'finished_product',is_active:true,unit_of_measure:'ea',inventory_account_id:'inventory',cogs_account_id:'cogs',revenue_account_id:'revenue'});otherBalance=await s.StockBalance.create({product_id:otherProduct.id,product_name:otherProduct.name,warehouse_id:'factory',warehouse_name:'Factory',quantity:1,total_value:100,unit_cost:100,lot_number:'OTHER-LOT',qc_status:'approved'});}
 const openingValue=mixed?500:400,openingJournal=(await postJournal(f.client.asServiceRole,{entryDate:date,description:'Fixture opening lot',sourceModule:'inventory_adjustment',sourceDocumentType:'WarehouseAdjustment',sourceDocumentId:openingAuditId,userId:gm.id,lines:[{account_id:'inventory',debit:openingValue,credit:0},{account_id:gain.id,debit:0,credit:openingValue}]})).journal;
 const openingMovement=await s.StockMovement.create({product_id:'product-a',product_name:'Fixture yogurt',source_warehouse_id:'',destination_warehouse_id:'factory',movement_type:'stock_count_variance',movement_date:date,status:'approved',quantity:2,unit_cost:200,total_value:400,lot_number:'LOT',warehouse_adjustment_balance_id:'stock',document_type:'WarehouseAdjustment',document_id:openingAuditId,journal_id:openingJournal.id});
 const openingRows=[{balance_id:'stock',warehouse_id:'factory',product_id:'product-a',lot_number:'LOT',book_quantity:0,book_value:0,counted_quantity:2,difference:2,value_after:400,value_difference:400}];
 if(mixed){await s.StockMovement.create({product_id:otherProduct.id,product_name:otherProduct.name,source_warehouse_id:'',destination_warehouse_id:'factory',movement_type:'stock_count_variance',movement_date:date,status:'approved',quantity:1,unit_cost:100,total_value:100,lot_number:'OTHER-LOT',warehouse_adjustment_balance_id:otherBalance.id,document_type:'WarehouseAdjustment',document_id:openingAuditId,journal_id:openingJournal.id});openingRows.push({balance_id:otherBalance.id,warehouse_id:'factory',product_id:otherProduct.id,lot_number:'OTHER-LOT',book_quantity:0,book_value:0,counted_quantity:1,difference:1,value_after:100,value_difference:100});}
 await s.AuditLog.create({id:openingAuditId,action:'warehouse_quantity_adjusted',module:'inventory_adjustment',entity_type:'WarehouseAdjustment',entity_id:openingAuditId,user_id:gm.id,audit_source:'server_verified',warehouse_adjustment_result:{journal_id:openingJournal.id,journal_number:openingJournal.journal_number,date,reference:'FIXTURE-OPENING-SHEET',value_difference:openingValue,rows:openingRows}});
 const setupBody={journalIds:[openingJournal.id],offsetAccountId:opening.id,accountingStartDate:date,reference:'Fixture signed opening review',confirmSetup:true},context={user:gm,role:'admin',employee:null},preview=await previewSetupStockCorrection(s,context,setupBody),setupResult=await postSetupStockCorrection(s,context,{...setupBody,token:preview.token,requestKey:crypto.randomUUID(),confirmed:true});
 const openingReclassification=await s.JournalEntry.get(setupResult.journals[0].journal_id);
 const order=await s.SalesOrder.create({order_number:'SO-FIXTURE',customer_id:'customer-a',customer_name:'Customer A',warehouse_id:'factory',order_date:date,payment_type:'credit',status:'draft',subtotal:mixed?1500:1000,tax_total:0,total:mixed?1500:1000,sales_supply_recorded_by:'seller-user'});
 await s.SalesOrderLine.create({order_id:order.id,product_id:'product-a',product_name:'Fixture yogurt',quantity:2,unit:'ea',unit_price:500,tax_rate:0,tax_amount:0,total:1000});
 if(mixed)await s.SalesOrderLine.create({order_id:order.id,product_id:otherProduct.id,product_name:otherProduct.name,quantity:1,unit:'ea',unit_price:500,tax_rate:0,tax_amount:0,total:500});
 const document=await invoiceAction(f.client,gm,{action:'createSalesInvoice',sourceType:'order',sourceId:order.id,invoiceDate:date,dueDate:date,options:invoiceDefaults({business_name:'Customer A'})});
 const invoice=await s.Invoice.get(document.invoice.id),line=(await s.InvoiceLine.filter({invoice_id:invoice.id})).find(row=>row.product_id==='product-a'),original=await s.JournalEntry.get(invoice.journal_id),issue=(await s.StockMovement.filter({document_type:'SalesOrder',document_id:order.id})).find(row=>row.product_id==='product-a');
 const inputs=async()=>({invoice:await s.Invoice.get(invoice.id),order:await s.SalesOrder.get(order.id),journal:await s.JournalEntry.get(original.id),invoiceLines:await s.InvoiceLine.filter({invoice_id:invoice.id}),issues:await s.StockMovement.filter({document_type:'SalesOrder',document_id:order.id}),originalLines:await s.JournalLine.filter({journal_id:original.id}),accounts:await s.Account.list()});
 return {...f,s,opening,gain,openingJournal,openingReclassification,openingMovement,openingAuditId,order,invoice,line,original,issue,inputs};
}

async function corrected(db,options){
 const f=await setup(db,options),{s}=f,id='OCC-'+createHash('sha256').update(correctionPolicy+':'+f.issue.id).digest('hex');
 const correction=(await postJournal(f.client.asServiceRole,{entryDate:date,description:'Fixture owner-confirmed opening lot cost',sourceModule:'accounting_corrections',sourceDocumentType:'OpeningLotCostCorrection',sourceDocumentId:id,userId:gm.id,lines:[{account_id:f.opening.id,debit:99.75,credit:0},{account_id:'cogs',debit:0,credit:99.75}]})).journal;
 const pointer={policy:correctionPolicy,id,journal_id:correction.id,requires_corrected_basis_reversal:true},marker={...pointer,journal_number:correction.journal_number,date,source_journal_id:f.original.id,source_invoice_id:f.invoice.id,source_order_id:f.order.id,source_issue_id:f.issue.id,source_invoice_line_id:f.line.id,source_stock_balance_id:'stock',source_opening_journal_id:f.openingJournal.id,source_opening_reclassification_journal_id:f.openingReclassification.id,source_opening_movement_id:f.openingMovement.id,source_opening_audit_id:f.openingAuditId,product_id:'product-a',lot_number:'LOT',quantity:2,unit_cost:'150.1225',original_cost:400,corrected_cost:300.25,cost_reduction:99.75,stock_disposition:'fully_sold',inventory_account_id:'inventory',cogs_account_id:'cogs',opening_account_id:f.opening.id};
 for(const [entity,recordId]of [['Invoice',f.invoice.id],['SalesOrder',f.order.id],['StockMovement',f.issue.id]])await s[entity].update(recordId,{[markerKey]:pointer});
 await s.JournalEntry.update(f.original.id,{[markerKey]:marker});
 await s.AuditLog.create({id,action:'correct_opening_lot_cost',module:'accounting_corrections',entity_type:'JournalEntry',entity_id:correction.id,user_id:gm.id,audit_source:'server_verified',accounting_control_opening_cost_policy:correctionPolicy,[markerKey]:marker});
 const preview=()=>saleReversalAction(f.client,gm,{action:'previewSaleReversal',invoiceId:f.invoice.id});
 const reverse=async(stock='return_stock',overrides={})=>{const p=await preview();return saleReversalAction(f.client,gm,{action:'reverseSale',invoiceId:f.invoice.id,reviewToken:p.reviewToken,reason:'Fixture sale correction',stockDisposition:stock,...(stock==='return_stock'?{warehouseId:'factory'}:{costTreatmentPolicy:retainedPolicy}),confirmed:true,...overrides});};
 return {...f,id,correction,pointer,marker,preview,reverse,basis:async()=>openingSaleCostBasis(s,await f.inputs())};
}

test('an unmarked sale keeps its original basis and a complete opening correction supplies exact effective costs without writes',async()=>{
 const normal=await setup(),normalBefore=await snapshot(normal.s);assert.equal(await openingSaleCostBasis(normal.s,await normal.inputs()),null);assert.deepEqual(await snapshot(normal.s),normalBefore);
 const f=await corrected(),before=await snapshot(f.s),basis=await f.basis();assert.equal(basis.cost,300.25);assert.equal(basis.issues.length,1);assert.equal(basis.issues[0].quantity,2);assert.equal(basis.issues[0].total_value,300.25);assert.equal(basis.effectiveCogsLines.reduce((n,row)=>n+Number(row.debit||0),0),300.25);assert.equal(basis.effectiveInventoryLines.reduce((n,row)=>n+Number(row.credit||0),0),300.25);assert.equal(basis.review.corrected,true);assert.deepEqual(await snapshot(f.s),before);
 const p=await f.preview();assert.equal(p.can_restore_stock,true);assert.equal(p.retained_cost_review.amount,300.25);assert.ok(p.opening_cost_review?.corrected);assert.deepEqual(await snapshot(f.s),before);
});

test('returning corrected fully sold goods restores only their corrected carrying value and leaves the opening correction intact',async()=>{
 const f=await corrected(),originalLines=await f.s.JournalLine.filter({journal_id:f.original.id}),correction=await f.s.JournalEntry.get(f.correction.id),correctionLines=await f.s.JournalLine.filter({journal_id:f.correction.id}),openingBalance=(await f.s.Account.get(f.opening.id)).balance;
 const result=await f.reverse(),returns=await f.s.StockBalance.filter({stock_origin:'sale_reversal'}),reverseLines=await f.s.JournalLine.filter({journal_id:result.reversal.journal_id});
 assert.equal(returns.length,1);assert.equal(returns[0].quantity,2);assert.equal(returns[0].total_value,300.25);assert.equal(returns[0].qc_status,'pending');assert.equal(reverseLines.find(row=>row.account_id==='inventory').debit,300.25);assert.equal(reverseLines.find(row=>row.account_id==='cogs').credit,300.25);assert.ok(reverseLines.every(row=>row.account_id!==f.opening.id));assert.equal((await f.s.Account.get('cogs')).balance,0);assert.equal((await f.s.Account.get('inventory')).balance,300.25);assert.equal((await f.s.Account.get(f.opening.id)).balance,openingBalance);
 assert.deepEqual(await f.s.JournalLine.filter({journal_id:f.original.id}),originalLines);assert.deepEqual(await f.s.JournalEntry.get(f.correction.id),correction);assert.deepEqual(await f.s.JournalLine.filter({journal_id:f.correction.id}),correctionLines);assert.equal((await f.s.StockMovement.get(f.issue.id)).total_value,400);assert.equal((await f.s.InvoiceLine.get(f.line.id)).cogs_total,400);
 const after=await snapshot(f.s),retry=await saleReversalAction(f.client,gm,{action:'reverseSale',invoiceId:f.invoice.id,reason:'Fixture sale correction',stockDisposition:'return_stock',warehouseId:'factory',confirmed:true});assert.equal(retry.reused,true);assert.deepEqual(await snapshot(f.s),after);
});

test('cancelling corrected goods that have not returned reclassifies only effective COGS and creates no inventory asset',async()=>{
 const f=await corrected(),stock=await f.s.StockBalance.list(),moves=await f.s.StockMovement.list(),inventory=(await f.s.Account.get('inventory')).balance,result=await f.reverse('retain_stock'),lines=await f.s.JournalLine.filter({journal_id:result.reversal.journal_id}),expense=(await f.s.Account.filter({account_number:'UNRETURNED-GOODS'}))[0];
 assert.equal(lines.find(row=>row.account_id==='cogs').credit,300.25);assert.equal(lines.find(row=>row.account_id===expense.id).debit,300.25);assert.equal(expense.balance,300.25);assert.equal(result.reversal.retained_cost_expense.amount,300.25);assert.equal((await f.s.Account.get('cogs')).balance,0);assert.equal((await f.s.Account.get('inventory')).balance,inventory);assert.deepEqual(await f.s.StockBalance.list(),stock);assert.deepEqual(await f.s.StockMovement.list(),moves);
});

test('mixed corrected and ordinary sold lots retain every unaffected cost while reversing their combined effective basis',async()=>{
 const f=await corrected(undefined,{mixed:true}),basis=await f.basis();assert.equal(f.openingJournal.total_debit,500);assert.equal(f.openingReclassification.total_credit,500);assert.equal(basis.cost,400.25);assert.deepEqual(basis.issues.map(row=>row.total_value).sort((a,b)=>a-b),[100,300.25]);
 const result=await f.reverse(),returns=await f.s.StockBalance.filter({stock_origin:'sale_reversal'});assert.equal(returns.reduce((n,row)=>n+row.total_value,0),400.25);assert.equal(returns.reduce((n,row)=>n+row.quantity,0),3);assert.equal((await f.s.Account.get('cogs')).balance,0);assert.equal((await f.s.Account.get('inventory')).balance,400.25);assert.equal((await f.s.InvoiceLine.filter({invoice_id:f.invoice.id})).reduce((n,row)=>n+row.cogs_total,0),500);assert.ok((await f.s.JournalLine.filter({journal_id:result.reversal.journal_id})).every(row=>row.account_id!==f.opening.id));
});

test('a sale author sees only the generic corrected-basis notice and no opening carrying costs',async()=>{
 const f=await corrected(),actor={id:'seller-user',role:'user'};f.client.auth.staff=async()=>({id:'seller',user_id:actor.id,role:'employee',status:'active'});
 const p=await saleReversalAction(f.client,actor,{action:'previewSaleReversal',invoiceId:f.invoice.id});assert.ok(p.opening_cost_review?.corrected);assert.doesNotMatch(JSON.stringify(p.opening_cost_review),/300\.25|99\.75|150\.1225|original_cost|corrected_cost|cost_reduction|account_id/);assert.equal(p.retained_cost_review.costs_visible,false);assert.equal(Object.hasOwn(p.retained_cost_review,'amount'),false);
});

test('legitimate payments after an opening correction do not invalidate cost proof or refund received money on reversal',async()=>{
 const f=await corrected(),payment=await f.s.Payment.create({payment_number:'RCP-FIXTURE',payment_type:'customer_payment',party_id:'customer-a',party_name:'Customer A',payment_date:date,amount:100,status:'pending_approval',cashier_confirmed_by:gm.id,treasury_account_id:'till',allocated_to_invoices:f.invoice.id,invoice_numbers:f.invoice.invoice_number,receipt_allocations:[{invoice_id:f.invoice.id,amount:100}],receipt_posting_token:''});
 await approveReceipt(f.client.asServiceRole,payment,gm,{topAdmin:true});await f.s.SalesOrder.update(f.order.id,{amount_due:900,amount_collected:100});
 const invoice=await f.s.Invoice.get(f.invoice.id),receiptBefore=await f.s.Payment.get(payment.id),treasuryBefore=await f.s.TreasuryAccount.get('till');assert.equal(invoice.balance,900);assert.equal(invoice.amount_paid,100);assert.equal((await f.basis()).cost,300.25);
 const preview=await f.preview();assert.equal(preview.unpaid_cancelled,900);assert.equal(preview.customer_credit,100);assert.equal(preview.retained_cost_review.amount,300.25);
 const result=await f.reverse('retain_stock');assert.equal(result.reversal.customer_credit,100);assert.equal(result.reversal.unpaid_cancelled,900);assert.equal(result.reversal.retained_cost_expense.amount,300.25);assert.equal((await f.s.Customer.get('customer-a')).balance,-100);assert.equal((await f.s.Account.get('cogs')).balance,0);assert.deepEqual(await f.s.Payment.get(payment.id),receiptBefore);assert.deepEqual(await f.s.TreasuryAccount.get('till'),treasuryBefore);
});

test('partial markers and unverified correction evidence block both basis derivation and reversal before any mutation',async()=>{
 const cases=[
  async f=>f.s.Invoice.update(f.invoice.id,{[markerKey]:null}),
  async f=>f.s.SalesOrder.update(f.order.id,{[markerKey]:null}),
  async f=>f.s.StockMovement.update(f.issue.id,{[markerKey]:null}),
  async f=>f.s.JournalEntry.update(f.original.id,{[markerKey]:null}),
  async f=>f.s.Invoice.update(f.invoice.id,{[markerKey]:{...f.pointer,id:'OCC-wrong'}}),
  async f=>f.s.AuditLog.deleteMany({id:f.id}),
  async f=>f.s.AuditLog.update(f.id,{audit_source:'client_reported'}),
  async f=>f.s.AuditLog.update(f.id,{entity_id:'another-journal'}),
  async f=>f.s.AuditLog.update(f.id,{accounting_control_opening_cost_policy:'unverified'}),
  async f=>f.s.JournalEntry.update(f.correction.id,{posting_payload:'tampered'}),
  async f=>f.s.JournalEntry.update(f.correction.id,{status:'draft'}),
  async f=>f.s.JournalEntry.update(f.correction.id,{is_immutable:false}),
  async f=>f.s.JournalEntry.update(f.correction.id,{source_document_id:'another-source'}),
  async f=>{const lines=await f.s.JournalLine.filter({journal_id:f.correction.id});await f.s.JournalLine.update(lines[0].id,{debit:99.74});},
  async f=>{const duplicate=await f.s.JournalEntry.create({...await f.s.JournalEntry.get(f.correction.id),id:undefined,journal_number:'JV-DUPLICATE'});for(const line of await f.s.JournalLine.filter({journal_id:f.correction.id}))await f.s.JournalLine.create({...line,id:undefined,journal_id:duplicate.id});},
  async f=>f.s.StockMovement.update(f.issue.id,{total_value:399.99}),
  async f=>f.s.StockMovement.update(f.issue.id,{quantity:1}),
  async f=>f.s.StockMovement.update(f.issue.id,{status:'pending'}),
  async f=>f.s.StockMovement.update(f.issue.id,{lot_number:'OTHER-LOT'}),
  async f=>f.s.InvoiceLine.update(f.line.id,{cogs_total:399.99}),
  async f=>f.s.StockBalance.update('stock',{quantity:1}),
  async f=>f.s.StockMovement.update(f.openingMovement.id,{total_value:399.99}),
  async f=>f.s.AuditLog.update(f.openingAuditId,{audit_source:'client_reported'}),
  async f=>f.s.JournalEntry.update(f.openingReclassification.id,{setup_stock_source_journal_id:'another-opening'}),
 ];
 for(const [index,change]of cases.entries()){const f=await corrected();await change(f);const before=await snapshot(f.s);await assert.rejects(f.basis(),error=>!!error,'basis evidence case '+index);await assert.rejects(f.preview(),error=>!!error,'preview evidence case '+index);assert.deepEqual(await snapshot(f.s),before);}
});

test('a balanced original journal cannot substitute a cost different from the original invoice and delivered issues',async()=>{
 const f=await corrected(),original=await f.s.JournalEntry.get(f.original.id),lines=await f.s.JournalLine.filter({journal_id:f.original.id});
 for(const line of lines){if(line.description==='Cost of goods sold')await f.s.JournalLine.update(line.id,{debit:500});if(line.description==='Inventory released')await f.s.JournalLine.update(line.id,{credit:500});}
 const changed=await f.s.JournalLine.filter({journal_id:f.original.id});await f.s.JournalEntry.update(original.id,{total_debit:1500,total_credit:1500,posting_payload:journalPayload({entryDate:original.entry_date,description:original.description,sourceModule:original.source_module,sourceDocumentType:original.source_document_type,lines:changed})});
 const before=await snapshot(f.s);await assert.rejects(f.basis());await assert.rejects(f.preview());assert.deepEqual(await snapshot(f.s),before);
});

test('matching markers cannot override the exact owner-confirmed decimal basis or the original source quantities and costs',async()=>{
 for(const patch of [{unit_cost:'150.1224'},{unit_cost:150.1225},{unit_cost:'150.1225',corrected_cost:300.24,cost_reduction:99.76},{original_cost:400.01,cost_reduction:99.76},{quantity:3},{source_invoice_line_id:'another-line'},{inventory_account_id:'receivable'},{cogs_account_id:'revenue'},{opening_account_id:'inventory'},{stock_disposition:'held'}]){
  const f=await corrected(),changed={...f.marker,...patch};await f.s.JournalEntry.update(f.original.id,{[markerKey]:changed});await f.s.AuditLog.update(f.id,{[markerKey]:changed});const before=await snapshot(f.s);await assert.rejects(f.basis());await assert.rejects(f.preview());assert.deepEqual(await snapshot(f.s),before);
 }
});

test('the reversal preview binds the correction journal, owner confirmation and opening evidence',async()=>{
 const changes=[async f=>f.s.JournalEntry.update(f.correction.id,{description:'Additional accounting evidence attached'}),async f=>f.s.AuditLog.update(f.id,{description:'Owner confirmation supplemented'}),async f=>{const a=await f.s.AuditLog.get(f.openingAuditId);await f.s.AuditLog.update(f.openingAuditId,{description:(a.description||'')+' reviewed'});}];
 for(const change of changes){const f=await corrected(),p=await f.preview();await change(f);const before=await snapshot(f.s);await assert.rejects(f.reverse('return_stock',{reviewToken:p.reviewToken}));assert.deepEqual(await snapshot(f.s),before);}
});

test('a late API failure rolls back a corrected-basis return and an identical retry restores the corrected stock once',async()=>{
 const db=new PGlite();try{
  const f=await corrected(db),p=await f.preview(),route=await functionRoute(),before=(await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows,create=f.s.AuditLog.create;
  f.s.AuditLog.create=async row=>{if(row.action==='reverse_sale')throw Error('Fixture late opening-basis audit failure');return create(row);};
  globalThis.__cashierClient=f.client;globalThis.__cashierTransaction=async callback=>{await db.exec('BEGIN');try{const result=await callback();await db.exec('COMMIT');return result;}catch(error){await db.exec('ROLLBACK');throw error;}};
  const body={action:'reverseSale',invoiceId:f.invoice.id,reviewToken:p.reviewToken,reason:'Return fixture corrected goods',stockDisposition:'return_stock',warehouseId:'factory',confirmed:true},call=()=>route(request(body),{params:Promise.resolve({name:'fieldOps'})});
  const failed=await call();assert.equal(failed.status,400);assert.match((await failed.json()).error,/Fixture late/);assert.deepEqual((await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows,before);
  f.s.AuditLog.create=create;const posted=await call();assert.equal(posted.status,200,JSON.stringify(await posted.clone().json()));assert.equal((await f.s.StockBalance.filter({stock_origin:'sale_reversal'}))[0].total_value,300.25);assert.equal((await f.s.Account.get('cogs')).balance,0);
  const after=(await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows,retry=await call();assert.equal((await retry.json()).reused,true);assert.deepEqual((await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows,after);
 }finally{delete globalThis.__cashierClient;delete globalThis.__cashierTransaction;await db.close();}
});
