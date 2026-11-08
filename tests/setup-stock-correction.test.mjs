import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {build} from 'esbuild';
import {fixture,date,user} from './helpers/cashier.mjs';
import {postJournal} from '../src/server/domain/field-ops.js';
import {openingBalancesWorkspace,saveAccountOpening} from '../src/server/domain/opening-balances.js';
import {journalLifecycle} from '../src/server/domain/journal-lifecycle.js';
import {warehouseAdjustmentAction} from '../src/server/domain/warehouse-adjustment.js';
import {inventoryAuditAction} from '../src/server/domain/inventory-audit.js';
import {guardMutation} from '../src/server/access.js';
import {setupStockCorrectionWorkspace,previewSetupStockCorrection,postSetupStockCorrection} from '../src/server/domain/setup-stock-correction.js';

const context={user:{id:'gm',role:'admin',email:'gm@example.test'},role:'admin',employee:null};
async function setup(db){
  const f=await fixture(db),s=f.entities,create=s.AuditLog.create;
  s.AuditLog.create=async value=>{
    value={...value,audit_source:value.audit_source==='client_reported'?'client_reported':'server_verified'};
    if(!value.id)return create(value);
    if(db)await db.query('INSERT INTO fixture_entity VALUES($1,$2,$3)',['AuditLog',value.id,JSON.stringify(value)]);
    else {if(f.rows.AuditLog.some(r=>r.id===value.id))throw Error('Duplicate audit');f.rows.AuditLog.push(structuredClone(value));}
    return structuredClone(value);
  };
  const inventory=await s.Account.create({name:'Inventory asset',account_number:'1310',account_type:'asset',normal_balance:'debit',is_active:true,is_posting:true,balance:0});
  const gain=await s.Account.create({name:'Other operating income',account_number:'7580',account_type:'other_income',normal_balance:'credit',is_active:true,is_posting:true,balance:0});
  const equity=await s.Account.create({name:'Opening clearing',account_number:'3900',account_type:'equity',normal_balance:'credit',is_active:true,is_posting:true,balance:0});
  const product=await s.Product.create({name:'Setup yogurt',inventory_account_id:inventory.id,inventory_type:'finished_product',is_active:true});
  const source=async (amount=300,{entryDate=date,profitAccount=gain.id,sourceModule='inventory_adjustment',cash=false}={})=>{
    const sourceId='WA-'+crypto.randomUUID();
    const asset=cash?'till-gl':inventory.id;
    const {journal}=await postJournal({entities:s},{entryDate,description:'Warehouse quantity adjustment: setup count',sourceModule,sourceDocumentType:'WarehouseAdjustment',sourceDocumentId:sourceId,userId:'gm',lines:amount>0?[{account_id:asset,debit:amount,credit:0},{account_id:profitAccount,debit:0,credit:amount}]:[{account_id:asset,debit:0,credit:-amount},{account_id:profitAccount,debit:-amount,credit:0}]});
    await s.StockMovement.create({product_id:product.id,warehouse_adjustment_balance_id:'count-'+sourceId,document_type:'WarehouseAdjustment',document_id:sourceId,journal_id:journal.id,movement_type:'stock_count_variance',movement_date:entryDate,status:'approved',quantity:Math.abs(amount)/10,total_value:Math.abs(amount),source_warehouse_id:amount<0?'factory':'',destination_warehouse_id:amount>0?'factory':''});
    await s.AuditLog.create({id:sourceId,action:'warehouse_quantity_adjusted',module:'inventory_adjustment',warehouse_adjustment_result:{journal_id:journal.id,journal_number:journal.journal_number,date:entryDate,reference:'COUNT-SOURCE',value_difference:amount,rows:[{balance_id:'count-'+sourceId,warehouse_id:'factory',product_id:product.id,difference:amount/10,value_difference:amount}]}});
    return journal;
  };
  const first=await source();
  const body={journalIds:[first.id],offsetAccountId:equity.id,accountingStartDate:date,reference:'Verified opening inventory',confirmSetup:true};
  return {...f,s,inventory,gain,equity,product,source,first,body};
}
const entitiesToPreserve=['StockBalance','StockMovement','Product','TreasuryAccount','TreasuryTransaction','Payment','PaymentAllocation','Bill','Supplier','Customer'];
async function protectedState(s){return Object.fromEntries(await Promise.all(entitiesToPreserve.map(async name=>[name,await s[name].list()])));}
async function bodyWithToken(f,patch={}){const body={...f.body,...patch},preview=await previewSetupStockCorrection(f.s,context,{action:'preview',...body});return {body:{action:'post',...body,token:preview.token,requestKey:crypto.randomUUID(),confirmed:true},preview};}

