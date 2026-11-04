import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import catalog from '../src/server/generated/schema.json' with {type:'json'};
import {postgresAdapter} from './helpers/postgres-adapter.mjs';
import {dispatchAction} from '../src/server/domain/dispatch-operations.js';
import {planCutover,inspectCutover,applyCutover,openingAccountReview,ENTITIES,CUTOVER_ID,NOT_AFTER,CLEARING_ACCOUNT_ID,CLEARING_ACCOUNT_NUMBER,hash} from '../scripts/driver-stock-cutover-lib.mjs';

const old='2026-11-03T12:00:00.000Z';
function rows(){
  const t=Object.fromEntries(ENTITIES.map(n=>[n,[]]));
  const row=(id,fields={})=>({id,created_date:old,updated_date:old,extra_data:{},...fields});
  t.CompanySettings=[row('company',{company_name:'SOEICAM',next_invoice_number:100,next_journal_number:200})];
  t.Warehouse=[row('cold',{name:'Cold room',warehouse_type:'cold_room'}),row('van',{name:'Vehicle CE TEST',warehouse_type:'vehicle',extra_data:{vehicle_id:'vehicle'}}),row('agent',{name:'Separate agent stock',warehouse_type:'commercial_custody'})];
  t.Vehicle=[row('vehicle',{name:'Vehicle',extra_data:{warehouse_id:'van'}})];
  t.Product=[row('p',{name:'YOLA',inventory_type:'assembly',inventory_account_id:'fg',components:[{product_id:'milk',quantity:3}]})];
  t.StockBalance=[row('factory',{product_id:'p',warehouse_id:'cold',product_name:'YOLA',quantity:10,unit_cost:10,total_value:100}),row('field',{product_id:'p',warehouse_id:'van',product_name:'YOLA',quantity:4,unit_cost:10,total_value:40,lot_number:'OLD',qc_status:'approved',expiry_date:'2026-12-01'}),row('separate',{product_id:'p',warehouse_id:'agent',quantity:1,total_value:10})];
  t.Account=[row('fg',{name:'Finished stock',account_type:'asset',normal_balance:'debit',is_posting:true,currency:'XAF',balance:110}),row('ar',{name:'Receivables',account_type:'asset',normal_balance:'debit',balance:500}),row('equity',{name:'Opening',account_type:'equity',normal_balance:'credit',is_posting:true,balance:610})];
  t.JournalEntry=[row('opening',{status:'posted',source_module:'opening_balances',total_debit:610,total_credit:610,entry_date:'2026-11-03'})];
  t.JournalLine=[row('j-fg',{journal_id:'opening',account_id:'fg',debit:110,credit:0}),row('j-ar',{journal_id:'opening',account_id:'ar',debit:500,credit:0}),row('j-eq',{journal_id:'opening',account_id:'equity',debit:0,credit:610})];
  t.Customer=[row('customer',{business_name:'Opening customer',balance:500,extra_data:{opening_balance_amount:500}})];
  t.Invoice=[row('invoice',{customer_id:'customer',invoice_number:'OPEN-1',total:500,balance:500,status:'unpaid',extra_data:{accounting_source:'opening_balances'}})];
  t.Supplier=[row('supplier',{name:'Opening supplier',balance:200})];
  t.Bill=[row('bill',{supplier_id:'supplier',bill_number:'OPEN-PAYABLE-1',total:200,amount_paid:0,balance:200,status:'open',extra_data:{accounting_source:'opening_balances'}})];
  t.Dispatch=[row('run',{dispatch_number:'OLD-RUN',vehicle_id:'vehicle',vehicle_warehouse_id:'van',warehouse_id:'cold',driver_id:'driver',salesperson_id:'commercial',status:'loaded',loaded_at:old,total_loaded_value:70,total_returned_value:0})];
  t.DispatchLine=[row('load',{dispatch_id:'run',product_id:'p',loaded_quantity:7,loaded_value:70,returned_quantity:0})];
  t.DispatchRequest=[row('request',{vehicle_id:'vehicle',status:'pending_approval',request_number:'OLD-REQUEST'})];
  t.StockMovement=[row('old-move',{product_id:'p',quantity:7,total_value:70,movement_type:'vehicle_load',source_warehouse_id:'cold',destination_warehouse_id:'van'})];
  t.FieldSale=[row('old-sale',{status:'posted',total:500,journal_id:'opening',extra_data:{dispatch_id:'run'}})];
  t.SalesOrder=[row('old-order',{status:'delivered',dispatch_id:'run',total:500})];
  t.Payment=[row('payment',{amount:30})];
  t.CashCollection=[row('collection',{outstanding_amount:20,amount_collected:20})];
  t.CashHandover=[row('handover',{status:'submitted',offered_amount:20})];
  t.ProductionOrder=[row('production',{status:'completed'})];
  t.AuditLog=[row('old-audit',{action:'import_customer_opening_balance',module:'accounting',description:'Retain this'})];
  return t;
}

