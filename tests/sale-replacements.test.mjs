import test from 'node:test';
import {companySalesRegister} from '../src/lib/company-sales.js';
import {salesStatusDocument} from '../src/lib/sales-report-documents.js';
import assert from 'node:assert/strict';
import { fixture, fieldHandler, request, validSupply, date } from './helpers/commercial-supply.mjs';
import { combinedSupplyQuantities, normalizeSaleReplacements, validateSaleReplacements } from '../src/lib/sale-replacements.js';

const exchange = changes => ({ product_id: 'product-a', quantity: 3, reason: 'expired', expiry_date: '2000-01-01', lot_number: 'RETURNED-LOT', ...changes });
async function submit(client, args) {
  globalThis.__dailySupplyClient = client;
  try { const response = await (await fieldHandler())(request(args)); return { status: response.status, ...await response.json() }; }
  finally { delete globalThis.__dailySupplyClient; }
}

for (const paymentType of ['cash', 'credit']) test(`${paymentType} sale exchanges fresh stock immediately without billing the free units; retry cannot repeat the issue`, async () => {
  const { client, tables } = fixture();
  const args = validSupply({ paymentType, amountCollected: paymentType === 'cash' ? 1000 : 0, stockReplacements: [exchange()] });
  const result = await submit(client, args);
  assert.equal(result.status, 200, result.error);
  assert.equal(result.sale.status, 'approved_posted'); assert.equal(result.sale.total, 1000);
  assert.equal(tables.FieldSaleLine.length, 1); assert.equal(tables.FieldSaleLine[0].quantity, 2);
  assert.equal(tables.StockBalance[0].quantity, 5);
  assert.equal(tables.Customer[0].balance, paymentType === 'cash' ? 0 : 1000);
  assert.equal(tables.CashCollection.length, paymentType === 'cash' ? 1 : 0);
  assert.equal(tables.Account.find(row => row.id === 'revenue').balance, 838.57);
  assert.equal(tables.Account.find(row => row.id === 'tax').balance, 161.43);
  assert.equal(tables.Account.find(row => row.id === 'cogs').balance, 400);
  assert.equal(tables.Account.find(row => row.account_number === 'CUSTOMER-REPLACEMENTS').balance, 600);
  assert.equal(tables.SpoilageRecord.length, 1);
  const record = tables.SpoilageRecord[0];
  assert.equal(record.source_sale_id, result.sale.id); assert.equal(record.posting_basis, 'sale_exchange');
  assert.equal(record.recorded_by, 'login-a'); assert.equal(record.commercial_id, 'agent-a');
  assert.equal(record.verified_by, undefined, 'the operation never invents an independent reviewer');
  assert.equal(record.status, 'replaced'); assert.equal(record.replacement_cost, 600);
  const returned = tables.StockBalance.find(row => row.warehouse_id === record.collection_warehouse_id);
  assert.equal(returned.quantity, 3); assert.equal(returned.qc_status, 'quarantine'); assert.equal(returned.total_value, 0);
  const replacement = tables.StockMovement.find(row => row.movement_type === 'promotional_issue');
  assert.equal(replacement.dispatch_id, 'run-a'); assert.equal(replacement.document_id, record.id);
  const snapshot = structuredClone(tables);
  const retry = await submit(client, { ...args, saleId: result.sale.id });
  assert.equal(retry.reused, true); assert.deepEqual(tables, snapshot);
  // A later sale cannot resell the units that left in the free exchange.
  const blocked = await submit(client, validSupply({ lines: [{ product_id: 'product-a', quantity: 6 }] }));
  assert.equal(blocked.status, 400); assert.match(blocked.error, /stock|loaded|available/i);
  assert.deepEqual(tables, snapshot);
});

test('a damaged return needs no invented expiry date and remains quarantined at zero value', async () => {
  const { client, tables } = fixture();
  const result = await submit(client, validSupply({ stockReplacements: [exchange({ reason: 'damaged', expiry_date: '' })] }));
  assert.equal(result.status, 200, result.error); assert.equal(tables.StockBalance[0].quantity, 5);
  assert.equal(tables.SpoilageRecord[0].reason, 'damaged_at_store'); assert.equal(tables.SpoilageRecord[0].returned_expiry_date, '');
  assert.equal(tables.StockBalance.find(row => row.qc_status === 'quarantine').quantity, 3);
});

test('replacement drafts preserve entered quantities without moving stock or money', async () => {
  const { client, tables } = fixture(), args = validSupply({ submit: false, stockReplacements: [exchange()] });
  const draft = await submit(client, args);
  assert.equal(draft.status, 200, draft.error); assert.deepEqual(draft.sale.stock_replacements, [exchange()]);
  assert.equal(tables.StockBalance[0].quantity, 10); assert.equal(tables.SpoilageRecord.length, 0); assert.equal(tables.JournalEntry.length, 0);
  const result = await submit(client, { ...args, saleId: draft.sale.id, submit: true });
  assert.equal(result.status, 200, result.error); assert.equal(tables.StockBalance[0].quantity, 5); assert.equal(tables.SpoilageRecord.length, 1);
});