test('workspace shows source evidence and never assumes a count is opening stock',async()=>{
  const f=await setup(),s=f.s;await f.source(50,{sourceModule:'manual'});
  const before=structuredClone(f.rows),workspace=await setupStockCorrectionWorkspace(s,context);
  const verified=workspace.candidates.find(row=>row.journal_id===f.first.id),unsupported=workspace.candidates.find(row=>row.source_module==='manual');
  assert.deepEqual(f.rows,before);assert.equal(workspace.candidates.length,2);assert.equal(verified.profit_effect,300);assert.equal(verified.eligible,true);assert.equal(verified.source_reference,'COUNT-SOURCE');assert.equal(workspace.equity_accounts[0].id,f.equity.id);
  assert.equal(unsupported.supported_source,false);assert.equal(unsupported.eligible,false);assert.match(unsupported.blocked_reasons.join(' '),/original workflow/);
  await assert.rejects(previewSetupStockCorrection(s,context,{...f.body,journalIds:[unsupported.journal_id]}),/original workflow/);
  await assert.rejects(previewSetupStockCorrection(s,context,{...f.body,confirmSetup:false}),/Confirm/);
  await assert.rejects(previewSetupStockCorrection(s,context,{...f.body,lines:[{account_id:f.gain.id,debit:1}]}),/complete setup journals/);
  await assert.rejects(previewSetupStockCorrection(s,context,{...f.body,journalIds:[]}),/Select between/);
});

async function auditedCount(f){
  const warehouse=await f.s.Warehouse.create({name:'Starting materials',warehouse_type:'raw_material',is_active:true});
  await f.s.Product.update(f.product.id,{inventory_type:'raw_material',configuration_status:'configured',unit_of_measure:'kg',current_cost:10});
  const lot=await f.s.StockBalance.create({product_id:f.product.id,warehouse_id:warehouse.id,product_name:'Setup yogurt',lot_number:'AUDITED-START',quantity:0,total_value:0,unit_cost:10,qc_status:'approved'});
  const client={auth:{staff:async()=>({id:'staff',role:'admin',status:'active',allowed_modules:['accounting','inventory_adjustments']}),assertModule(){}},asServiceRole:{entities:f.s}};
  const owner={id:'count-owner',role:'admin'},reviewer={id:'independent-reviewer',role:'admin'};
  const call=async(actor,action,audit,extra={})=>(await inventoryAuditAction(client,actor,{action:'inventoryAudit'+action,requestKey:crypto.randomUUID(),...(audit?{auditId:audit.id,revision:audit.revision}:{}),...extra})).audit;
  let audit=await call(owner,'Start',null,{title:'Reviewed opening material count',balanceIds:[lot.id]});
  audit=await call(owner,'Save',audit,{rows:[{balance_id:lot.id,counted_quantity:2,reason:'Physically verified starting materials'}],evidenceReference:'SIGNED-OPENING-SHEET',lossAccountId:'expense',gainAccountId:f.gain.id});
  audit=await call(owner,'Submit',audit);audit=await call(reviewer,'Approve',audit,{note:'Independent signed opening review'});audit=await call(owner,'Post',audit);
  return {audit,lot,journal:await f.s.JournalEntry.get(audit.journal_id)};
}