test('plan selects only driver vehicle stock and old open allocations; counted warehouses, agent custody and customer debts are excluded',()=>{
  const t=rows(),before=hash(t),p=planCutover(t);
  assert.deepEqual(p.blockers,[]);assert.deepEqual(p.balances.map(r=>r.id),['field']);assert.equal(p.summary.removed_value,40);
  assert.equal(p.summary.accounting[0].remaining_stock,110);assert.equal(p.summary.accounting[0].posted_ledger,110);assert.equal(hash(t),before);
});
test('unreconciled inventory values or account caches block a stock-only cutover rather than inventing a financial adjustment',()=>{
  for(const mode of ['ledger','cache','missing-account','ambiguous-rule','invalid-value']){
    const t=rows();if(mode==='ledger')t.JournalLine[0].debit=150;
    if(mode==='cache')t.Account[0].balance=150;
    if(mode==='missing-account')t.Product[0].inventory_account_id='absent';
    if(mode==='ambiguous-rule'){delete t.Product[0].inventory_account_id;t.PostingRule=[{id:'a',rule_key:'finished_goods_inventory',account_id:'fg'},{id:'b',rule_key:'finished_goods_inventory',account_id:'fg'}];}
    if(mode==='invalid-value')t.StockBalance[1].total_value='not known';
    assert.ok(planCutover(t).blockers.length,mode);
  }
});
test('new or changed driver goods, requests and runs after the prepared cutoff cannot be swept into the reset',()=>{
  for(const entity of ['StockBalance','Dispatch','DispatchRequest']){
    const t=rows(),r=entity==='StockBalance'?t[entity][1]:t[entity][0];r.updated_date=new Date(Date.parse(NOT_AFTER)+1).toISOString();
    assert.match(planCutover(t).blockers.join(' '),/changed after/);
  }
  const t=rows();delete t.StockBalance[1].created_date;delete t.StockBalance[1].updated_date;assert.match(planCutover(t).blockers.join(' '),/trustworthy/);
});
test('ambiguous fleet mappings, negative quantities and unresolved sales/returns fail closed',()=>{
  for(const mode of ['mapping','negative','sale','order','return','state']){
    const t=rows();
    if(mode==='mapping')t.Vehicle.push({id:'other',extra_data:{warehouse_id:'van'}});
    if(mode==='negative')t.StockBalance[1].quantity=-1;
    if(mode==='sale')t.FieldSale[0].status='approved';
    if(mode==='order')t.SalesOrder[0].status='confirmed';
    if(mode==='return')t.SpoilageRecord=[{id:'spoil',dispatch_id:'run',status:'pending'}];
    if(mode==='state')t.Dispatch[0].status='unknown';
    assert.ok(planCutover(t).blockers.length,mode);
  }
});
test('zero-quantity residual carrying value remains part of the audited reset and zero-valued quantities still require ledger reconciliation',()=>{
  const t=rows();t.StockBalance[1].quantity=0;assert.equal(planCutover(t).summary.removed_value,40);
  t.StockBalance.forEach(b=>{b.total_value=0;});const p=planCutover(t);assert.ok(p.blockers.some(b=>b.includes('reconciliation')));
});

async function fixture(data=rows(),{dictionaryOrder=false}={}){
  const db=new PGlite(),statements=[];
  for(const n of ENTITIES){
    const s=catalog[n],columns=Object.entries(s.fields).map(([k,d])=>'"'+k+'" '+(['number','integer'].includes(d.type)?'numeric':d.type==='boolean'?'boolean':['array','object'].includes(d.type)?'jsonb':'text')+(k==='id'?' PRIMARY KEY':''));
    await db.exec('CREATE TABLE public."'+s.table+'" ('+columns.join(',')+",extra_data jsonb NOT NULL DEFAULT '{}'::jsonb)");
  }
  let fail=null,tamper=null;
  const unsafe=async(query,params=[])=>{
    statements.push(query);
    if(fail?.test(query))throw Error('Injected failure');
    if(/^SET |^LOCK TABLE|pg_advisory_xact_lock/.test(query))return [];
    // This PGlite build lacks ICU. SQL lower(id) reproduces the mixed-case
    // ordering difference of dictionary collations without changing any data.
    const readQuery=dictionaryOrder&&query.startsWith('SELECT *')?query.replace(' ORDER BY id',' ORDER BY lower(id), id'):query;
    const result=await postgresAdapter(db).unsafe(readQuery,params);
    if(tamper&&query.startsWith('UPDATE public."stock_balance"'))await db.exec(tamper);
    return result;
  };
  const sql={unsafe,begin:async run=>{await db.exec('BEGIN');try{const result=await run({unsafe});await db.exec('COMMIT');return result;}catch(e){await db.exec('ROLLBACK');throw e;}}};
  for(const n of ENTITIES)for(const row of data[n]){
    const keys=Object.keys(row),values=keys.map(k=>k==='extra_data'||['array','object'].includes(catalog[n].fields[k]?.type)?JSON.stringify(row[k]):row[k]);
    await unsafe('INSERT INTO public."'+catalog[n].table+'" ('+keys.map(k=>'"'+k+'"').join(',')+') VALUES ('+keys.map((k,i)=>'$'+(i+1)+(k==='extra_data'?'::text::jsonb':'')).join(',')+')',values);
  }
  statements.length=0;
  const root=await mkdtemp(path.join(tmpdir(),'soeicam-driver-cutover-test-'));
  const options=async(extra={})=>{const p=await inspectCutover(sql,{targetKey:'fixture',...extra});return {targetKey:'fixture',expectedTarget:p.target,expectedSnapshot:p.snapshot,expectedReview:p.reviewHash,actor:'Isolated owner fixture',backupDir:path.join(root,'backup'),...extra};};
  const read=async()=>{const t={};for(const n of ENTITIES)t[n]=await sql.unsafe('SELECT * FROM public."'+catalog[n].table+'" ORDER BY id');return t;};
  return {db,sql,statements,root,options,read,fail:r=>{fail=r;},tamper:(query='UPDATE customer SET balance=999')=>{tamper=query;},dictionaryOrder:value=>{dictionaryOrder=value;},close:()=>db.close()};
}

