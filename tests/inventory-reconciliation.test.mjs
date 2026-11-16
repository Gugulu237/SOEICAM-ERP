import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileInventory } from '../src/server/domain/inventory-reconciliation.js';
import { guardMutation } from '../src/server/access.js';
import { reviewStockLot } from '../src/server/domain/stock-quality.js';
import { fixture as cashierFixture } from './helpers/cashier.mjs';

const item = { id: 'cup', name: 'Cup', inventory_type: 'packaging', inventory_account_id: 'packaging' };
const main = { id: 'main', name: 'Packaging Warehouse' };
const recovered = { id: 'held', name: 'Package Recovery' };
const fixture = () => ({
  products: [item],
  warehouses: [main, recovered],
  balances: [
    { id: 'main-cup', product_id: item.id, warehouse_id: main.id, lot_number: 'A', quantity: 2, total_value: 21.5 },
    { id: 'held-cup', product_id: item.id, warehouse_id: recovered.id, lot_number: 'B', quantity: 1, total_value: 5, inventory_recovery_account_id: 'salvage' },
  ],
  movements: [
    { id: 'receipt', product_id: item.id, destination_warehouse_id: main.id, lot_number: 'A', quantity: 4, total_value: 40, status: 'approved' },
    { id: 'issue', product_id: item.id, source_warehouse_id: main.id, lot_number: 'A', quantity: 2, total_value: 20, status: 'approved' },
    { id: 'value-only', product_id: item.id, destination_warehouse_id: main.id, lot_number: 'A', quantity: 0, total_value: 1.5, status: 'approved' },
    { id: 'recovery', product_id: item.id, destination_warehouse_id: recovered.id, lot_number: 'B', quantity: 1, total_value: 5, status: 'approved' },
    { id: 'quality', product_id: item.id, source_warehouse_id: recovered.id, destination_warehouse_id: recovered.id, lot_number: 'B', quantity: 1, total_value: 5, status: 'approved' },
    { id: 'draft', product_id: item.id, destination_warehouse_id: recovered.id, lot_number: 'C', quantity: 1, total_value: 100, status: 'pending' },
  ],
  accounts: [
    { id: 'packaging', account_number: '1310', name: 'Packaging', account_type: 'asset' },
    { id: 'salvage', account_number: '1311', name: 'Recovered packaging', account_type: 'asset' },
  ],
  rules: [],
  journals: [{ id: 'original', status: 'reversed' }, { id: 'reverse', status: 'posted' }, { id: 'draft', status: 'draft' }],
  lines: [
    { journal_id: 'original', account_id: 'packaging', debit: 40, status: 'posted' },
    { journal_id: 'reverse', account_id: 'packaging', credit: 18.5, status: 'posted' },
    { journal_id: 'reverse', account_id: 'salvage', debit: 5, status: 'posted' },
    { journal_id: 'draft', account_id: 'salvage', debit: 100, status: 'draft' },
  ],
});

test('the inventory reconciliation replays stock and ties separately valued recovery to posted general ledger accounts', () => {
  const data = fixture(), before = structuredClone(data);
  const result = reconcileInventory(data);
  assert.equal(result.groups_checked, 2);
  assert.equal(result.lot_difference_count, 0);
  assert.equal(result.reference_issue_count, 0);
  assert.deepEqual(result.accounts.map(row => [row.account_number, row.inventory_value, row.ledger_value, row.value_difference]),
    [['1310', 21.5, 21.5, 0], ['1311', 5, 5, 0]]);
  assert.deepEqual(data, before);
});

test('the inventory reconciliation identifies differences at a cent without overwriting legacy balances', () => {
  const data = fixture();
  data.balances[0].total_value -= 0.01;
  data.movements[3].product_id = 'missing-item';
  const result = reconcileInventory(data);
  assert.equal(result.lot_difference_count, 3);
  assert.equal(result.reference_issue_count, 1);
  const mainLot = result.lots.find(row => row.lot_number === 'A');
  assert.equal(mainLot.quantity_difference, 0);
  assert.equal(mainLot.value_difference, -0.01);
  assert.deepEqual(mainLot.movement_ids, ['receipt', 'issue', 'value-only']);
  assert.equal(result.accounts[0].value_difference, -0.01);
  assert.deepEqual(result.references.map(row => [row.id, row.reason]), [['recovery', 'missing_master']]);
});

test('generic entity writes cannot detach a lot from its movement or change its saleability', () => {
  const gm = { role: 'admin', user: { id: 'gm', role: 'admin' } };
  for (const payload of [{ lot_number: 'new' }, { qc_status: 'approved' }, { expiry_date: '' }]) {
    assert.throws(() => guardMutation(gm, 'StockBalance', 'update', payload, { id: 'lot' }), { status: 403 });
  }
});

test('checked stock quality records a release once and leaves recovered packaging under its own review', async () => {
  const { client, entities } = await cashierFixture();
  const gm = { id: 'gm', role: 'admin' };
  const source = (await entities.StockBalance.list())[0];
  const held = await entities.StockBalance.create({ ...source, id: undefined, lot_number: 'QA-001', qc_status: 'quarantine' });
  const body = { balanceId: held.id, status: 'approved', notes: 'Verified batch identity and seal' };
  assert.deepEqual(await reviewStockLot(client, gm, body), { reviewed: true });
  assert.deepEqual(await reviewStockLot(client, gm, body), { reviewed: true, reused: true });
  const [movement] = await entities.StockMovement.filter({ document_type: 'QualityReview', document_id: held.id });
  assert.deepEqual([movement.source_warehouse_id, movement.destination_warehouse_id], [held.warehouse_id, held.warehouse_id]);
  assert.equal((await entities.AuditLog.filter({ entity_id: held.id })).length, 1);
  const recoveredLot = await entities.StockBalance.create({ ...source, id: undefined, qc_status: 'quarantine', inventory_recovery_id: 'EPR-proof' });
  await assert.rejects(reviewStockLot(client, gm, { ...body, balanceId: recoveredLot.id }), /recovery/);
  assert.equal((await entities.StockBalance.get(recoveredLot.id)).qc_status, 'quarantine');
});
