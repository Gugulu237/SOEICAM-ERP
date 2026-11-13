import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,fieldHandler,validSupply,request,staff,date} from './helpers/commercial-supply.mjs';
import {journalPayload} from '../src/server/domain/journal-validation.js';
import {postJournal} from '../src/server/domain/field-ops.js';

const message=/Recorded field-sale costs do not match actual delivered stock/;
function manager(f){f.client.auth.me=async()=>({id:'manager',role:'admin',full_name:'Manager'});f.client.entities.Employee.filter=async()=>[];}
function legacy(){
 const f=fixture(),{tables:t}=f;
 t.FieldSale.push({id:'legacy',sale_number:'FS-LEGACY',commercial_id:staff.id,commercial_name:staff.full_name,customer_id:'customer-a',customer_name:'Customer A',status:'submitted',stock_moved_at:new Date().toISOString(),custodian_warehouse_id:'van-stock',transaction_date:date,payment_type:'credit',subtotal:1000,tax_total:0,total:1000,amount_collected:0,amount_due:1000,cost_of_goods:400});
 t.FieldSaleLine.push({id:'legacy-line',field_sale_id:'legacy',product_id:'product-a',quantity:2,unit_cost:200,line_cost:400,line_total:1000,tax_amount:0});
 t.StockMovement.push({id:'legacy-issue',document_type:'FieldSale',document_id:'legacy',movement_type:'field_delivery',status:'approved',source_warehouse_id:'van-stock',product_id:'product-a',quantity:2,total_value:400,unit_cost:200,movement_date:date});
 Object.assign(t.StockBalance[0],{quantity:8,total_value:1600});manager(f);return f;
}
const snapshot=f=>structuredClone(f.tables);
async function invoke(handler,f,body){globalThis.__dailySupplyClient=f.client;return handler(request(body));}
function refreshPayload(t,journal){journal.posting_payload=journalPayload({entryDate:journal.entry_date,description:journal.description,sourceModule:journal.source_module,sourceDocumentType:journal.source_document_type,lines:t.JournalLine.filter(l=>l.journal_id===journal.id)});}

test('legacy approval and journal preview require exact approved outbound quantities and carrying costs before financial writes',async()=>{
 const handler=await fieldHandler();
 const cases=[
  ['no physical issue',t=>t.StockMovement.splice(0)],
  ['unmoved supply',t=>t.FieldSale[0].stock_moved_at=''],
  ['unknown stock source',t=>t.FieldSale[0].custodian_warehouse_id=''],
  ['wrong delivered quantity',t=>t.StockMovement[0].quantity=3],
  ['wrong per-line cost',t=>{t.FieldSaleLine[0].line_cost=500;t.FieldSale[0].cost_of_goods=500;}],
  ['wrong header cost',t=>t.FieldSale[0].cost_of_goods=500],
  ['missing recorded value',t=>t.StockMovement[0].total_value=null],
  ['missing explicit line cost',t=>delete t.FieldSaleLine[0].line_cost],
  ['pending physical issue',t=>t.StockMovement[0].status='pending'],
  ['transfer rather than sale',t=>t.StockMovement[0].destination_warehouse_id='held'],
  ['wrong warehouse',t=>t.StockMovement[0].source_warehouse_id='factory'],
  ['wrong movement day',t=>t.StockMovement[0].movement_date='2000-01-01'],
  ['stock load is not COGS',t=>t.StockMovement[0].movement_type='vehicle_load'],
  ['material consumption is not sold stock',t=>t.StockMovement[0].movement_type='material_issue'],
  ['sample giveaway is not sold stock',t=>t.StockMovement[0].movement_type='promotional_issue'],
  ['expensed promotional source',t=>t.StockMovement[0].degustation_appropriation_id='promo'],
  ['wrong run identity',t=>{t.FieldSale[0].dispatch_id='run-a';t.StockMovement[0].dispatch_id='another';}],
  ['fractional precision lost',t=>t.FieldSaleLine[0].quantity=2.0001],
  ['same grand total with wrong product costs',t=>{
   Object.assign(t.FieldSaleLine[0],{quantity:1,line_cost:200});t.FieldSaleLine.push({...t.FieldSaleLine[0],id:'line-b',product_id:'product-b'});
   Object.assign(t.StockMovement[0],{quantity:1,total_value:300});t.StockMovement.push({...t.StockMovement[0],id:'issue-b',product_id:'product-b',total_value:100});
  }],
 ];
 try{
  for(const[label,change]of cases)for(const action of ['proposedJournal','approveSale']){
   const f=legacy();change(f.tables);const before=snapshot(f),response=await invoke(handler,f,{action,saleId:'legacy'}),result=await response.json();
   assert.equal(response.status,400,label+' / '+action);assert.match(result.error,label==='unmoved supply'&&action==='approveSale'?/delivered stock has not been recorded/:message,label);assert.deepEqual(f.tables,before,label+' cannot change journals, stock, cash or customer debt');
  }
 }finally{delete globalThis.__dailySupplyClient;}
});