test('dictionary-style database ordering cannot cause a false post-cutover verification failure',async()=>{
  for(const data of [rows(),unreconciled()]){
    data.AuditLog.push({id:'COB-opening-123',action:'import_customer_opening_balance',extra_data:{customer_ids:['z-customer','a-customer']}},{id:'a-import',action:'historical_import'});
    const f=await fixture(data,{dictionaryOrder:true});
    try{
      const before=await f.read(),databaseOrder=before.AuditLog.map(r=>r.id);
      assert.notDeepEqual(databaseOrder,[...databaseOrder].sort(),'fixture must return SQL ordering different from JavaScript');
      const opts=await f.options(),result=await applyCutover(f.sql,opts),after=await f.read();
      assert.equal(result.mode,'cutover committed');assert.equal(result.inventory_reconciled,true);
      assert.equal(result.financial_entries_created,planCutover(data).summary.correction.required?1:0);
      for(const row of before.AuditLog)assert.deepEqual(after.AuditLog.find(r=>r.id===row.id),row,'historical audit values and nested array ordering are preserved');
      for(const name of ['Customer','Supplier','Invoice','Bill','Payment','ProductionOrder'])assert.deepEqual(after[name],before[name],name);
      const retry=await applyCutover(f.sql,opts);assert.equal(retry.reused,true);assert.deepEqual(await f.read(),after);
    }finally{await f.close();}
  }
});

test('review fingerprints depend on records, not SQL presentation order',async()=>{
  const data=unreconciled();data.AuditLog.push({id:'COB-opening-123',action:'import_customer_opening_balance'},{id:'a-import',action:'historical_import'});
  const f=await fixture(data);
  try{
    const first=await inspectCutover(f.sql,{targetKey:'fixture'}),before=await f.read(),opts=await f.options();
    f.dictionaryOrder(true);
    const second=await inspectCutover(f.sql,{targetKey:'fixture'}),reordered=await f.read();
    assert.notDeepEqual(before.AuditLog.map(r=>r.id),reordered.AuditLog.map(r=>r.id));
    assert.deepEqual(first,second,'all preview fingerprints and review details are stable');
    assert.equal((await applyCutover(f.sql,opts)).mode,'cutover committed');
  }finally{await f.close();}
});

test('verification diagnoses real protected-record changes without exposing data and rolls back the entire opening correction',async()=>{
  const cases=[
    {sql:'UPDATE customer SET balance=999',detail:'Customer: 0 added, 0 missing, 1 changed (fields: balance)'},
    {sql:'DELETE FROM bill',detail:'Bill: 0 added, 1 missing, 0 changed'},
    {sql:"INSERT INTO customer(id,business_name) VALUES ('PRIVATE-ID','Private customer name')",detail:'Customer: 1 added, 0 missing, 0 changed'},
    {sql:`UPDATE customer SET extra_data=jsonb_set(extra_data,'{private_values}','["second-private-value","first-private-value"]'::jsonb)`,detail:'Customer: 0 added, 0 missing, 1 changed (fields: extra_data)'},
    {sql:`UPDATE product SET components='[{"product_id":"pack","quantity":1},{"product_id":"milk","quantity":3}]'::jsonb WHERE id='p'`,detail:'Product: 0 added, 0 missing, 1 changed (fields: components)'},
    {sql:"UPDATE supplier SET id='PRIVATE-ID'",detail:'Supplier: 1 added, 1 missing, 0 changed'}
  ];
  for(const scenario of cases){
    const data=unreconciled();data.Customer[0].extra_data.private_values=['first-private-value','second-private-value'];
    data.Product[0].components.push({product_id:'pack',quantity:1});
    const f=await fixture(data,{dictionaryOrder:true});
    try{
      const opts=await f.options(),before=await f.read();f.tamper(scenario.sql);
      await assert.rejects(applyCutover(f.sql,opts),error=>{
        assert.match(error.message,/Post-cutover verification failed; all changes were rolled back/);
        assert.ok(error.message.includes(scenario.detail),error.message);
        assert.doesNotMatch(error.message,/PRIVATE-ID|Private customer name|999|first-private-value|second-private-value/);
        return true;
      });
      assert.deepEqual(await f.read(),before,'including journal, clearing account, sequence, balances, inventory and audit');
    }finally{await f.close();}
  }
});