test('invalid replacement input, combined stock shortages and unauthorized actors fail before any write', async t => {
  const cases = [
    ['zero quantity', { stockReplacements: [exchange({ quantity: 0 })] }],
    ['boolean quantity', { stockReplacements: [exchange({ quantity: true })] }],
    ['non numeric quantity', { stockReplacements: [exchange({ quantity: 'NaN' })] }],
    ['unknown product', { stockReplacements: [exchange({ product_id: 'missing' })] }],
    ['missing condition', { stockReplacements: [exchange({ reason: '' })] }],
    ['invalid date', { stockReplacements: [exchange({ expiry_date: '2026-02-30' })] }],
    ['not yet expired', { stockReplacements: [exchange({ expiry_date: date })] }],
    ['no expiry evidence', { stockReplacements: [exchange({ expiry_date: '' })] }],
    ['duplicate batch', { stockReplacements: [exchange(), exchange()] }],
    ['combined sale and replacement exceeds run', { stockReplacements: [exchange({ quantity: 9 })] }],
    ['missing receipt', { stockReplacements: [exchange()], receiptFileUris: [] }],
    ['foreign agent', { stockReplacements: [exchange()], commercialId: 'other-agent' }],
    ['foreign run', { stockReplacements: [exchange()], dispatchId: 'other-run' }],
  ];
  for (const [name, patch] of cases) await t.test(name, async () => {
    const { client, tables } = fixture(), before = structuredClone(tables);
    const result = await submit(client, validSupply(patch));
    assert.equal(result.status, name === 'foreign agent' ? 403 : 400, result.error); assert.deepEqual(tables, before);
  });
});

test('checkout combines paid and free quantities while leaving invoice lines intact', () => {
  const lines = [{ product_id: 'p', quantity: 4 }], replacements = [{ product_id: 'p', quantity: 3 }];
  assert.deepEqual(combinedSupplyQuantities(lines, replacements), [{ product_id: 'p', quantity: 7 }]);
  assert.deepEqual(lines, [{ product_id: 'p', quantity: 4 }]);
  const form = { lines, stock_replacements: [exchange({ product_id: 'p' })], transaction_date: date };
  assert.match(validateSaleReplacements(form, [{ id: 'p', quantity: 6 }]), /exceed/);
  assert.equal(validateSaleReplacements(form, [{ id: 'p', quantity: 7 }]), '');
  assert.throws(() => normalizeSaleReplacements('invalid', date), /Choose at most/);
});

test('replacement-only Commercial receipt posts an exchange cost without revenue, cash or new customer debt, exactly once', async () => {
  const {client,tables}=fixture();tables.Customer[0].balance=900;tables.Customer[0].credit_limit=100;tables.Customer[0].credit_status='blocked';
  const args=validSupply({lines:[],paymentType:'exchange',amountCollected:0,stockReplacements:[exchange({reason:'damaged',expiry_date:''})]});
  const result=await submit(client,args);assert.equal(result.status,200,result.error);
  assert.equal(result.sale.supply_kind,'exchange');assert.equal(result.sale.status,'approved_posted');assert.equal(result.sale.total,0);assert.equal(result.sale.amount_due,0);assert.equal(result.sale.journal_id,'');
  assert.equal(companySalesRegister({invoices:[],fieldSales:tables.FieldSale,from:date,to:date}).totals.count,0);
  const report=salesStatusDocument('field',tables.FieldSale,{from:date,to:date});assert.equal(report.sections[0].rows[0][0],'Exchange');assert.equal(report.sections[1].rows.length,0);
  assert.equal(tables.FieldSaleLine.length,0);assert.equal(tables.CashCollection.length,0);assert.equal(tables.StockBalance[0].quantity,7);assert.equal(tables.Customer[0].balance,900);
  assert.equal(tables.Account.find(a=>a.id==='revenue').balance||0,0);assert.equal(tables.Account.find(a=>a.id==='cogs').balance,0);assert.equal(tables.Account.find(a=>a.account_number==='CUSTOMER-REPLACEMENTS').balance,600);
  assert.equal(tables.SpoilageRecord.length,1);assert.equal(tables.JournalEntry.length,1);assert.equal(tables.JournalEntry[0].source_document_type,'SpoilageRecord');
  const returned=tables.StockBalance.find(b=>b.qc_status==='quarantine');assert.equal(returned.quantity,3);assert.equal(returned.total_value,0);
  const before=structuredClone(tables),retry=await submit(client,args);assert.equal(retry.reused,true);assert.deepEqual(tables,before);
  const preview=await submit(client,{action:'proposedJournal',saleId:result.sale.id});assert.equal(preview.status,200,preview.error);assert.equal(preview.posts,true);assert.equal(preview.lines.reduce((n,l)=>n+Number(l.debit||0),0),600);
  const changed=await submit(client,{...args,stockReplacements:[exchange({quantity:4,reason:'damaged',expiry_date:''})]});assert.equal(changed.status,400);assert.deepEqual(tables,before);
});

