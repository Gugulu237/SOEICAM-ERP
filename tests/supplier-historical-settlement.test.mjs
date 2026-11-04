import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {build} from 'esbuild';
import {fixture,date} from './helpers/cashier.mjs';
import {postJournal} from '../src/server/domain/field-ops.js';
import {historicalSettlementWorkspace,previewHistoricalSettlement,postHistoricalSettlement} from '../src/server/domain/supplier-historical-settlement.js';
import {guardMutation} from '../src/server/access.js';

const context={user:{id:'gm',role:'admin'},role:'admin'};
async function setup(db){
  const f=await fixture(db),s=f.entities,create=s.AuditLog.create;
  s.AuditLog.create=async row=>{
    if(!row.id)return create(row);
    const value={...row,audit_source:'server_verified'};
    if(db)await db.query('INSERT INTO fixture_entity VALUES($1,$2,$3)',['AuditLog',value.id,JSON.stringify(value)]);
    else{if(f.rows.AuditLog.some(a=>a.id===value.id))throw Error('Duplicate audit');f.rows.AuditLog.push(structuredClone(value));}
    return value;
  };
  await s.Account.update('payable',{account_type:'liability',is_control_account:true});
  const equity=await s.Account.create({account_number:'TEST-OPEN',name:'Migration clearing',account_type:'equity',normal_balance:'credit',is_active:true,is_posting:true,balance:0});
  const inventory=await s.Account.create({account_number:'TEST-STOCK',name:'Materials',account_type:'asset',normal_balance:'debit',is_active:true,is_posting:true,balance:0});
  await s.PostingRule.create({rule_key:'supplier_payable',account_id:'payable',is_active:true});
  const receipt=await s.GoodsReceipt.create({supplier_id:'supplier',po_id:'po',status:'confirmed',receipt_date:date});
  const {journal}=await postJournal({entities:s},{entryDate:date,description:'Received goods',sourceModule:'procurement',sourceDocumentType:'GoodsReceipt',sourceDocumentId:receipt.id,userId:'gm',lines:[{account_id:inventory.id,debit:120.25},{account_id:'payable',credit:120.25,party_type:'supplier',party_id:'supplier'}]});
  const bill=await s.Bill.create({supplier_id:'supplier',bill_number:'TEST-BILL',bill_date:date,total:120.25,amount_paid:0,balance:120.25,status:'open',accounting_source:'goods_receipt',journal_id:journal.id,receipt_id:receipt.id,po_id:'po'});
  await s.GoodsReceipt.update(receipt.id,{bill_id:bill.id});await s.Supplier.update('supplier',{balance:120.25});
  const body={billIds:[bill.id],date,offsetAccountId:equity.id,reference:'Owner confirms pre-system payment'};
  return {...f,bill,receipt,journal,equity,inventory,body};
}
async function confirmation(f){const preview=await previewHistoricalSettlement(f.entities,context,'supplier',f.body);return {...f.body,token:preview.token,confirmed:true,requestKey:crypto.randomUUID()};}

test('historical settlement clears exact debt and bills, preserves operations, and retries without duplicate posting',async()=>{
  const f=await setup(),s=f.entities,untouched=['StockBalance','StockMovement','Payment','PaymentAllocation','TreasuryAccount','TreasuryTransaction','Invoice','SalesOrder','Customer','GoodsReceipt','PurchaseOrder'];
  const before=structuredClone(f.rows),ws=await historicalSettlementWorkspace(s,context,'supplier');
  assert.equal(ws.ledger_balance,120.25);assert.equal(ws.bills[0].eligible,true);
  const body=await confirmation(f);assert.deepEqual(f.rows,before);
  const result=await postHistoricalSettlement(s,context,'supplier',body);
  assert.equal(result.total,120.25);assert.equal(result.cash_movement,0);
  assert.equal((await s.Bill.get(f.bill.id)).balance,0);assert.equal((await s.Bill.get(f.bill.id)).amount_paid,120.25);assert.equal((await s.Supplier.get('supplier')).balance,0);
  assert.equal((await s.Account.get('payable')).balance,0);assert.equal((await s.Account.get(f.equity.id)).balance,120.25);assert.equal((await s.Account.get(f.inventory.id)).balance,120.25);
  for(const n of untouched)assert.deepEqual(f.rows[n],before[n],n);
  for(const j of before.JournalEntry)assert.deepEqual(await s.JournalEntry.get(j.id),j);
  const lines=await s.JournalLine.filter({journal_id:result.journal_id});
  assert.equal(lines.find(l=>l.account_id==='payable').party_id,'supplier');assert.equal(lines.find(l=>l.account_id==='payable').debit,120.25);
  const audit=f.rows.AuditLog.find(a=>a.action==='supplier_historical_settlement');assert.equal(audit.historical_settlement_before.bills[0].balance,120.25);
  const after=structuredClone(f.rows);assert.equal((await postHistoricalSettlement(s,context,'supplier',body)).reused,true);assert.deepEqual(f.rows,after);
  await assert.rejects(postHistoricalSettlement(s,context,'supplier',{...body,reference:'Different intent'}),{status:409});
  assert.equal((await historicalSettlementWorkspace(s,context,'supplier')).completed,true);
});