test('real transaction backs up old allocations, zeroes driver stock once, closes runs and preserves customer/GL/warehouse/cash records',async()=>{
  const f=await fixture();
  try{
    const before=await f.read(),opts=await f.options(),r=await applyCutover(f.sql,opts),after=await f.read();
    assert.equal(r.mode,'cutover committed');assert.equal(r.financial_entries_created,0);
    const cleared=after.StockBalance.find(b=>b.id==='field');assert.equal(Number(cleared.quantity),0);assert.equal(Number(cleared.total_value),0);assert.equal(Number(cleared.unit_cost),10);assert.equal(cleared.lot_number,'OLD');
    for(const n of ENTITIES.filter(n=>!['StockBalance','Dispatch','DispatchRequest','StockMovement','AuditLog'].includes(n)))assert.deepEqual(after[n],before[n],n);
    for(const id of ['factory','separate'])assert.deepEqual(after.StockBalance.find(b=>b.id===id),before.StockBalance.find(b=>b.id===id));
    assert.equal(after.Dispatch[0].status,'completed');assert.equal(Number(after.Dispatch[0].total_returned_value),0);assert.equal(after.DispatchRequest[0].status,'cancelled');
    assert.equal(after.StockMovement.length,2);const movement=after.StockMovement.find(m=>m.document_type==='DriverStockCutover');assert.equal(Number(movement.quantity),4);assert.equal(movement.destination_warehouse_id,'');assert.equal(movement.extra_data.value_difference,-40);
    const backup=JSON.parse(await readFile(path.join(opts.backupDir,'driver-stock-before.json'),'utf8'));assert.equal(Number(backup.tables.StockBalance[0].quantity),4);assert.equal(backup.tables.Customer,undefined);
    assert.ok(f.statements.some(s=>s.startsWith('LOCK TABLE')));
    // Feed the committed state into the real issue-goods domain workflow.
    const live=Object.fromEntries(Object.entries(after).map(([n,rs])=>[n,rs.map(({extra_data,...r})=>({...extra_data,...Object.fromEntries(Object.entries(r).map(([k,v])=>[k,v!=null&&['number','integer'].includes(catalog[n].fields[k]?.type)?Number(v):v]))}))]));
    live.Employee=[{id:'driver',role:'driver',status:'active'},{id:'commercial',role:'commercial',status:'active'}];
    const entities=Object.fromEntries(Object.entries(live).map(([n,rs])=>[n,{get:async id=>rs.find(r=>r.id===id),filter:async(q={},_sort,limit=200,skip=0)=>rs.filter(r=>Object.entries(q).every(([k,v])=>v&&typeof v==='object'&&v.$in?v.$in.includes(r[k]):r[k]===v)).slice(skip,skip+limit),update:async(id,fields)=>Object.assign(rs.find(r=>r.id===id),fields),create:async fields=>{const r={id:n+'-'+rs.length,...fields};rs.push(r);return r;}}]));
    const client={entities,asServiceRole:{entities}},owner={id:'owner',role:'admin'};
    await assert.rejects(dispatchAction(client,owner,{action:'loadDispatch',dispatchId:'run'}),/approved/);
    await assert.rejects(dispatchAction(client,owner,{action:'approveDispatchRequest',requestId:'request'}),/awaiting approval/);
    live.Dispatch.push({id:'new-run',status:'approved',dispatch_date:'2026-11-04',warehouse_id:'cold',vehicle_id:'vehicle',vehicle_warehouse_id:'van',driver_id:'driver',salesperson_id:'commercial'});
    live.DispatchLine.push({id:'new-line',dispatch_id:'new-run',product_id:'p',loaded_quantity:3});
    await dispatchAction(client,owner,{action:'loadDispatch',dispatchId:'new-run'});
    assert.equal(live.StockBalance.find(b=>b.id==='factory').quantity,7);assert.equal(live.StockBalance.filter(b=>b.warehouse_id==='van').reduce((n,b)=>n+Number(b.quantity),0),3);
    assert.equal(live.JournalEntry.length,before.JournalEntry.length);assert.equal(live.Invoice.length,before.Invoice.length);
    await f.sql.unsafe("UPDATE stock_balance SET quantity=8,total_value=80 WHERE id='field'");
    const retried=await applyCutover(f.sql,opts);assert.equal(retried.reused,true);assert.equal(Number((await f.read()).StockBalance.find(b=>b.id==='field').quantity),8,'retry must preserve newly issued goods');
    assert.equal((await inspectCutover(f.sql,{targetKey:'fixture'})).completed,true);
  }finally{await f.close();}
});
test('stale snapshots, wrong databases and invalid actor attribution reject the reset before any write',async()=>{
  const f=await fixture();
  try{
    const opts=await f.options(),before=await f.read();
    await assert.rejects(applyCutover(f.sql,{...opts,expectedTarget:'wrong'}),/target changed/);
    await assert.rejects(applyCutover(f.sql,{...opts,actor:''}),/Identify/);
    await f.sql.unsafe("UPDATE invoice SET balance=450 WHERE id='invoice'");
    await assert.rejects(applyCutover(f.sql,opts),/changed since review/);
    assert.equal(Number((await f.read()).StockBalance.find(b=>b.id==='field').quantity),4);assert.deepEqual((await f.read()).AuditLog,before.AuditLog);
  }finally{await f.close();}
});
test('backup failure leaves every database record unchanged',async()=>{
  const f=await fixture();try{
    const opts=await f.options(),before=await f.read();await writeFile(opts.backupDir,'not a directory');
    await assert.rejects(applyCutover(f.sql,opts));assert.deepEqual(await f.read(),before);
  }finally{await f.close();}
});
test('an audit failure rolls back stock, dispatch statuses and movements together',async()=>{
  const f=await fixture();try{
    const opts=await f.options(),before=await f.read();f.fail(/^INSERT INTO public\."audit_log"/);
    await assert.rejects(applyCutover(f.sql,opts),/Injected failure/);f.fail(null);assert.deepEqual(await f.read(),before);
  }finally{await f.close();}
});
test('post-reset verification detects unexpected changes to protected customer balances and rolls back',async()=>{
  const f=await fixture();try{
    const opts=await f.options(),before=await f.read();f.tamper();
    await assert.rejects(applyCutover(f.sql,opts),/verification failed/);assert.deepEqual(await f.read(),before);
  }finally{await f.close();}
});
test('an incompatible one-time marker blocks every later reset',()=>{
  const t=rows();t.AuditLog.push({id:CUTOVER_ID,action:'unrelated',extra_data:{}});assert.throws(()=>planCutover(t),/incompatible/);
});