test('verified InventoryAudit setup counts reclassify their exact P&L amount without another stock movement',async()=>{
  const f=await setup(),{audit,journal}=await auditedCount(f),before=await protectedState(f.s),original=await f.s.JournalLine.filter({journal_id:journal.id});
  const row=(await setupStockCorrectionWorkspace(f.s,context)).candidates.find(c=>c.journal_id===journal.id);
  assert.equal(row.supported_source,true);assert.equal(row.source_document_type,'InventoryAudit');assert.equal(row.eligible,true,row.blocked_reasons.join(' '));assert.equal(row.source_reference,'SIGNED-OPENING-SHEET');assert.equal(row.profit_effect,20);
  const {body,preview}=await bodyWithToken(f,{journalIds:[journal.id]});assert.equal(preview.total_profit_adjustment,-20);
  const result=await postSetupStockCorrection(f.s,context,body);assert.equal(result.total_profit_adjustment,-20);assert.equal(result.journals[0].date,date);
  assert.deepEqual(await protectedState(f.s),before);assert.deepEqual(await f.s.JournalLine.filter({journal_id:journal.id}),original);
  assert.equal((await f.s.Account.get(f.gain.id)).balance,300);assert.equal((await f.s.Account.get(f.equity.id)).balance,20);
  const postedEvent=(await f.s.AuditLog.filter({entity_id:audit.id,action:'inventoryAuditPost'}))[0];assert.equal(postedEvent.inventory_audit_state.status,'posted');
  const snapshot=structuredClone(f.rows);assert.equal((await postSetupStockCorrection(f.s,context,body)).reused,true);assert.deepEqual(f.rows,snapshot);
});

test('unverified imported and manual inventory P&L chains remain visible but cannot be relabeled setup',async()=>{
  const f=await setup(),legacy=await f.source(40,{sourceModule:'legacy_import'}),manual=await f.source(25,{sourceModule:'manual'});
  await f.s.JournalEntry.update(legacy.id,{source_document_type:'StockAdjustment'});
  const revenue=await f.s.Account.create({name:'Sale revenue',account_type:'revenue',normal_balance:'credit',balance:0,is_active:true,is_posting:true}),cogs=await f.s.Account.create({name:'Sale cost',account_type:'cogs',normal_balance:'debit',balance:0,is_active:true,is_posting:true});
  const sale=(await postJournal({entities:f.s},{entryDate:date,description:'Ordinary supplied invoice',sourceModule:'sales',sourceDocumentType:'Invoice',sourceDocumentId:'normal-invoice',userId:'gm',lines:[{account_id:'till-gl',debit:200,credit:0},{account_id:revenue.id,debit:0,credit:200},{account_id:cogs.id,debit:80,credit:0},{account_id:f.inventory.id,debit:0,credit:80}]})).journal;
  const snapshot=structuredClone(f.rows),workspace=await setupStockCorrectionWorkspace(f.s,context);
  for(const id of [legacy.id,manual.id,sale.id]){
    const candidate=workspace.candidates.find(row=>row.journal_id===id);assert.ok(candidate);assert.equal(candidate.eligible,false);assert.equal(candidate.supported_source,false);assert.match(candidate.blocked_reasons.join(' '),/original workflow/);
    await assert.rejects(bodyWithToken(f,{journalIds:[id]}),/original workflow/);
  }
  assert.equal(workspace.candidates.find(row=>row.journal_id===sale.id).profit_effect,120,'blocked sources still display their complete P&L effect');
  assert.deepEqual(f.rows,snapshot);
});