test('rent payable, other suppliers and supplier advance assets are preserved',async()=>{
  const f=await setup(),s=f.entities;
  const rent=await s.Account.create({account_type:'liability',normal_balance:'credit',is_posting:true,balance:0}),advance=await s.Account.create({account_type:'asset',normal_balance:'debit',is_posting:true,balance:0});
  await postJournal({entities:s},{entryDate:date,sourceDocumentId:'other-balances',sourceModule:'opening_balances',userId:'gm',lines:[{account_id:advance.id,debit:40,party_type:'supplier',party_id:'supplier'},{account_id:rent.id,credit:30},{account_id:'payable',credit:10,party_type:'supplier',party_id:'another-supplier'}]});
  const beforeRent=await s.Account.get(rent.id),beforeAdvance=await s.Account.get(advance.id);
  await postHistoricalSettlement(s,context,'supplier',await confirmation(f));
  assert.deepEqual(await s.Account.get(rent.id),beforeRent);assert.deepEqual(await s.Account.get(advance.id),beforeAdvance);assert.equal((await s.Account.get('payable')).balance,10);
});

test('conflicting payments, receipt evidence, unbilled debt and invalid counterparts block the correction without writes',async()=>{
  const variations=[
    async f=>f.entities.Payment.create({party_id:'supplier',status:'pending_approval',amount:1}),
    async f=>f.entities.Payment.create({party_id:'supplier',status:'posted',amount:1}),
    async f=>f.entities.PaymentAllocation.create({party_id:'supplier',amount:1}),
    async f=>f.entities.Bill.update(f.bill.id,{accounting_source:'recurring_expense'}),
    async f=>f.entities.Bill.update(f.bill.id,{amount_paid:1,balance:119.25,status:'partially_paid'}),
    async f=>f.entities.Bill.update(f.bill.id,{total:121}),
    async f=>f.entities.GoodsReceipt.update(f.receipt.id,{status:'draft'}),
    async f=>f.entities.GoodsReceipt.update(f.receipt.id,{po_id:'other'}),
    async f=>f.entities.JournalEntry.update(f.journal.id,{status:'reversed'}),
    async f=>f.entities.JournalEntry.update(f.journal.id,{total_credit:130}),
    async f=>f.entities.JournalLine.update(f.rows.JournalLine.find(l=>l.account_id==='payable').id,{party_id:'another'}),
    async f=>f.entities.Account.update(f.equity.id,{account_type:'expense'}),
    async f=>f.entities.TreasuryAccount.create({gl_account_id:f.equity.id}),
    async f=>f.entities.Account.update('payable',{balance:130}),
    async f=>f.entities.AccountingPeriod.update('period',{status:'closed'}),
    async f=>postJournal({entities:f.entities},{entryDate:date,sourceDocumentId:'unbilled',sourceModule:'procurement',userId:'gm',lines:[{account_id:f.inventory.id,debit:5},{account_id:'payable',credit:5,party_type:'supplier',party_id:'supplier'}]}),
  ];
  for(const vary of variations){const f=await setup();await vary(f);const before=structuredClone(f.rows);await assert.rejects(previewHistoricalSettlement(f.entities,context,'supplier',f.body));assert.deepEqual(f.rows,before);}
});