function unreconciled(){
  const t=rows();
  t.StockBalance[0].total_value=325274.30;
  t.StockBalance[1].total_value=213382.23;t.StockBalance[1].quantity=507;
  t.Account[0].balance=538666.53;t.JournalLine[0].debit=538666.53;
  t.Account[2].balance=539166.53;t.JournalLine[2].credit=539166.53;
  t.JournalEntry[0].total_debit=539166.53;t.JournalEntry[0].total_credit=539166.53;
  // The separate raw-material control account already agrees and must not move.
  t.Product.push({id:'raw',name:'Packaging',inventory_account_id:'raw-account'});
  t.StockBalance.push({id:'raw-stock',product_id:'raw',warehouse_id:'cold',quantity:100,total_value:2833492.29});
  t.Account.push({id:'raw-account',name:'Materials and packaging',account_type:'asset',normal_balance:'debit',is_posting:true,balance:2833492.29});
  t.JournalEntry.push({id:'raw-opening',status:'posted',total_debit:2833492.29,total_credit:2833492.29});
  t.JournalLine.push({id:'raw-debit',journal_id:'raw-opening',account_id:'raw-account',debit:2833492.29,credit:0},{id:'raw-credit',journal_id:'raw-opening',account_id:'equity',debit:0,credit:2833492.29});
  t.Account[2].balance=3372658.82;
  t.Account.push({id:'cogs',name:'Cost of goods sold',account_type:'cogs',normal_balance:'debit',balance:1000},{id:'revenue',name:'Sales revenue',account_type:'revenue',normal_balance:'credit',balance:1000});
  t.JournalEntry.push({id:'historical-profit',status:'posted',source_module:'manual',total_debit:1000,total_credit:1000});
  t.JournalLine.push({id:'historical-cost',journal_id:'historical-profit',account_id:'cogs',debit:1000,credit:0},{id:'historical-revenue',journal_id:'historical-profit',account_id:'revenue',debit:0,credit:1000});
  return t;
}

test('the opening baseline previews the exact correction to dedicated temporary clearing without changing existing accounts',()=>{
  const t=unreconciled(),p=planCutover(t);
  assert.deepEqual(p.blockers,[]);assert.equal(p.needsOffsetSelection,false);assert.equal(p.summary.correction.total,213382.23);
  assert.deepEqual(p.offsetCandidates,[]);assert.equal(p.clearingAccount.account_number,CLEARING_ACCOUNT_NUMBER);
  assert.equal(p.summary.correction.reconciliation_status,'pending_full_opening_balance_reconciliation');
  assert.deepEqual(p.summary.correction.lines.map(l=>[l.account_id,l.debit,l.credit]),[[CLEARING_ACCOUNT_ID,213382.23,0],['fg',0,213382.23]]);
  assert.equal(t.Account.find(a=>a.id===CLEARING_ACCOUNT_ID),undefined,'preview must not create the clearing account');
  assert.equal(p.summary.baseline.new_sales_or_expenses,false);assert.equal(p.summary.baseline.warehouse_quantities_added,0);
});

test('opening baseline rejects unrelated discrepancies, reused or incompatible clearing accounts, arbitrary offsets and closed periods',()=>{
  for(const mode of ['partial','over-correction','expense','arbitrary-offset','code-collision','name-collision','wrong-code','wrong-owner','wrong-statement','inactive','non-posting','control','treasury-flag','treasury-link','currency','manual-disabled','cache','prior-activity','closed','locked','period-dates','sequence','orphan']){
    const t=unreconciled(),a=planCutover(t).clearingAccount;t.Account.push(a);const options={};
    if(mode==='partial'||mode==='over-correction'){const n=mode==='partial'?-1:1;t.JournalLine[0].debit+=n;t.Account[0].balance+=n;}
    if(mode==='expense')a.account_type='expense';
    if(mode==='arbitrary-offset')options.offsetAccountId='equity';
    if(mode==='code-collision')t.Account.push({id:'unrelated',name:'Unrelated',account_number:CLEARING_ACCOUNT_NUMBER});
    if(mode==='name-collision')t.Account.push({id:'unrelated',name:a.name,account_number:'OTHER'});
    if(mode==='wrong-code')a.account_number='5000';
    if(mode==='wrong-owner')a.extra_data.opening_cutover_id='unrelated';
    if(mode==='wrong-statement')a.financial_statement='income_statement';
    if(mode==='inactive')a.is_active=false;
    if(mode==='non-posting')a.is_posting=false;
    if(mode==='control')a.is_control_account=true;
    if(mode==='treasury-flag')a.is_treasury=true;
    if(mode==='treasury-link')t.TreasuryAccount=[{id:'bank',gl_account_id:CLEARING_ACCOUNT_ID}];
    if(mode==='currency')a.currency='EUR';
    if(mode==='manual-disabled')a.allow_manual_journal=false;
    if(mode==='cache')a.balance+=1;
    if(mode==='prior-activity')t.JournalLine.push({id:'old-clearing-line',journal_id:'opening',account_id:CLEARING_ACCOUNT_ID,debit:0,credit:0});
    if(['closed','locked','period-dates'].includes(mode))t.AccountingPeriod=[{id:'period',name:'Closed year',start_date:mode==='period-dates'?'invalid':'2000-01-01',end_date:'2099-12-31',status:mode}];
    if(mode==='sequence')t.CompanySettings[0].next_journal_number=0;
    if(mode==='orphan')t.JournalEntry.push({id:'stray',source_document_id:CUTOVER_ID,status:'posted'});
    assert.ok(planCutover(t,options).blockers.length,mode);
  }
});