test('InventoryAudit correction rejects missing or changed approvals, lot evidence and posting plans',async()=>{
  const scenarios=[
    async(f,a)=>f.s.AuditLog.deleteMany({entity_id:a.id,action:'inventoryAuditApprove'}),
    async(f,a)=>{const event=(await f.s.AuditLog.filter({entity_id:a.id,action:'inventoryAuditPost'}))[0];await f.s.AuditLog.update(event.id,{inventory_audit_state:{...event.inventory_audit_state,makers:[a.approved_by]}});},
    async(f,a)=>{const event=(await f.s.AuditLog.filter({entity_id:a.id,action:'inventoryAuditApprove'}))[0];await f.s.AuditLog.update(event.id,{user_id:'unrelated-reviewer'});},
    async(f,a)=>{const event=(await f.s.AuditLog.filter({entity_id:a.id,action:'inventoryAuditApprove'}))[0];await f.s.AuditLog.update(event.id,{audit_source:'client_reported'});},
    async(f,a)=>{const event=(await f.s.AuditLog.filter({entity_id:a.id,action:'inventoryAuditPost'}))[0];await f.s.AuditLog.update(event.id,{audit_source:'client_reported'});},
    async(f,a)=>{const event=(await f.s.AuditLog.filter({entity_id:a.id,action:'inventoryAuditPost'}))[0];await f.s.AuditLog.update(event.id,{audit_source:''});},
    async(f,a)=>{const event=(await f.s.AuditLog.filter({entity_id:a.id,action:'inventoryAuditPost'}))[0];await f.s.AuditLog.update(event.id,{inventory_audit_state:{...event.inventory_audit_state,rows:event.inventory_audit_state.rows.map(row=>({...row,counted_quantity:3}))}});},
    async(f,a)=>{const event=(await f.s.AuditLog.filter({entity_id:a.id,action:'inventoryAuditPost'}))[0];await f.s.AuditLog.update(event.id,{inventory_audit_state:{...event.inventory_audit_state,approved_plan:[]}});},
    async(f,a)=>{const event=(await f.s.AuditLog.filter({entity_id:a.id,action:'inventoryAuditPost'}))[0];const copy=structuredClone(event);delete copy.id;await f.s.AuditLog.create(copy);},
    async(f,a)=>{const movement=(await f.s.StockMovement.filter({document_id:a.id}))[0];await f.s.StockMovement.update(movement.id,{journal_id:'another-journal'});},
    async(f,a)=>{const movement=(await f.s.StockMovement.filter({document_id:a.id}))[0];await f.s.StockMovement.update(movement.id,{inventory_audit_balance_id:'another-lot'});},
    async(f,a)=>{const movement=(await f.s.StockMovement.filter({document_id:a.id}))[0];await f.s.StockMovement.update(movement.id,{quantity:3});},
    async(f,a)=>{const movement=(await f.s.StockMovement.filter({document_id:a.id}))[0];await f.s.StockMovement.update(movement.id,{lot_number:'unrelated-lot'});},
  ];
  for(const change of scenarios){
    const f=await setup(),{audit,journal}=await auditedCount(f);await change(f,audit);const before=structuredClone(f.rows),candidate=(await setupStockCorrectionWorkspace(f.s,context)).candidates.find(row=>row.journal_id===journal.id);
    assert.equal(candidate.eligible,false);assert.ok(candidate.blocked_reasons.length);await assert.rejects(bodyWithToken(f,{journalIds:[journal.id]}));assert.deepEqual(f.rows,before);
  }
});

test('the original InventoryAudit approval is included in stale-preview protection',async()=>{
  const f=await setup(),{audit,journal}=await auditedCount(f),{body}=await bodyWithToken(f,{journalIds:[journal.id]});
  const event=(await f.s.AuditLog.filter({entity_id:audit.id,action:'inventoryAuditApprove'}))[0];await f.s.AuditLog.update(event.id,{description:'Additional audit evidence was attached'});
  const before=structuredClone(f.rows);await assert.rejects(postSetupStockCorrection(f.s,context,body),{status:409});assert.deepEqual(f.rows,before);
});

