import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {build} from 'esbuild';
import {fixture,date,user} from './helpers/cashier.mjs';
import {openingPositionWorkspace,saveOpeningPosition} from '../src/server/domain/opening-position.js';
import {postOpeningBalances} from '../src/server/domain/opening-balances.js';
import {supplierLifecycle} from '../src/server/domain/supplier-lifecycle.js';
import {supplierAction} from '../src/server/domain/supplier-workspace.js';
import {cashierAction} from '../src/server/domain/cashier-workspace.js';
import {purchasePaymentDecision} from '../src/server/domain/purchase-workspace.js';
import {verifiedOpeningDocument} from '../src/server/domain/opening-payments.js';
import {validateAllocations,approveReceipt} from '../src/server/domain/customer-receipts.js';
import {openingOffset} from '../src/lib/opening-offset.js';
import {openingPositionTotals} from '../src/lib/opening-position-totals.js';
import {companySalesRegister} from '../src/lib/company-sales.js';
import {scheduleThrough} from '../src/lib/asset-schedule.js';
import {guardMutation} from '../src/server/access.js';
const context={user:{id:'gm',role:'admin'},role:'admin',employee:null};
const previous=new Date(date.slice(0,8)+'01T12:00:00Z');previous.setUTCDate(0);const opening=previous.toISOString().slice(0,10);
async function setup(db){
 const f=await fixture(db),s=f.entities;let seq=0;
 const table=name=>{
  f.rows[name]||=[];
  const list=async()=>db?(await db.query('SELECT data FROM fixture_entity WHERE entity=$1',[name])).rows.map(r=>r.data):structuredClone(f.rows[name]);
  const get=async id=>(await list()).find(r=>r.id===id);
  const create=async value=>{const row={...value,id:value.id||name+'-'+ ++seq};if(db)await db.query('INSERT INTO fixture_entity VALUES($1,$2,$3)',[name,row.id,JSON.stringify(row)]);else f.rows[name].push(structuredClone(row));return row;};
  const update=async(id,v)=>{const row={...await get(id),...v};if(db)await db.query('UPDATE fixture_entity SET data=$1 WHERE entity=$2 AND id=$3',[JSON.stringify(row),name,id]);else Object.assign(f.rows[name].find(r=>r.id===id),v);return row;};
  return {list,get,create,update,filter:async q=>(await list()).filter(r=>Object.entries(q).every(([k,v])=>r[k]===v))};
 };
 s.FixedAsset=table('FixedAsset');const audit=table('AuditLog');s.AuditLog.create=audit.create;
 for(const id of ['receivable','inventory'])await s.Account.update(id,{account_type:'asset',is_control_account:true});
 await s.Account.update('payable',{account_type:'liability',is_control_account:true});
 const equity=await s.Account.create({name:'Retained equity',account_number:'100',account_type:'equity',normal_balance:'credit',is_active:true,is_posting:true});
 const cost=await s.Account.create({name:'Machinery cost',account_number:'215',account_type:'asset',normal_balance:'debit',is_active:true,is_posting:true});
 const accum=await s.Account.create({name:'Accumulated depreciation',account_number:'2815',account_type:'asset',normal_balance:'credit',is_active:true,is_posting:true});
 await s.PostingRule.create({rule_key:'supplier_payable',account_id:'payable',is_active:true});
 await s.PostingRule.create({rule_key:'raw_material_inventory',account_id:'inventory',is_active:true});
 const product=await s.Product.create({name:'Milk powder',inventory_type:'ingredient',configuration_status:'ready',is_active:true,storage_unit:'kg'});
 const details=[
 {kind:'cash',treasury_id:'till',amount:50000},
 {kind:'stock',product_id:product.id,warehouse_id:'factory',quantity:10,unit_cost:500,lot_number:'OLD-LOT'},
 {kind:'asset',name:'Existing mixer',reference:'MIX-OLD',acquisition_date:opening.slice(0,4)+'-01-01',acquisition_cost:100000,accumulated_depreciation:20000,salvage_value:10000,remaining_months:35,asset_account_id:cost.id,accum_dep_account_id:accum.id,expense_account_id:'expense'},
 {kind:'receivable',party_id:'customer-a',reference:'INV-LEGACY',document_date:opening,due_date:date,amount:25000},
 {kind:'payable',party_id:'supplier',reference:'BILL-LEGACY',document_date:opening,due_date:date,amount:10000}
 ];
 const body={action:'post',requestKey:crypto.randomUUID(),date:opening,reference:'Old books closing position',details,lines:[{account_id:equity.id,credit:150000}]};
 return {...f,cost,accum,equity,product,body};
}
test('opening position posts one balanced batch, fills registers and preserves prior depreciation without new operations',async()=>{
 const f=await setup(),s=f.entities;
 const before={sales:f.rows.SalesOrder.length,purchases:f.rows.PurchaseOrder.length,cash:f.rows.TreasuryTransaction.length};
 const result=await saveOpeningPosition(s,context,f.body),j=await s.JournalEntry.get(result.journal.id);
 assert.equal(j.total_debit,180000);assert.equal(j.total_credit,180000);assert.equal(j.source_module,'opening_balances');
 assert.equal((await s.TreasuryAccount.get('till')).balance,50000);
 const stock=await s.StockBalance.get(result.stock[0]);assert.equal(stock.quantity,10);assert.equal(stock.total_value,5000);assert.equal(stock.qc_status,'quarantine');
 const asset=await s.FixedAsset.get(result.assets[0]);assert.equal(asset.accumulated_depreciation,20000);assert.equal(asset.net_book_value,80000);assert.equal(scheduleThrough(asset,opening.slice(0,7)).length,0);assert.equal(scheduleThrough(asset,date.slice(0,7)).length,1);
 assert.equal((await s.Customer.get('customer-a')).balance,25000);assert.equal((await s.Supplier.get('supplier')).balance,10000);
 assert.equal(await verifiedOpeningDocument(s,await s.Invoice.get(result.receivables[0]),'Invoice'),true);
 assert.equal(await verifiedOpeningDocument(s,await s.Bill.get(result.payables[0]),'Bill'),true);
 assert.deepEqual({sales:f.rows.SalesOrder.length,purchases:f.rows.PurchaseOrder.length,cash:f.rows.TreasuryTransaction.length},before);
 const snapshot=structuredClone(f.rows);assert.equal((await saveOpeningPosition(s,context,f.body)).reused,true);assert.deepEqual(f.rows,snapshot);
 await assert.rejects(saveOpeningPosition(s,context,{...f.body,reference:'changed'}),{status:409});
 const w=await openingPositionWorkspace(s,context);assert.equal(w.accounts.find(a=>a.id==='receivable').opening_details_recorded,true);
 const totals=openingPositionTotals(f.body.details,f.body.lines,w);assert.equal(totals.debit,180000);assert.equal(totals.credit,180000);
 assert.equal(companySalesRegister({invoices:await s.Invoice.list(),from:opening,to:date}).rows.length,0);
});
test('legacy GL balances accept exact debt schedules once without a second journal or changed monetary lines',async()=>{
 const f=await setup(),s=f.entities,details=f.body.details.filter(d=>['receivable','payable'].includes(d.kind));
 await postOpeningBalances(s,context,{...f.body,details:undefined,lines:[{account_id:'receivable',debit:25000},{account_id:'payable',credit:10000},{account_id:f.equity.id,credit:15000}],acknowledgeControlBalances:true});
 const amounts=(await s.JournalLine.list()).map(l=>[l.id,l.debit,l.credit]);
 const body={...f.body,requestKey:crypto.randomUUID(),action:'attach',details,lines:[]};
 await assert.rejects(saveOpeningPosition(s,context,{...body,details:[details[0],{...details[1],amount:9999}]}),/exactly match/);
 assert.equal((await s.JournalLine.list()).some(l=>l.opening_party_allocations),false);
 const result=await saveOpeningPosition(s,context,body);assert.equal(result.linked_only,true);assert.equal((await s.JournalEntry.list()).length,1);
 assert.deepEqual((await s.JournalLine.list()).map(l=>[l.id,l.debit,l.credit]),amounts);
 assert.equal((await s.Supplier.get('supplier')).balance,10000);
 const ws=await supplierAction(f.client,{id:'gm',role:'admin'},{action:'supplierWorkspace'});assert.equal(ws.suppliers.find(x=>x.id==='supplier').ledger_balance,10000);
 await assert.rejects(saveOpeningPosition(s,context,{...body,requestKey:crypto.randomUUID()}),/already recorded|already linked|already recorded|exactly match/);
});
test('invalid details fail before writes, including existing stock, duplicate documents and asset references',async()=>{
 const f=await setup(),s=f.entities;
 const mutations=[
 {...f.body,date:'2026-02-30'},
 {...f.body,details:[...f.body.details,f.body.details[3]]},
 {...f.body,details:f.body.details.map(d=>d.kind==='stock'?{...d,quantity:1.0001}:d)},
 {...f.body,details:f.body.details.map(d=>d.kind==='asset'?{...d,accumulated_depreciation:100001}:d)},
 {...f.body,details:f.body.details.map(d=>d.kind==='payable'?{...d,party_id:'missing'}:d)},
 {...f.body,lines:[...f.body.lines,...f.body.lines]}
 ];
 for(const body of mutations){const before=structuredClone(f.rows);await assert.rejects(saveOpeningPosition(s,context,body));assert.deepEqual(f.rows,before);}
 await s.StockMovement.create({product_id:f.product.id,destination_warehouse_id:'factory',quantity:1});
 await assert.rejects(saveOpeningPosition(s,context,f.body),/stock activity/);
});
test('opening migration and generic mutation guards protect permissions and immutable import evidence',async()=>{
 const f=await setup(),s=f.entities;
 for(const ctx of [{...context,role:'cashier',user:{id:'cashier',role:'user'},employee:{role:'cashier',status:'active'}},{...context,employee:{status:'inactive',role:'admin'}}]){
  await assert.rejects(openingPositionWorkspace(s,ctx),{status:403});await assert.rejects(saveOpeningPosition(s,ctx,f.body),{status:403});
 }
 const result=await saveOpeningPosition(s,context,f.body),bill=await s.Bill.get(result.payables[0]);
 for(const [entity,operation,value,existing] of [['Bill','update',{balance:0},bill],['Invoice','create',{opening_batch_id:'forged'}],['StockBalance','delete',{},await s.StockBalance.get(result.stock[0])],['Supplier','delete',{},await s.Supplier.get('supplier')],['Payment','update',{status:'approved'},{opening_bill_payment:true}]]){
  assert.throws(()=>guardMutation(context,entity,operation,value,existing),{status:403});
 }
});
test('opening supplier bills follow GM authorization and clear the payable exactly once on cash release',async()=>{
 const f=await setup(),s=f.entities,result=await saveOpeningPosition(s,context,f.body),bill=await s.Bill.get(result.payables[0]);
 const req={action:'cashierRequestPayment',billId:bill.id,accountId:'till',amount:5000,date,requestKey:crypto.randomUUID()};
 const {payment}=await cashierAction(f.client,user,req);assert.equal(payment.status,'pending_approval');assert.equal(payment.po_id,undefined);
 const release={action:'cashierReleasePayment',paymentId:payment.id,accountId:'till',date,requestKey:crypto.randomUUID()};
 await assert.rejects(cashierAction(f.client,user,release),/approved by/);
 await assert.rejects(purchasePaymentDecision(f.client,user,{action:'approvePurchasePayment',paymentId:payment.id}),/Not permitted/);
 await purchasePaymentDecision(f.client,{id:'gm',role:'admin'},{action:'approvePurchasePayment',paymentId:payment.id});
 await cashierAction(f.client,user,release);await cashierAction(f.client,user,release);
 assert.equal((await s.Bill.get(bill.id)).balance,5000);assert.equal((await s.Supplier.get('supplier')).balance,5000);
 assert.equal((await s.TreasuryAccount.get('till')).balance,45000);assert.equal((await s.PaymentAllocation.list()).length,1);
});
test('opening customer receipts retain the original receivable control account after posting rules change',async()=>{
 const f=await setup(),s=f.entities,result=await saveOpeningPosition(s,context,f.body),invoice=await s.Invoice.get(result.receivables[0]);
 const account=await s.Account.create({name:'New AR',account_type:'asset',normal_balance:'debit',is_active:true,is_posting:true,balance:0});await s.PostingRule.update('customer_receivable',{account_id:account.id});
 const wrapped={entities:{...s}};
 for(const name of ['Invoice','Payment','PaymentAllocation','TreasuryTransaction'])wrapped.entities[name]={...s[name],filter:async(q,options)=>({items:await s[name].filter(q,null,options?.limit),has_more:false})};
 // approveReceipt's compare-and-set adapter is supplied by the production request client.
 wrapped.entities.Payment.update=async(id,value)=>s.Payment.update(id,value);
 wrapped.entities.Payment.updateMany=async(query,change)=>{const p=await s.Payment.get(query.id);if(!p[Object.keys(query).find(k=>k!=='id')])await s.Payment.update(query.id,change.$set);};
 const allocated=await validateAllocations(wrapped,[{invoice_id:invoice.id,amount:1000}],'customer-a');assert.equal(allocated[0].invoice.opening_account_id,'receivable');
 await assert.rejects(validateAllocations(wrapped,[{invoice_id:invoice.id,amount:30000}],'customer-a'),/remains/);
 const payment=await s.Payment.create({payment_number:'OLD-AR-COLLECTION',payment_type:'customer_payment',party_id:'customer-a',party_name:'Customer A',amount:1000,payment_date:date,treasury_account_id:'till',status:'pending_approval',cashier_confirmed_by:'cashier',receipt_posting_token:'',receipt_allocations:[{invoice_id:invoice.id,amount:1000}]});
 const beforeOpening=new Date(opening+'T12:00:00Z');beforeOpening.setUTCDate(beforeOpening.getUTCDate()-1);await s.Payment.update(payment.id,{payment_date:beforeOpening.toISOString().slice(0,10)});
 await assert.rejects(approveReceipt(wrapped,await s.Payment.get(payment.id),{id:'gm'}),/before its opening date/);assert.equal((await s.TreasuryAccount.get('till')).balance,50000);await s.Payment.update(payment.id,{payment_date:date});
 await approveReceipt(wrapped,await s.Payment.get(payment.id),{id:'gm',full_name:'GM'});await approveReceipt(wrapped,await s.Payment.get(payment.id),{id:'gm'});
 assert.equal((await s.Invoice.get(invoice.id)).balance,24000);assert.equal((await s.Customer.get('customer-a')).balance,24000);assert.equal((await s.Account.get('receivable')).balance,24000);assert.equal((await s.Account.get(account.id)).balance,0);assert.equal((await s.TreasuryAccount.get('till')).balance,51000);
});
async function route(entry='src/app/api/accounting/opening-position/route.js'){
 const mocks={
 '@/server/auth':'export const authenticateRequest=async()=>globalThis.__position.context,checkOrigin=()=>{},apiError=e=>Response.json({error:e.message},{status:e.status||400});',
 '@/server/entities':'export const serviceEntities=new Proxy({},{get:(_,key)=>globalThis.__position.entities[key]});',
 '@/server/db':'export const database=()=>({unsafe:async()=>{}}),transaction=async run=>{const db=globalThis.__position.db;await db.exec("BEGIN");try{const r=await run();await db.exec("COMMIT");return r;}catch(e){await db.exec("ROLLBACK");throw e;}};'
 };
 const r=await build({entryPoints:[entry],bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'position-fixture',setup(b){b.onResolve({filter:new RegExp('^@/server/')},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
 return import('data:text/javascript;base64,'+Buffer.from(r.outputFiles[0].text).toString('base64'));
}
test('API rolls back GL, stock, debt registers and caches on late audit failure, then retries once',async()=>{
 const db=new PGlite();try{
  const f=await setup(db),s=f.entities,r=await route();globalThis.__position={...f,context,db};
  const before=(await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows,create=s.AuditLog.create;
  s.AuditLog.create=async v=>{if(v.action==='import_opening_position')throw Error('Audit storage unavailable');return create(v);};
  const post=()=>r.POST(new Request('http://localhost/api/accounting/opening-position',{method:'POST',body:JSON.stringify(f.body)}));
  assert.equal((await post()).status,400);assert.deepEqual((await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows,before);
  s.AuditLog.create=create;let response=await post();assert.equal(response.status,200,JSON.stringify(await response.clone().json()));assert.equal((await post()).status,200);assert.equal((await s.JournalEntry.list()).length,1);
 }finally{delete globalThis.__position;await db.close();}
});
test('supplier deletion is reversible, retry safe and preserves purchase history while hiding the directory entry',async()=>{
 const f=await setup(),s=f.entities;await s.PurchaseOrder.update('po',{status:'cancelled'});
 const body={action:'remove',revision:0,reason:'Duplicate supplier entry',requestKey:crypto.randomUUID()};
 const saved=await supplierLifecycle(context,s,'supplier',body);assert.equal(saved.supplier.is_active,false);assert.ok(saved.supplier.supplier_removed_at);
 assert.equal((await supplierLifecycle(context,s,'supplier',body)).reused,true);assert.ok(await s.PurchaseOrder.get('po'));
 assert.equal((await supplierAction(f.client,{id:'gm',role:'admin'},{action:'supplierWorkspace'})).suppliers.length,0);
 const restore=await supplierLifecycle(context,s,'supplier',{...body,action:'restore',revision:1,requestKey:crypto.randomUUID()});assert.equal(restore.supplier.supplier_removed_at,null);assert.equal(restore.supplier.is_active,false);
 await assert.rejects(supplierLifecycle(context,s,'supplier',{...body,requestKey:crypto.randomUUID()}),{status:409});
});
test('supplier deletion rejects active purchasing, debts, preferred-item links and unauthorized staff',async()=>{
 const f=await setup(),s=f.entities,body={action:'remove',revision:0,reason:'Duplicate record',requestKey:crypto.randomUUID()};
 await assert.rejects(supplierLifecycle(context,s,'supplier',body),/unfinished/);
 await s.PurchaseOrder.update('po',{status:'cancelled'});await s.Supplier.update('supplier',{balance:12});await assert.rejects(supplierLifecycle(context,s,'supplier',body),/Settle/);
 await s.Supplier.update('supplier',{balance:0});await s.Product.update(f.product.id,{preferred_supplier_id:'supplier'});await assert.rejects(supplierLifecycle(context,s,'supplier',body),/preferred supplier/);
 await assert.rejects(supplierLifecycle({...context,role:'cashier',user:{id:'cashier',role:'user'},employee:{role:'cashier',status:'active'}},s,'supplier',body),{status:403});
});

test('supplier deletion route rolls back a directory change if its audit fails and retries without duplicating it',async()=>{
 const db=new PGlite();try{
  const f=await setup(db),s=f.entities,r=await route('src/app/api/suppliers/[id]/lifecycle/route.js');globalThis.__position={...f,context,db};
  await s.PurchaseOrder.update('po',{status:'cancelled'});const create=s.AuditLog.create,before=(await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows;
  s.AuditLog.create=async()=>{throw Error('Audit unavailable');};
  const body={action:'remove',revision:0,reason:'Duplicate entry',requestKey:crypto.randomUUID()},post=()=>r.POST(new Request('http://localhost/api/suppliers/supplier/lifecycle',{method:'POST',body:JSON.stringify(body)}),{params:Promise.resolve({id:'supplier'})});
  assert.equal((await post()).status,400);assert.deepEqual((await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows,before);
  s.AuditLog.create=create;assert.equal((await post()).status,200);assert.equal((await post()).status,200);assert.equal((await s.Supplier.get('supplier')).supplier_lifecycle_revision,1);assert.equal((await s.AuditLog.list()).length,1);
 }finally{delete globalThis.__position;await db.close();}
});

test('detailed opening debits reject posting alone and accept only their full reviewed equity counterpart',async()=>{
 const f=await setup(),s=f.entities,body={...f.body,details:[f.body.details[0]],lines:[]},before=structuredClone(f.rows);
 await assert.rejects(saveOpeningPosition(s,context,body),/must balance/);assert.deepEqual(f.rows,before);
 const workspace=await openingPositionWorkspace(s,context),totals=openingPositionTotals(body.details,[],workspace),offset=openingOffset(totals,f.equity.id,workspace.accounts);
 assert.equal(offset.line.credit,50000);const result=await saveOpeningPosition(s,context,{...body,lines:[offset.line]});
 const journal=await s.JournalEntry.get(result.journal.id);assert.equal(journal.total_debit,50000);assert.equal(journal.total_credit,50000);
 const lines=await s.JournalLine.filter({journal_id:journal.id});assert.equal(lines.find(l=>l.account_id==='till-gl').debit,lines.find(l=>l.account_id===f.equity.id).credit);
});