test('the opening baseline clears only stale vehicle allocations, preserves physical stock and customer/supplier debts, and leaves all profit accounts unchanged',async()=>{
  const f=await fixture(unreconciled());try{
    const before=await f.read(),preview=await inspectCutover(f.sql,{targetKey:'fixture'});
    assert.equal(preview.eligible,true);assert.equal(preview.needs_offset_selection,false);
    assert.deepEqual(await f.read(),before,'preview is read-only');
    const opts=await f.options(),r=await applyCutover(f.sql,opts),after=await f.read();
    assert.equal(r.financial_entries_created,1);assert.equal(r.journal_number,'JV-000200');
    const j=after.JournalEntry.find(j=>j.id===r.journal_id),lines=after.JournalLine.filter(l=>l.journal_id===r.journal_id);
    assert.equal(Number(j.total_debit),213382.23);assert.equal(Number(j.total_credit),213382.23);assert.equal(j.status,'posted');assert.equal(j.is_immutable,true);
    assert.equal(j.source_module,'inventory_adjustment','must not be offered as a new initial opening import');assert.equal(j.source_document_id,CUTOVER_ID);
    assert.deepEqual(lines.map(l=>[l.account_id,Number(l.debit),Number(l.credit)]),[[CLEARING_ACCOUNT_ID,213382.23,0],['fg',0,213382.23]]);
    assert.equal(Number(after.Account.find(a=>a.id==='fg').balance),325284.30);assert.equal(Number(after.Account.find(a=>a.id===CLEARING_ACCOUNT_ID).balance),-213382.23);
    assert.equal(after.Account.find(a=>a.id===CLEARING_ACCOUNT_ID).extra_data.opening_reconciliation_status,'pending');
    assert.equal(r.baseline.full_opening_accounts_status,'pending_reconciliation');assert.equal(r.baseline.warehouse_quantities_added,0);
    assert.equal(Number(after.StockBalance.find(b=>b.id==='field').quantity),0);assert.equal(Number(after.StockBalance.find(b=>b.id==='field').total_value),0);
    for(const n of ENTITIES.filter(n=>!['CompanySettings','Account','JournalEntry','JournalLine','StockBalance','Dispatch','DispatchRequest','StockMovement','AuditLog'].includes(n)))assert.deepEqual(after[n],before[n],n);
    for(const n of ['JournalEntry','JournalLine'])for(const row of before[n])assert.deepEqual(after[n].find(r=>r.id===row.id),row,'historical '+n);
    for(const original of before.Account.filter(a=>a.id!=='fg'))assert.deepEqual(after.Account.find(a=>a.id===original.id),original);
    for(const id of ['factory','separate','raw-stock'])assert.deepEqual(after.StockBalance.find(b=>b.id===id),before.StockBalance.find(b=>b.id===id));
    assert.equal(Number(after.CompanySettings[0].next_journal_number),201);
    const audits=after.AuditLog.filter(a=>!before.AuditLog.some(b=>a.id===b.id));assert.equal(audits.length,2);assert.ok(audits.every(a=>a.extra_data.audit_source==='owner_maintenance'));
    const backup=JSON.parse(await readFile(path.join(opts.backupDir,'driver-stock-before.json'),'utf8'));assert.equal(backup.tables.Account.length,1);assert.equal(backup.planned_new_clearing_account.id,CLEARING_ACCOUNT_ID);assert.equal(backup.tables.JournalLine,undefined);
    await f.sql.unsafe("UPDATE stock_balance SET quantity=5,total_value=50 WHERE id='field'");
    const retry=await applyCutover(f.sql,opts);assert.equal(retry.reused,true);const retried=await f.read();assert.equal(Number(retried.StockBalance.find(b=>b.id==='field').quantity),5);assert.deepEqual(retried.JournalEntry,after.JournalEntry);assert.deepEqual(retried.Account,after.Account);
  }finally{await f.close();}
});

test('old arbitrary-account arguments and an unreviewed migration plan cannot apply the new baseline',async()=>{
  const data=unreconciled();data.Account.push({id:'other-equity',name:'Another equity',account_type:'equity',normal_balance:'credit',is_posting:true,balance:0});
  const f=await fixture(data);try{
    const opts=await f.options(),before=await f.read();
    await assert.rejects(applyCutover(f.sql,{...opts,offsetAccountId:'other-equity'}),/Arbitrary equity selection is disabled/);
    await assert.rejects(applyCutover(f.sql,{...opts,expectedReview:undefined}),/selection or posting date changed/);
    assert.deepEqual(await f.read(),before);
  }finally{await f.close();}
});

test('new clearing account, journal, sequence, balances, stock and audit roll back together on failures at every stage',async()=>{
  for(const stage of ['clearing-create','journal-line','account','movement','final-audit','verification']){
    const f=await fixture(unreconciled());try{
      const opts=await f.options(),before=await f.read();let audits=0;
      if(stage==='clearing-create')f.fail(/^INSERT INTO public\."account"/);
      if(stage==='journal-line')f.fail(/^INSERT INTO public\."journal_line"/);
      if(stage==='account')f.fail(/^UPDATE public\."account"/);
      if(stage==='movement')f.fail(/^INSERT INTO public\."stock_movement"/);
      if(stage==='final-audit')f.fail({test:query=>/^INSERT INTO public\."audit_log"/.test(query)&&++audits===2});
      if(stage==='verification')f.tamper();
      await assert.rejects(applyCutover(f.sql,opts),/Injected failure|verification failed/,stage);f.fail(null);
      assert.deepEqual(await f.read(),before,stage);
    }finally{await f.close();}
  }
});