test('paid delivery cost excludes unrelated stock held, transfers and free replacement issues',async()=>{
 const handler=await fieldHandler(),f=legacy(),t=f.tables;
 t.StockMovement.push({...t.StockMovement[0],id:'sample',movement_type:'promotional_issue',quantity:50,total_value:10000},
  {...t.StockMovement[0],id:'replacement',document_type:'SpoilageRecord',document_id:'replacement',movement_type:'promotional_issue',quantity:100,total_value:20000},
  {...t.StockMovement[0],id:'other-sale',document_id:'other-sale',quantity:40,total_value:8000});
 const held=structuredClone(t.StockBalance),moves=structuredClone(t.StockMovement);
 try{
  const preview=await invoke(handler,f,{action:'proposedJournal',saleId:'legacy'}),plan=await preview.json();assert.equal(preview.status,200,plan.error);assert.equal(plan.lines.find(l=>l.account_id==='cogs').debit,400);assert.equal(t.JournalEntry.length,0);
  const response=await invoke(handler,f,{action:'approveSale',saleId:'legacy'}),result=await response.json();assert.equal(response.status,200,result.error);assert.equal(t.JournalLine.find(l=>l.account_id==='cogs').debit,400);assert.deepEqual(t.StockBalance,held);assert.deepEqual(t.StockMovement,moves);assert.equal(t.Customer[0].balance,1000);
  const saved=snapshot(f),retry=await invoke(handler,f,{action:'approveSale',saleId:'legacy'});assert.equal((await retry.json()).alreadyPosted,true);assert.deepEqual(f.tables,saved);
 }finally{delete globalThis.__dailySupplyClient;}
});

test('automatic sales expense recorded delivered carrying value while held stock remains an asset despite a stale unit-cost cache',async()=>{
 const handler=await fieldHandler(),f=fixture(),args=validSupply();f.tables.StockBalance[0].unit_cost=99999;
 try{
  const response=await invoke(handler,f,args),result=await response.json();assert.equal(response.status,200,result.error);assert.equal(result.sale.cost_of_goods,400);assert.equal(f.tables.StockBalance[0].quantity,8);assert.equal(f.tables.StockBalance[0].total_value,1600);assert.equal(f.tables.JournalLine.find(l=>l.account_id==='cogs').debit,400);
  const saved=snapshot(f),retry=await invoke(handler,f,args);assert.equal((await retry.json()).reused,true);assert.deepEqual(f.tables,saved);
 }finally{delete globalThis.__dailySupplyClient;}
});

test('posted approvals and idempotent sale retries reject changed stock costs, changed journal costs and duplicate original journals without writes',async()=>{
 const handler=await fieldHandler();
 const cases=[
  ['movement cost',t=>t.StockMovement[0].total_value=500],
  ['stored cost',t=>{t.FieldSale[0].cost_of_goods=500;t.FieldSaleLine[0].line_cost=500;}],
  ['balanced but wrong journal cost',t=>{
   const journal=t.JournalEntry[0];for(const line of t.JournalLine.filter(l=>l.journal_id===journal.id)){if(line.account_id==='cogs')line.debit=800;if(line.account_id==='inventory')line.credit=800;}journal.total_debit+=400;journal.total_credit+=400;refreshPayload(t,journal);
  }],
  ['duplicate source journal',t=>{const original=t.JournalEntry[0];t.JournalEntry.push({...original,id:'duplicate',journal_number:'JV-DUPLICATE'});t.JournalLine.push(...t.JournalLine.filter(l=>l.journal_id===original.id).map(l=>({...l,id:'duplicate-'+l.id,journal_id:'duplicate'})));}],
  ['foreign linked journal',t=>t.JournalEntry[0].source_document_id='another-sale'],
 ];
 try{
  for(const[label,change]of cases){
   const f=fixture(),args=validSupply(),response=await invoke(handler,f,args),sale=(await response.json()).sale;assert.equal(response.status,200);change(f.tables);const before=snapshot(f);
   const retry=await invoke(handler,f,args);assert.equal(retry.status,400,label+' submission');assert.match((await retry.json()).error,message);assert.deepEqual(f.tables,before);
   manager(f);for(const action of ['proposedJournal','approveSale']){const again=await invoke(handler,f,{action,saleId:sale.id});assert.equal(again.status,400,label+' '+action);assert.match((await again.json()).error,message);assert.deepEqual(f.tables,before);}
  }
 }finally{delete globalThis.__dailySupplyClient;}
});