test('reviewed opening surplus moves its profit effect into equity without changing inventory, debt or cash',async()=>{
  const f=await setup(),{body,preview}=await bodyWithToken(f),protectedBefore=await protectedState(f.s),sourceLines=await f.s.JournalLine.filter({journal_id:f.first.id});
  assert.equal(preview.total_profit_adjustment,-300);assert.equal(preview.journals[0].date,f.first.entry_date);assert.deepEqual(preview.journals[0].lines.map(l=>[l.account_id,l.debit,l.credit]),[[f.gain.id,300,0],[f.equity.id,0,300]]);
  const result=await postSetupStockCorrection(f.s,context,body);
  assert.equal(result.total_profit_adjustment,-300);assert.equal(result.journals.length,1);
  assert.deepEqual(await protectedState(f.s),protectedBefore);assert.deepEqual(await f.s.JournalLine.filter({journal_id:f.first.id}),sourceLines);
  const original=await f.s.JournalEntry.get(f.first.id);assert.equal(original.status,'posted');assert.equal(original.total_credit,300);assert.equal(original.setup_stock_correction_journal_id,result.journals[0].journal_id);
  const correction=await f.s.JournalEntry.get(result.journals[0].journal_id);assert.equal(correction.entry_date,f.first.entry_date);assert.equal(correction.setup_stock_source_journal_id,f.first.id);assert.equal(correction.source_module,'accounting_corrections');
  assert.equal((await f.s.Account.get(f.gain.id)).balance,0);assert.equal((await f.s.Account.get(f.equity.id)).balance,300);assert.equal((await f.s.Account.get(f.inventory.id)).balance,300);
  const snapshot=structuredClone(f.rows);assert.equal((await postSetupStockCorrection(f.s,context,body)).reused,true);assert.deepEqual(f.rows,snapshot);
  await assert.rejects(postSetupStockCorrection(f.s,context,{...body,reference:'Different evidence'}),/different details/);
  assert.equal((await setupStockCorrectionWorkspace(f.s,context)).candidates[0].corrected,true);
  await assert.rejects(bodyWithToken(f),/already has a setup correction/);
});

test('corrections on separate dates leave original opening imports and later account openings independent',async()=>{
  const f=await setup(),prior=date.slice(0,4)+'-01-01',second=await f.source(40,{entryDate:prior});
  const before=await openingBalancesWorkspace(f.s,context),{body}=await bodyWithToken(f,{journalIds:[f.first.id,second.id]});
  const result=await postSetupStockCorrection(f.s,context,body),after=await openingBalancesWorkspace(f.s,context);
  assert.deepEqual(after,before);assert.equal(after.date_locked,false);assert.equal(after.history.length,0);
  for(const row of result.journals)await assert.rejects(journalLifecycle(f.s,context,{journalId:row.journal_id,action:'previewReversal'}),/original business workflow/);
  const target=await f.s.Account.create({name:'Other opening asset',account_number:'1900',account_type:'asset',normal_balance:'debit',is_active:true,is_posting:true,balance:0});
  await saveAccountOpening(f.s,context,target,{confirmed:true,amount:20,date:prior,reference:'Separate historical balance',side:'debit',offset_account_id:f.equity.id},crypto.randomUUID());
  const opening=await openingBalancesWorkspace(f.s,context);
  assert.equal(opening.history.length,1);assert.equal(opening.accounts.find(a=>a.id===target.id).opening_debit,20);assert.equal(opening.accounts.find(a=>a.id===f.equity.id).opening_credit,20);assert.equal(opening.accounts.find(a=>a.id===f.gain.id).opening_recorded,false);
  assert.equal((await f.s.Account.get(f.equity.id)).balance,360);
});

test('a real count with lower quantity but higher verified carrying value remains eligible',async()=>{
  const f=await setup(),s=f.s;await s.Employee.update('cashier',{role:'admin'});
  const warehouse=await s.Warehouse.create({name:'Ingredient store',warehouse_type:'raw_material',is_active:true});
  await s.Product.update(f.product.id,{inventory_type:'raw_material',configuration_status:'configured',unit_of_measure:'kg',current_cost:30});
  const lot=await s.StockBalance.create({product_id:f.product.id,warehouse_id:warehouse.id,lot_number:'COUNT-REVALUE',quantity:10,unit_cost:10,total_value:100,qc_status:'approved'});
  const call=body=>warehouseAdjustmentAction(f.client,user,{warehouseId:warehouse.id,...body}),workspace=await call({action:'warehouseAdjustmentWorkspace'}),row=workspace.rows.find(r=>r.balance_id===lot.id);
  const source=await call({action:'postWarehouseAdjustment',requestKey:crypto.randomUUID(),date,accountId:'expense',reference:'RECOUNT-COST',reason:'Verified setup count and current unit cost',rows:[{balance_id:lot.id,fingerprint:row.fingerprint,counted_quantity:5,use_current_cost:true}]});
  assert.equal(source.rows[0].difference,-5);assert.equal(source.value_difference,50);
  const candidate=(await setupStockCorrectionWorkspace(s,context)).candidates.find(c=>c.journal_id===source.journal_id);
  assert.equal(candidate.eligible,true,JSON.stringify(candidate.blocked_reasons));assert.equal(candidate.profit_effect,50);
  const {body,preview}=await bodyWithToken(f,{journalIds:[source.journal_id]}),stock=await protectedState(s);
  assert.equal(preview.total_profit_adjustment,-50);await postSetupStockCorrection(s,context,body);assert.deepEqual(await protectedState(s),stock);
});