test('journal numbering avoids existing numbers and records the matching accounting period',async()=>{
  const data=unreconciled();data.JournalEntry[0].journal_number='JV-000200';data.AccountingPeriod=[{id:'open',name:'Current',start_date:'2000-01-01',end_date:'2099-12-31',status:'open'}];
  const f=await fixture(data);try{
    const r=await applyCutover(f.sql,await f.options()),after=await f.read();
    assert.equal(r.journal_number,'JV-000201');assert.equal(Number(after.CompanySettings[0].next_journal_number),202);assert.equal(after.JournalEntry.find(j=>j.id===r.journal_id).period_id,'open');
  }finally{await f.close();}
});

test('a matching unused clearing definition is reused without creating another account',async()=>{
  const data=unreconciled();data.Account.push(planCutover(data).clearingAccount);
  const f=await fixture(data);try{
    const before=await f.read(),preview=await inspectCutover(f.sql,{targetKey:'fixture'});
    assert.equal(preview.eligible,true);assert.equal(preview.summary.correction.create_clearing_account,false);
    await applyCutover(f.sql,await f.options());const after=await f.read();
    assert.equal(after.Account.length,before.Account.length);assert.equal(Number(after.Account.find(a=>a.id===CLEARING_ACCOUNT_ID).balance),-213382.23);
  }finally{await f.close();}
});

test('supplier opening balances changing after review prevent a stale baseline without altering stock or creating clearing',async()=>{
  const f=await fixture(unreconciled());try{
    const options=await f.options();await f.sql.unsafe("UPDATE bill SET balance=150 WHERE id='bill'");const before=await f.read();
    await assert.rejects(applyCutover(f.sql,options),/changed since review/);
    assert.deepEqual(await f.read(),before);assert.equal(before.Account.some(a=>a.id===CLEARING_ACCOUNT_ID),false);
  }finally{await f.close();}
});

test('a previously completed version-two cutover is recognized without clearing any later issued stock',()=>{
  const t=unreconciled(),receipt={cutover_id:CUTOVER_ID,completed_at:'2026-11-04T00:00:00Z',financial_entries_created:1};
  t.AuditLog.push({id:CUTOVER_ID,action:'driver_opening_cutover',extra_data:{audit_source:'owner_maintenance',driver_cutover_policy:hash({version:2,id:CUTOVER_ID,notAfter:NOT_AFTER,scope:'registered vehicle stock only',financialWrites:'exact old-stock difference; operator-selected opening equity; shared journal engine'}),driver_cutover_receipt:receipt}});
  const before=hash(t);assert.equal(planCutover(t).completed,true);assert.equal(hash(t),before);
});

test('a valid completed stock-only legacy marker remains idempotent after the accounting upgrade',()=>{
  const t=rows(),receipt={cutover_id:CUTOVER_ID,completed_at:'2026-11-04T00:00:00Z',financial_entries_created:0};
  t.AuditLog.push({id:CUTOVER_ID,action:'driver_opening_cutover',extra_data:{audit_source:'owner_maintenance',driver_cutover_policy:hash({version:1,id:CUTOVER_ID,notAfter:NOT_AFTER,scope:'registered vehicle stock only',financialWrites:false}),driver_cutover_receipt:receipt}});
  assert.equal(planCutover(t).completed,true);
});

test('account review shows actual inventory journal counterparts and opening usage without guessing from account names',()=>{
  const t=unreconciled();t.Account.push({id:'retained',name:'Retained Earnings',account_type:'equity',normal_balance:'credit',balance:0,is_posting:true});
  t.JournalEntry.push({id:'draft',status:'draft',source_module:'opening_balances',description:'PRIVATE CUSTOMER TEXT'});
  t.JournalLine.push({id:'draft-line',journal_id:'draft',account_id:'retained',debit:0,credit:999});
  t.JournalEntry[0].description='PRIVATE CUSTOMER TEXT';t.JournalLine[0].party_id='private-customer';
  const before=hash(t),plan=planCutover(t),report=openingAccountReview(t,plan);
  assert.equal(report.inventory_accounts.length,1);assert.equal(report.inventory_accounts[0].account_id,'fg');
  assert.equal(report.inventory_journal_count,1);assert.equal(report.inventory_journals[0].journal_id,'opening');
  assert.ok(report.inventory_journals[0].lines.some(l=>l.account_id==='equity'&&l.credit===539166.53));
  assert.equal(report.equity_opening_usage.find(a=>a.account_id==='equity').opening_journal_count,1);
  assert.equal(report.equity_opening_usage.find(a=>a.account_id==='retained').opening_journal_count,0);
  assert.equal(report.recommended_account,undefined);assert.equal(plan.needsOffsetSelection,false);assert.equal(report.proposed_correction.offset_account_id,CLEARING_ACCOUNT_ID);assert.equal(hash(t),before);
  assert.doesNotMatch(JSON.stringify(report),/PRIVATE CUSTOMER TEXT|private-customer/);
});

test('read-only account inspection never posts or selects an account and refuses apply mode',async()=>{
  const f=await fixture(unreconciled());try{
    const before=await f.read();f.statements.length=0;
    const report=await inspectCutover(f.sql,{targetKey:'fixture',reviewOpeningAccounts:true});
    assert.equal(report.mode,'read-only opening-account review');assert.equal(report.opening_account_review.inventory_journal_count,1);
    assert.equal(report.eligible,undefined);assert.ok(f.statements.every(s=>/^SELECT |^SET /.test(s)));
    await assert.rejects(applyCutover(f.sql,{reviewOpeningAccounts:true}),/read-only/);
    assert.deepEqual(await f.read(),before);
  }finally{await f.close();}
});