test('verified posted retries inspect historical money lines without depending on current revenue or cash mappings',async()=>{
 const handler=await fieldHandler(),f=fixture(),args=validSupply(),response=await invoke(handler,f,args),sale=(await response.json()).sale;assert.equal(response.status,200);
 f.tables.Product[0].revenue_account_id='new-revenue-not-configured';f.tables.PostingRule.find(r=>r.rule_key==='customer_receivable').account_id='new-receivable-not-configured';
 const before=snapshot(f);
 try{
  const retry=await invoke(handler,f,args);assert.equal((await retry.json()).reused,true);assert.deepEqual(f.tables,before);
  manager(f);const preview=await invoke(handler,f,{action:'proposedJournal',saleId:sale.id}),plan=await preview.json();assert.equal(preview.status,200,plan.error);assert.ok(plan.lines.some(line=>line.account_id==='revenue'&&line.credit===838.57));assert.ok(plan.lines.some(line=>line.account_id==='tax'&&line.credit===161.43));assert.ok(plan.lines.some(line=>line.account_id==='receivable'&&line.debit===600));assert.deepEqual(f.tables,before);
 }finally{delete globalThis.__dailySupplyClient;}
});

test('canonical COGS aliases and a linked completed reversal keep historical approvals read-only and cannot repost the original sale',async()=>{
 const handler=await fieldHandler(),f=fixture(),args=validSupply({paymentType:'credit',amountCollected:0}),response=await invoke(handler,f,args),sale=(await response.json()).sale,t=f.tables,s=f.client.asServiceRole;
 assert.equal(response.status,200);const original=t.JournalEntry[0];
 t.Account.push({id:'old-cogs',account_number:'7000',name:'Old COGS',account_type:'cogs',normal_balance:'debit',balance:0,is_active:false,consolidated_into_account_id:'cogs'});
 t.JournalLine.find(l=>l.account_id==='cogs').account_id='old-cogs';refreshPayload(t,original);
 try{
  const aliased=snapshot(f),repeat=await invoke(handler,f,args);assert.equal((await repeat.json()).reused,true);assert.deepEqual(f.tables,aliased);
  const{journal}=await postJournal(s,{entryDate:date,description:'Completed sale reversal',sourceModule:'sales',sourceDocumentType:'SaleReversal',sourceDocumentId:original.id,userId:'manager',lines:t.JournalLine.filter(l=>l.journal_id===original.id).map(l=>({account_id:l.account_id==='old-cogs'?'cogs':l.account_id,debit:l.credit,credit:l.debit}))});
  await s.entities.JournalEntry.update(journal.id,{reversal_of:original.id});await s.entities.JournalEntry.update(original.id,{reversed_by_journal:journal.id});await s.entities.FieldSale.update(sale.id,{amount_due:0,sale_reversal:{journal_id:journal.id,date}});await s.entities.Customer.update('customer-a',{balance:0});
  const reversed=snapshot(f),retry=await invoke(handler,f,args);assert.equal((await retry.json()).reused,true);assert.deepEqual(f.tables,reversed);
  manager(f);const approved=await invoke(handler,f,{action:'approveSale',saleId:sale.id});assert.equal((await approved.json()).alreadyPosted,true);assert.deepEqual(f.tables,reversed);
  t.JournalEntry.find(j=>j.id===journal.id).source_document_type='FieldSale';const wrong=snapshot(f),blocked=await invoke(handler,f,{action:'approveSale',saleId:sale.id});assert.equal(blocked.status,400);assert.match((await blocked.json()).error,message);assert.deepEqual(f.tables,wrong);
 }finally{delete globalThis.__dailySupplyClient;}
});