test('whole-journal correction removes setup shortages as well as surpluses and preserves their separate dates',async()=>{
  const f=await setup(),loss=await f.source(-70,{profitAccount:'expense'}),{body,preview}=await bodyWithToken(f,{journalIds:[f.first.id,loss.id]});
  assert.equal(preview.total_profit_adjustment,-230);assert.equal(preview.journals.find(j=>j.source_journal_id===loss.id).profit_adjustment,70);
  await postSetupStockCorrection(f.s,context,body);
  assert.equal((await f.s.Account.get(f.gain.id)).balance,0);assert.equal((await f.s.Account.get('expense')).balance,0);assert.equal((await f.s.Account.get(f.equity.id)).balance,230);assert.equal((await f.s.Account.get(f.inventory.id)).balance,230);
});

test('changed snapshots, closed periods, unsuitable equity and later operational counts are rejected',async()=>{
  const f=await setup(),{body}=await bodyWithToken(f);
  await f.s.Account.update(f.equity.id,{name:'Changed opening clearing'});
  await assert.rejects(postSetupStockCorrection(f.s,context,body),{status:409});
  for(const change of [{is_active:false},{is_active:true,account_type:'liability'},{account_type:'equity',normal_balance:'debit'},{normal_balance:'credit',is_control_account:true},{is_control_account:false,is_treasury:true}]){
    await f.s.Account.update(f.equity.id,change);await assert.rejects(bodyWithToken(f),/posting equity/);
  }
  await f.s.Account.update(f.equity.id,{is_treasury:false});
  const prior=new Date(date+'T12:00:00Z');prior.setUTCDate(prior.getUTCDate()-1);
  await assert.rejects(bodyWithToken(f,{accountingStartDate:prior.toISOString().slice(0,10)}),/on or before/);
  await assert.rejects(bodyWithToken(f,{accountingStartDate:'2099-01-01'}),/future/);
  await f.s.AccountingPeriod.update('period',{status:'closed'});await assert.rejects(bodyWithToken(f),/open accounting period/);
});

test('cash, party allocations, wrong inventory mappings, mismatched evidence and reversals cannot be relabeled setup stock',async()=>{
  const scenarios=[
    async f=>{const line=(await f.s.JournalLine.filter({journal_id:f.first.id}))[0];await f.s.JournalLine.update(line.id,{party_type:'supplier',party_id:'supplier'});},
    async f=>{await f.s.Product.update(f.product.id,{inventory_account_id:''});},
    async f=>{await f.s.JournalEntry.update(f.first.id,{status:'reversed'});},
    async f=>{await f.s.JournalEntry.update(f.first.id,{reversed_by_journal:'reversal-id'});},
    async f=>{const movement=(await f.s.StockMovement.filter({journal_id:f.first.id}))[0];await f.s.StockMovement.update(movement.id,{total_value:1});},
    async f=>{await f.s.AuditLog.update(f.first.source_document_id,{warehouse_adjustment_result:{journal_id:'another',date}});},
    async f=>{await f.s.Account.update(f.inventory.id,{is_treasury:true});},
  ];
  for(const scenario of scenarios){const f=await setup();await scenario(f);const before=structuredClone(f.rows),workspace=await setupStockCorrectionWorkspace(f.s,context);assert.equal(workspace.candidates[0].eligible,false);assert.ok(workspace.candidates[0].blocked_reasons.length);await assert.rejects(bodyWithToken(f));assert.deepEqual(f.rows,before);}
  const f=await setup(),cash=await f.source(20,{cash:true});await assert.rejects(bodyWithToken(f,{journalIds:[cash.id]}),/Cash, treasury/);
});