test('account review prioritizes opening evidence and reports omitted journal or line history explicitly',()=>{
  const t=unreconciled();
  for(let i=0;i<25;i++){
    t.JournalEntry.push({id:'later-'+i,status:'posted',source_module:'inventory_adjustment',entry_date:'2026-11-04'});
    t.JournalLine.push({id:'later-line-'+i,journal_id:'later-'+i,account_id:'fg',debit:1,credit:0});
  }
  for(let i=0;i<31;i++)t.JournalLine.push({id:'extra-'+i,journal_id:'opening',account_id:'ar',debit:0,credit:0});
  const report=openingAccountReview(t,planCutover(t));
  assert.equal(report.inventory_journal_count,26);assert.equal(report.inventory_journals.length,20);assert.equal(report.omitted_journals,6);
  assert.equal(report.inventory_journals[0].journal_id,'opening');assert.equal(report.inventory_journals[0].omitted_lines,4);
});

test('Windows wrapper uses the dedicated opening baseline without account selection, preserves Unicode and keeps review read-only', {skip:process.platform!=='win32'},async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'soeicam-driver-wrapper-test-')),scripts=path.join(root,'scripts');await mkdir(scripts);
  const source=await readFile(new URL('../scripts/Reset-SOEICAM-Driver-Opening-Stock.ps1',import.meta.url),'utf8');
  const wrapper=path.join(scripts,'Reset-SOEICAM-Driver-Opening-Stock.ps1'),mock=path.join(scripts,'mock-node.ps1');
  await writeFile(wrapper,source.replace("$node = (Get-Command node.exe -ErrorAction Stop).Source","$node = Join-Path $PSScriptRoot 'mock-node.ps1'"));
  await writeFile(path.join(root,'synthetic.env'),'# Test fixture only');
  const ascii=v=>JSON.stringify(v).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
  const base={completed:false,eligible:true,target:'target',snapshot:'snapshot',reviewHash:'baseline',blockers:[],needs_offset_selection:false,offset_candidates:[],summary:{correction:{required:true,total:213382.23,offset_account:'Opening Balance Clearing'},vehicles:[{name:'Yaourt \u00e0 boire'}]}};
  await writeFile(mock,[
    '$global:LASTEXITCODE = 0',
    '$inputArgs = @($args)',
    '$scenario = $env:SOEICAM_WRAPPER_SCENARIO',
    "if ($inputArgs -contains '--review-opening-accounts') {",
    "    Write-Output '{"+'"opening_account_review":{"mode":"Read-only accounting evidence","fixture_label":"Yaourt \\u00e0 boire"},"blockers":[]'+"}'",
    "} elseif ($inputArgs -contains '--apply') {",
    "    $inputArgs | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'applied.json')",
    "    Write-Output '{"+'"mode":"cutover committed","financial_entries_created":1'+"}'",
    '} else {',
    "    $review = '"+ascii(base)+"' | ConvertFrom-Json",
    "    if ($scenario -eq 'blocked') { $review.eligible = $false; $review.blockers = @('Account balance differs from ledger') }",
    "    if ($scenario -eq 'completed') { $review.completed = $true; $review | Add-Member -NotePropertyName receipt -NotePropertyValue $review.summary }",
    '    Write-Output ($review | ConvertTo-Json -Depth 12)',
    '}'
  ].join('\n'));
  const quote=s=>"'"+s.replaceAll("'","''")+"'";
  for(const scenario of ['preview','apply','deprecated-offset','blocked','completed','account-report','invalid-report-apply']){
    const receipt=path.join(scripts,'applied.json');await writeFile(receipt,'null');
    const command=[
      "$ErrorActionPreference = 'Stop'",
      '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding',
      "function global:Read-Host { throw 'No account-selection prompt is allowed for the opening baseline.' }",
      '& '+quote(wrapper)+' -EnvironmentFile '+quote(path.join(root,'synthetic.env'))+' -BackupRoot '+quote(path.join(root,'backups'))+' '+(['preview','account-report'].includes(scenario)?'':'-Apply')+' '+(scenario==='deprecated-offset'?"-OpeningOffsetAccountId 'opening-equity'":'')+' '+(['account-report','invalid-report-apply'].includes(scenario)?'-ReviewOpeningAccounts':'')
    ].join('\n');
    const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',Buffer.from(command,'utf16le').toString('base64')],{encoding:'utf8',timeout:30000,windowsHide:true,env:{...process.env,SOEICAM_WRAPPER_SCENARIO:scenario}});
    const args=JSON.parse(await readFile(receipt,'utf8'));
    if(scenario==='apply'){
      assert.equal(result.status,0,result.stderr);assert.equal(args.includes('--offset-account'),false);assert.equal(args[args.indexOf('--review')+1],'baseline');assert.equal(args[args.indexOf('--snapshot')+1],'snapshot');
      assert.match(result.stdout,/temporary opening-clearing balance/);
    }else{
      assert.equal(args,null,scenario+' must not apply');
      if(['deprecated-offset','blocked','invalid-report-apply'].includes(scenario))assert.notEqual(result.status,0,scenario);
      else assert.equal(result.status,0,result.stderr);
    }
    if(!['deprecated-offset','invalid-report-apply'].includes(scenario))assert.match(result.stdout,/Yaourt \u00e0 boire/,'Unicode must survive native JSON transport');
    if(scenario==='account-report')assert.match(result.stdout,/Read-only accounting evidence/);
  }
});
