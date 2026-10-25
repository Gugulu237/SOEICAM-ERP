import test from 'node:test';
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
  assert.equal(tables.Account.find(row => row.id === 'revenue').balance, 1000);
  assert.equal(tables.Account.find(row => row.id === 'cogs').balance, 1000);
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