test('authorization, stale ledger caches and incomplete confirmation prevent writes',async()=>{
  const f=await setup(),{body}=await bodyWithToken(f),before=structuredClone(f.rows);
  const staff={user:{id:'worker',role:'user'},role:'cashier',employee:{role:'cashier',status:'active'}};
  await assert.rejects(setupStockCorrectionWorkspace(f.s,staff),{status:403});await assert.rejects(previewSetupStockCorrection(f.s,staff,f.body),{status:403});await assert.rejects(postSetupStockCorrection(f.s,staff,body),{status:403});
  await assert.rejects(postSetupStockCorrection(f.s,context,{...body,confirmed:false}),/Review and confirm/);assert.deepEqual(f.rows,before);
  await f.s.Account.update(f.gain.id,{balance:301});await assert.rejects(bodyWithToken(f),/affected account balances/);
});

test('generic mutations cannot forge correction source links, metadata or audit evidence',()=>{
  for(const data of [{source_module:'accounting_corrections'},{source_document_type:'SetupStockCorrection'},{setup_stock_correction_id:'SSC-forged'},{setup_stock_source_journal_id:'original'}]){
    assert.throws(()=>guardMutation(context,'JournalEntry','create',data));
    assert.throws(()=>guardMutation(context,'JournalEntry','update',data,{id:'draft',status:'draft'}));
  }
  for(const data of [{module:'accounting_corrections'},{action:'correct_setup_stock'},{id:'SSC-forged'},{setup_stock_correction_result:{journal_id:'forged'}}]){
    assert.throws(()=>guardMutation(context,'AuditLog','create',data));
    assert.throws(()=>guardMutation(context,'AuditLog','update',data,{id:'event'}));
  }
});

async function api(){
  const mocks={
    '@/server/auth':"export const authenticateRequest=async feature=>{globalThis.__setupStockTest.feature=feature;return globalThis.__setupStockTest.context;},checkOrigin=()=>{},apiError=e=>Response.json({error:e.message},{status:e.status||400});",
    '@/server/entities':"export const serviceEntities=new Proxy({},{get:(_,key)=>globalThis.__setupStockTest.s[key]});",
    '@/server/db':"export const database=()=>({unsafe:async()=>{}}),transaction=async fn=>{const db=globalThis.__setupStockTest.db;await db.exec('BEGIN');try{const result=await fn();await db.exec('COMMIT');return result;}catch(e){await db.exec('ROLLBACK');throw e;}};",
  };
  const out=await build({entryPoints:['src/app/api/accounting/setup-stock-correction/route.js'],bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'setup-stock-api',setup(b){b.onResolve({filter:/^@\/server\//},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
  return import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));
}
test('API transaction rolls back corrective journals and source links after a late audit failure; retries post once',async()=>{
  const db=new PGlite();
  try{
    const f=await setup(db),route=await api();globalThis.__setupStockTest={...f,db,context};
    const post=body=>route.POST(new Request('http://localhost/api/accounting/setup-stock-correction',{method:'POST',body:JSON.stringify(body)}));
    const workspace=await route.GET();assert.equal(workspace.status,200);assert.equal(workspace.headers.get('Cache-Control'),'private, no-store');assert.equal(globalThis.__setupStockTest.feature,'accounting');
    const preview=await post({action:'preview',...f.body});assert.equal(preview.status,200);const {token}=await preview.json(),body={action:'post',...f.body,token,requestKey:crypto.randomUUID(),confirmed:true};
    const before=(await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows,create=f.s.AuditLog.create;
    f.s.AuditLog.create=async value=>{if(value.action==='correct_setup_stock')throw Error('Audit unavailable');return create(value);};
    const failed=await post(body);assert.equal(failed.status,400);assert.match((await failed.json()).error,/Audit unavailable/);assert.deepEqual((await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows,before);
    f.s.AuditLog.create=create;const success=await post(body);assert.equal(success.status,200);const saved=await success.json(),retry=await post(body);assert.equal(retry.status,200);assert.equal((await retry.json()).correction_id,saved.correction_id);
    assert.equal((await f.s.JournalEntry.list()).length,2);assert.equal((await f.s.AuditLog.filter({action:'correct_setup_stock'})).length,1);
  }finally{delete globalThis.__setupStockTest;await db.close();}
});