test('free replacements expense exact recorded carrying value through the configured expense and product inventory accounts',async()=>{
 const {client,tables}=fixture();tables.StockBalance[0].total_value=100;tables.StockBalance[0].unit_cost=1000;
 tables.Account.push({id:'item-inventory',account_number:'ITEM-STOCK',name:'Item inventory',account_type:'asset',normal_balance:'debit',currency:'XAF',is_active:true,is_posting:true,balance:100},{id:'replacement-expense',account_number:'CUSTOM-REPLACEMENT',name:'Configured customer replacement expense',account_type:'other_expense',normal_balance:'debit',currency:'XAF',is_active:true,is_posting:true,balance:0});
 Object.assign(tables.Product[0],{inventory_account_id:'item-inventory',cogs_account_id:'revenue'});
 tables.PostingRule.push({id:'replacement-rule',rule_key:'customer_replacement_expense',account_id:'replacement-expense',is_active:true});
 const args=validSupply({lines:[],paymentType:'exchange',amountCollected:0,stockReplacements:[exchange({reason:'damaged',expiry_date:''})]}),result=await submit(client,args);assert.equal(result.status,200,result.error);
 assert.equal(tables.SpoilageRecord[0].replacement_cost,30);assert.equal(tables.StockBalance[0].quantity,7);assert.equal(tables.StockBalance[0].total_value,70);assert.equal(tables.Account.find(a=>a.id==='replacement-expense').balance,30);assert.equal(tables.Account.find(a=>a.id==='item-inventory').balance,70);assert.equal(tables.Account.find(a=>a.id==='cogs').balance,0);
 assert.deepEqual(tables.JournalLine.map(row=>({account_id:row.account_id,debit:row.debit,credit:row.credit})),[{account_id:'replacement-expense',debit:30,credit:0},{account_id:'item-inventory',debit:0,credit:30}]);assert.equal(tables.Account.some(a=>a.account_number==='CUSTOMER-REPLACEMENTS'),false);
 const before=structuredClone(tables);assert.equal((await submit(client,args)).reused,true);assert.deepEqual(tables,before);
});

test('exchange-only drafts do not move stock; cash, empty replacements, malformed lines and shortages reject before writes', async () => {
  const args=validSupply({lines:[],paymentType:'exchange',amountCollected:0,stockReplacements:[exchange()]});
  for(const patch of [{amountCollected:5},{stockReplacements:[]},{lines:'invalid'},{stockReplacements:[exchange({quantity:11})]}]){
    const {client,tables}=fixture(),before=structuredClone(tables);const result=await submit(client,{...args,...patch});assert.equal(result.status,400,result.error);assert.deepEqual(tables,before);
  }
  const {client,tables}=fixture();const draft=await submit(client,{...args,submit:false});assert.equal(draft.status,200,draft.error);assert.equal(draft.sale.supply_kind,'exchange');assert.equal(tables.StockBalance[0].quantity,10);assert.equal(tables.JournalEntry.length,0);
  const posted=await submit(client,{...args,saleId:draft.sale.id});assert.equal(posted.status,200,posted.error);assert.equal(tables.StockBalance[0].quantity,7);assert.equal(tables.JournalEntry.length,1);
});

for(const exchangeOnly of [false,true])test('Commercial can supply existing finished stock with incomplete assembly setup, including exchanges: '+exchangeOnly,async()=>{
 const {client,tables}=fixture();Object.assign(tables.Product[0],{configuration_status:'draft',components:[]});
 const args=validSupply({stockReplacements:[exchange({reason:'damaged',expiry_date:''})],...(exchangeOnly?{lines:[],paymentType:'exchange',amountCollected:0}:{amountCollected:1000})});
 const result=await submit(client,args);assert.equal(result.status,200,result.error);
 assert.equal(result.sale.total,exchangeOnly?0:1000);assert.equal(tables.StockBalance[0].quantity,exchangeOnly?7:5);assert.equal(tables.SpoilageRecord[0].replacement_cost,600);
 assert.equal(tables.StockBalance.find(row=>row.qc_status==='quarantine').quantity,3);
 const snapshot=structuredClone(tables);assert.equal((await submit(client,args)).reused,true);assert.deepEqual(tables,snapshot);
});