test('confirmation, stale previews, one-time markers and role boundaries are enforced',async()=>{
  const f=await setup(),body=await confirmation(f),s=f.entities;
  for(const patch of [{confirmed:false},{token:'bad'},{requestKey:'bad'},{billIds:[]},{billIds:[f.bill.id,f.bill.id]},{date:'2026-02-30'},{reference:''}])await assert.rejects(postHistoricalSettlement(s,context,'supplier',{...body,...patch}));
  await s.Supplier.update('supplier',{notes:'Changed since review'});await assert.rejects(postHistoricalSettlement(s,context,'supplier',body),{status:409});
  const cashier={user:{id:'cashier',role:'user'},role:'cashier',employee:{role:'cashier',status:'active'}};
  await assert.rejects(historicalSettlementWorkspace(s,cashier,'supplier'),{status:403});await assert.rejects(postHistoricalSettlement(s,cashier,'supplier',body),{status:403});
  for(const operation of ['create','update','delete','deleteMany'])assert.throws(()=>guardMutation(context,'AuditLog',operation,operation==='create'?{action:'supplier_historical_settlement'}:{},{historical_settlement_result:{}}),{status:403});
  assert.throws(()=>guardMutation(context,'Supplier','update',{historical_settlement_id:'fake'},{id:'supplier'}),{status:403});
  assert.equal(f.rows.JournalEntry.length,1);
});

async function route(){
  const mocks={
    '@/server/auth':'export const authenticateRequest=async()=>globalThis.__historical.context,checkOrigin=()=>{},apiError=e=>Response.json({error:e.message},{status:e.status||400});',
    '@/server/entities':'export const serviceEntities=new Proxy({},{get:(_,key)=>globalThis.__historical.entities[key]});',
    '@/server/db':'export const database=()=>({unsafe:async(sql,args)=>globalThis.__historical.locks.push(args[0])}),transaction=async run=>{const db=globalThis.__historical.db;await db.exec("BEGIN");try{const r=await run();await db.exec("COMMIT");return r;}catch(e){await db.exec("ROLLBACK");throw e;}};'
  };
  const out=await build({entryPoints:['src/app/api/suppliers/[id]/historical-settlement/route.js'],bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'historical-fixture',setup(b){b.onResolve({filter:/^@\/server\//},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
  return import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));
}
test('HTTP transaction rolls back journal, bills, caches and audit together; durable retry succeeds once',async()=>{
  const db=new PGlite();
  try{
    const f=await setup(db),s=f.entities,r=await route();globalThis.__historical={...f,db,context,locks:[]};
    const params={params:Promise.resolve({id:'supplier'})},post=body=>r.POST(new Request('http://localhost/api/suppliers/supplier/historical-settlement',{method:'POST',body:JSON.stringify(body)}),params);
    const preview=await (await post({...f.body,action:'preview'})).json(),body={...f.body,action:'post',token:preview.token,requestKey:crypto.randomUUID(),confirmed:true};
    const snapshot=async()=>(await db.query('SELECT * FROM fixture_entity ORDER BY entity,id')).rows;
    const before=await snapshot(),create=s.AuditLog.create;
    s.AuditLog.create=async data=>{if(data.action==='supplier_historical_settlement')throw Error('Audit unavailable');return create(data);};
    assert.equal((await post(body)).status,400);assert.deepEqual(await snapshot(),before);s.AuditLog.create=create;
    const response=await post(body);assert.equal(response.status,200,JSON.stringify(await response.clone().json()));assert.match(response.headers.get('Cache-Control'),/no-store/);
    const saved=await snapshot();assert.equal((await (await post(body)).json()).reused,true);assert.deepEqual(await snapshot(),saved);
    assert.ok(globalThis.__historical.locks.every(l=>l==='supplier-historical-settlement:supplier'));
    assert.equal((await post({...body,requestKey:crypto.randomUUID()})).status,409);
  }finally{delete globalThis.__historical;await db.close();}
});
